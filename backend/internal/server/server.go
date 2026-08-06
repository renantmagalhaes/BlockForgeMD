package server

import (
	"context"
	"encoding/json"
	"errors"
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
	"blockforgemd/internal/plugins"
	"blockforgemd/internal/plugins/aitags"
	"blockforgemd/internal/plugins/googlecalendar"
	"blockforgemd/internal/watcher"

	"github.com/go-chi/chi/v5"
)

type Server struct {
	db        *db.DB
	watcher   *watcher.Watcher
	rootPath  string
	clients   map[chan string]bool
	clientsMu sync.Mutex
	router    *chi.Mux
	plugins   *plugins.Registry
}

func NewServer(rootPath string, database *db.DB, w *watcher.Watcher, encKey [32]byte) *Server {
	s := &Server{
		db:       database,
		watcher:  w,
		rootPath: rootPath,
		clients:  make(map[chan string]bool),
		router:   chi.NewRouter(),
		plugins:  plugins.NewRegistry(),
	}

	s.plugins.Register(googlecalendar.New(database, s, encKey))
	s.plugins.Register(aitags.New(database, s, encKey))
	s.plugins.RegisterComingSoon(plugins.Meta{ID: "mcp-servers", Name: "MCP Servers", Category: "mcp"})
	s.plugins.RegisterComingSoon(plugins.Meta{ID: "llm-providers", Name: "LLM Providers", Category: "llm"})
	if err := s.plugins.StartAll(context.Background()); err != nil {
		log.Printf("plugins: failed to start: %v", err)
	}

	s.setupRoutes()
	go s.listenForWatcherUpdates()
	s.startTrashCleanup()
	s.startDueDateAutoUpdate()

	return s
}

// StopPlugins cancels every registered plugin's background work and waits
// for it to unwind — called during graceful shutdown alongside the file
// watcher and DB connection.
func (s *Server) StopPlugins() {
	s.plugins.StopAll()
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

	// Auth routes (public — no auth middleware)
	s.router.Route("/auth", func(r chi.Router) {
		r.Get("/status", s.handleAuthStatus)
		r.Post("/bootstrap", s.handleBootstrap)
		r.Post("/login", s.handleLogin)
		r.Post("/logout", s.handleLogout)
		r.Get("/me", s.handleMe)
	})

	// API Endpoints
	s.router.Route("/api", func(r chi.Router) {
		r.Use(s.requireAuth)
		r.Get("/files", s.handleListFiles)
		r.Patch("/files/reorder", s.handleReorderFiles)
		r.Get("/file", s.handleGetFile)
		r.Post("/file", s.handleSaveFile)
		r.Delete("/file", s.handleDeleteFile)
		r.Delete("/folder", s.handleDeleteFolder)
		r.Get("/trash", s.handleListTrash)
		r.Get("/trash/search", s.handleSearchTrash)
		r.Post("/trash/restore", s.handleRestoreTrashItem)
		r.Delete("/trash", s.handlePurgeTrashItem)
		r.Delete("/trash/all", s.handleEmptyTrash)
		r.Get("/trash-asset/{workspace}/{id}/{file}", s.handleTrashAsset)
		r.Get("/trash/content", s.handleGetTrashContent)
		r.Patch("/file/front-matter", s.handleUpdateFrontMatter)
		r.Patch("/file/task", s.handleUpdateTaskStatus)
		r.Get("/file/history", s.handleGetFileHistory)
		r.Get("/file/history/content", s.handleGetFileHistoryContent)
		r.Post("/file/history/checkpoint", s.handleCreateCheckpoint)
		r.Post("/file/rollback", s.handleRollbackFile)
		r.Post("/file/move", s.handleMoveFile)
		r.Post("/upload", s.handleUploadAsset)
		r.Get("/sync/events", s.handleSSE)
		r.Get("/link-preview", s.handleLinkPreview)
		r.Get("/embed-check", s.handleEmbedCheck)
		r.Get("/screenshot", s.handleScreenshot)
		r.Post("/export/pdf", s.handleExportPDF)
		r.Post("/export/archive", s.handleExportArchive)
		r.Get("/search", s.handleSearch)
		r.Post("/search/open", s.handleRecordSearchOpen)
		r.Get("/settings", s.handleGetSettings)
		r.Post("/settings", s.handleSaveSettings)
		r.Get("/favorites", s.handleGetFavorites)
		r.Post("/favorites", s.handleSetFavorites)
		r.Get("/folder-collapse", s.handleGetFolderCollapse)
		r.Post("/folder-collapse", s.handleSetFolderCollapse)
		r.Get("/tag-colors", s.handleGetTagColors)
		r.Post("/tag-colors", s.handleSetTagColors)
		r.Get("/workspaces", s.handleListWorkspaces)
		r.Post("/workspaces", s.handleCreateWorkspace)
		r.Post("/workspaces/rename", s.handleRenameWorkspace)
		r.Post("/workspaces/migrate", s.handleMigrateWorkspace)
		r.Delete("/workspaces", s.handleDeleteWorkspace)
		r.Get("/backlinks", s.handleGetBacklinks)
		r.Get("/graph", s.handleGetGraph)
		r.Get("/cards", s.handleGetCards)
		r.Post("/due-dates/auto-update/run", s.handleRunDueDateAutoUpdate)
		r.Get("/users", s.handleListUsers)
		r.Post("/users", s.handleCreateUser)
		r.Delete("/users/{id}", s.handleDeleteUser)
		r.Patch("/users/{id}/password", s.handleChangeUserPassword)
		r.Get("/keys", s.handleListAPIKeys)
		r.Post("/keys", s.handleCreateAPIKey)
		r.Delete("/keys/{id}", s.handleDeleteAPIKey)

		r.Get("/plugins", s.handleListPlugins)
		r.Get("/plugins/google-calendar/config", s.handleGCalGetConfig)
		r.Post("/plugins/google-calendar/config", s.handleGCalSetConfig)
		r.Get("/plugins/google-calendar/oauth/start", s.handleGCalOAuthStart)
		r.Post("/plugins/google-calendar/disconnect", s.handleGCalDisconnect)
		r.Get("/plugins/google-calendar/status", s.handleGCalStatus)
		r.Post("/plugins/google-calendar/sync-now", s.handleGCalSyncNow)
		r.Get("/plugins/google-calendar/calendars", s.handleGCalListCalendars)
		r.Post("/plugins/google-calendar/calendar", s.handleGCalSetCalendar)
		r.Post("/plugins/google-calendar/completion-policy", s.handleGCalSetCompletionPolicy)
		r.Get("/plugins/ai-auto-tags/config", s.handleAITagsGetConfig)
		r.Post("/plugins/ai-auto-tags/config", s.handleAITagsSetConfig)
		r.Get("/plugins/ai-auto-tags/models", s.handleAITagsModels)
		r.Post("/plugins/ai-auto-tags/tag-file", s.handleAITagsTagFile)
	})

	// Google's OAuth redirect lands here with the bare browser (no session
	// cookie context useful to us), so this can't sit behind requireAuth like
	// the rest of /api — the signed `state` param is what authenticates it.
	s.router.Get("/api/plugins/google-calendar/oauth/callback", s.handleGCalOAuthCallback)

	// API reference docs page
	s.router.Get("/docs", s.handleGetDocs)

	// Serve workspace-scoped assets (e.g. /Default/assets/image.png)
	s.router.Handle("/{workspace}/assets/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workspace := chi.URLParam(r, "workspace")
		prefix := "/" + workspace + "/assets"
		fs := http.StripPrefix(prefix, http.FileServer(http.Dir(filepath.Join(s.rootPath, workspace, "assets"))))
		fs.ServeHTTP(w, r)
	}))

	// Serve the no-workspace-context upload fallback (see handleUploadAsset /
	// noteAssetBase) — rare in practice, but should still resolve rather than
	// silently 404 if it's ever hit.
	s.router.Handle("/.assets/*", http.StripPrefix("/.assets", http.FileServer(http.Dir(filepath.Join(s.rootPath, ".assets")))))
}

// listenForWatcherUpdates streams updates from the watcher to active SSE clients
func (s *Server) listenForWatcherUpdates() {
	for path := range s.watcher.Updates {
		s.broadcastEvent(path)
	}
}

func (s *Server) broadcastEvent(path string) {
	s.plugins.NotifyFileChanged(path)

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
	// nginx (and anything built on it, e.g. Nginx Proxy Manager) buffers
	// proxied responses by default, which would hold back every SSE event
	// until its buffer fills or the connection closes. This response header
	// is nginx's documented per-response override to disable that buffering,
	// with no proxy-side config needed — defensive for any nginx-fronted
	// deployment even though it wasn't the confirmed cause of any specific
	// reported issue.
	w.Header().Set("X-Accel-Buffering", "no")

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

	// Reverse proxies, NAS gateways, and browsers routinely reap SSE streams
	// that sit idle too long between real events, which the frontend then
	// (mis)reports as "Vault Offline" when the client reconnects. A periodic
	// comment line keeps the connection alive without ever surfacing as a
	// dispatched event (SSE comments start with ':' and are ignored by
	// EventSource per spec).
	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case path := <-clientChan:
			fmt.Fprintf(w, "event: file_update\ndata: %s\n\n", path)
			flusher.Flush()
		case <-keepalive.C:
			fmt.Fprintf(w, ": keepalive\n\n")
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
	// cover/attachments are indexed as stored on disk (relative, for GitHub
	// portability) — expand to the app's absolute form for display here since
	// this list is what card thumbnails and the editor's front matter render.
	for i := range records {
		parser.RewriteFrontMatterMapAssetFields(records[i].FrontMatter, records[i].Path, parser.AbsoluteAssetPath)
	}
	respondJSON(w, records)
}

// handleReorderFiles updates the position field for a batch of files to persist custom ordering.
func (s *Server) handleReorderFiles(w http.ResponseWriter, r *http.Request) {
	var updates []db.PositionUpdate
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := s.db.UpdatePositions(updates); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

	// Asset references are stored on disk relative to this file (portable for
	// GitHub etc.) — expand them back to the app's absolute form for display.
	content := parser.RewriteAssetPaths(relPath, string(contentBytes), parser.AbsoluteAssetPath)
	parser.RewriteFrontMatterMapAssetFields(meta.FrontMatter, relPath, parser.AbsoluteAssetPath)

	response := map[string]interface{}{
		"meta":    meta,
		"content": content,
		"tasks":   tasks,
	}
	respondJSON(w, response)
}

// handleSaveFile creates or overwrites a markdown file
// multiPartExtensions are suffixes treated as a single unit when disambiguating
// a colliding filename (so "Board.board.md" becomes "Board-2.board.md", not
// "Board.board-2.md").
var multiPartExtensions = []string{".board.md", ".excalidraw.md", ".drawio.md", ".mindmap.md"}

