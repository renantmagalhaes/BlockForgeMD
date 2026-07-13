package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
)

// Some sites (Reddit among them) send X-Frame-Options/CSP headers that block
// iframe embedding outright. Rather than show a blank/broken frame, the
// editor's iframe embed falls back to a server-rendered screenshot — this
// file provides both the "can this be framed?" check and the screenshot
// renderer (via a headless, per-request Chromium instance) backing that.

// screenshotSem bounds how many headless Chromium instances can run at once,
// since each one is a real, fairly heavy browser process.
var screenshotSem = make(chan struct{}, 2)

// Screenshots are cached indefinitely once captured — a card's embed doesn't
// need to be re-rendered every time the page is opened, only the first time
// a given URL is embedded. The cache lives under the workspace root (not
// os.TempDir()) so it survives container restarts; ".blockforge-cache" is
// dot-prefixed so the watcher/indexer/file browser already ignore it (see
// watcher.go's isTrashPath/hidden-path skip).
func (s *Server) screenshotCacheDir() string {
	dir := filepath.Join(s.rootPath, ".blockforge-cache", "screenshots")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func (s *Server) screenshotCachePath(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return filepath.Join(s.screenshotCacheDir(), hex.EncodeToString(sum[:])+".png")
}

// handleEmbedCheck reports whether a URL's response headers allow it to be
// framed by us. This is a best-effort header check (X-Frame-Options and the
// CSP frame-ancestors directive), not a real embed attempt, so it can't
// account for every edge case — but it covers the common "this site outright
// refuses to be framed" scenario the frontend needs to decide between
// rendering an <iframe> or falling back to a screenshot.
func (s *Server) handleEmbedCheck(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url parameter", http.StatusBadRequest)
		return
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		http.Error(w, "Invalid url parameter", http.StatusBadRequest)
		return
	}

	embeddable := true
	client := http.Client{
		Timeout: 5 * time.Second,
		// Redirects can change the framing policy of the page we actually land
		// on, so let the client follow them (default behavior) and inspect the
		// final response's headers.
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err == nil {
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36")
		resp, err := client.Do(req)
		if err == nil {
			defer resp.Body.Close()
			xfo := strings.ToUpper(strings.TrimSpace(resp.Header.Get("X-Frame-Options")))
			if xfo == "DENY" || xfo == "SAMEORIGIN" {
				embeddable = false
			}
			if csp := resp.Header.Get("Content-Security-Policy"); csp != "" {
				for _, directive := range strings.Split(csp, ";") {
					directive = strings.TrimSpace(directive)
					if !strings.HasPrefix(strings.ToLower(directive), "frame-ancestors") {
						continue
					}
					lower := strings.ToLower(directive)
					if !strings.Contains(lower, "*") {
						embeddable = false
					}
				}
			}
		}
		// A failed request here isn't evidence the site blocks framing — fail
		// open and let the iframe attempt happen normally.
	}

	respondJSON(w, map[string]bool{"embeddable": embeddable})
}

// handleScreenshot renders a URL in a headless, throwaway Chromium instance
// and returns a PNG viewport screenshot, disk-cached for screenshotCacheTTL.
func (s *Server) handleScreenshot(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url parameter", http.StatusBadRequest)
		return
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		http.Error(w, "Invalid url parameter", http.StatusBadRequest)
		return
	}

	cachePath := s.screenshotCachePath(rawURL)
	if _, err := os.Stat(cachePath); err == nil {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(w, r, cachePath)
		return
	}

	select {
	case screenshotSem <- struct{}{}:
		defer func() { <-screenshotSem }()
	case <-time.After(15 * time.Second):
		http.Error(w, "Screenshot service is busy, try again shortly", http.StatusServiceUnavailable)
		return
	}

	buf, err := renderScreenshot(rawURL)
	if err != nil {
		log.Printf("Screenshot failed for %s: %v", rawURL, err)
		http.Error(w, "Failed to capture screenshot", http.StatusBadGateway)
		return
	}

	if err := os.WriteFile(cachePath, buf, 0o644); err != nil {
		log.Printf("Failed to cache screenshot for %s: %v", rawURL, err)
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = w.Write(buf)
}

func renderScreenshot(rawURL string) ([]byte, error) {
	// Without an explicit user-data-dir, Chrome derives one from $HOME, which
	// may not exist (or be writable) for the unprivileged user the container
	// runs as after entrypoint.sh drops privileges — that leaves Chrome
	// unable to construct a crashpad database path and it fails to start
	// entirely ("chrome_crashpad_handler: --database is required"). Giving it
	// a concrete, guaranteed-writable temp dir per request sidesteps that.
	// Debian's chromium package's crashpad handler turned out to read $HOME
	// directly too, independent of --user-data-dir, so both need pointing at
	// the same writable dir — --user-data-dir alone wasn't enough.
	userDataDir, err := os.MkdirTemp("", "blockforgemd-chrome-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(userDataDir)

	allocCtx, cancelAlloc := chromedp.NewExecAllocator(
		context.Background(),
		append(
			chromedp.DefaultExecAllocatorOptions[:],
			chromedp.NoSandbox,
			chromedp.Flag("disable-gpu", true),
			chromedp.Flag("disable-crash-reporter", true),
			chromedp.UserDataDir(userDataDir),
			chromedp.Env("HOME="+userDataDir, "XDG_CONFIG_HOME="+userDataDir, "XDG_CACHE_HOME="+userDataDir),
			// Headless Chrome's default UA literally contains "HeadlessChrome",
			// an easy tell that gets some sites' bot detection to block harder
			// than they would a plain scraper. Presenting as a normal desktop
			// Chrome install clears the most basic tier of that detection —
			// it won't help against sites doing deeper fingerprinting (Reddit
			// in particular still blocks this — that's a losing arms race, not
			// a bug to chase further here).
			chromedp.UserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"),
		)...,
	)
	defer cancelAlloc()

	taskCtx, cancelTask := chromedp.NewContext(allocCtx)
	defer cancelTask()

	// The browser itself is allocated lazily on the first Run below, so it's
	// safe to bound this call with a timeout — unlike wrapping the allocator
	// context, which would tear down the whole browser instead of just this
	// one navigation.
	timeoutCtx, cancelTimeout := context.WithTimeout(taskCtx, 20*time.Second)
	defer cancelTimeout()

	var buf []byte
	err = chromedp.Run(timeoutCtx,
		chromedp.EmulateViewport(1280, 800),
		chromedp.Navigate(rawURL),
		chromedp.Sleep(1500*time.Millisecond),
		chromedp.CaptureScreenshot(&buf),
	)
	if err != nil {
		return nil, err
	}
	return buf, nil
}
