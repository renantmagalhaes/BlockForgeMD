package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"blockforgemd/internal/cryptoutil"
	"blockforgemd/internal/db"
	"blockforgemd/internal/server"
	"blockforgemd/internal/watcher"
)

func main() {
	// Parse command line flags
	workspaceFlag := flag.String("workspace", "./workspace", "path to the markdown workspace folder")
	portFlag := flag.String("port", "8080", "port number to listen on")
	flag.Parse()

	workspacePath, err := filepath.Abs(*workspaceFlag)
	if err != nil {
		log.Fatalf("Invalid workspace path: %v", err)
	}

	log.Printf("Starting BlockForgeMD Backend...")
	log.Printf("Workspace Path: %s", workspacePath)

	// Ensure workspace folder exists
	if err := os.MkdirAll(workspacePath, 0755); err != nil {
		log.Fatalf("Failed to create workspace folder: %v", err)
	}

	// Initialize SQLite Database Cache
	dbPath := filepath.Join(workspacePath, ".blockforge", "cache.db")
	cacheDB, err := db.NewDB(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer func() {
		log.Printf("Closing database connection...")
		if err := cacheDB.Close(); err != nil {
			log.Printf("Error closing database: %v", err)
		}
	}()

	// Initialize Filesystem Watcher
	fsWatcher, err := watcher.NewWatcher(workspacePath, cacheDB)
	if err != nil {
		log.Fatalf("Failed to initialize file watcher: %v", err)
	}
	defer func() {
		log.Printf("Stopping file watcher...")
		if err := fsWatcher.Close(); err != nil {
			log.Printf("Error closing file watcher: %v", err)
		}
	}()

	// Start file watcher
	if err := fsWatcher.Start(); err != nil {
		log.Fatalf("Failed to start file watcher: %v", err)
	}

	// Load (or generate) the encryption key used to store plugin secrets
	// (OAuth client secrets, per-user refresh/access tokens) at rest.
	encKey, err := cryptoutil.LoadOrCreateKey(workspacePath)
	if err != nil {
		log.Fatalf("Failed to load plugin encryption key: %v", err)
	}

	// Initialize HTTP and SSE Server
	apiServer := server.NewServer(workspacePath, cacheDB, fsWatcher, encKey)
	defer func() {
		log.Printf("Stopping plugins...")
		apiServer.StopPlugins()
	}()

	// In production, we'll embed the frontend assets and serve them.
	// For local dev, Vite runs on its own port, so we only need to host the API.
	// If a built frontend index.html exists in web-dist, we can mount it:
	distPath := filepath.Clean("./web-dist")
	if info, err := os.Stat(distPath); err == nil && info.IsDir() {
		log.Printf("Mounting static frontend assets from: %s", distPath)
		apiServer.MountFrontend(http.Dir(distPath))
	} else {
		log.Printf("No static web assets found at %s. API server running in API-only mode.", distPath)
	}

	srv := &http.Server{
		Addr:    ":" + *portFlag,
		Handler: apiServer,
	}

	// Start Server in a goroutine
	go func() {
		log.Printf("Server listening on http://localhost:%s", *portFlag)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server listen failed: %v", err)
		}
	}()

	// Graceful shutdown handling
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Printf("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Printf("BlockForgeMD Backend stopped successfully.")
}