// uniquifyPath returns relPath unchanged if nothing exists there yet; otherwise
// it finds the first "-2", "-3", ... suffix (inserted before the file's
// extension) that doesn't collide with an existing file.
func uniquifyPath(rootPath, relPath string) string {
	if _, err := os.Stat(filepath.Join(rootPath, relPath)); os.IsNotExist(err) {
		return relPath
	}

	base := strings.TrimSuffix(relPath, filepath.Ext(relPath))
	ext := filepath.Ext(relPath)
	for _, e := range multiPartExtensions {
		if strings.HasSuffix(relPath, e) {
			base = relPath[:len(relPath)-len(e)]
			ext = e
			break
		}
	}

	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", base, i, ext)
		if _, err := os.Stat(filepath.Join(rootPath, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
}

func (s *Server) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path       string `json:"path"`
		Content    string `json:"content"`
		CreateOnly bool   `json:"createOnly"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	// For brand-new items (not saves of an already-open file), never clobber
	// an existing file that happens to share the same generated name/path —
	// pick the next free "-2", "-3", ... name instead.
	if req.CreateOnly {
		req.Path = uniquifyPath(s.rootPath, req.Path)
	}

	fullPath := filepath.Join(s.rootPath, req.Path)
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("failed to create directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Lock watcher bypass
	s.watcher.LockPath(req.Path)
	defer s.watcher.UnlockPath(req.Path)

	// Store asset references (cover, attachments, inline images) as paths
	// relative to this file rather than the app's absolute "/Workspace/assets/..."
	// form, so the vault stays viewable (images included) when synced to GitHub
	// or opened as plain files elsewhere.
	content := parser.RewriteAssetPaths(req.Path, req.Content, parser.RelativeAssetPath)

	err := os.WriteFile(fullPath, []byte(content), 0644)
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

	// Auto-assign the creator as owner: brand-new pages with no explicit
	// `assignee` get one set automatically, so due-dated pages are
	// immediately routed to the right person's calendar (see the Google
	// Calendar plugin's assignee-based sync) without manual bookkeeping.
	// Enforced here (not just in the frontend's creation modal) so it also
	// covers the public /api/file REST API path. Only applies going forward
	// — an explicit `assignee: ""` from a caller counts as already specified
	// and is left alone.
	if req.CreateOnly {
		if _, hasAssignee := res.FrontMatter["assignee"]; !hasAssignee {
			if user := userFromCtx(r); user != nil {
				if _, err := parser.UpdateFrontMatterInFile(s.rootPath, req.Path, map[string]interface{}{"assignee": user.Username}); err != nil {
					http.Error(w, fmt.Sprintf("failed to auto-assign creator: %v", err), http.StatusInternalServerError)
					return
				}
				res, err = parser.ParseFile(s.rootPath, req.Path)
				if err != nil {
					http.Error(w, fmt.Sprintf("failed to parse file: %v", err), http.StatusInternalServerError)
					return
				}
			}
		}
	}

	err = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update cache: %v", err), http.StatusInternalServerError)
		return
	}

	s.broadcastEvent(req.Path)
	respondJSON(w, map[string]interface{}{"status": "success", "file": res.Record})
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

	if err := s.UpdateFrontMatter(req.Path, req.Updates); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]interface{}{"status": "success"})
}

// UpdateFrontMatter applies a front-matter patch to a file through the same
// locking / reindexing / SSE-broadcast path handleUpdateFrontMatter uses over
// HTTP. Exported so plugins (e.g. googlecalendar.Plugin, via the LocalWriter
// interface) can safely write back page changes driven by an external event,
// such as a Google Calendar event's date changing.
func (s *Server) UpdateFrontMatter(relPath string, updates map[string]interface{}) error {
	s.watcher.LockPath(relPath)
	defer s.watcher.UnlockPath(relPath)

	newHash, err := parser.UpdateFrontMatterInFile(s.rootPath, relPath, updates)
	if err != nil {
		return fmt.Errorf("failed to update front matter: %w", err)
	}

	res, err := parser.ParseFile(s.rootPath, relPath)
	if err != nil {
		return fmt.Errorf("failed to parse file: %w", err)
	}
	res.Record.ContentHash = newHash

	if err := s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks); err != nil {
		return fmt.Errorf("failed to update cache: %w", err)
	}

	s.broadcastEvent(relPath)
	return nil
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
	// This app's data changes on essentially every request (file edits, drag
	// reorders, settings toggles) — a stale cached GET here is exactly what
	// makes a plain refresh look fine while a hard refresh reveals the real,
	// unsynced state. Every JSON API response goes through this helper, so
	// setting it once here covers /api/files, /api/settings, /api/file, etc.
	w.Header().Set("Cache-Control", "no-store")
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

	// Prune history to dynamic settings limit (default: 50)
	limitStr, _ := s.db.GetSetting("history_limit", "50")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 50
	}

	entries, err := os.ReadDir(backupDir)
	if err == nil && len(entries) > limit {
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].Name() < entries[j].Name()
		})
		for i := 0; i < len(entries)-limit; i++ {
			os.Remove(filepath.Join(backupDir, entries[i].Name()))
		}
	}
}

// handleCreateCheckpoint saves the current on-disk state of a file as a history snapshot.
// Called on page switch and window close rather than on every autosave.
func (s *Server) handleCreateCheckpoint(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Path == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	req.Path = filepath.Clean(req.Path)
	if strings.HasPrefix(req.Path, "..") {
		http.Error(w, "invalid path", http.StatusForbidden)
		return
	}

	fullPath := filepath.Join(s.rootPath, req.Path)
	currentBytes, err := os.ReadFile(fullPath)
	if err != nil {
		respondJSON(w, map[string]string{"status": "skipped"})
		return
	}

	escapedPath := url.PathEscape(req.Path)
	backupDir := filepath.Join(s.rootPath, ".blockforge", "history", escapedPath)

	// Skip if content matches the most recent backup (nothing changed since last checkpoint)
	if entries, err := os.ReadDir(backupDir); err == nil && len(entries) > 0 {
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() > entries[j].Name() })
		if latest, err := os.ReadFile(filepath.Join(backupDir, entries[0].Name())); err == nil {
			if string(latest) == string(currentBytes) {
				respondJSON(w, map[string]string{"status": "unchanged"})
				return
			}
		}
	}

	if err := os.MkdirAll(backupDir, 0755); err != nil {
		http.Error(w, "failed to create backup dir", http.StatusInternalServerError)
		return
	}
	timestamp := time.Now().Unix()
	if err := os.WriteFile(filepath.Join(backupDir, fmt.Sprintf("%d.md", timestamp)), currentBytes, 0644); err != nil {
		http.Error(w, "failed to write checkpoint", http.StatusInternalServerError)
		return
	}

	// Prune to history limit
	limitStr, _ := s.db.GetSetting("history_limit", "50")
	limit, _ := strconv.Atoi(limitStr)
	if limit <= 0 {
		limit = 50
	}
	if all, err := os.ReadDir(backupDir); err == nil && len(all) > limit {
		sort.Slice(all, func(i, j int) bool { return all[i].Name() < all[j].Name() })
		for i := 0; i < len(all)-limit; i++ {
			os.Remove(filepath.Join(backupDir, all[i].Name()))
		}
	}

	respondJSON(w, map[string]string{"status": "ok"})
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
	// The restored bytes are written to disk verbatim (whatever form that
	// snapshot was saved in), but the response used to populate the editor
	// needs asset paths expanded to the app's absolute form for display.
	displayContent := parser.RewriteAssetPaths(req.Path, string(backupBytes), parser.AbsoluteAssetPath)
	respondJSON(w, map[string]interface{}{"status": "success", "file": res.Record, "content": displayContent})
}

// sectionRoots are the standard top-level section directories present in every
// workspace. If the first path segment of a note path matches one of these the
// note lives at vault root (no workspace prefix).
var sectionRoots = map[string]bool{
	"Documents": true, "Tasks": true, "Boards": true,
	"Canvas": true, "MindMaps": true,
}

// noteAssetBase resolves where to store assets for a given note path.
// Returns (assetsDir on disk, URL prefix, sub-directory within assets).
//
//	notePath "Default/Documents/note.md"  →  {root}/Default/assets, /Default/assets, Documents
//	notePath "Documents/note.md"          →  {root}/assets,          /assets,          Documents  (no-workspace mode)
func (s *Server) noteAssetBase(notePath string) (assetsDir, urlBase, subDir string) {
	dir := filepath.ToSlash(filepath.Dir(notePath))
	if dir == "." || dir == "/" {
		dir = ""
	}

	parts := strings.SplitN(dir, "/", 2)
	first := ""
	if len(parts) > 0 {
		first = parts[0]
	}
	rest := ""
	if len(parts) > 1 {
		rest = parts[1]
	}

	if first != "" && !sectionRoots[first] {
		// first segment is a workspace name
		return filepath.Join(s.rootPath, first, "assets"),
			"/" + first + "/assets",
			rest
	}
	// notePath had no workspace-prefixed directory component — dot-prefixed
	// so it can never be mistaken for a workspace directory (see the same
	// reasoning in handleUploadAsset's no-notePath branch above).
	return filepath.Join(s.rootPath, ".assets"), "/.assets", dir
}

func (s *Server) handleUploadAsset(w http.ResponseWriter, r *http.Request) {
	limitMB := defaultUploadLimitMB
	if v, err := s.db.GetSetting("upload_limit_mb", ""); err == nil && v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			limitMB = parsed
		}
	}
	limitBytes := int64(limitMB) * 1024 * 1024

	// http.MaxBytesReader actually enforces the cap (unlike the maxMemory
	// argument to ParseMultipartForm below, which only controls the
	// memory/disk split for parsed parts and never rejects large uploads —
	// without this, a file of any size would still succeed, just spilling to
	// temp disk beyond that threshold).
	r.Body = http.MaxBytesReader(w, r.Body, limitBytes)

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var mbErr *http.MaxBytesError
		if errors.As(err, &mbErr) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error":   fmt.Sprintf("File exceeds the %d MB upload limit configured in Settings.", limitMB),
				"code":    "upload_limit_exceeded",
				"limitMB": limitMB,
			})
			return
		}
		http.Error(w, "Failed to parse upload: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, handler, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Error retrieving the file from form-data (field 'file')", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// ── Overwrite existing asset ─────────────────────────────────────────────
	overwritePath := r.URL.Query().Get("overwritePath")
	if overwritePath != "" {
		// Strip query parameters
		if idx := strings.Index(overwritePath, "?"); idx != -1 {
			overwritePath = overwritePath[:idx]
		}
		// Normalise fully-qualified HTTP URLs
		if strings.HasPrefix(overwritePath, "http://") || strings.HasPrefix(overwritePath, "https://") {
			if u, err := url.Parse(overwritePath); err == nil {
				overwritePath = u.Path
			}
		}
		overwritePath = strings.TrimPrefix(overwritePath, "/")

		// Security: must be an assets path
		if !strings.Contains("/"+overwritePath, "/assets/") {
			http.Error(w, "Invalid overwrite path", http.StatusBadRequest)
			return
		}
		cleanRel := filepath.Clean(overwritePath)
		if strings.HasPrefix(cleanRel, "..") {
			http.Error(w, "Invalid overwrite path", http.StatusBadRequest)
			return
		}

		dstPath := filepath.Join(s.rootPath, cleanRel)
		if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
			http.Error(w, "Failed to create assets directory: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Before first overwrite, save a permanent original backup (e.g. photo._orig.png)
		ext := filepath.Ext(dstPath)
		origPath := strings.TrimSuffix(dstPath, ext) + "._orig" + ext
		if _, err := os.Stat(origPath); os.IsNotExist(err) {
			// Only backup if the target file already exists on disk
			if _, statErr := os.Stat(dstPath); statErr == nil {
				if srcF, openErr := os.Open(dstPath); openErr == nil {
					if origF, createErr := os.OpenFile(origPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644); createErr == nil {
						io.Copy(origF, srcF)
						origF.Close()
					}
					srcF.Close()
				}
			}
		}

		dst, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			http.Error(w, "Failed to open asset file for overwriting: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer dst.Close()
		if _, err := io.Copy(dst, file); err != nil {
			http.Error(w, "Failed to write asset bytes: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := map[string]string{"url": "/" + filepath.ToSlash(cleanRel)}
		if _, err := os.Stat(origPath); err == nil {
			origRel := filepath.ToSlash(strings.TrimPrefix(origPath, s.rootPath+string(filepath.Separator)))
			resp["originalUrl"] = "/" + origRel
		}
		respondJSON(w, resp)
		return
	}

	// ── New upload ───────────────────────────────────────────────────────────
	notePath := r.URL.Query().Get("notePath")

	var assetsDir, urlBase, subDir string
	if notePath != "" {
		assetsDir, urlBase, subDir = s.noteAssetBase(notePath)
	} else {
		// No workspace context at all (shouldn't normally happen — every
		// upload call site scopes notePath to a workspace). Dot-prefixed so
		// this can never be mistaken for a workspace directory by
		// handleListWorkspaces or the file browser, unlike the old bare
		// "assets" folder this replaces.
		assetsDir = filepath.Join(s.rootPath, ".assets")
		urlBase = "/.assets"
		subDir = ""
	}

	destSubdir := filepath.Join(assetsDir, subDir)
	if err := os.MkdirAll(destSubdir, 0755); err != nil {
		http.Error(w, "Failed to create assets directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Sanitize base filename and append a nanosecond timestamp
	ext := filepath.Ext(handler.Filename)
	base := strings.TrimSuffix(handler.Filename, ext)
	base = strings.ReplaceAll(base, " ", "_")
	cleanBase := ""
	for _, char := range base {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '_' || char == '-' {
			cleanBase += string(char)
		}
	}
	if cleanBase == "" {
		cleanBase = "image"
	}

	// Include note's base name in the filename for traceability
	var noteBase string
	if notePath != "" {
		noteFile := filepath.Base(notePath)
		noteExt := filepath.Ext(noteFile)
		noteName := strings.TrimSuffix(noteFile, noteExt)
		for _, char := range noteName {
			if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
				(char >= '0' && char <= '9') || char == '_' || char == '-' {
				noteBase += string(char)
			}
		}
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
		http.Error(w, "Failed to create asset file: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, "Failed to save asset bytes: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var urlPath string
	if subDir != "" {
		urlPath = fmt.Sprintf("%s/%s/%s", urlBase, filepath.ToSlash(subDir), filename)
	} else {
		urlPath = fmt.Sprintf("%s/%s", urlBase, filename)
	}
	// Permanent record that this note owns this asset — see appendAssetLog's
	// comment for why this can't just be reconstructed from content/history
	// at delete time.
	s.appendAssetLog(notePath, urlPath)
	respondJSON(w, map[string]string{"url": urlPath})
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

var redditPostRegex = regexp.MustCompile(`(?i)^https?://(?:www\.|old\.|new\.|m\.)?reddit\.com/r/[^/]+/comments/[a-zA-Z0-9]+`)

type redditOEmbedResponse struct {
	Title        string `json:"title"`
	ThumbnailURL string `json:"thumbnail_url"`
}

// fetchRedditOEmbedTitle calls Reddit's public oEmbed endpoint, which returns
// the real post title even though Reddit's regular HTML pages serve a
// bot-check interstitial to non-browser requests.
func fetchRedditOEmbedTitle(pageURL string) (title, thumbnail string) {
	client := http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get("https://www.reddit.com/oembed?url=" + url.QueryEscape(pageURL))
	if err != nil {
		return "", ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", ""
	}
	var data redditOEmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", ""
	}
	return data.Title, data.ThumbnailURL
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

	// Special case Reddit — its HTML pages serve a bot-check interstitial
	// ("Reddit - Please wait for verification") to non-browser requests, so
	// scraping <title>/og:title would just capture that instead of the real
	// post title. The public oEmbed endpoint isn't gated the same way and
	// returns the actual title directly.
	skipGenericScrape := false
	if redditPostRegex.MatchString(rawURL) {
		if title, thumb := fetchRedditOEmbedTitle(rawURL); title != "" {
			result.Title = title
			result.SiteName = "Reddit"
			result.Favicon = "https://www.reddit.com/favicon.ico"
			if thumb != "" {
				result.Image = thumb
			}
			skipGenericScrape = true
		}
	}

	// Fetch page metadata if not fully populated by special embed logic
	if !skipGenericScrape && (result.Title == "" || result.Image == "") {
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

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		respondJSON(w, []db.FileRecord{})
		return
	}

	// Scope results to the caller's workspace (empty string = root/no workspace)
	wsPrefix := ""
	if ws := r.URL.Query().Get("workspace"); ws != "" {
		wsPrefix = ws + "/"
	}

	user := userFromCtx(r)
	var userID string
	if user != nil {
		userID = user.ID
	}

	results, err := s.db.Search(q, wsPrefix, userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Search failed: %v", err), http.StatusInternalServerError)
		return
	}

	respondJSON(w, results)
}

// handleRecordSearchOpen logs that a user opened a file from a search result.
// It's fire-and-forget learning signal for the ranking engine: repeated opens
// of the same file for the same query gently boost it in future searches.
func (s *Server) handleRecordSearchOpen(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Query string `json:"query"`
		Path  string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if len([]rune(req.Query)) > 256 || len([]rune(req.Path)) > 1024 {
		http.Error(w, "query or path is too long", http.StatusBadRequest)
		return
	}
	if _, err := s.db.GetFile(req.Path); err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	if err := s.db.RecordSearchOpen(user.ID, req.Query, req.Path); err != nil {
		http.Error(w, "failed to record search open", http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleGetFileHistoryContent(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	tsStr := r.URL.Query().Get("timestamp")
	if relPath == "" || tsStr == "" {
		http.Error(w, "missing path or timestamp parameters", http.StatusBadRequest)
		return
	}

	timestamp, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid timestamp parameter", http.StatusBadRequest)
		return
	}

	escapedPath := url.PathEscape(relPath)
	backupFilePath := filepath.Join(s.rootPath, ".blockforge", "history", escapedPath, fmt.Sprintf("%d.md", timestamp))

	backupBytes, err := os.ReadFile(backupFilePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("backup snapshot not found: %v", err), http.StatusNotFound)
		return
	}

	content := parser.RewriteAssetPaths(relPath, string(backupBytes), parser.AbsoluteAssetPath)
	respondJSON(w, map[string]string{"content": content})
}

var hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// defaultUploadLimitMB is used when the "upload_limit_mb" setting has never
// been saved. Configurable in Settings; validated to [1, maxUploadLimitMB].
const defaultUploadLimitMB = 100
const maxUploadLimitMB = 10000 // 10GB ceiling — sanity bound, not a recommendation

var validAppFonts = map[string]bool{
	"inter":         true,
	"system":        true,
	"roboto":        true,
	"open-sans":     true,
	"lato":          true,
	"poppins":       true,
	"nunito":        true,
	"source-sans-3": true,
	"maple-mono-nf": true,
}

// isTrashRelPath returns true when relPath lives inside a Trash directory
// (root-level "Trash/..." or workspace-level "<ws>/Trash/...").
func isTrashRelPath(relPath string) bool {
	s := filepath.ToSlash(relPath)
	return s == "Trash" ||
		strings.HasPrefix(s, "Trash/") ||
		strings.Contains(s, "/Trash/") ||
		strings.HasSuffix(s, "/Trash")
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	limitStr, _ := s.db.GetSetting("history_limit", "50")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 50
	}
	theme, _ := s.db.GetSetting("theme", "dark")
	retentionStr, _ := s.db.GetSetting("trash_retention_days", "30")
	retention, err := strconv.Atoi(retentionStr)
	if err != nil || retention < 0 {
		retention = 30
	}
	defaultPage, _ := s.db.GetSetting("default_page", "")
	sidebarCollapsedStr, _ := s.db.GetSetting("sidebar_collapsed", "false")
	kanbanCardViewMode, _ := s.db.GetSetting("kanban_card_view_mode", "modal")
	// Sidebar mode was removed (it was involved in a card data-loss bug) — a
	// value saved from before that still says "sidebar" falls back to
	// "modal" here rather than being served forward.
	if kanbanCardViewMode == "sidebar" {
		kanbanCardViewMode = "modal"
	}
	propertiesCollapsedStr, _ := s.db.GetSetting("properties_collapsed", "false")
	glassEnabledStr, _ := s.db.GetSetting("glass_enabled", "false")
	glassSidebarEnabledStr, _ := s.db.GetSetting("glass_sidebar_enabled", "true")
	appBgType, _ := s.db.GetSetting("app_bg_type", "color")
	appBgColor, _ := s.db.GetSetting("app_bg_color", "")
	appBgImage, _ := s.db.GetSetting("app_bg_image", "")
	// Sidebar/header colors are saved per-theme (dark vs light each keep
	// their own customization) — the plain, un-suffixed keys are the
	// pre-existing single shared value, kept only as the seed default for
	// whichever theme variant hasn't been saved yet, so upgrading doesn't
	// silently drop a color someone already picked.
	docHeaderTextColorLegacy, _ := s.db.GetSetting("doc_header_text_color", "")
	docHeaderTextColorDark, _ := s.db.GetSetting("doc_header_text_color_dark", docHeaderTextColorLegacy)
	docHeaderTextColorLight, _ := s.db.GetSetting("doc_header_text_color_light", docHeaderTextColorLegacy)
	autosaveDelayStr, _ := s.db.GetSetting("autosave_delay", "1500")
	autosaveDelay, err3 := strconv.Atoi(autosaveDelayStr)
	if err3 != nil || autosaveDelay < 100 {
		autosaveDelay = 1500
	}
	historyIntervalStr, _ := s.db.GetSetting("history_interval", "0")
	historyInterval, err4 := strconv.Atoi(historyIntervalStr)
	if err4 != nil || historyInterval < 0 {
		historyInterval = 0
	}
	sidebarBgColorLegacy, _ := s.db.GetSetting("sidebar_bg_color", "")
	sidebarBgColorDark, _ := s.db.GetSetting("sidebar_bg_color_dark", sidebarBgColorLegacy)
	sidebarBgColorLight, _ := s.db.GetSetting("sidebar_bg_color_light", sidebarBgColorLegacy)
	sidebarTextColorLegacy, _ := s.db.GetSetting("sidebar_text_color", "")
	sidebarTextColorDark, _ := s.db.GetSetting("sidebar_text_color_dark", sidebarTextColorLegacy)
	sidebarTextColorLight, _ := s.db.GetSetting("sidebar_text_color_light", sidebarTextColorLegacy)
	globalLayoutOverride, _ := s.db.GetSetting("global_layout_override", "per-page")
	globalColumnWidthOverride, _ := s.db.GetSetting("global_column_width_override", "per-page")
	dateFormat, _ := s.db.GetSetting("date_format", "long")
	appFont, _ := s.db.GetSetting("app_font", "inter")
	dueDateAutoUpdateEnabledStr, _ := s.db.GetSetting("due_date_auto_update_enabled", "false")
	dueDateAutoUpdateTime, _ := s.db.GetSetting("due_date_auto_update_time", "01:00")
	dueDateAutoUpdateDaysAhead, _ := s.db.GetSetting("due_date_auto_update_days_ahead", "0")
	uploadLimitStr, _ := s.db.GetSetting("upload_limit_mb", strconv.Itoa(defaultUploadLimitMB))
	uploadLimitMB, err5 := strconv.Atoi(uploadLimitStr)
	if err5 != nil || uploadLimitMB <= 0 || uploadLimitMB > maxUploadLimitMB {
		uploadLimitMB = defaultUploadLimitMB
	}
	respondJSON(w, map[string]interface{}{
		"history_limit":                   limit,
		"theme":                           theme,
		"trash_retention_days":            retention,
		"default_page":                    defaultPage,
		"sidebar_collapsed":               sidebarCollapsedStr == "true",
		"kanban_card_view_mode":           kanbanCardViewMode,
		"properties_collapsed":            propertiesCollapsedStr == "true",
		"glass_enabled":                   glassEnabledStr == "true",
		"glass_sidebar_enabled":           glassSidebarEnabledStr == "true",
		"app_bg_type":                     appBgType,
		"app_bg_color":                    appBgColor,
		"app_bg_image":                    appBgImage,
		"doc_header_text_color_dark":      docHeaderTextColorDark,
		"doc_header_text_color_light":     docHeaderTextColorLight,
		"autosave_delay":                  autosaveDelay,
		"history_interval":                historyInterval,
		"sidebar_bg_color_dark":           sidebarBgColorDark,
		"sidebar_bg_color_light":          sidebarBgColorLight,
		"sidebar_text_color_dark":         sidebarTextColorDark,
		"sidebar_text_color_light":        sidebarTextColorLight,
		"global_layout_override":          globalLayoutOverride,
		"global_column_width_override":    globalColumnWidthOverride,
		"date_format":                     dateFormat,
		"app_font":                        appFont,
		"due_date_auto_update_enabled":    dueDateAutoUpdateEnabledStr == "true",
		"due_date_auto_update_time":       dueDateAutoUpdateTime,
		"due_date_auto_update_days_ahead": dueDateAutoUpdateDaysAhead,
		"upload_limit_mb":                 uploadLimitMB,
	})
}

func (s *Server) handleSaveSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		HistoryLimit               *int    `json:"history_limit"`
		Theme                      string  `json:"theme"`
		TrashRetentionDays         *int    `json:"trash_retention_days"`
		DefaultPage                *string `json:"default_page"`
		SidebarCollapsed           *bool   `json:"sidebar_collapsed"`
		KanbanCardViewMode         string  `json:"kanban_card_view_mode"`
		PropertiesCollapsed        *bool   `json:"properties_collapsed"`
		GlassEnabled               *bool   `json:"glass_enabled"`
		GlassSidebarEnabled        *bool   `json:"glass_sidebar_enabled"`
		AutosaveDelay              *int    `json:"autosave_delay"`
		HistoryInterval            *int    `json:"history_interval"`
		SidebarBgColorDark         *string `json:"sidebar_bg_color_dark"`
		SidebarBgColorLight        *string `json:"sidebar_bg_color_light"`
		SidebarTextColorDark       *string `json:"sidebar_text_color_dark"`
		SidebarTextColorLight      *string `json:"sidebar_text_color_light"`
		AppBgType                  string  `json:"app_bg_type"`
		AppBgColor                 *string `json:"app_bg_color"`
		AppBgImage                 *string `json:"app_bg_image"`
		DocHeaderTextColorDark     *string `json:"doc_header_text_color_dark"`
		DocHeaderTextColorLight    *string `json:"doc_header_text_color_light"`
		GlobalLayoutOverride       string  `json:"global_layout_override"`
		GlobalColumnWidthOverride  string  `json:"global_column_width_override"`
		DateFormat                 string  `json:"date_format"`
		AppFont                    string  `json:"app_font"`
		DueDateAutoUpdateEnabled   *bool   `json:"due_date_auto_update_enabled"`
		DueDateAutoUpdateTime      *string `json:"due_date_auto_update_time"`
		DueDateAutoUpdateDaysAhead *int    `json:"due_date_auto_update_days_ahead"`
		UploadLimitMB              *int    `json:"upload_limit_mb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.HistoryLimit != nil {
		if *req.HistoryLimit <= 0 {
			http.Error(w, "invalid history_limit value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("history_limit", strconv.Itoa(*req.HistoryLimit)); err != nil {
			http.Error(w, fmt.Sprintf("failed to save settings: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.Theme == "dark" || req.Theme == "light" {
		if err := s.db.SetSetting("theme", req.Theme); err != nil {
			http.Error(w, fmt.Sprintf("failed to save theme: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.TrashRetentionDays != nil {
		if *req.TrashRetentionDays < 0 {
			http.Error(w, "invalid trash_retention_days value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("trash_retention_days", strconv.Itoa(*req.TrashRetentionDays)); err != nil {
			http.Error(w, fmt.Sprintf("failed to save trash_retention_days: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.DefaultPage != nil {
		if err := s.db.SetSetting("default_page", *req.DefaultPage); err != nil {
			http.Error(w, fmt.Sprintf("failed to save default_page: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.SidebarCollapsed != nil {
		val := "false"
		if *req.SidebarCollapsed {
			val = "true"
		}
		if err := s.db.SetSetting("sidebar_collapsed", val); err != nil {
			http.Error(w, fmt.Sprintf("failed to save sidebar_collapsed: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.KanbanCardViewMode == "modal" || req.KanbanCardViewMode == "fullscreen" {
		if err := s.db.SetSetting("kanban_card_view_mode", req.KanbanCardViewMode); err != nil {
			http.Error(w, fmt.Sprintf("failed to save kanban_card_view_mode: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.PropertiesCollapsed != nil {
		val := "false"
		if *req.PropertiesCollapsed {
			val = "true"
		}
		if err := s.db.SetSetting("properties_collapsed", val); err != nil {
			http.Error(w, fmt.Sprintf("failed to save properties_collapsed: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.GlassEnabled != nil {
		val := "false"
		if *req.GlassEnabled {
			val = "true"
		}
		if err := s.db.SetSetting("glass_enabled", val); err != nil {
			http.Error(w, fmt.Sprintf("failed to save glass_enabled: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.GlassSidebarEnabled != nil {
		val := "false"
		if *req.GlassSidebarEnabled {
			val = "true"
		}
		if err := s.db.SetSetting("glass_sidebar_enabled", val); err != nil {
			http.Error(w, fmt.Sprintf("failed to save glass_sidebar_enabled: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.AutosaveDelay != nil && *req.AutosaveDelay >= 100 {
		if err := s.db.SetSetting("autosave_delay", strconv.Itoa(*req.AutosaveDelay)); err != nil {
			http.Error(w, fmt.Sprintf("failed to save autosave_delay: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.HistoryInterval != nil && *req.HistoryInterval >= 0 {
		if err := s.db.SetSetting("history_interval", strconv.Itoa(*req.HistoryInterval)); err != nil {
			http.Error(w, fmt.Sprintf("failed to save history_interval: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.SidebarBgColorDark != nil {
		if *req.SidebarBgColorDark != "" && !hexColorRe.MatchString(*req.SidebarBgColorDark) {
			http.Error(w, "invalid sidebar_bg_color_dark value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("sidebar_bg_color_dark", *req.SidebarBgColorDark); err != nil {
			http.Error(w, fmt.Sprintf("failed to save sidebar_bg_color_dark: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.SidebarBgColorLight != nil {
		if *req.SidebarBgColorLight != "" && !hexColorRe.MatchString(*req.SidebarBgColorLight) {
			http.Error(w, "invalid sidebar_bg_color_light value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("sidebar_bg_color_light", *req.SidebarBgColorLight); err != nil {
			http.Error(w, fmt.Sprintf("failed to save sidebar_bg_color_light: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.SidebarTextColorDark != nil {
		if *req.SidebarTextColorDark != "" && !hexColorRe.MatchString(*req.SidebarTextColorDark) {
			http.Error(w, "invalid sidebar_text_color_dark value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("sidebar_text_color_dark", *req.SidebarTextColorDark); err != nil {
			http.Error(w, fmt.Sprintf("failed to save sidebar_text_color_dark: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.SidebarTextColorLight != nil {
		if *req.SidebarTextColorLight != "" && !hexColorRe.MatchString(*req.SidebarTextColorLight) {
			http.Error(w, "invalid sidebar_text_color_light value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("sidebar_text_color_light", *req.SidebarTextColorLight); err != nil {
			http.Error(w, fmt.Sprintf("failed to save sidebar_text_color_light: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.AppBgType == "color" || req.AppBgType == "image" {
		if err := s.db.SetSetting("app_bg_type", req.AppBgType); err != nil {
			http.Error(w, fmt.Sprintf("failed to save app_bg_type: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.AppBgColor != nil {
		if *req.AppBgColor != "" && !hexColorRe.MatchString(*req.AppBgColor) {
			http.Error(w, "invalid app_bg_color value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("app_bg_color", *req.AppBgColor); err != nil {
			http.Error(w, fmt.Sprintf("failed to save app_bg_color: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.AppBgImage != nil {
		if err := s.db.SetSetting("app_bg_image", *req.AppBgImage); err != nil {
			http.Error(w, fmt.Sprintf("failed to save app_bg_image: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.DocHeaderTextColorDark != nil {
		if *req.DocHeaderTextColorDark != "" && !hexColorRe.MatchString(*req.DocHeaderTextColorDark) {
			http.Error(w, "invalid doc_header_text_color_dark value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("doc_header_text_color_dark", *req.DocHeaderTextColorDark); err != nil {
			http.Error(w, fmt.Sprintf("failed to save doc_header_text_color_dark: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.DocHeaderTextColorLight != nil {
		if *req.DocHeaderTextColorLight != "" && !hexColorRe.MatchString(*req.DocHeaderTextColorLight) {
			http.Error(w, "invalid doc_header_text_color_light value", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("doc_header_text_color_light", *req.DocHeaderTextColorLight); err != nil {
			http.Error(w, fmt.Sprintf("failed to save doc_header_text_color_light: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.GlobalLayoutOverride == "per-page" || req.GlobalLayoutOverride == "left" || req.GlobalLayoutOverride == "center" || req.GlobalLayoutOverride == "full" {
		if err := s.db.SetSetting("global_layout_override", req.GlobalLayoutOverride); err != nil {
			http.Error(w, fmt.Sprintf("failed to save global_layout_override: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.GlobalColumnWidthOverride == "per-page" || req.GlobalColumnWidthOverride == "narrow" || req.GlobalColumnWidthOverride == "normal" || req.GlobalColumnWidthOverride == "wide" {
		if err := s.db.SetSetting("global_column_width_override", req.GlobalColumnWidthOverride); err != nil {
			http.Error(w, fmt.Sprintf("failed to save global_column_width_override: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.DateFormat == "long" || req.DateFormat == "iso" {
		if err := s.db.SetSetting("date_format", req.DateFormat); err != nil {
			http.Error(w, fmt.Sprintf("failed to save date_format: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if validAppFonts[req.AppFont] {
		if err := s.db.SetSetting("app_font", req.AppFont); err != nil {
			http.Error(w, fmt.Sprintf("failed to save app_font: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.DueDateAutoUpdateEnabled != nil {
		val := "false"
		if *req.DueDateAutoUpdateEnabled {
			val = "true"
		}
		if err := s.db.SetSetting("due_date_auto_update_enabled", val); err != nil {
			http.Error(w, fmt.Sprintf("failed to save due_date_auto_update_enabled: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.DueDateAutoUpdateTime != nil {
		if _, err := time.Parse("15:04", *req.DueDateAutoUpdateTime); err != nil {
			http.Error(w, "invalid due_date_auto_update_time value (expected HH:MM)", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("due_date_auto_update_time", *req.DueDateAutoUpdateTime); err != nil {
			http.Error(w, fmt.Sprintf("failed to save due_date_auto_update_time: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.DueDateAutoUpdateDaysAhead != nil {
		if *req.DueDateAutoUpdateDaysAhead < 0 || *req.DueDateAutoUpdateDaysAhead > 3650 {
			http.Error(w, "invalid due_date_auto_update_days_ahead value (must be between 0 and 3650)", http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("due_date_auto_update_days_ahead", strconv.Itoa(*req.DueDateAutoUpdateDaysAhead)); err != nil {
			http.Error(w, fmt.Sprintf("failed to save due_date_auto_update_days_ahead: %v", err), http.StatusInternalServerError)
			return
		}
	}

	if req.UploadLimitMB != nil {
		if *req.UploadLimitMB <= 0 || *req.UploadLimitMB > maxUploadLimitMB {
			http.Error(w, fmt.Sprintf("invalid upload_limit_mb value (must be between 1 and %d)", maxUploadLimitMB), http.StatusBadRequest)
			return
		}
		if err := s.db.SetSetting("upload_limit_mb", strconv.Itoa(*req.UploadLimitMB)); err != nil {
			http.Error(w, fmt.Sprintf("failed to save upload_limit_mb: %v", err), http.StatusInternalServerError)
			return
		}
	}

	respondJSON(w, map[string]string{"status": "success"})
}

func (s *Server) handleGetFavorites(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	val, _ := s.db.GetSetting("favorites_"+workspace, "[]")
	var favorites []string
	if err := json.Unmarshal([]byte(val), &favorites); err != nil {
		favorites = []string{}
	}
	respondJSON(w, map[string]interface{}{"favorites": favorites})
}

func (s *Server) handleSetFavorites(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Workspace string   `json:"workspace"`
		Favorites []string `json:"favorites"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	data, _ := json.Marshal(req.Favorites)
	if err := s.db.SetSetting("favorites_"+req.Workspace, string(data)); err != nil {
		http.Error(w, "failed to save favorites", http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]string{"status": "success"})
}

