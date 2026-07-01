package server

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"blockforgemd/internal/db"
	"blockforgemd/internal/parser"
	"blockforgemd/internal/watcher"

	"github.com/go-chi/chi/v5"
)

type Server struct {
	db         *db.DB
	watcher    *watcher.Watcher
	rootPath   string
	clients    map[chan string]bool
	clientsMu  sync.Mutex
	router     *chi.Mux
}

func NewServer(rootPath string, database *db.DB, w *watcher.Watcher) *Server {
	s := &Server{
		db:       database,
		watcher:  w,
		rootPath: rootPath,
		clients:  make(map[chan string]bool),
		router:   chi.NewRouter(),
	}

	s.setupRoutes()
	go s.listenForWatcherUpdates()

	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

func (s *Server) setupRoutes() {
	// CORS Middleware
	s.router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	// API Endpoints
	s.router.Route("/api", func(r chi.Router) {
		r.Get("/files", s.handleListFiles)
		r.Get("/file", s.handleGetFile)
		r.Post("/file", s.handleSaveFile)
		r.Delete("/file", s.handleDeleteFile)
		r.Patch("/file/front-matter", s.handleUpdateFrontMatter)
		r.Patch("/file/task", s.handleUpdateTaskStatus)
		r.Get("/file/history", s.handleGetFileHistory)
		r.Post("/file/rollback", s.handleRollbackFile)
		r.Post("/upload", s.handleUploadAsset)
		r.Get("/sync/events", s.handleSSE)
		r.Get("/link-preview", s.handleLinkPreview)
	})

	// Serve assets directly from the vault's assets directory
	s.router.Handle("/assets/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fs := http.StripPrefix("/assets", http.FileServer(http.Dir(filepath.Join(s.rootPath, "assets"))))
		fs.ServeHTTP(w, r)
	}))
}

// listenForWatcherUpdates streams updates from the watcher to active SSE clients
func (s *Server) listenForWatcherUpdates() {
	for path := range s.watcher.Updates {
		s.broadcastEvent(path)
	}
}

func (s *Server) broadcastEvent(path string) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for clientChan := range s.clients {
		select {
		case clientChan <- path:
		default:
		}
	}
}

// SSE handler for real-time synchronization
func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	clientChan := make(chan string, 10)

	s.clientsMu.Lock()
	s.clients[clientChan] = true
	s.clientsMu.Unlock()

	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, clientChan)
		s.clientsMu.Unlock()
		close(clientChan)
	}()

	notify := r.Context().Done()

	// Send initial connection event
	fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()

	for {
		select {
		case path := <-clientChan:
			fmt.Fprintf(w, "event: file_update\ndata: %s\n\n", path)
			flusher.Flush()
		case <-notify:
			return
		}
	}
}

// handleListFiles returns all indexed file records
func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	records, err := s.db.ListFiles()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, records)
}

// handleGetFile reads a markdown file and returns its content plus parsed metadata
func (s *Server) handleGetFile(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(s.rootPath, relPath)
	contentBytes, err := os.ReadFile(fullPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read file: %v", err), http.StatusNotFound)
		return
	}

	meta, err := s.db.GetFile(relPath)
	if err != nil {
		// File might not be indexed yet, parse on the fly
		res, parseErr := parser.ParseFile(s.rootPath, relPath)
		if parseErr == nil {
			meta = &res.Record
			meta.FrontMatter = make(map[string]string)
			for k, v := range res.FrontMatter {
				meta.FrontMatter[k] = fmt.Sprintf("%v", v)
			}
		} else {
			meta = &db.FileRecord{Path: relPath, Title: filepath.Base(relPath), Type: "document"}
		}
	}

	tasks, _ := s.db.GetTasksForFile(relPath)

	response := map[string]interface{}{
		"meta":    meta,
		"content": string(contentBytes),
		"tasks":   tasks,
	}
	respondJSON(w, response)
}

