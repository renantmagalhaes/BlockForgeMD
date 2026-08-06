package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// PDF rendering starts a full Chromium process, so keep it deliberately
// scarce. Unlike window.print(), this produces a downloadable PDF response
// with Chrome's native link annotations intact (including #anchor links).
var pdfExportSem = make(chan struct{}, 1)

var imageSrcAttribute = regexp.MustCompile(`(?i)(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])`)
var localAssetURL = regexp.MustCompile(`(?i)(?:src|href)\s*=\s*["'](/[^"'#?]+)["']|\]\(<?(/[^) >]+)>?\)`)

func (s *Server) handleExportPDF(w http.ResponseWriter, r *http.Request) {
	var req struct {
		HTML string `json:"html"`
		Name string `json:"name"`
	}
	// The browser embeds local images before requesting a PDF, so allow a
	// document containing several high-resolution images while still putting a
	// sensible ceiling on a single export request.
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.HTML == "" {
		http.Error(w, "a document HTML payload is required", http.StatusBadRequest)
		return
	}
	select {
	case pdfExportSem <- struct{}{}:
		defer func() { <-pdfExportSem }()
	case <-time.After(15 * time.Second):
		http.Error(w, "PDF export is busy; try again shortly", http.StatusServiceUnavailable)
		return
	}

	proto := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		proto = "https"
	}
	// Headless Chromium renders this document from about:blank. Embed vault
	// images first so exports do not rely on that temporary page being able to
	// fetch local assets over HTTP.
	exportHTML := inlineVaultImages(req.HTML, s.rootPath)
	pdf, err := renderPDF(withDocumentBaseURL(exportHTML, proto+"://"+r.Host+"/"))
	if err != nil {
		http.Error(w, "failed to generate PDF: "+err.Error(), http.StatusBadGateway)
		return
	}
	name := safeDownloadName(req.Name)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name+".pdf"))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(pdf)))
	_, _ = w.Write(pdf)
}