// handleGetFolderCollapse and handleSetFolderCollapse persist the sidebar's
// folder expand/collapse state server-side (rather than localStorage) so it
// stays consistent across devices/browsers, not just the one that toggled
// it. Keyed by full (already workspace-prefixed) tree path, one map across
// all workspaces — same single-blob-of-JSON-in-a-setting approach as
// favorites/tag colors, just not bucketed per workspace since paths are
// already globally unique.
func (s *Server) handleGetFolderCollapse(w http.ResponseWriter, r *http.Request) {
	val, _ := s.db.GetSetting("folder_collapsed", "{}")
	var collapsed map[string]bool
	if err := json.Unmarshal([]byte(val), &collapsed); err != nil {
		collapsed = map[string]bool{}
	}
	respondJSON(w, map[string]interface{}{"collapsed": collapsed})
}

func (s *Server) handleSetFolderCollapse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Collapsed map[string]bool `json:"collapsed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	data, err := json.Marshal(req.Collapsed)
	if err != nil {
		http.Error(w, "invalid collapsed map", http.StatusBadRequest)
		return
	}
	if err := s.db.SetSetting("folder_collapsed", string(data)); err != nil {
		http.Error(w, "failed to save folder collapse state", http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]string{"status": "success"})
}

func (s *Server) handleGetTagColors(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	val, _ := s.db.GetSetting("tag_colors_"+workspace, "{}")
	var tagColors map[string]string
	if err := json.Unmarshal([]byte(val), &tagColors); err != nil {
		tagColors = map[string]string{}
	}
	respondJSON(w, map[string]interface{}{"tagColors": tagColors})
}

func (s *Server) handleSetTagColors(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Workspace string            `json:"workspace"`
		TagColors map[string]string `json:"tagColors"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	data, _ := json.Marshal(req.TagColors)
	if err := s.db.SetSetting("tag_colors_"+req.Workspace, string(data)); err != nil {
		http.Error(w, "failed to save tag colors", http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]string{"status": "success"})
}