// handleSaveFile creates or overwrites a markdown file
func (s *Server) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(s.rootPath, req.Path)
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("failed to create directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Trigger version history backup before overwriting
	s.saveFileBackup(req.Path, req.Content)

	// Lock watcher bypass
	s.watcher.LockPath(req.Path)
	defer s.watcher.UnlockPath(req.Path)

	err := os.WriteFile(fullPath, []byte(req.Content), 0644)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to write file: %v", err), http.StatusInternalServerError)
		return
	}

	// Manually index the file to ensure DB is up to date immediately
	res, err := parser.ParseFile(s.rootPath, req.Path)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to parse file: %v", err), http.StatusInternalServerError)
		return
	}

	err = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update cache: %v", err), http.StatusInternalServerError)
		return
	}

	s.broadcastEvent(req.Path)
	respondJSON(w, map[string]interface{}{"status": "success", "file": res.Record})
}

// handleDeleteFile deletes a markdown file from disk and deletes cache entries
func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(s.rootPath, relPath)
	s.watcher.LockPath(relPath)
	defer s.watcher.UnlockPath(relPath)

	err := os.Remove(fullPath)
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, fmt.Sprintf("failed to delete file: %v", err), http.StatusInternalServerError)
		return
	}

	err = s.db.DeleteFile(relPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to delete cache: %v", err), http.StatusInternalServerError)
		return
	}

	s.broadcastEvent(relPath)
	respondJSON(w, map[string]string{"status": "deleted"})
}

// handleUpdateFrontMatter edits front matter fields directly (e.g. Kanban drag and drop)
func (s *Server) handleUpdateFrontMatter(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string                 `json:"path"`
		Updates map[string]interface{} `json:"updates"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	s.watcher.LockPath(req.Path)
	defer s.watcher.UnlockPath(req.Path)

	newHash, err := parser.UpdateFrontMatterInFile(s.rootPath, req.Path, req.Updates)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update front matter: %v", err), http.StatusInternalServerError)
		return
	}

	// Re-index file metadata
	res, err := parser.ParseFile(s.rootPath, req.Path)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to parse file: %v", err), http.StatusInternalServerError)
		return
	}
	res.Record.ContentHash = newHash

	err = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update cache: %v", err), http.StatusInternalServerError)
		return
	}

	s.broadcastEvent(req.Path)
	respondJSON(w, map[string]interface{}{"status": "success", "file": res.Record})
}

// handleUpdateTaskStatus toggles standard markdown checklist tasks status on save
func (s *Server) handleUpdateTaskStatus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path       string `json:"path"`
		LineNumber int    `json:"lineNumber"`
		Completed  bool   `json:"completed"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.LineNumber <= 0 {
		http.Error(w, "missing path or invalid lineNumber", http.StatusBadRequest)
		return
	}

	s.watcher.LockPath(req.Path)
	defer s.watcher.UnlockPath(req.Path)

	newHash, err := parser.UpdateTaskStatusInFile(s.rootPath, req.Path, req.LineNumber, req.Completed)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update task: %v", err), http.StatusInternalServerError)
		return
	}

	// Re-index file metadata
	res, err := parser.ParseFile(s.rootPath, req.Path)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to parse file: %v", err), http.StatusInternalServerError)
		return
	}
	res.Record.ContentHash = newHash

	err = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update cache: %v", err), http.StatusInternalServerError)
		return
	}

	s.broadcastEvent(req.Path)
	respondJSON(w, map[string]interface{}{"status": "success", "file": res.Record})
}

func respondJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Failed to write JSON response: %v", err)
	}
}

func (s *Server) MountFrontend(fs http.FileSystem) {
	// Simple static file routing fallback
	s.router.Handle("/*", http.StripPrefix("/", http.FileServer(fs)))
}

// saveFileBackup creates a timestamped copy of a file if it has changed
func (s *Server) saveFileBackup(relPath, newContent string) {
	fullPath := filepath.Join(s.rootPath, relPath)
	oldBytes, err := os.ReadFile(fullPath)
	if err != nil {
		// File does not exist yet, no backup needed
		return
	}

	if string(oldBytes) == newContent {
		// Content hasn't changed, skip backup
		return
	}

	escapedPath := url.PathEscape(relPath)
	backupDir := filepath.Join(s.rootPath, ".blockforge", "history", escapedPath)
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		log.Printf("History: failed to create backup dir: %v", err)
		return
	}

	timestamp := time.Now().Unix()
	backupFilePath := filepath.Join(backupDir, fmt.Sprintf("%d.md", timestamp))
	if err := os.WriteFile(backupFilePath, oldBytes, 0644); err != nil {
		log.Printf("History: failed to write backup: %v", err)
		return
	}

	// Prune history to limit of 20 backups
	entries, err := os.ReadDir(backupDir)
	if err == nil && len(entries) > 20 {
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].Name() < entries[j].Name()
		})
		for i := 0; i < len(entries)-20; i++ {
			os.Remove(filepath.Join(backupDir, entries[i].Name()))
		}
	}
}

