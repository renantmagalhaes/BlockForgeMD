package server

import (
	"blockforgemd/internal/db"
	"blockforgemd/internal/watcher"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSaveFileBackupAndPruning(t *testing.T) {
	// Create temporary workspace
	tempDir, err := os.MkdirTemp("", "blockforge-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Setup mock DB and watcher
	dbPath := filepath.Join(tempDir, "cache.db")
	database, err := db.NewDB(dbPath)
	if err != nil {
		t.Fatalf("failed to init db: %v", err)
	}
	defer database.Close()

	w, err := watcher.NewWatcher(tempDir, database)
	if err != nil {
		t.Fatalf("failed to init watcher: %v", err)
	}
	defer w.Close()

	// Initialize server
	s := NewServer(tempDir, database, w)

	relPath := "test-note.md"
	fullPath := filepath.Join(tempDir, relPath)

	// Write initial content
	err = os.WriteFile(fullPath, []byte("Version 0 content"), 0644)
	if err != nil {
		t.Fatalf("failed to write test note: %v", err)
	}

	// Trigger first backup by passing new changed content
	s.saveFileBackup(relPath, "Version 1 content")

	escapedPath := url.PathEscape(relPath)
	backupDir := filepath.Join(tempDir, ".blockforge", "history", escapedPath)

	// Assert backup directory exists
	if _, err := os.Stat(backupDir); os.IsNotExist(err) {
		t.Fatalf("backup directory was not created")
	}

	// Verify backup content contains "Version 0 content"
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("failed to read backup dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 backup, found %d", len(entries))
	}

	backupFilePath := filepath.Join(backupDir, entries[0].Name())
	backupBytes, err := os.ReadFile(backupFilePath)
	if err != nil {
		t.Fatalf("failed to read backup file: %v", err)
	}
	if string(backupBytes) != "Version 0 content" {
		t.Fatalf("expected backup content 'Version 0 content', got '%s'", string(backupBytes))
	}

	// Trigger 25 updates to verify backup pruning limits (maximum 20)
	for i := 1; i <= 25; i++ {
		// Sleep 1ms to ensure different timestamps in tests
		time.Sleep(2 * time.Millisecond)

		newContent := fmt.Sprintf("Version %d content", i)

		// Save the backup of current bytes
		s.saveFileBackup(relPath, newContent)

		// Overwrite the active file content
		os.WriteFile(fullPath, []byte(newContent), 0644)
	}

	// Check final counts in history folder
	finalEntries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("failed to read backup dir: %v", err)
	}

	// It must prune backups to stay <= 20
	if len(finalEntries) > 20 {
		t.Fatalf("history pruning failed: found %d backups, expected max 20", len(finalEntries))
	}

	// Verify that the oldest backups (e.g. Version 0 content) were pruned
	for _, entry := range finalEntries {
		data, _ := os.ReadFile(filepath.Join(backupDir, entry.Name()))
		if strings.Contains(string(data), "Version 0 content") {
			t.Fatalf("old backup was not pruned successfully")
		}
	}
}