// mdStem strips compound markdown extensions to get the stem used for sub-page directories.
// e.g. "Boards/MyBoard.board.md" → "Boards/MyBoard"
//
//	"Documents/Note.md"       → "Documents/Note"
func mdStem(fullPath string) string {
	if strings.HasSuffix(fullPath, ".board.md") {
		return fullPath[:len(fullPath)-len(".board.md")]
	}
	if strings.HasSuffix(fullPath, ".md") {
		return fullPath[:len(fullPath)-3]
	}
	return fullPath
}

// ═══════════════════════════════════════════════════════════════════════════
// TRASH SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// TrashMeta describes one trash bundle (one deleted file or folder tree).
type TrashMeta struct {
	ID           string            `json:"id"`
	OriginalPath string            `json:"originalPath"` // relative to rootPath
	Type         string            `json:"type"`         // "file" or "folder"
	TrashedAt    time.Time         `json:"trashedAt"`
	Assets       map[string]string `json:"assets"` // filename-in-trash → original root-relative URL
	Files        []string          `json:"files"`  // all trashed file rel-paths (always populated)
}

// TrashListItem is the over-the-wire representation of one trash entry.
type TrashListItem struct {
	ID           string    `json:"id"`
	OriginalPath string    `json:"originalPath"`
	Name         string    `json:"name"`
	Type         string    `json:"type"`
	TrashedAt    time.Time `json:"trashedAt"`
	ExpiresAt    time.Time `json:"expiresAt"` // zero-value means "never expires"
	FileCount    int       `json:"fileCount"`
	Files        []string  `json:"files"`
	MatchedFiles []string  `json:"matchedFiles,omitempty"` // files whose content matched the search query
}

// trashDirForWorkspace returns the Trash directory for a named workspace.
func (s *Server) trashDirForWorkspace(workspace string) string {
	if workspace == "" || sectionRoots[workspace] {
		return filepath.Join(s.rootPath, "Trash")
	}
	return filepath.Join(s.rootPath, workspace, "Trash")
}

// allTrashDirs returns the Trash paths for all existing workspaces plus root.
func (s *Server) allTrashDirs() []string {
	var dirs []string
	// root-level Trash (no-workspace mode)
	dirs = append(dirs, filepath.Join(s.rootPath, "Trash"))
	entries, err := os.ReadDir(s.rootPath)
	if err != nil {
		return dirs
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || sectionRoots[e.Name()] || e.Name() == "Trash" {
			continue
		}
		dirs = append(dirs, filepath.Join(s.rootPath, e.Name(), "Trash"))
	}
	return dirs
}

// copyFile copies src to dst, creating dst if it doesn't exist.
// This is a cross-device-safe alternative to os.Rename.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// moveFile moves src to dst using Rename; falls back to copy+delete for cross-device moves.
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	return os.Remove(src)
}

func (s *Server) trashRetentionDays() int {
	v, _ := s.db.GetSetting("trash_retention_days", "30")
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 30
	}
	return n
}

// isAppAssetURL reports whether an already-absolute URL (as returned by
// parser.AbsoluteAssetPath) points at one of this app's own asset
// directories, as opposed to an external link or protocol-relative URL.
func isAppAssetURL(absURL string) bool {
	return strings.HasPrefix(absURL, "/") && !strings.HasPrefix(absURL, "//")
}

// stripURLSuffix trims a trailing "?query" or "#fragment" from a URL. The
// image editor appends a cache-busting "?t=<timestamp>" to the asset URL it
// writes back into a note (see Editor.tsx's handleImageSave) so the browser
// re-fetches the edited image instead of showing a stale cached one — and
// that suffix gets persisted as part of the note's on-disk asset reference.
// It must never be treated as part of the file path itself: the real file
// on disk has no query string in its name, so building a filesystem path
// from the reference as-is resolves to a file that doesn't exist, and the
// real asset is silently skipped.
func stripURLSuffix(url string) string {
	if i := strings.IndexAny(url, "?#"); i != -1 {
		return url[:i]
	}
	return url
}