// handleExportArchive returns the normal file for text-only exports, but
// packages a document and every referenced vault asset into a portable ZIP
// whenever local images or attachments are present.
func (s *Server) handleExportArchive(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content string `json:"content"`
		Name    string `json:"name"`
		Format  string `json:"format"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Content == "" || (req.Format != "md" && req.Format != "html") {
		http.Error(w, "a document export payload is required", http.StatusBadRequest)
		return
	}

	content, assets := collectExportAssets(req.Content, s.rootPath)
	base := safeDownloadName(strings.TrimSuffix(strings.TrimSuffix(req.Name, ".md"), ".html"))
	if len(assets) == 0 {
		contentType := "text/markdown;charset=utf-8"
		if req.Format == "html" {
			contentType = "text/html;charset=utf-8"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", base+"."+req.Format))
		_, _ = w.Write([]byte(content))
		return
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	entry, err := zw.Create(base + "." + req.Format)
	if err == nil {
		_, err = entry.Write([]byte(content))
	}
	for zipPath, data := range assets {
		if err != nil {
			break
		}
		entry, err = zw.Create(zipPath)
		if err == nil {
			_, err = entry.Write(data)
		}
	}
	if err == nil {
		err = zw.Close()
	} else {
		_ = zw.Close()
	}
	if err != nil {
		http.Error(w, "failed to create export archive", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", base+".zip"))
	_, _ = w.Write(buf.Bytes())
}

// collectExportAssets rewrites rooted vault URLs into archive-relative URLs
// and returns their file contents keyed by their portable archive path.
func collectExportAssets(content, rootPath string) (string, map[string][]byte) {
	assets := make(map[string][]byte)
	rootAbs, err := filepath.Abs(rootPath)
	if err != nil {
		return content, assets
	}
	rootPrefix := rootAbs + string(filepath.Separator)
	for _, match := range localAssetURL.FindAllStringSubmatch(content, -1) {
		ref := match[1]
		if ref == "" {
			ref = match[2]
		}
		if ref == "" || strings.HasPrefix(ref, "//") {
			continue
		}
		parsed, parseErr := url.Parse(ref)
		if parseErr != nil {
			continue
		}
		rel, unescapeErr := url.PathUnescape(strings.TrimPrefix(parsed.Path, "/"))
		if unescapeErr != nil || rel == "" || (!strings.Contains("/"+filepath.ToSlash(rel), "/assets/") && !strings.HasPrefix(filepath.ToSlash(rel), ".assets/")) {
			continue
		}
		fullPath, absErr := filepath.Abs(filepath.Join(rootAbs, filepath.FromSlash(rel)))
		if absErr != nil || !strings.HasPrefix(fullPath, rootPrefix) {
			continue
		}
		data, readErr := os.ReadFile(fullPath)
		if readErr != nil {
			continue
		}
		archivePath := filepath.ToSlash(rel)
		assets[archivePath] = data
		// Retain URL encoding in the document: it resolves to the decoded
		// filename when the ZIP is extracted or opened by a browser.
		content = strings.ReplaceAll(content, ref, strings.TrimPrefix(ref, "/"))
	}
	return content, assets
}

// inlineVaultImages replaces root-relative image URLs emitted by the editor
// with data URLs. It deliberately leaves remote and non-image resources alone.
// A failed read also leaves the original URL untouched, retaining the browser
// fallback for any supported URL that is not stored in the vault.
func inlineVaultImages(html, rootPath string) string {
	rootAbs, err := filepath.Abs(rootPath)
	if err != nil {
		return html
	}
	rootPrefix := rootAbs + string(filepath.Separator)
	return imageSrcAttribute.ReplaceAllStringFunc(html, func(match string) string {
		parts := imageSrcAttribute.FindStringSubmatch(match)
		if len(parts) != 4 || !strings.HasPrefix(parts[2], "/") || strings.HasPrefix(parts[2], "//") {
			return match
		}
		parsed, err := url.Parse(parts[2])
		if err != nil {
			return match
		}
		rel, err := url.PathUnescape(strings.TrimPrefix(parsed.Path, "/"))
		if err != nil || rel == "" {
			return match
		}
		assetPath, err := filepath.Abs(filepath.Join(rootAbs, filepath.FromSlash(rel)))
		if err != nil || (assetPath != rootAbs && !strings.HasPrefix(assetPath, rootPrefix)) {
			return match
		}
		data, err := os.ReadFile(assetPath)
		if err != nil {
			return match
		}
		contentType := mime.TypeByExtension(filepath.Ext(assetPath))
		if contentType == "" {
			contentType = http.DetectContentType(data)
		}
		if !strings.HasPrefix(contentType, "image/") {
			return match
		}
		return parts[1] + "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data) + parts[3]
	})
}

func withDocumentBaseURL(html, baseURL string) string {
	base := `<base href="` + strings.ReplaceAll(strings.ReplaceAll(baseURL, `"`, ""), "'", "") + `">`
	if strings.Contains(html, "<head>") {
		return strings.Replace(html, "<head>", "<head>"+base, 1)
	}
	return base + html
}

func safeDownloadName(name string) string {
	if name == "" {
		return "document"
	}
	out := make([]rune, 0, len(name))
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return "document"
	}
	return string(out)
}

func renderPDF(html string) ([]byte, error) {
	userDataDir, err := os.MkdirTemp("", "blockforgemd-pdf-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(userDataDir)

	allocCtx, cancelAlloc := chromedp.NewExecAllocator(context.Background(), append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.NoSandbox, chromedp.Flag("disable-gpu", true), chromedp.Flag("disable-crash-reporter", true),
		chromedp.UserDataDir(userDataDir), chromedp.Env("HOME="+userDataDir, "XDG_CONFIG_HOME="+userDataDir, "XDG_CACHE_HOME="+userDataDir),
	)...)
	defer cancelAlloc()
	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()
	ctx, cancelTimeout := context.WithTimeout(ctx, 45*time.Second)
	defer cancelTimeout()

	var pdf []byte
	err = chromedp.Run(ctx,
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			tree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}
			return page.SetDocumentContent(tree.Frame.ID, html).Do(ctx)
		}),
		// Give vault assets and web fonts a moment to load before Chromium
		// snapshots the page. Relative asset URLs resolve through the <base>
		// added above, rather than against about:blank.
		chromedp.Sleep(1200*time.Millisecond),
		chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			pdf, _, err = page.PrintToPDF().WithPrintBackground(true).WithPreferCSSPageSize(true).Do(ctx)
			return err
		}),
	)
	return pdf, err
}