type historyVersion struct {
	Timestamp int64  `json:"timestamp"`
	Date      string `json:"date"`
	Size      int64  `json:"size"`
}

func (s *Server) handleGetFileHistory(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}

	escapedPath := url.PathEscape(relPath)
	backupDir := filepath.Join(s.rootPath, ".blockforge", "history", escapedPath)

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		// Return empty list if no history folder exists yet
		respondJSON(w, []historyVersion{})
		return
	}

	var versions []historyVersion
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		name := strings.TrimSuffix(entry.Name(), ".md")
		timestamp, err := strconv.ParseInt(name, 10, 64)
		if err != nil {
			continue
		}

		date := time.Unix(timestamp, 0).Format("2006-01-02 15:04:05")
		versions = append(versions, historyVersion{
			Timestamp: timestamp,
			Date:      date,
			Size:      info.Size(),
		})
	}

	// Sort newest first
	sort.Slice(versions, func(i, j int) bool {
		return versions[i].Timestamp > versions[j].Timestamp
	})

	respondJSON(w, versions)
}

func (s *Server) handleRollbackFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path      string `json:"path"`
		Timestamp int64  `json:"timestamp"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Timestamp == 0 {
		http.Error(w, "missing path or timestamp", http.StatusBadRequest)
		return
	}

	escapedPath := url.PathEscape(req.Path)
	backupFilePath := filepath.Join(s.rootPath, ".blockforge", "history", escapedPath, fmt.Sprintf("%d.md", req.Timestamp))

	backupBytes, err := os.ReadFile(backupFilePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("backup snapshot not found: %v", err), http.StatusNotFound)
		return
	}

	fullPath := filepath.Join(s.rootPath, req.Path)

	// Save active as a backup snapshot before rolling back (so we can undo a rollback!)
	s.saveFileBackup(req.Path, string(backupBytes))

	s.watcher.LockPath(req.Path)
	defer s.watcher.UnlockPath(req.Path)

	if err := os.WriteFile(fullPath, backupBytes, 0644); err != nil {
		http.Error(w, fmt.Sprintf("failed to rollback file: %v", err), http.StatusInternalServerError)
		return
	}

	// Re-parse and update DB
	res, err := parser.ParseFile(s.rootPath, req.Path)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to parse rolled-back file: %v", err), http.StatusInternalServerError)
		return
	}

	err = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update cache: %v", err), http.StatusInternalServerError)
		return
	}

	s.broadcastEvent(req.Path)
	respondJSON(w, map[string]interface{}{"status": "success", "file": res.Record, "content": string(backupBytes)})
}

func (s *Server) handleUploadAsset(w http.ResponseWriter, r *http.Request) {
	// Max upload size: 20MB
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		http.Error(w, "Upload size limit exceeded", http.StatusBadRequest)
		return
	}

	file, handler, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Error retrieving the file from form-data (field 'file')", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Parse optional overwritePath query param
	overwritePath := r.URL.Query().Get("overwritePath")
	if overwritePath != "" {
		// Strip query parameters
		if idx := strings.Index(overwritePath, "?"); idx != -1 {
			overwritePath = overwritePath[:idx]
		}
		// Clean fully qualified HTTP URLs if passed
		if strings.HasPrefix(overwritePath, "http://") || strings.HasPrefix(overwritePath, "https://") {
			if u, err := url.Parse(overwritePath); err == nil {
				overwritePath = u.Path
			}
		}
		// Clean prefixes
		overwritePath = strings.TrimPrefix(overwritePath, "/")
		overwritePath = strings.TrimPrefix(overwritePath, "assets/")

		dstPath := filepath.Join(s.rootPath, "assets", filepath.Clean(overwritePath))
		if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
			http.Error(w, "Failed to create assets directory: " + err.Error(), http.StatusInternalServerError)
			return
		}

		dst, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			http.Error(w, "Failed to open asset file for overwriting: " + err.Error(), http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			http.Error(w, "Failed to write asset bytes: " + err.Error(), http.StatusInternalServerError)
			return
		}

		respondJSON(w, map[string]string{
			"url": "/" + filepath.Join("assets", filepath.ToSlash(overwritePath)),
		})
		return
	}

	// Parse optional notePath query param
	notePath := r.URL.Query().Get("notePath")
	var parentDir string
	if notePath != "" {
		parentDir = filepath.Dir(notePath)
		if parentDir == "." || parentDir == "/" {
			parentDir = ""
		}
	}

	// Ensure assets destination directory exists
	assetsDir := filepath.Join(s.rootPath, "assets")
	destSubdir := filepath.Join(assetsDir, parentDir)
	if err := os.MkdirAll(destSubdir, 0755); err != nil {
		http.Error(w, "Failed to create assets directory: " + err.Error(), http.StatusInternalServerError)
		return
	}

	// Sanitize base filename and append a nanosecond timestamp
	ext := filepath.Ext(handler.Filename)
	base := strings.TrimSuffix(handler.Filename, ext)
	base = strings.ReplaceAll(base, " ", "_")
	
	cleanBase := ""
	for _, char := range base {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			cleanBase += string(char)
		}
	}
	if cleanBase == "" {
		cleanBase = "image"
	}

	// Extract and clean note's base name
	var noteBase string
	if notePath != "" {
		noteFile := filepath.Base(notePath)
		noteExt := filepath.Ext(noteFile)
		noteName := strings.TrimSuffix(noteFile, noteExt)
		cleanNoteName := ""
		for _, char := range noteName {
			if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
				cleanNoteName += string(char)
			}
		}
		noteBase = cleanNoteName
	}

	var filename string
	if noteBase != "" {
		filename = fmt.Sprintf("%s-%s-%d%s", noteBase, cleanBase, time.Now().UnixNano(), ext)
	} else {
		filename = fmt.Sprintf("%s-%d%s", cleanBase, time.Now().UnixNano(), ext)
	}
	dstPath := filepath.Join(destSubdir, filename)

	dst, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		http.Error(w, "Failed to create asset file: " + err.Error(), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, "Failed to save asset bytes: " + err.Error(), http.StatusInternalServerError)
		return
	}

	// Construct relative URL path
	var urlPath string
	if parentDir != "" {
		urlPath = fmt.Sprintf("/assets/%s/%s", filepath.ToSlash(parentDir), filename)
	} else {
		urlPath = fmt.Sprintf("/assets/%s", filename)
	}

	respondJSON(w, map[string]string{
		"url": urlPath,
	})
}

// ─── Link Preview ─────────────────────────────────────────────────────────────

type LinkPreviewResult struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	Favicon     string `json:"favicon"`
	SiteName    string `json:"siteName"`
	EmbedURL    string `json:"embedUrl,omitempty"`
	URL         string `json:"url"`
}

type previewCacheEntry struct {
	result    LinkPreviewResult
	fetchedAt time.Time
}

var (
	previewCache   = make(map[string]previewCacheEntry)
	previewCacheMu sync.Mutex
)

var ytRegexes = []*regexp.Regexp{
	regexp.MustCompile(`(?:youtube\.com/watch\?.*v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})`),
}

var vimeoRegexes = []*regexp.Regexp{
	regexp.MustCompile(`vimeo\.com/(?:video/)?(\d+)`),
}

func (s *Server) handleLinkPreview(w http.ResponseWriter, r *http.Request) {
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

	// Check cache
	previewCacheMu.Lock()
	if entry, found := previewCache[rawURL]; found && time.Since(entry.fetchedAt) < 10*time.Minute {
		previewCacheMu.Unlock()
		respondJSON(w, entry.result)
		return
	}
	previewCacheMu.Unlock()

	result := LinkPreviewResult{
		URL: rawURL,
	}

	// Special case YouTube
	for _, reg := range ytRegexes {
		if matches := reg.FindStringSubmatch(rawURL); len(matches) > 1 {
			videoID := matches[1]
			result.Title = "YouTube Video"
			result.SiteName = "YouTube"
			result.Image = fmt.Sprintf("https://img.youtube.com/vi/%s/hqdefault.jpg", videoID)
			result.EmbedURL = fmt.Sprintf("https://www.youtube.com/embed/%s", videoID)
			result.Favicon = "https://www.google.com/s2/favicons?domain=youtube.com&sz=32"
			break
		}
	}

	// Special case Vimeo
	if result.EmbedURL == "" {
		for _, reg := range vimeoRegexes {
			if matches := reg.FindStringSubmatch(rawURL); len(matches) > 1 {
				videoID := matches[1]
				result.Title = "Vimeo Video"
				result.SiteName = "Vimeo"
				result.EmbedURL = fmt.Sprintf("https://player.vimeo.com/video/%s", videoID)
				result.Favicon = "https://www.google.com/s2/favicons?domain=vimeo.com&sz=32"
				break
			}
		}
	}

	// Fetch page metadata if not fully populated by special embed logic
	if result.Title == "" || result.Image == "" {
		client := http.Client{
			Timeout: 4 * time.Second,
		}
		req, err := http.NewRequest("GET", rawURL, nil)
		if err == nil {
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36")
			resp, err := client.Do(req)
			if err == nil {
				defer resp.Body.Close()
				bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
				if err == nil {
					htmlContent := string(bodyBytes)
					
					// Parse title
					if title := extractMeta(htmlContent, `(?i)<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']`); title != "" {
						result.Title = title
					} else if title := extractMeta(htmlContent, `(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']`); title != "" {
						result.Title = title
					} else if title := extractTag(htmlContent, `(?i)<title[^>]*>([^<]+)</title>`); title != "" {
						result.Title = title
					}

					// Parse description
					if desc := extractMeta(htmlContent, `(?i)<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']`); desc != "" {
						result.Description = desc
					} else if desc := extractMeta(htmlContent, `(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']`); desc != "" {
						result.Description = desc
					} else if desc := extractMeta(htmlContent, `(?i)<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']`); desc != "" {
						result.Description = desc
					} else if desc := extractMeta(htmlContent, `(?i)<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']`); desc != "" {
						result.Description = desc
					}

					// Parse image
					if img := extractMeta(htmlContent, `(?i)<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']`); img != "" {
						result.Image = img
					} else if img := extractMeta(htmlContent, `(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']`); img != "" {
						result.Image = img
					}

					// Parse site name
					if site := extractMeta(htmlContent, `(?i)<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']`); site != "" {
						result.SiteName = site
					} else if site := extractMeta(htmlContent, `(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']`); site != "" {
						result.SiteName = site
					}

					// Parse favicon
					if fav := extractMeta(htmlContent, `(?i)<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']`); fav != "" {
						result.Favicon = fav
					} else if fav := extractMeta(htmlContent, `(?i)<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']`); fav != "" {
						result.Favicon = fav
					}
				}
			}
		}
	}

	// Set defaults/fallbacks
	if result.Title == "" {
		result.Title = u.Host
	}
	if result.SiteName == "" {
		result.SiteName = u.Host
		if strings.HasPrefix(result.SiteName, "www.") {
			result.SiteName = result.SiteName[4:]
		}
	}
	if result.Favicon == "" {
		result.Favicon = fmt.Sprintf("https://www.google.com/s2/favicons?domain=%s&sz=32", u.Host)
	} else {
		favURL, err := url.Parse(result.Favicon)
		if err == nil {
			result.Favicon = u.ResolveReference(favURL).String()
		}
	}

	if result.Image != "" {
		imgURL, err := url.Parse(result.Image)
		if err == nil {
			result.Image = u.ResolveReference(imgURL).String()
		}
	}

	// Save to cache
	previewCacheMu.Lock()
	previewCache[rawURL] = previewCacheEntry{
		result:    result,
		fetchedAt: time.Now(),
	}
	previewCacheMu.Unlock()

	respondJSON(w, result)
}

func extractMeta(htmlContent, regexStr string) string {
	re := regexp.MustCompile(regexStr)
	matches := re.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return strings.TrimSpace(html.UnescapeString(matches[1]))
	}
	return ""
}

func extractTag(htmlContent, regexStr string) string {
	re := regexp.MustCompile(regexStr)
	matches := re.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return strings.TrimSpace(html.UnescapeString(matches[1]))
	}
	return ""
}