// origBackupPath returns the sibling "permanent original" backup path the
// image editor creates next to an asset the first time it's overwritten
// (see handleUploadAsset's overwritePath branch) — e.g. "photo.png" ->
// "photo._orig.png". It's never referenced anywhere in note content —
// discoverable only by this naming convention — so callers that clean up an
// asset because a note referenced it must check for this sibling too, or it
// orphans permanently every time.
func origBackupPath(assetFull string) string {
	ext := filepath.Ext(assetFull)
	return strings.TrimSuffix(assetFull, ext) + "._orig" + ext
}

// fileExists reports whether path exists — a file or a directory (or at
// least not confirmed absent — any stat error other than "not exist" is
// treated as "can't tell, don't try to touch it").
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// uniqueAssetName returns filename, or filename with a "_N" suffix inserted
// before its extension if that name already exists inside dir.
func uniqueAssetName(dir, filename string) string {
	destName := filename
	for i := 1; ; i++ {
		if _, statErr := os.Stat(filepath.Join(dir, destName)); os.IsNotExist(statErr) {
			return destName
		}
		ext := filepath.Ext(filename)
		destName = strings.TrimSuffix(filename, ext) + fmt.Sprintf("_%d", i) + ext
	}
}

// collectFolderFiles returns the folder .md file itself plus all .md files
// that live inside the derived children directory (recursively).
func (s *Server) collectFolderFiles(folderMDPath string) ([]string, error) {
	files := []string{folderMDPath}

	childrenRelDir := mdStem(folderMDPath)
	childrenAbsDir := filepath.Join(s.rootPath, filepath.FromSlash(childrenRelDir))

	if _, err := os.Stat(childrenAbsDir); os.IsNotExist(err) {
		return files, nil
	}

	err := filepath.Walk(childrenAbsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && strings.HasSuffix(path, ".md") {
			rel, relErr := filepath.Rel(s.rootPath, path)
			if relErr == nil {
				files = append(files, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	return files, err
}

// historyDirPath and assetLogPath return the on-disk location of a note's
// version-history snapshots and permanent asset-upload log, respectively.
// Centralized here because both need to be resolved consistently from four
// places: written (saveFileBackup / appendAssetLog), read at delete-time,
// and moved on rename (handleMoveFile) so they keep following the note
// instead of being silently abandoned under its old path.
func historyDirPath(rootPath, relPath string) string {
	return filepath.Join(rootPath, ".blockforge", "history", url.PathEscape(relPath))
}
func assetLogPath(rootPath, relPath string) string {
	return filepath.Join(rootPath, ".blockforge", "asset-log", url.PathEscape(relPath)+".jsonl")
}

// appendAssetLog permanently records that assetURL was uploaded for notePath.
// Unlike version-history snapshots (bounded, pruned to the configured
// history_limit — see saveFileBackup), this log is never pruned: it's the
// durable source of truth for "every asset this note has ever owned," so
// delete-time cleanup can still find and remove an image even after the
// history snapshot that once referenced it has aged out of the retention
// window entirely.
func (s *Server) appendAssetLog(notePath, assetURL string) {
	if notePath == "" || assetURL == "" {
		return
	}
	logPath := assetLogPath(s.rootPath, notePath)
	if err := os.MkdirAll(filepath.Dir(logPath), 0755); err != nil {
		log.Printf("asset-log: failed to create dir: %v", err)
		return
	}
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("asset-log: failed to open: %v", err)
		return
	}
	defer f.Close()
	entry, _ := json.Marshal(map[string]string{
		"path":       assetURL,
		"uploadedAt": time.Now().UTC().Format(time.RFC3339),
	})
	f.Write(entry)
	f.Write([]byte("\n"))
}

// assetLogURLs reads every asset URL ever recorded for relPath by
// appendAssetLog. One JSON object per line (append-only) rather than a
// single JSON array specifically so appending never requires reading the
// existing file back first.
func (s *Server) assetLogURLs(relPath string) map[string]bool {
	found := map[string]bool{}
	data, err := os.ReadFile(assetLogPath(s.rootPath, relPath))
	if err != nil {
		return found
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err == nil && entry.Path != "" {
			found[entry.Path] = true
		}
	}
	return found
}

// historicalAssetURLs scans every stored history snapshot for a note (see
// saveFileBackup) and returns the set of asset URLs any of them ever
// referenced. A note's CURRENT content only reveals assets it references
// right now — an image that was uploaded and later removed from the body,
// or made unreachable by rolling back to an earlier version, leaves no
// trace there. Its old snapshots still have it, though, so this is what
// lets delete-time cleanup catch those instead of orphaning them in the
// shared assets folder forever. (Bounded by the configured retention
// window — assetLogURLs above is the unbounded backstop for anything that
// has already aged out of history entirely.)
func (s *Server) historicalAssetURLs(relPath string) map[string]bool {
	found := map[string]bool{}
	historyDir := historyDirPath(s.rootPath, relPath)
	entries, err := os.ReadDir(historyDir)
	if err != nil {
		return found
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(historyDir, entry.Name()))
		if err != nil {
			continue
		}
		parser.RewriteAssetPaths(relPath, string(raw), func(notePath, u string) string {
			absURL := stripURLSuffix(parser.AbsoluteAssetPath(notePath, u))
			if isAppAssetURL(absURL) {
				found[absURL] = true
			}
			return u // collect only — snapshots on disk are never rewritten
		})
	}
	return found
}

// trashFiles moves a list of files (and their referenced assets) into a single
// trash bundle at trashRoot/id.  It writes _meta.json at the end.
// workspace is embedded in the asset URL so the serve handler can locate it.

func (s *Server) trashFiles(files []string, originalPath, itemType, workspace, id string) error {
	trashRoot := s.trashDirForWorkspace(workspace)
	bundleDir := filepath.Join(trashRoot, id)
	assetsDir := filepath.Join(bundleDir, "assets")
	contentDir := filepath.Join(bundleDir, "content")
	for _, dir := range []string{assetsDir, contentDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create trash dir: %w", err)
		}
	}

	assetMap := map[string]string{} // trash filename → original URL

	// Moves a single already-resolved asset URL into the trash bundle and
	// records it in assetMap, shared by both the current-content rewrite
	// pass below and the history-only sweep that follows it. Returns the
	// name it was given inside the bundle, or "" if the move failed (e.g.
	// the asset no longer exists on disk).
	moveAssetToTrash := func(absURL string) string {
		assetRel := strings.TrimPrefix(absURL, "/")
		assetFull := filepath.Join(s.rootPath, filepath.FromSlash(assetRel))
		filename := filepath.Base(assetFull)
		destName := uniqueAssetName(assetsDir, filename)

		if mvErr := moveFile(assetFull, filepath.Join(assetsDir, destName)); mvErr != nil {
			return "" // asset may not exist or not accessible
		}
		assetMap[destName] = absURL

		// The image editor's permanent-original backup isn't referenced
		// anywhere in content, so it has to be located and moved
		// alongside the asset it belongs to rather than found on its
		// own pass over the note.
		if origFull := origBackupPath(assetFull); fileExists(origFull) {
			origFilename := filepath.Base(origFull)
			origDestName := uniqueAssetName(assetsDir, origFilename)
			if moveFile(origFull, filepath.Join(assetsDir, origDestName)) == nil {
				assetMap[origDestName] = origBackupPath(absURL)
			}
		}
		return destName
	}

	for _, relPath := range files {
		fullPath := filepath.Join(s.rootPath, filepath.FromSlash(relPath))
		raw, err := os.ReadFile(fullPath)
		if err != nil {
			continue
		}
		content := string(raw)
		handled := map[string]bool{}

		// Asset references are stored on disk relative to the note's own
		// location (see assetlinks.go), not as the app-rooted "/workspace/
		// assets/..." URLs this used to assume — so every reference has to
		// go through AbsoluteAssetPath before it can be resolved to a real
		// file on disk. RewriteAssetPaths already knows where to look for
		// references (body images, front-matter cover/attachments) and
		// which raw substring to swap out, so reuse it instead of a
		// hand-rolled regex that only matched the old absolute form.
		newContent := parser.RewriteAssetPaths(relPath, content, func(notePath, rawURL string) string {
			absURL := stripURLSuffix(parser.AbsoluteAssetPath(notePath, rawURL))
			if !isAppAssetURL(absURL) {
				return rawURL // external link or non-asset — leave untouched
			}
			handled[absURL] = true
			destName := moveAssetToTrash(absURL)
			if destName == "" {
				return rawURL // move failed — leave reference as-is
			}
			return fmt.Sprintf("/api/trash-asset/%s/%s/%s", workspace, id, destName)
		})

		// Assets this note referenced at some point in its history but not
		// in its current content (removed images, old covers, anything
		// orphaned by a rollback) — sweep those into the trash bundle too,
		// even though nothing in the saved content points at them anymore.
		// Two sources, since each covers a gap the other can't: history is
		// bounded by the retention window (an old-enough removal ages out
		// of it entirely), while the asset log is unbounded but only exists
		// for uploads made after this log was introduced.
		for absURL := range s.historicalAssetURLs(relPath) {
			if !handled[absURL] {
				moveAssetToTrash(absURL)
				handled[absURL] = true
			}
		}
		for absURL := range s.assetLogURLs(relPath) {
			if !handled[absURL] {
				moveAssetToTrash(absURL)
			}
		}

		contentDest := filepath.Join(contentDir, filepath.FromSlash(relPath))
		if mkErr := os.MkdirAll(filepath.Dir(contentDest), 0755); mkErr != nil {
			continue
		}
		if wErr := os.WriteFile(contentDest, []byte(newContent), 0644); wErr != nil {
			continue
		}

		if rmErr := os.Remove(fullPath); rmErr != nil && !os.IsNotExist(rmErr) {
			log.Printf("trash: failed to remove %s: %v", fullPath, rmErr)
		}
		_ = s.db.DeleteFile(relPath)

		// Bring the note's version history and asset log along into the
		// bundle rather than leaving them behind under the old path (or
		// deleting them outright) — a trashed note can still be restored,
		// and restoring it should bring back its full delete-safety net,
		// not silently reset it.
		if historyDir := historyDirPath(s.rootPath, relPath); fileExists(historyDir) {
			dest := filepath.Join(bundleDir, "history", url.PathEscape(relPath))
			if mkErr := os.MkdirAll(filepath.Dir(dest), 0755); mkErr == nil {
				_ = os.Rename(historyDir, dest)
			}
		}
		if logPath := assetLogPath(s.rootPath, relPath); fileExists(logPath) {
			dest := filepath.Join(bundleDir, "asset-log", url.PathEscape(relPath)+".jsonl")
			if mkErr := os.MkdirAll(filepath.Dir(dest), 0755); mkErr == nil {
				_ = os.Rename(logPath, dest)
			}
		}
	}

	meta := TrashMeta{
		ID:           id,
		OriginalPath: originalPath,
		Type:         itemType,
		TrashedAt:    time.Now().UTC(),
		Assets:       assetMap,
		Files:        files,
	}
	metaJSON, _ := json.Marshal(meta)
	return os.WriteFile(filepath.Join(bundleDir, "_meta.json"), metaJSON, 0644)
}

// permanentlyDeleteFiles removes files and their referenced assets from disk immediately.
func (s *Server) permanentlyDeleteFiles(files []string, childrenAbsDir string) {
	removeAsset := func(absURL string) {
		assetFull := filepath.Join(s.rootPath, filepath.FromSlash(strings.TrimPrefix(absURL, "/")))
		_ = os.Remove(assetFull)
		if origFull := origBackupPath(assetFull); fileExists(origFull) {
			_ = os.Remove(origFull)
		}
	}

	for _, relPath := range files {
		fullPath := filepath.Join(s.rootPath, filepath.FromSlash(relPath))
		handled := map[string]bool{}
		if raw, err := os.ReadFile(fullPath); err == nil {
			// See trashFiles' comment: references are relative-to-note on
			// disk, so resolve through AbsoluteAssetPath before removing.
			parser.RewriteAssetPaths(relPath, string(raw), func(notePath, u string) string {
				absURL := stripURLSuffix(parser.AbsoluteAssetPath(notePath, u))
				if isAppAssetURL(absURL) {
					removeAsset(absURL)
					handled[absURL] = true
				}
				return u
			})
		}

		// Same history + asset-log sweep as trashFiles — catches assets this
		// note referenced at some point but not anymore (removed images,
		// old covers, anything orphaned by a rollback), which the live
		// content alone would never reveal.
		for absURL := range s.historicalAssetURLs(relPath) {
			if !handled[absURL] {
				removeAsset(absURL)
				handled[absURL] = true
			}
		}
		for absURL := range s.assetLogURLs(relPath) {
			if !handled[absURL] {
				removeAsset(absURL)
			}
		}

		// The note is gone for good — its revision history and asset log no
		// longer serve any purpose and would otherwise sit on disk forever.
		_ = os.RemoveAll(historyDirPath(s.rootPath, relPath))
		_ = os.Remove(assetLogPath(s.rootPath, relPath))

		_ = os.Remove(fullPath)
		_ = s.db.DeleteFile(relPath)
	}
	if childrenAbsDir != "" {
		_ = os.RemoveAll(childrenAbsDir)
	}
}

// workspaceFromRelPath extracts the workspace name from a vault-relative path.
// Returns "" for no-workspace (section-root) paths.
func workspaceFromRelPath(relPath string) string {
	parts := strings.SplitN(filepath.ToSlash(relPath), "/", 2)
	if len(parts) == 0 || sectionRoots[parts[0]] {
		return ""
	}
	return parts[0]
}

// restoreTrashBundle moves files and assets from a trash bundle back to their
// original locations and rewrites asset URLs back to their original forms.
func (s *Server) restoreTrashBundle(workspace, id string) error {
	trashRoot := s.trashDirForWorkspace(workspace)
	bundleDir := filepath.Join(trashRoot, id)
	metaPath := filepath.Join(bundleDir, "_meta.json")

	raw, err := os.ReadFile(metaPath)
	if err != nil {
		return fmt.Errorf("read trash meta: %w", err)
	}
	var meta TrashMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return fmt.Errorf("parse trash meta: %w", err)
	}

	// Build reverse lookup: trash URL → original absolute asset URL. The
	// note-relative form to restore into each file depends on that file's
	// own path, so this is resolved per-file below via RelativeAssetPath
	// rather than a single global string replacement.
	trashURLToAbs := map[string]string{}
	for filename, originalURL := range meta.Assets {
		trashURL := fmt.Sprintf("/api/trash-asset/%s/%s/%s", workspace, id, filename)
		trashURLToAbs[trashURL] = originalURL
	}

	contentDir := filepath.Join(bundleDir, "content")
	assetsDir := filepath.Join(bundleDir, "assets")

	// Check for conflicts before touching anything.
	for _, relPath := range meta.Files {
		dest := filepath.Join(s.rootPath, filepath.FromSlash(relPath))
		if _, statErr := os.Stat(dest); statErr == nil {
			return fmt.Errorf("cannot restore: %s already exists — delete or move it first", relPath)
		}
	}

	// Restore assets first so rewritten markdown links immediately resolve.
	for filename, originalURL := range meta.Assets {
		assetRel := strings.TrimPrefix(originalURL, "/")
		assetDest := filepath.Join(s.rootPath, filepath.FromSlash(assetRel))
		if mkErr := os.MkdirAll(filepath.Dir(assetDest), 0755); mkErr != nil {
			continue
		}
		_ = moveFile(filepath.Join(assetsDir, filename), assetDest)
	}

	// Restore files with rewritten content, indexing each one directly so the
	// DB is consistent before we broadcast (avoids the watcher's 50ms delay).
	for _, relPath := range meta.Files {
		src := filepath.Join(contentDir, filepath.FromSlash(relPath))
		dest := filepath.Join(s.rootPath, filepath.FromSlash(relPath))
		destDir := filepath.Dir(dest)
		if mkErr := os.MkdirAll(destDir, 0755); mkErr != nil {
			continue
		}
		// Ensure the destination directory is watched so future edits are picked up.
		s.watcher.WatchPath(destDir)

		fileRaw, readErr := os.ReadFile(src)
		if readErr != nil {
			continue
		}
		content := parser.RewriteAssetPaths(relPath, string(fileRaw), func(notePath, url string) string {
			absURL, ok := trashURLToAbs[url]
			if !ok {
				return url
			}
			return parser.RelativeAssetPath(notePath, absURL)
		})
		if wErr := os.WriteFile(dest, []byte(content), 0644); wErr != nil {
			continue
		}
		// Index immediately so fetchFiles() returns the restored file without delay.
		// IndexFile already triggers a broadcast itself (it pushes onto
		// watcher.Updates, which listenForWatcherUpdates drains into its own
		// broadcastEvent call) — calling broadcastEvent again here used to
		// double-fire every restore, which for the Google Calendar plugin
		// meant two concurrent pushes racing to create the same page's
		// event: both saw no existing mapping yet, so both created a
		// separate Google event, and only one ever ended up tracked
		// locally — the other became a permanent, undeletable orphan.
		if idxErr := s.watcher.IndexFile(relPath); idxErr != nil {
			log.Printf("restore: failed to index %s: %v", relPath, idxErr)
		}

		// Bring the note's version history and asset log back too, if
		// trashFiles packed them into this bundle — a restored note should
		// regain its full delete-safety net, not come back with history
		// silently reset to empty.
		if bundledHistory := filepath.Join(bundleDir, "history", url.PathEscape(relPath)); fileExists(bundledHistory) {
			if mkErr := os.MkdirAll(filepath.Dir(historyDirPath(s.rootPath, relPath)), 0755); mkErr == nil {
				_ = os.Rename(bundledHistory, historyDirPath(s.rootPath, relPath))
			}
		}
		if bundledLog := filepath.Join(bundleDir, "asset-log", url.PathEscape(relPath)+".jsonl"); fileExists(bundledLog) {
			dest := assetLogPath(s.rootPath, relPath)
			if mkErr := os.MkdirAll(filepath.Dir(dest), 0755); mkErr == nil {
				_ = os.Rename(bundledLog, dest)
			}
		}
	}

	return os.RemoveAll(bundleDir)
}

