package watcher

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"blockforgemd/internal/db"
	"blockforgemd/internal/parser"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	fsWatcher *fsnotify.Watcher
	db        *db.DB
	rootPath  string
	Updates   chan string // Channel to broadcast modified file paths
	closeChan chan struct{}
	mu        sync.RWMutex
	writeLock map[string]time.Time // Path -> write lock timestamp
}

func NewWatcher(rootPath string, database *db.DB) (*Watcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	return &Watcher{
		fsWatcher: fsWatcher,
		db:        database,
		rootPath:  rootPath,
		Updates:   make(chan string, 100),
		closeChan: make(chan struct{}),
		writeLock: make(map[string]time.Time),
	}, nil
}

// isSystemDir returns true for directory names that should never be indexed:
// hidden dirs (starting with ".") and the "Trash" system folder.
func isSystemDir(base string) bool {
	return strings.HasPrefix(base, ".") || base == "Trash"
}

// Start initiates the watcher event loop
func (w *Watcher) Start() error {
	// Watch the root and all subdirectories (skip hidden and Trash)
	err := filepath.Walk(w.rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			base := filepath.Base(path)
			if isSystemDir(base) && path != w.rootPath {
				return filepath.SkipDir
			}
			return w.fsWatcher.Add(path)
		}
		return nil
	})
	if err != nil {
		return err
	}

	// Index everything at startup
	go w.initialIndex()

	// Watch events loop
	go w.watchLoop()

	return nil
}

// LockPath sets a write lock for a path, telling the watcher to temporarily ignore modifications
func (w *Watcher) LockPath(relPath string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.writeLock[relPath] = time.Now()
}

// UnlockPath releases a write lock for a path
func (w *Watcher) UnlockPath(relPath string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.writeLock, relPath)
}

func (w *Watcher) isLocked(relPath string) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	t, ok := w.writeLock[relPath]
	if !ok {
		return false
	}
	// Expire locks after 2 seconds to prevent lock leaks
	if time.Since(t) > 2*time.Second {
		return false
	}
	return true
}

func (w *Watcher) initialIndex() {
	log.Printf("Starting initial workspace indexing of %s...", w.rootPath)
	count := 0
	err := filepath.Walk(w.rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			base := filepath.Base(path)
			if isSystemDir(base) && path != w.rootPath {
				return filepath.SkipDir
			}
			return nil
		}

		relPath, err := filepath.Rel(w.rootPath, path)
		if err != nil {
			return nil
		}

		if isSupportedFile(relPath) {
			if err := w.indexFile(relPath); err == nil {
				count++
			} else {
				log.Printf("Failed to index %s: %v", relPath, err)
			}
		}
		return nil
	})
	if err != nil {
		log.Printf("Initial indexing error: %v", err)
	} else {
		log.Printf("Indexed %d files successfully.", count)
	}
}

func (w *Watcher) indexFile(relPath string) error {
	res, err := parser.ParseFile(w.rootPath, relPath)
	if err != nil {
		return err
	}

	// Check if already in DB, content matches hash, and content column is populated
	existing, err := w.db.GetFile(relPath)
	if err == nil && existing.ContentHash == res.Record.ContentHash && existing.Content != "" {
		// No changes, skip DB write
		return nil
	}

	err = w.db.UpsertFile(res.Record, res.FrontMatter, res.Tasks)
	if err != nil {
		return err
	}

	select {
	case w.Updates <- relPath:
	default:
	}
	return nil
}

// IndexFile parses a file and immediately upserts it into the DB.
// Used by restore to bypass the fsnotify delay and update the DB synchronously.
func (w *Watcher) IndexFile(relPath string) error {
	return w.indexFile(relPath)
}

// isTrashPath returns true when relPath lives inside a Trash directory
// (handles both root-level "Trash/..." and workspace-level ".../Trash/...").
func isTrashPath(relPath string) bool {
	s := filepath.ToSlash(relPath)
	return s == "Trash" ||
		strings.HasPrefix(s, "Trash/") ||
		strings.Contains(s, "/Trash/") ||
		strings.HasSuffix(s, "/Trash")
}

func (w *Watcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.fsWatcher.Events:
			if !ok {
				return
			}

			// Resolve relative path
			relPath, err := filepath.Rel(w.rootPath, event.Name)
			if err != nil {
				continue
			}

			// Ignore hidden paths and Trash paths
			if strings.HasPrefix(relPath, ".") || strings.Contains(relPath, "/.") || isTrashPath(relPath) {
				continue
			}

			// Handle directories
			info, err := os.Stat(event.Name)
			isDir := err == nil && info.IsDir()

			if isDir {
				if event.Op&fsnotify.Create == fsnotify.Create {
					base := filepath.Base(event.Name)
					if !isSystemDir(base) {
						w.fsWatcher.Add(event.Name)
						log.Printf("Watcher: added directory %s", relPath)
					}
				}
				continue
			}

			if !isSupportedFile(relPath) {
				continue
			}

			// Check bypass locks
			if w.isLocked(relPath) {
				// Bypass parsing since this is a self-generated write
				continue
			}

			if event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create {
				log.Printf("Watcher: file modified/created: %s", relPath)
				// Defer a tiny bit to allow file writes to complete
				time.AfterFunc(50*time.Millisecond, func() {
					if err := w.indexFile(relPath); err != nil {
						log.Printf("Watcher: failed to index %s: %v", relPath, err)
					}
				})
			} else if event.Op&fsnotify.Remove == fsnotify.Remove || event.Op&fsnotify.Rename == fsnotify.Rename {
				log.Printf("Watcher: file removed/renamed: %s", relPath)
				err := w.db.DeleteFile(relPath)
				if err != nil {
					log.Printf("Watcher: failed to delete %s from cache: %v", relPath, err)
				}
				select {
				case w.Updates <- relPath:
				default:
				}
			}

		case err, ok := <-w.fsWatcher.Errors:
			if !ok {
				return
			}
			log.Printf("Watcher error: %v", err)

		case <-w.closeChan:
			return
		}
	}
}

// WatchPath adds a directory and its subdirectories to the file watcher.
// Used after creating or migrating a workspace directory.
func (w *Watcher) WatchPath(dir string) {
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || !info.IsDir() {
			return nil
		}
		base := filepath.Base(path)
		if isSystemDir(base) {
			return filepath.SkipDir
		}
		return w.fsWatcher.Add(path)
	})
}

func (w *Watcher) Close() error {
	close(w.closeChan)
	return w.fsWatcher.Close()
}

func isSupportedFile(path string) bool {
	ext := filepath.Ext(path)
	return ext == ".md" || ext == ".excalidraw" || ext == ".xml" || ext == ".drawio"
}