// purgeTrashDir deletes expired bundles from one trash directory.
func (s *Server) purgeTrashDir(trashDir string, cutoff time.Time) {
	entries, err := os.ReadDir(trashDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(trashDir, entry.Name(), "_meta.json"))
		if err != nil {
			continue
		}
		var meta TrashMeta
		if err := json.Unmarshal(raw, &meta); err != nil {
			continue
		}
		if meta.TrashedAt.Before(cutoff) {
			_ = os.RemoveAll(filepath.Join(trashDir, entry.Name()))
		}
	}
}

// purgeExpiredTrash permanently deletes all trash bundles older than the retention window
// across every workspace's .trash directory.
func (s *Server) purgeExpiredTrash() {
	retention := s.trashRetentionDays()
	if retention == 0 {
		return
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -retention)
	for _, dir := range s.allTrashDirs() {
		s.purgeTrashDir(dir, cutoff)
	}
}

// startTrashCleanup runs purgeExpiredTrash once on startup then daily.
func (s *Server) startTrashCleanup() {
	go func() {
		s.purgeExpiredTrash()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			s.purgeExpiredTrash()
		}
	}()
}

// startDueDateAutoUpdate polls once a minute to catch the one shared
// due-date-auto-update time (Settings → General). Whether a given board
// actually runs at that time depends on its own dueDateAutoUpdate override:
// "off" always skips it, "on" always includes it, and unset falls back to
// the global enabled flag. Per-board last-run bookkeeping still lives in
// that board's own front matter (visible by just opening the board file),
// so a board reconfigured mid-day, or one that opts in after today's slot
// already ran for others, isn't blocked by an unrelated board's history.
func (s *Server) startDueDateAutoUpdate() {
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			s.checkScheduledDueDateAutoUpdates()
		}
	}()
}

func (s *Server) checkScheduledDueDateAutoUpdates() {
	runAt, _ := s.db.GetSetting("due_date_auto_update_time", "01:00")
	now := time.Now()
	if now.Format("15:04") != runAt {
		return
	}
	slot := now.Format("2006-01-02") + " " + runAt

	globalEnabled, _ := s.db.GetSetting("due_date_auto_update_enabled", "false")

	boards, err := s.db.QueryByFrontMatter("type", "board")
	if err != nil {
		log.Printf("due-date auto-update: failed to list boards: %v", err)
		return
	}

	for _, b := range boards {
		fm, ferr := s.db.GetFrontMatterFlat(b.Path)
		if ferr != nil {
			continue
		}
		boardEnabled := globalEnabled == "true"
		switch override := fm["dueDateAutoUpdate"]; {
		case override == "off":
			boardEnabled = false
		case override == "on":
			boardEnabled = true
		}
		// A card can explicitly opt in even when its board (and the global
		// default) is off, so don't skip that board before card-level rules
		// get a chance to apply.
		if !boardEnabled && !s.boardHasDueDateAutoUpdateOn(b.Path) {
			continue
		}
		if fm["dueDateAutoUpdateLastRun"] == slot {
			continue
		}
		updated, _, rerr := s.runDueDateAutoUpdate(b.Path, false)
		log.Printf("due-date auto-update: board %s slot %s — updated=%d err=%v", b.Path, slot, updated, rerr)
		if uerr := s.UpdateFrontMatter(b.Path, map[string]interface{}{"dueDateAutoUpdateLastRun": slot}); uerr != nil {
			log.Printf("due-date auto-update: failed to record last-run for %s: %v", b.Path, uerr)
		}
	}
}

func (s *Server) boardHasDueDateAutoUpdateOn(boardPath string) bool {
	prefix := strings.TrimSuffix(boardPath, ".board.md") + "/"
	cards, err := s.db.QueryCards(prefix, nil, "")
	if err != nil {
		return false
	}
	for _, card := range cards {
		if card.Fields["dueDateAutoUpdate"] == "on" {
			return true
		}
	}
	return false
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}

	s.watcher.LockPath(relPath)
	defer s.watcher.UnlockPath(relPath)

	// Collect the target file plus any children that live in its stem directory
	// (e.g. task files inside a Kanban board's directory).
	files, err := s.collectFolderFiles(relPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to collect files: %v", err), http.StatusInternalServerError)
		return
	}
	childrenAbsDir := filepath.Join(s.rootPath, filepath.FromSlash(mdStem(relPath)))
	childrenInfo, _ := os.Stat(childrenAbsDir)
	hasChildren := childrenInfo != nil && childrenInfo.IsDir()

	workspace := workspaceFromRelPath(relPath)
	retention := s.trashRetentionDays()
	if retention == 0 {
		childDir := ""
		if hasChildren {
			childDir = childrenAbsDir
		}
		s.permanentlyDeleteFiles(files, childDir)
	} else {
		itemType := "file"
		if hasChildren {
			itemType = "folder"
		}
		id := fmt.Sprintf("%d", time.Now().UnixNano())
		if err := s.trashFiles(files, relPath, itemType, workspace, id); err != nil {
			http.Error(w, fmt.Sprintf("failed to move to trash: %v", err), http.StatusInternalServerError)
			return
		}
		if hasChildren {
			_ = os.RemoveAll(childrenAbsDir)
		}
	}

	s.broadcastEvent(relPath)
	respondJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) handleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	folderMDPath := r.URL.Query().Get("path")
	if folderMDPath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}

	s.watcher.LockPath(folderMDPath)
	defer s.watcher.UnlockPath(folderMDPath)

	files, err := s.collectFolderFiles(folderMDPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to collect folder contents: %v", err), http.StatusInternalServerError)
		return
	}

	childrenAbsDir := filepath.Join(s.rootPath, filepath.FromSlash(mdStem(folderMDPath)))
	workspace := workspaceFromRelPath(folderMDPath)

	retention := s.trashRetentionDays()
	if retention == 0 {
		s.permanentlyDeleteFiles(files, childrenAbsDir)
	} else {
		id := fmt.Sprintf("%d", time.Now().UnixNano())
		if err := s.trashFiles(files, folderMDPath, "folder", workspace, id); err != nil {
			http.Error(w, fmt.Sprintf("failed to move folder to trash: %v", err), http.StatusInternalServerError)
			return
		}
		// Remove the now-empty children directory (trashFiles only removed .md files).
		_ = os.RemoveAll(childrenAbsDir)
	}

	s.broadcastEvent(folderMDPath)
	respondJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) handleListTrash(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	trashDir := s.trashDirForWorkspace(workspace)

	entries, err := os.ReadDir(trashDir)
	if err != nil {
		if os.IsNotExist(err) {
			respondJSON(w, []TrashListItem{})
			return
		}
		http.Error(w, "failed to read trash directory", http.StatusInternalServerError)
		return
	}

	retention := s.trashRetentionDays()
	var items []TrashListItem

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(trashDir, entry.Name(), "_meta.json"))
		if err != nil {
			continue
		}
		var meta TrashMeta
		if err := json.Unmarshal(raw, &meta); err != nil {
			continue
		}
		item := TrashListItem{
			ID:           meta.ID,
			OriginalPath: meta.OriginalPath,
			Name:         filepath.Base(meta.OriginalPath),
			Type:         meta.Type,
			TrashedAt:    meta.TrashedAt,
			FileCount:    len(meta.Files),
			Files:        meta.Files,
		}
		if retention > 0 {
			item.ExpiresAt = meta.TrashedAt.AddDate(0, 0, retention)
		}
		items = append(items, item)
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].TrashedAt.After(items[j].TrashedAt)
	})

	if items == nil {
		items = []TrashListItem{}
	}
	respondJSON(w, items)
}

func (s *Server) handleRestoreTrashItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID        string `json:"id"`
		Workspace string `json:"workspace"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	if err := s.restoreTrashBundle(req.Workspace, req.ID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	respondJSON(w, map[string]string{"status": "restored"})
}

func (s *Server) handlePurgeTrashItem(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	workspace := r.URL.Query().Get("workspace")
	if id == "" {
		http.Error(w, "missing id parameter", http.StatusBadRequest)
		return
	}
	bundleDir := filepath.Join(s.trashDirForWorkspace(workspace), id)
	if err := os.RemoveAll(bundleDir); err != nil {
		http.Error(w, fmt.Sprintf("failed to delete: %v", err), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) handleEmptyTrash(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	trashDir := s.trashDirForWorkspace(workspace)

	entries, err := os.ReadDir(trashDir)
	if err != nil {
		if os.IsNotExist(err) {
			respondJSON(w, map[string]string{"status": "ok"})
			return
		}
		http.Error(w, "failed to read trash", http.StatusInternalServerError)
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			_ = os.RemoveAll(filepath.Join(trashDir, entry.Name()))
		}
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleTrashAsset(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	id := chi.URLParam(r, "id")
	file := chi.URLParam(r, "file")
	if id == "" || file == "" {
		http.Error(w, "missing params", http.StatusBadRequest)
		return
	}
	if strings.Contains(file, "..") || strings.Contains(id, "..") || strings.Contains(workspace, "..") {
		http.Error(w, "invalid params", http.StatusBadRequest)
		return
	}
	assetPath := filepath.Join(s.trashDirForWorkspace(workspace), id, "assets", file)
	http.ServeFile(w, r, assetPath)
}

func (s *Server) handleGetTrashContent(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	id := r.URL.Query().Get("id")
	relPath := r.URL.Query().Get("path")
	if id == "" || relPath == "" {
		http.Error(w, "missing params", http.StatusBadRequest)
		return
	}
	if strings.Contains(id, "..") || strings.Contains(relPath, "..") || strings.Contains(workspace, "..") {
		http.Error(w, "invalid params", http.StatusBadRequest)
		return
	}
	contentPath := filepath.Join(s.trashDirForWorkspace(workspace), id, "content", filepath.FromSlash(relPath))
	raw, err := os.ReadFile(contentPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	respondJSON(w, map[string]string{"content": string(raw)})
}

// handleSearchTrash performs a case-insensitive search over trash item names and
// the text content of their files, returning matching TrashListItems.
func (s *Server) handleSearchTrash(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if query == "" {
		respondJSON(w, []TrashListItem{})
		return
	}

	trashDir := s.trashDirForWorkspace(workspace)
	entries, err := os.ReadDir(trashDir)
	if err != nil {
		if os.IsNotExist(err) {
			respondJSON(w, []TrashListItem{})
			return
		}
		http.Error(w, "failed to read trash", http.StatusInternalServerError)
		return
	}

	retention := s.trashRetentionDays()
	var items []TrashListItem

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(trashDir, entry.Name(), "_meta.json"))
		if err != nil {
			continue
		}
		var meta TrashMeta
		if err := json.Unmarshal(raw, &meta); err != nil {
			continue
		}

		// Name / path match (fast path — no per-file attribution needed)
		nameMatched := strings.Contains(strings.ToLower(filepath.Base(meta.OriginalPath)), query) ||
			strings.Contains(strings.ToLower(meta.OriginalPath), query)

		// Content match: walk the bundle's content directory and record which files matched
		var matchedFiles []string
		if !nameMatched {
			contentDir := filepath.Join(trashDir, entry.Name(), "content")
			_ = filepath.Walk(contentDir, func(path string, info os.FileInfo, err error) error {
				if err != nil || info.IsDir() {
					return nil
				}
				data, readErr := os.ReadFile(path)
				if readErr != nil {
					return nil
				}
				if strings.Contains(strings.ToLower(string(data)), query) {
					// rel is the original vault-relative path (mirrors how content was stored)
					if rel, relErr := filepath.Rel(contentDir, path); relErr == nil {
						matchedFiles = append(matchedFiles, filepath.ToSlash(rel))
					}
				}
				return nil
			})
		}

		if !nameMatched && len(matchedFiles) == 0 {
			continue
		}

		item := TrashListItem{
			ID:           meta.ID,
			OriginalPath: meta.OriginalPath,
			Name:         filepath.Base(meta.OriginalPath),
			Type:         meta.Type,
			TrashedAt:    meta.TrashedAt,
			FileCount:    len(meta.Files),
			Files:        meta.Files,
			MatchedFiles: matchedFiles,
		}
		if retention > 0 {
			item.ExpiresAt = meta.TrashedAt.AddDate(0, 0, retention)
		}
		items = append(items, item)
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].TrashedAt.After(items[j].TrashedAt)
	})
	if items == nil {
		items = []TrashListItem{}
	}
	respondJSON(w, items)
}

// handleMoveFile moves a vault file (and its sub-page directory) to a new path,
// then re-indexes everything that moved so the DB stays consistent.
func (s *Server) handleMoveFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.From == "" || req.To == "" {
		http.Error(w, "missing from or to", http.StatusBadRequest)
		return
	}

	fromFull := filepath.Join(s.rootPath, filepath.Clean(req.From))
	toFull := filepath.Join(s.rootPath, filepath.Clean(req.To))

	// Prevent path traversal
	rootAbs := s.rootPath + string(os.PathSeparator)
	if !strings.HasPrefix(fromFull, rootAbs) || !strings.HasPrefix(toFull, rootAbs) {
		http.Error(w, "path traversal not allowed", http.StatusBadRequest)
		return
	}

	// Prevent move onto self or own subtree
	fromStemFull := mdStem(fromFull)
	if fromFull == toFull || strings.HasPrefix(toFull, fromStemFull+string(os.PathSeparator)) {
		http.Error(w, "cannot move a file onto itself or its own sub-page", http.StatusBadRequest)
		return
	}

	// Hard invariant: a move/rename must never silently destroy a different,
	// existing file at the destination — os.Rename below would otherwise
	// atomically replace it with no way to recover. This exists specifically
	// because a frontend race (a title-change-triggered rename overlapping a
	// card switch) has computed a destination colliding with another card's
	// real file, and the move happily clobbered it. Disambiguating here
	// (same suffixing handleSaveFile's createOnly path already uses) is the
	// last line of defense against data loss regardless of what upstream bug
	// produces the collision — the move still succeeds, just onto a free
	// name, instead of eating another card's file.
	if disambiguated := uniquifyPath(s.rootPath, req.To); disambiguated != req.To {
		req.To = disambiguated
		toFull = filepath.Join(s.rootPath, filepath.Clean(req.To))
	}

	// Ensure destination directory exists
	if err := os.MkdirAll(filepath.Dir(toFull), 0755); err != nil {
		http.Error(w, "failed to create destination directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	s.watcher.LockPath(req.From)
	s.watcher.LockPath(req.To)
	defer s.watcher.UnlockPath(req.From)
	defer s.watcher.UnlockPath(req.To)

	// Move the file itself
	if err := os.Rename(fromFull, toFull); err != nil {
		http.Error(w, "failed to move file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// The file's relative distance to its assets folder just changed — rebase
	// any relative asset references (cover, attachments, inline images) so
	// they still resolve correctly at the new location.
	rebaseAssetPathsInFile(req.From, req.To, toFull)

	// The note's version history and permanent asset log are both keyed by
	// its path — without moving them here, a rename would silently sever
	// every pre-rename snapshot and upload record from any future lookup
	// keyed by the new (current) path: the Version History panel would
	// appear to start from a blank slate, and delete-time asset cleanup
	// would lose all record of anything uploaded before this rename.
	if oldHistoryDir := historyDirPath(s.rootPath, req.From); fileExists(oldHistoryDir) {
		newHistoryDir := historyDirPath(s.rootPath, req.To)
		if mkErr := os.MkdirAll(filepath.Dir(newHistoryDir), 0755); mkErr == nil {
			_ = os.Rename(oldHistoryDir, newHistoryDir)
		}
	}
	if oldLogPath := assetLogPath(s.rootPath, req.From); fileExists(oldLogPath) {
		newLogPath := assetLogPath(s.rootPath, req.To)
		if mkErr := os.MkdirAll(filepath.Dir(newLogPath), 0755); mkErr == nil {
			_ = os.Rename(oldLogPath, newLogPath)
		}
	}

	// Move the sub-page directory if it exists
	// e.g. Documents/Note1.md  → sub-dir Documents/Note1/
	//      Boards/MyBoard.board.md → sub-dir Boards/MyBoard/
	toStemFull := mdStem(toFull)
	if info, err := os.Stat(fromStemFull); err == nil && info.IsDir() && fromStemFull != fromFull {
		if err := os.MkdirAll(filepath.Dir(toStemFull), 0755); err == nil {
			_ = os.Rename(fromStemFull, toStemFull)
		}
	}

	// Update DB: remove old entry, index the moved file
	_ = s.db.DeleteFile(req.From)
	if res, err := parser.ParseFile(s.rootPath, req.To); err == nil {
		_ = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
	}

	// Re-index any children that moved with the sub-page directory
	if info, err := os.Stat(toStemFull); err == nil && info.IsDir() {
		toStemRel := filepath.ToSlash(toStemFull[len(s.rootPath)+1:])
		fromStemRel := filepath.ToSlash(fromStemFull[len(s.rootPath)+1:])
		_ = filepath.Walk(toStemFull, func(path string, fi os.FileInfo, werr error) error {
			if werr != nil || fi.IsDir() || !strings.HasSuffix(path, ".md") {
				return nil
			}
			newRel := filepath.ToSlash(path[len(s.rootPath)+1:])
			oldRel := fromStemRel + newRel[len(toStemRel):]
			rebaseAssetPathsInFile(oldRel, newRel, path)
			_ = s.db.DeleteFile(oldRel)
			if res, err := parser.ParseFile(s.rootPath, newRel); err == nil {
				_ = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
			}
			s.rewriteBacklinksToMovedFile(oldRel, newRel)
			return nil
		})
	}

	// Any other note (an @-mention inserted before this rename, a manual
	// [[link]], etc.) that pointed at the old path would otherwise 404
	// forever the moment this move lands — see rewriteBacklinksToMovedFile's
	// comment for why this doesn't happen automatically otherwise.
	s.rewriteBacklinksToMovedFile(req.From, req.To)

	s.broadcastEvent(req.To)
	respondJSON(w, map[string]string{"status": "moved", "to": req.To})
}

// rebaseAssetPathsInFile reads the file at fullPath, rewrites any relative
// asset references so they remain valid now that the note itself has moved
// from oldRel to newRel, and writes the result back if anything changed.
// Best-effort: read/write failures are silently ignored, same as the
// surrounding move logic's other best-effort re-indexing steps.
func rebaseAssetPathsInFile(oldRel, newRel, fullPath string) {
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	rebased := parser.RebaseAssetPaths(oldRel, newRel, string(content))
	if rebased != string(content) {
		_ = os.WriteFile(fullPath, []byte(rebased), 0644)
	}
}

// rewriteBacklinksToMovedFile scans every markdown file under the moved
// file's workspace and rewrites any [text](path) link pointing at oldRel so
// it points at newRel instead. Renaming/moving a file only ever touches that
// file's own content (and, via rebaseAssetPathsInFile, its own outgoing
// asset references) — nothing previously updated *other* files that link to
// it, so any @-mention or manual link inserted before a rename went stale
// and 404'd forever the instant the target moved. Reuses the same
// link-detection regex as the existing backlinks search (handleGetBacklinks)
// so "what links here" and "what gets rewritten here" stay consistent.
// Best-effort, matching the surrounding move logic: read/write/index
// failures for any one file are silently skipped rather than failing the
// whole move.
func (s *Server) rewriteBacklinksToMovedFile(oldRel, newRel string) {
	oldRel = filepath.ToSlash(oldRel)
	newRel = filepath.ToSlash(newRel)
	workspace := strings.SplitN(oldRel, "/", 2)[0]
	searchRoot := filepath.Join(s.rootPath, workspace)

	_ = filepath.WalkDir(searchRoot, func(absPath string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() || !strings.HasSuffix(absPath, ".md") {
			return nil
		}
		if strings.Contains(absPath, string(os.PathSeparator)+".") {
			return nil
		}
		relPath, err := filepath.Rel(s.rootPath, absPath)
		if err != nil {
			return nil
		}
		relPath = filepath.ToSlash(relPath)
		if relPath == newRel {
			return nil // the moved file itself
		}

		raw, err := os.ReadFile(absPath)
		if err != nil {
			return nil
		}
		content := string(raw)
		changed := false
		rewritten := mdLinkRe.ReplaceAllStringFunc(content, func(m string) string {
			sub := mdLinkRe.FindStringSubmatch(m)
			linkTarget := strings.TrimPrefix(filepath.ToSlash(sub[2]), "/")
			if linkTarget != oldRel {
				return m
			}
			changed = true
			return "[" + sub[1] + "](" + newRel + ")"
		})
		if !changed {
			return nil
		}
		if err := os.WriteFile(absPath, []byte(rewritten), 0644); err != nil {
			return nil
		}
		if res, err := parser.ParseFile(s.rootPath, relPath); err == nil {
			_ = s.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
		}
		return nil
	})
}

// ─── Workspace Handlers ───────────────────────────────────────────────────────

var validWorkspaceNameRe = regexp.MustCompile(`^[\w][\w\s\-]*$`)

// handleListWorkspaces returns all top-level directories in the vault that
// actually look like workspaces. A name-based denylist (e.g. excluding
// "assets" or "Trash") would misfire the instant a user names an actual
// workspace either of those — so instead this checks structure: every real
// workspace gets Documents/Boards/Canvas/MindMaps created immediately by
// handleCreateWorkspace, whereas incidental top-level directories (a stray
// asset-upload folder, the legacy global Trash folder, which stores each
// trashed item under its own id/_meta.json+content rather than section
// names) never do, regardless of what they happen to be named.
func (s *Server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(s.rootPath)
	if err != nil {
		http.Error(w, "failed to read vault", http.StatusInternalServerError)
		return
	}
	workspaces := []string{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		children, err := os.ReadDir(filepath.Join(s.rootPath, e.Name()))
		if err != nil {
			continue
		}
		hasSection := false
		for _, c := range children {
			if c.IsDir() && sectionRoots[c.Name()] {
				hasSection = true
				break
			}
		}
		if hasSection {
			workspaces = append(workspaces, e.Name())
		}
	}
	respondJSON(w, map[string]interface{}{"workspaces": workspaces})
}

// handleCreateWorkspace creates a new workspace directory with standard section subdirs.
func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || !validWorkspaceNameRe.MatchString(name) {
		http.Error(w, "invalid workspace name", http.StatusBadRequest)
		return
	}

	sections := []string{"Documents", "Boards", "Canvas", "MindMaps"}
	for _, section := range sections {
		if err := os.MkdirAll(filepath.Join(s.rootPath, name, section), 0755); err != nil {
			http.Error(w, fmt.Sprintf("failed to create %s: %v", section, err), http.StatusInternalServerError)
			return
		}
	}
	s.watcher.WatchPath(filepath.Join(s.rootPath, name))
	respondJSON(w, map[string]string{"name": name})
}

// handleRenameWorkspace renames a workspace directory and updates all DB path records.
func (s *Server) handleRenameWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldName string `json:"oldName"`
		NewName string `json:"newName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	oldName := strings.TrimSpace(req.OldName)
	newName := strings.TrimSpace(req.NewName)
	if oldName == "" || newName == "" || oldName == newName {
		http.Error(w, "invalid names", http.StatusBadRequest)
		return
	}
	if !validWorkspaceNameRe.MatchString(newName) {
		http.Error(w, "invalid workspace name", http.StatusBadRequest)
		return
	}

	src := filepath.Join(s.rootPath, oldName)
	dst := filepath.Join(s.rootPath, newName)

	if _, err := os.Stat(src); err != nil {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}
	if _, err := os.Stat(dst); err == nil {
		http.Error(w, "workspace name already taken", http.StatusConflict)
		return
	}

	if err := os.Rename(src, dst); err != nil {
		http.Error(w, fmt.Sprintf("failed to rename directory: %v", err), http.StatusInternalServerError)
		return
	}

	if err := s.db.RenameWorkspacePaths(oldName, newName); err != nil {
		http.Error(w, fmt.Sprintf("failed to update DB: %v", err), http.StatusInternalServerError)
		return
	}

	s.watcher.WatchPath(dst)
	s.broadcastEvent("__workspace_renamed__")
	respondJSON(w, map[string]string{"oldName": oldName, "newName": newName})
}

// handleDeleteWorkspace permanently deletes a workspace directory (including its
// own Trash) and purges all DB rows and settings referencing it.
func (s *Server) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		http.Error(w, "invalid workspace name", http.StatusBadRequest)
		return
	}

	dir := filepath.Join(s.rootPath, name)
	if _, err := os.Stat(dir); err != nil {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}

	entries, err := os.ReadDir(s.rootPath)
	if err != nil {
		http.Error(w, "failed to read vault", http.StatusInternalServerError)
		return
	}
	count := 0
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		children, err := os.ReadDir(filepath.Join(s.rootPath, e.Name()))
		if err != nil {
			continue
		}
		for _, c := range children {
			if c.IsDir() && sectionRoots[c.Name()] {
				count++
				break
			}
		}
	}
	if count <= 1 {
		http.Error(w, "cannot delete the only remaining workspace", http.StatusConflict)
		return
	}

	if err := os.RemoveAll(dir); err != nil {
		http.Error(w, fmt.Sprintf("failed to delete workspace directory: %v", err), http.StatusInternalServerError)
		return
	}

	if err := s.db.DeleteWorkspacePaths(name); err != nil {
		http.Error(w, fmt.Sprintf("failed to update DB: %v", err), http.StatusInternalServerError)
		return
	}

	s.broadcastEvent("__workspace_deleted__")
	respondJSON(w, map[string]string{"status": "ok"})
}

// handleMigrateWorkspace moves existing flat section dirs (Documents/, Boards/, etc.)
// into a named workspace subdirectory, and updates all DB path records.
func (s *Server) handleMigrateWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Default"
	}

	workspaceDir := filepath.Join(s.rootPath, name)
	if err := os.MkdirAll(workspaceDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("failed to create workspace dir: %v", err), http.StatusInternalServerError)
		return
	}

	sections := []string{"Documents", "Boards", "Canvas", "MindMaps", "Tasks"}
	for _, section := range sections {
		src := filepath.Join(s.rootPath, section)
		dst := filepath.Join(workspaceDir, section)
		if _, err := os.Stat(src); err == nil {
			if err := os.Rename(src, dst); err != nil {
				http.Error(w, fmt.Sprintf("failed to move %s: %v", section, err), http.StatusInternalServerError)
				return
			}
		}
	}

	if err := s.db.AddWorkspacePrefix(name); err != nil {
		http.Error(w, fmt.Sprintf("failed to update DB: %v", err), http.StatusInternalServerError)
		return
	}

	s.watcher.WatchPath(workspaceDir)
	s.broadcastEvent("__workspace_migrated__")
	respondJSON(w, map[string]string{"name": name})
}

// ─── Backlinks ────────────────────────────────────────────────────────────────

var mdLinkRe = regexp.MustCompile(`\[([^\]]*)\]\(([^)]+\.md)\)`)

// handleGetCards queries kanban cards with optional filters.
//
// Query parameters:
//
//	board      – board file path, e.g. "Default/Boards/board.board.md"
//	            The card directory is derived by stripping ".board.md" and appending "/".
//	            Mutually exclusive with prefix.
//	prefix     – raw path prefix to scope results (alternative to board).
//	overdue    – "true" → only cards where dueDate is before today (YYYY-MM-DD).
//	due_before – ISO date string; only cards with dueDate strictly before this value.
//	status     – exact match on front-matter "status" field.
//	assignee   – exact match on front-matter "assignee" field.
func (s *Server) handleGetCards(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	// Resolve path prefix.
	prefix := q.Get("prefix")
	if board := q.Get("board"); board != "" {
		const suffix = ".board.md"
		if strings.HasSuffix(board, suffix) {
			prefix = board[:len(board)-len(suffix)] + "/"
		} else {
			prefix = board + "/"
		}
	}

	// Resolve due_before date.
	dueBefore := q.Get("due_before")
	if q.Get("overdue") == "true" {
		dueBefore = time.Now().Format("2006-01-02")
	}

	// Build exact-match filters from remaining recognised params.
	filters := map[string]string{}
	if v := q.Get("status"); v != "" {
		filters["status"] = v
	}
	if v := q.Get("assignee"); v != "" {
		filters["assignee"] = v
	}

	cards, err := s.db.QueryCards(prefix, filters, dueBefore)
	if err != nil {
		http.Error(w, fmt.Sprintf("query failed: %v", err), http.StatusInternalServerError)
		return
	}
	if cards == nil {
		cards = []db.CardResult{}
	}
	respondJSON(w, map[string]interface{}{
		"cards": cards,
		"count": len(cards),
	})
}

func (s *Server) handleGetBacklinks(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	targetPath = strings.TrimPrefix(filepath.ToSlash(targetPath), "/")

	// Scope to the workspace (first path segment of targetPath)
	workspace := strings.SplitN(targetPath, "/", 2)[0]
	searchRoot := filepath.Join(s.rootPath, workspace)

	type Backlink struct {
		Path    string `json:"path"`
		Title   string `json:"title"`
		Excerpt string `json:"excerpt"`
	}

	var results []Backlink
	seen := map[string]bool{}

	err := filepath.WalkDir(searchRoot, func(absPath string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return walkErr
		}
		if !strings.HasSuffix(absPath, ".md") {
			return nil
		}
		if strings.Contains(absPath, string(os.PathSeparator)+".") {
			return nil
		}
		relPath := filepath.ToSlash(absPath[len(s.rootPath)+1:])
		if relPath == targetPath {
			return nil
		}
		raw, err := os.ReadFile(absPath)
		if err != nil {
			return nil
		}
		content := string(raw)
		matches := mdLinkRe.FindAllStringSubmatch(content, -1)
		for _, m := range matches {
			linkTarget := strings.TrimPrefix(filepath.ToSlash(m[2]), "/")
			if linkTarget == targetPath {
				title := relPath
				for _, line := range strings.Split(content, "\n") {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "# ") {
						title = strings.TrimPrefix(line, "# ")
						break
					}
				}
				excerpt := ""
				for _, line := range strings.Split(content, "\n") {
					if strings.Contains(line, m[0]) {
						excerpt = strings.TrimSpace(line)
						if len(excerpt) > 200 {
							excerpt = excerpt[:200] + "…"
						}
						break
					}
				}
				if !seen[relPath] {
					seen[relPath] = true
					results = append(results, Backlink{Path: relPath, Title: title, Excerpt: excerpt})
				}
				break
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, "walk error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []Backlink{}
	}
	respondJSON(w, results)
}

// ─── Graph ────────────────────────────────────────────────────────────────────

func (s *Server) handleGetGraph(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	type Node struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Type  string `json:"type"`
	}
	type Edge struct {
		Source string `json:"source"`
		Target string `json:"target"`
	}
	type Graph struct {
		Nodes []Node `json:"nodes"`
		Edges []Edge `json:"edges"`
	}

	searchRoot := s.rootPath
	if workspace != "" {
		searchRoot = filepath.Join(s.rootPath, workspace)
	}

	nodeSet := map[string]string{} // id -> title
	tagSet := map[string]bool{}    // tag name -> seen
	var edges []Edge

	_ = filepath.WalkDir(searchRoot, func(absPath string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return walkErr
		}
		if !strings.HasSuffix(absPath, ".md") {
			return nil
		}
		// Skip hidden dirs like .blockforge
		if strings.Contains(absPath, string(os.PathSeparator)+".") {
			return nil
		}
		relPath := filepath.ToSlash(absPath[len(s.rootPath)+1:])
		// Skip trashed files (root-level "Trash/..." or workspace-level "<ws>/Trash/...")
		if isTrashRelPath(relPath) {
			return nil
		}
		raw, err := os.ReadFile(absPath)
		if err != nil {
			return nil
		}
		content := string(raw)
		// Derive a human-readable title: check YAML front-matter title: first,
		// then fall back to first # heading, then the bare filename.
		title := strings.TrimSuffix(strings.TrimSuffix(filepath.Base(absPath), ".md"), ".board")
		lines := strings.Split(content, "\n")
		inFrontMatter := false
		fmDone := false
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if !fmDone {
				if trimmed == "---" {
					if !inFrontMatter {
						inFrontMatter = true
						continue
					}
					fmDone = true
					continue
				}
				if inFrontMatter && strings.HasPrefix(trimmed, "title:") {
					t := strings.TrimSpace(strings.TrimPrefix(trimmed, "title:"))
					t = strings.Trim(t, `"'`)
					if t != "" {
						title = t
						fmDone = true
					}
					continue
				}
			} else {
				if strings.HasPrefix(trimmed, "# ") {
					t := strings.TrimPrefix(trimmed, "# ")
					if title == strings.TrimSuffix(strings.TrimSuffix(filepath.Base(absPath), ".md"), ".board") {
						title = t // only use heading if we didn't already find a YAML title
					}
					break
				}
			}
		}
		nodeSet[relPath] = title
		for _, tag := range parser.ExtractTags(content) {
			tagSet[tag] = true
			edges = append(edges, Edge{Source: relPath, Target: "tag:" + tag})
		}
		sourceDir := filepath.Dir(filepath.FromSlash(relPath))
		for _, m := range mdLinkRe.FindAllStringSubmatch(content, -1) {
			raw := strings.TrimPrefix(filepath.ToSlash(m[2]), "/")
			var target string
			if strings.Contains(raw, "/") && !strings.HasPrefix(raw, ".") {
				// Looks like an absolute-from-root path already
				target = raw
			} else {
				// Relative path — resolve against source file's directory
				target = filepath.ToSlash(filepath.Clean(filepath.Join(sourceDir, filepath.FromSlash(raw))))
			}
			if target != relPath {
				edges = append(edges, Edge{Source: relPath, Target: target})
			}
		}
		return nil
	})

	// Add implicit owner→child edges:
	// For each .md file, strip its extension(s) to get a stem and check if a
	// sibling directory with that name exists. If it does, every .md file inside
	// that directory gets an edge from the owner file.
	// This covers:
	//   - test.md  → test/Series-To-Watch.md   (folder page)
	//   - xxxx.board.md → xxxx/dfdafda.md       (kanban board → cards)
	for ownerRel := range nodeSet {
		// Strip all extensions from the basename to get the stem.
		// e.g. "Default/Boards/xxxx.board.md" → stem "xxxx"
		base := filepath.Base(filepath.FromSlash(ownerRel))
		stem := base
		for {
			ext := filepath.Ext(stem)
			if ext == "" {
				break
			}
			stem = strings.TrimSuffix(stem, ext)
		}
		ownerDir := filepath.Dir(filepath.FromSlash(ownerRel))
		siblingDir := filepath.Join(ownerDir, stem)
		siblingDirAbs := filepath.Join(s.rootPath, siblingDir)
		info, err := os.Stat(siblingDirAbs)
		if err != nil || !info.IsDir() {
			continue
		}
		// All nodes whose path starts with siblingDir/ are children
		siblingPrefix := filepath.ToSlash(siblingDir) + "/"
		for childRel := range nodeSet {
			if strings.HasPrefix(childRel, siblingPrefix) {
				edges = append(edges, Edge{Source: ownerRel, Target: childRel})
			}
		}
	}

	nodes := make([]Node, 0, len(nodeSet)+len(tagSet))
	for id, title := range nodeSet {
		nodes = append(nodes, Node{ID: id, Title: title, Type: "file"})
	}
	for tag := range tagSet {
		nodes = append(nodes, Node{ID: "tag:" + tag, Title: "#" + tag, Type: "tag"})
	}

	if nodes == nil {
		nodes = []Node{}
	}
	if edges == nil {
		edges = []Edge{}
	}
	respondJSON(w, Graph{Nodes: nodes, Edges: edges})
}
