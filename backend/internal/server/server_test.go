package server

import (
	"blockforgemd/internal/db"
	"blockforgemd/internal/watcher"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
	var encKey [32]byte
	s := NewServer(tempDir, database, w, encKey)

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

// newTestServer sets up a temp workspace root, DB, and watcher for a test,
// returning the server plus a cleanup func.
func newTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	tempDir, err := os.MkdirTemp("", "blockforge-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tempDir) })

	dbPath := filepath.Join(tempDir, "cache.db")
	database, err := db.NewDB(dbPath)
	if err != nil {
		t.Fatalf("failed to init db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	w, err := watcher.NewWatcher(tempDir, database)
	if err != nil {
		t.Fatalf("failed to init watcher: %v", err)
	}
	t.Cleanup(func() { w.Close() })

	var encKey [32]byte
	return NewServer(tempDir, database, w, encKey), tempDir
}

func TestFolderCollapseUpdatesOnlyTheTargetFolder(t *testing.T) {
	s, _ := newTestServer(t)

	setCollapse := func(body string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/folder-collapse", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("save folder collapse: expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
	}

	setCollapse(`{"path":"Default/Documents/Projects.md","collapsed":false}`)
	setCollapse(`{"path":"Default/Documents/Archive.md","collapsed":true}`)

	req := httptest.NewRequest(http.MethodGet, "/api/folder-collapse", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	var response struct {
		Collapsed map[string]bool `json:"collapsed"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode folder collapse response: %v", err)
	}
	if response.Collapsed["Default/Documents/Projects.md"] {
		t.Fatal("expected Projects folder to remain open")
	}
	if !response.Collapsed["Default/Documents/Archive.md"] {
		t.Fatal("expected Archive folder to remain collapsed")
	}
}

// noteWithRelativeAsset writes a note plus a physical asset under it,
// mirroring how the app actually stores things on disk: the note's body
// references the asset with a path relative to the note's own directory
// (e.g. "../../../assets/Boards/Folder/Board/img.png"), not an app-rooted
// "/workspace/assets/..." URL. This is the on-disk format assetlinks.go
// documents as the deliberate current behavior (portable when synced to
// GitHub) — trash/delete asset cleanup has to resolve through it correctly.
func noteWithRelativeAsset(t *testing.T, rootPath, noteRelPath, assetRelPath string) {
	t.Helper()
	noteFull := filepath.Join(rootPath, filepath.FromSlash(noteRelPath))
	assetFull := filepath.Join(rootPath, filepath.FromSlash(assetRelPath))

	if err := os.MkdirAll(filepath.Dir(noteFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(assetFull), 0755); err != nil {
		t.Fatalf("mkdir asset dir: %v", err)
	}
	if err := os.WriteFile(assetFull, []byte("fake-png-bytes"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}

	noteDir := filepath.Dir(noteRelPath)
	relRef, err := filepath.Rel(noteDir, assetRelPath)
	if err != nil {
		t.Fatalf("compute relative asset ref: %v", err)
	}
	relRef = filepath.ToSlash(relRef)

	content := "---\ntitle: Task\ntype: task\n---\n\n![](" + relRef + ")\n"
	if err := os.WriteFile(noteFull, []byte(content), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}
}

// Regression test: a card/task embeds its image with a path relative to the
// note's own location (the app's actual on-disk format). Trashing the note
// must still locate and move the real physical asset — it previously only
// recognized old-style app-rooted "/workspace/assets/..." URLs, so a
// relative reference like "../../../assets/..." was silently ignored and
// the asset was orphaned on disk forever.
func TestTrashFilesMovesRelativeAssetReferences(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	noteWithRelativeAsset(t, tempDir, noteRel, assetRel)

	if err := s.trashFiles([]string{noteRel}, noteRel, "file", "Default", "testid123"); err != nil {
		t.Fatalf("trashFiles failed: %v", err)
	}

	// The note and its asset must both be gone from their original locations.
	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(noteRel))); !os.IsNotExist(err) {
		t.Fatalf("expected note to be removed from original location, stat err: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(assetRel))); !os.IsNotExist(err) {
		t.Fatalf("expected asset to be removed from original location (moved to trash), stat err: %v", err)
	}

	// The asset must have actually landed inside the trash bundle, not been
	// silently dropped.
	bundleAssetsDir := filepath.Join(s.trashDirForWorkspace("Default"), "testid123", "assets")
	entries, err := os.ReadDir(bundleAssetsDir)
	if err != nil {
		t.Fatalf("failed to read trash bundle assets dir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "img.png" {
		t.Fatalf("expected exactly one trashed asset named img.png, got %+v", entries)
	}
}

// Regression test: same relative-path scenario, but for permanent delete
// (trash retention set to 0) — the asset must actually be removed from disk,
// not just orphaned because its reference wasn't recognized.
func TestPermanentlyDeleteFilesRemovesRelativeAssetReferences(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	noteWithRelativeAsset(t, tempDir, noteRel, assetRel)

	s.permanentlyDeleteFiles([]string{noteRel}, "")

	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(noteRel))); !os.IsNotExist(err) {
		t.Fatalf("expected note to be deleted, stat err: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(assetRel))); !os.IsNotExist(err) {
		t.Fatalf("expected asset to be permanently deleted, stat err: %v", err)
	}
}

// Regression test: trashing then restoring a note must round-trip its asset
// reference back into the same relative-to-note form the app writes on
// every save — not the old app-rooted absolute form, which would still
// technically resolve today (AbsoluteAssetPath treats it as a no-op legacy
// path) but silently reintroduces the non-portable format on every restore.
func TestRestoreTrashBundleKeepsRelativeAssetReference(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	noteWithRelativeAsset(t, tempDir, noteRel, assetRel)

	if err := s.trashFiles([]string{noteRel}, noteRel, "file", "Default", "testid456"); err != nil {
		t.Fatalf("trashFiles failed: %v", err)
	}
	if err := s.restoreTrashBundle("Default", "testid456"); err != nil {
		t.Fatalf("restoreTrashBundle failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(assetRel))); err != nil {
		t.Fatalf("expected asset restored to original location: %v", err)
	}
	restored, err := os.ReadFile(filepath.Join(tempDir, filepath.FromSlash(noteRel)))
	if err != nil {
		t.Fatalf("failed to read restored note: %v", err)
	}
	if !strings.Contains(string(restored), "../../../assets/Boards/Folder/Board/img.png") {
		t.Fatalf("expected restored note to reference the asset with a note-relative path, got:\n%s", restored)
	}
	if strings.Contains(string(restored), "/Default/assets/") {
		t.Fatalf("restored note regressed to the old app-rooted absolute asset path, got:\n%s", restored)
	}
}

// Regression test: the image editor's "._orig" backup (see handleUploadAsset)
// is never referenced anywhere in note content — it's discoverable only by
// naming convention next to the asset it belongs to. A card with an edited
// (annotated/cropped) image must have both files cleaned up on trash, not
// just the one the note actually links to.
func TestTrashFilesMovesOrigBackupSibling(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	origRel := "Default/assets/Boards/Folder/Board/img._orig.png"
	noteWithRelativeAsset(t, tempDir, noteRel, assetRel)
	if err := os.WriteFile(filepath.Join(tempDir, filepath.FromSlash(origRel)), []byte("fake-orig-bytes"), 0644); err != nil {
		t.Fatalf("write orig backup: %v", err)
	}

	if err := s.trashFiles([]string{noteRel}, noteRel, "file", "Default", "testid789"); err != nil {
		t.Fatalf("trashFiles failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(origRel))); !os.IsNotExist(err) {
		t.Fatalf("expected orig backup to be removed from original location, stat err: %v", err)
	}
	bundleAssetsDir := filepath.Join(s.trashDirForWorkspace("Default"), "testid789", "assets")
	entries, err := os.ReadDir(bundleAssetsDir)
	if err != nil {
		t.Fatalf("failed to read trash bundle assets dir: %v", err)
	}
	names := map[string]bool{}
	for _, e := range entries {
		names[e.Name()] = true
	}
	if !names["img.png"] || !names["img._orig.png"] {
		t.Fatalf("expected both img.png and img._orig.png in trash bundle, got %+v", entries)
	}

	// Restoring should bring the orig backup home alongside the main asset.
	if err := s.restoreTrashBundle("Default", "testid789"); err != nil {
		t.Fatalf("restoreTrashBundle failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(origRel))); err != nil {
		t.Fatalf("expected orig backup restored to original location: %v", err)
	}
}

// Regression test: same "._orig" sibling scenario for permanent delete.
func TestPermanentlyDeleteFilesRemovesOrigBackupSibling(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	origRel := "Default/assets/Boards/Folder/Board/img._orig.png"
	noteWithRelativeAsset(t, tempDir, noteRel, assetRel)
	if err := os.WriteFile(filepath.Join(tempDir, filepath.FromSlash(origRel)), []byte("fake-orig-bytes"), 0644); err != nil {
		t.Fatalf("write orig backup: %v", err)
	}

	s.permanentlyDeleteFiles([]string{noteRel}, "")

	if _, err := os.Stat(filepath.Join(tempDir, filepath.FromSlash(origRel))); !os.IsNotExist(err) {
		t.Fatalf("expected orig backup to be permanently deleted, stat err: %v", err)
	}
}

// Regression test: the image markup editor appends a cache-busting
// "?t=<timestamp>" to the asset URL it writes back into a note (see
// Editor.tsx's handleImageSave) so the browser re-fetches the edited image
// instead of showing a stale cached one. That query string ends up
// persisted as part of the note's on-disk relative asset reference, e.g.
// "../../../assets/Boards/.../img.png?t=1737100000000" — the real file on
// disk is still just "img.png", with no query string in its name. Deleting
// the note must still resolve through that contamination to find the real
// file, not silently skip it because the literal string doesn't exist.
func TestTrashFilesHandlesCacheBustedAssetReference(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	assetFull := filepath.Join(tempDir, filepath.FromSlash(assetRel))
	noteFull := filepath.Join(tempDir, filepath.FromSlash(noteRel))

	if err := os.MkdirAll(filepath.Dir(assetFull), 0755); err != nil {
		t.Fatalf("mkdir asset dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(noteFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.WriteFile(assetFull, []byte("fake-png-bytes"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	content := "---\ntitle: Task\ntype: task\n---\n\n![](../../../assets/Boards/Folder/Board/img.png?t=1737100000000)\n"
	if err := os.WriteFile(noteFull, []byte(content), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	if err := s.trashFiles([]string{noteRel}, noteRel, "file", "Default", "testidquery"); err != nil {
		t.Fatalf("trashFiles failed: %v", err)
	}

	if _, err := os.Stat(assetFull); !os.IsNotExist(err) {
		t.Fatalf("expected cache-busted asset to be removed from original location, stat err: %v", err)
	}
	bundleAssetsDir := filepath.Join(s.trashDirForWorkspace("Default"), "testidquery", "assets")
	entries, err := os.ReadDir(bundleAssetsDir)
	if err != nil {
		t.Fatalf("failed to read trash bundle assets dir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "img.png" {
		t.Fatalf("expected exactly one trashed asset named img.png, got %+v", entries)
	}
}

// Regression test for the reported bug: upload an image to a card, then
// remove it from the card's content (simulating either an explicit removal
// or a rollback to a version that predates the upload) — the asset is no
// longer referenced by current content, but it WAS referenced by an older
// history snapshot. Deleting the card must still find and clean it up via
// that history, not just leave it orphaned in the shared assets folder
// because the live content's own references no longer mention it.
func TestTrashFilesCleansUpAssetOrphanedByHistory(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	assetFull := filepath.Join(tempDir, filepath.FromSlash(assetRel))
	noteFull := filepath.Join(tempDir, filepath.FromSlash(noteRel))

	if err := os.MkdirAll(filepath.Dir(assetFull), 0755); err != nil {
		t.Fatalf("mkdir asset dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(noteFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.WriteFile(assetFull, []byte("fake-png-bytes"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}

	withImage := "---\ntitle: Task\ntype: task\n---\n\n![](../../../assets/Boards/Folder/Board/img.png)\n"
	withoutImage := "---\ntitle: Task\ntype: task\n---\n\nJust text now, image removed.\n"

	// Simulate the real save flow: write the with-image version first, then
	// call saveFileBackup (as the save handler does) before overwriting with
	// the without-image version — this is what actually populates history.
	if err := os.WriteFile(noteFull, []byte(withImage), 0644); err != nil {
		t.Fatalf("write initial note: %v", err)
	}
	s.saveFileBackup(noteRel, withoutImage)
	if err := os.WriteFile(noteFull, []byte(withoutImage), 0644); err != nil {
		t.Fatalf("overwrite note: %v", err)
	}

	// Sanity check: current content genuinely no longer references the
	// asset (this is what makes the bug possible in the first place).
	if strings.Contains(withoutImage, "img.png") {
		t.Fatalf("test setup broken: current content still references img.png")
	}

	if err := s.trashFiles([]string{noteRel}, noteRel, "file", "Default", "testid-history"); err != nil {
		t.Fatalf("trashFiles failed: %v", err)
	}

	if _, err := os.Stat(assetFull); !os.IsNotExist(err) {
		t.Fatalf("expected history-only-referenced asset to be removed from original location, stat err: %v", err)
	}
	bundleAssetsDir := filepath.Join(s.trashDirForWorkspace("Default"), "testid-history", "assets")
	entries, err := os.ReadDir(bundleAssetsDir)
	if err != nil {
		t.Fatalf("failed to read trash bundle assets dir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "img.png" {
		t.Fatalf("expected the history-only asset to be swept into the trash bundle, got %+v", entries)
	}
}

// Same history-orphan scenario for permanent delete, which must also remove
// the note's revision history itself once the note is gone for good.
func TestPermanentlyDeleteFilesCleansUpAssetOrphanedByHistory(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	assetFull := filepath.Join(tempDir, filepath.FromSlash(assetRel))
	noteFull := filepath.Join(tempDir, filepath.FromSlash(noteRel))

	if err := os.MkdirAll(filepath.Dir(assetFull), 0755); err != nil {
		t.Fatalf("mkdir asset dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(noteFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.WriteFile(assetFull, []byte("fake-png-bytes"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}

	withImage := "---\ntitle: Task\ntype: task\n---\n\n![](../../../assets/Boards/Folder/Board/img.png)\n"
	withoutImage := "---\ntitle: Task\ntype: task\n---\n\nJust text now, image removed.\n"

	if err := os.WriteFile(noteFull, []byte(withImage), 0644); err != nil {
		t.Fatalf("write initial note: %v", err)
	}
	s.saveFileBackup(noteRel, withoutImage)
	if err := os.WriteFile(noteFull, []byte(withoutImage), 0644); err != nil {
		t.Fatalf("overwrite note: %v", err)
	}

	historyDir := filepath.Join(tempDir, ".blockforge", "history", url.PathEscape(noteRel))
	if _, err := os.Stat(historyDir); err != nil {
		t.Fatalf("test setup broken: history dir missing: %v", err)
	}

	s.permanentlyDeleteFiles([]string{noteRel}, "")

	if _, err := os.Stat(assetFull); !os.IsNotExist(err) {
		t.Fatalf("expected history-only-referenced asset to be permanently deleted, stat err: %v", err)
	}
	if _, err := os.Stat(historyDir); !os.IsNotExist(err) {
		t.Fatalf("expected the note's history directory to be removed on permanent delete, stat err: %v", err)
	}
}

// Same cache-busted-reference scenario for permanent delete.
func TestPermanentlyDeleteFilesHandlesCacheBustedAssetReference(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	assetFull := filepath.Join(tempDir, filepath.FromSlash(assetRel))
	noteFull := filepath.Join(tempDir, filepath.FromSlash(noteRel))

	if err := os.MkdirAll(filepath.Dir(assetFull), 0755); err != nil {
		t.Fatalf("mkdir asset dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(noteFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.WriteFile(assetFull, []byte("fake-png-bytes"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	content := "---\ntitle: Task\ntype: task\n---\n\n![](../../../assets/Boards/Folder/Board/img.png?t=1737100000000)\n"
	if err := os.WriteFile(noteFull, []byte(content), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	s.permanentlyDeleteFiles([]string{noteRel}, "")

	if _, err := os.Stat(assetFull); !os.IsNotExist(err) {
		t.Fatalf("expected cache-busted asset to be permanently deleted, stat err: %v", err)
	}
}

// Regression test for the follow-up bug report: an asset whose only
// reference lived in a history snapshot that has since been pruned (aged
// out of the configured retention window) is invisible to
// historicalAssetURLs — the permanent, never-pruned asset log is the
// backstop for exactly this case. Deliberately does NOT create any history
// snapshot, to prove the asset log alone (independent of history) is
// sufficient to find and clean up the asset.
func TestPermanentlyDeleteFilesCleansUpAssetViaLogWithNoHistory(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	assetRel := "Default/assets/Boards/Folder/Board/img.png"
	assetFull := filepath.Join(tempDir, filepath.FromSlash(assetRel))
	noteFull := filepath.Join(tempDir, filepath.FromSlash(noteRel))

	if err := os.MkdirAll(filepath.Dir(assetFull), 0755); err != nil {
		t.Fatalf("mkdir asset dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(noteFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.WriteFile(assetFull, []byte("fake-png-bytes"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	// Current content never references the image at all — as if it was
	// removed long enough ago that its history snapshot has since aged out
	// and been pruned (simulated here by simply never creating one).
	content := "---\ntitle: Task\ntype: task\n---\n\nJust text, no image reference, no history entry either.\n"
	if err := os.WriteFile(noteFull, []byte(content), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	// Simulates what handleUploadAsset does on every upload.
	s.appendAssetLog(noteRel, "/"+filepath.ToSlash(assetRel))

	s.permanentlyDeleteFiles([]string{noteRel}, "")

	if _, err := os.Stat(assetFull); !os.IsNotExist(err) {
		t.Fatalf("expected log-only-referenced asset to be permanently deleted, stat err: %v", err)
	}
}

// Regression test: renaming a note must carry its version history and
// permanent asset log along to the new path — otherwise every pre-rename
// snapshot/upload record becomes permanently invisible to anything keyed by
// the note's current path (the Version History panel, rollback, and this
// package's own delete-time asset cleanup all key off the current path).
func TestHandleMoveFileCarriesHistoryAndAssetLog(t *testing.T) {
	s, tempDir := newTestServer(t)

	oldRel := "Default/Boards/Folder/Board/Old-Name.md"
	newRel := "Default/Boards/Folder/Board/New-Name.md"
	oldFull := filepath.Join(tempDir, filepath.FromSlash(oldRel))

	if err := os.MkdirAll(filepath.Dir(oldFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.WriteFile(oldFull, []byte("---\ntitle: Old Name\ntype: task\n---\n\nBody\n"), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	// Populate a history snapshot and an asset-log entry under the OLD path,
	// exactly as saveFileBackup / appendAssetLog would have over the note's
	// life prior to this rename.
	s.saveFileBackup(oldRel, "---\ntitle: Old Name\ntype: task\n---\n\nBody v2\n")
	s.appendAssetLog(oldRel, "/Default/assets/Boards/Folder/Board/img.png")

	oldHistoryDir := historyDirPath(tempDir, oldRel)
	if _, err := os.Stat(oldHistoryDir); err != nil {
		t.Fatalf("test setup broken: history dir missing: %v", err)
	}
	oldLogPath := assetLogPath(tempDir, oldRel)
	if _, err := os.Stat(oldLogPath); err != nil {
		t.Fatalf("test setup broken: asset log missing: %v", err)
	}

	reqBody, _ := json.Marshal(map[string]string{"from": oldRel, "to": newRel})
	req := httptest.NewRequest(http.MethodPost, "/api/file/move", bytes.NewReader(reqBody))
	rec := httptest.NewRecorder()
	s.handleMoveFile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handleMoveFile returned %d: %s", rec.Code, rec.Body.String())
	}

	if _, err := os.Stat(oldHistoryDir); !os.IsNotExist(err) {
		t.Fatalf("expected old history dir to be gone after rename, stat err: %v", err)
	}
	if _, err := os.Stat(oldLogPath); !os.IsNotExist(err) {
		t.Fatalf("expected old asset log to be gone after rename, stat err: %v", err)
	}

	newHistoryDir := historyDirPath(tempDir, newRel)
	newEntries, err := os.ReadDir(newHistoryDir)
	if err != nil || len(newEntries) != 1 {
		t.Fatalf("expected exactly 1 history snapshot to have followed the rename, err=%v entries=%v", err, newEntries)
	}
	newLogPath := assetLogPath(tempDir, newRel)
	logBytes, err := os.ReadFile(newLogPath)
	if err != nil || !strings.Contains(string(logBytes), "img.png") {
		t.Fatalf("expected asset log to have followed the rename with its entry intact, err=%v content=%s", err, logBytes)
	}
}

// End-to-end regression for the exact scenario the user described: upload
// an image, rename the card (so the asset was logged under a name the card
// no longer has), then delete it — the permanent asset log must have
// followed the rename for delete-time cleanup to still find the image.
func TestRenamedNoteAssetStillCleanedUpOnDelete(t *testing.T) {
	s, tempDir := newTestServer(t)

	oldRel := "Default/Boards/Folder/Board/Old-Name.md"
	newRel := "Default/Boards/Folder/Board/New-Name.md"
	assetRel := "Default/assets/Boards/Folder/Board/Old-Name-clipboard-123.png"
	oldFull := filepath.Join(tempDir, filepath.FromSlash(oldRel))
	assetFull := filepath.Join(tempDir, filepath.FromSlash(assetRel))

	if err := os.MkdirAll(filepath.Dir(oldFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(assetFull), 0755); err != nil {
		t.Fatalf("mkdir asset dir: %v", err)
	}
	if err := os.WriteFile(assetFull, []byte("fake-png-bytes"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	// The card's CURRENT content never references the image — it was
	// removed before the rename, so only the asset log (uploaded under the
	// OLD note name) remembers it ever existed.
	if err := os.WriteFile(oldFull, []byte("---\ntitle: Old Name\ntype: task\n---\n\nNo image here.\n"), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}
	s.appendAssetLog(oldRel, "/"+filepath.ToSlash(assetRel))

	reqBody, _ := json.Marshal(map[string]string{"from": oldRel, "to": newRel})
	req := httptest.NewRequest(http.MethodPost, "/api/file/move", bytes.NewReader(reqBody))
	rec := httptest.NewRecorder()
	s.handleMoveFile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handleMoveFile returned %d: %s", rec.Code, rec.Body.String())
	}

	s.permanentlyDeleteFiles([]string{newRel}, "")

	if _, err := os.Stat(assetFull); !os.IsNotExist(err) {
		t.Fatalf("expected asset uploaded under the pre-rename name to still be cleaned up, stat err: %v", err)
	}
}

// Regression test: trashing then restoring a note must bring its version
// history and asset log back too — otherwise a restored note's
// delete-safety net (and its Version History panel) would silently reset
// to empty even though the note itself came back intact.
func TestTrashAndRestorePreservesHistoryAndAssetLog(t *testing.T) {
	s, tempDir := newTestServer(t)

	noteRel := "Default/Boards/Folder/Board/task.md"
	noteFull := filepath.Join(tempDir, filepath.FromSlash(noteRel))
	if err := os.MkdirAll(filepath.Dir(noteFull), 0755); err != nil {
		t.Fatalf("mkdir note dir: %v", err)
	}
	if err := os.WriteFile(noteFull, []byte("---\ntitle: Task\ntype: task\n---\n\nBody\n"), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}
	s.saveFileBackup(noteRel, "---\ntitle: Task\ntype: task\n---\n\nBody v2\n")
	s.appendAssetLog(noteRel, "/Default/assets/Boards/Folder/Board/img.png")

	if err := s.trashFiles([]string{noteRel}, noteRel, "file", "Default", "testid-hist-restore"); err != nil {
		t.Fatalf("trashFiles failed: %v", err)
	}
	if _, err := os.Stat(historyDirPath(tempDir, noteRel)); !os.IsNotExist(err) {
		t.Fatalf("expected history dir to be moved out of its original location by trash")
	}

	if err := s.restoreTrashBundle("Default", "testid-hist-restore"); err != nil {
		t.Fatalf("restoreTrashBundle failed: %v", err)
	}

	restoredHistoryDir := historyDirPath(tempDir, noteRel)
	entries, err := os.ReadDir(restoredHistoryDir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("expected history to be restored with its 1 snapshot, err=%v entries=%v", err, entries)
	}
	logBytes, err := os.ReadFile(assetLogPath(tempDir, noteRel))
	if err != nil || !strings.Contains(string(logBytes), "img.png") {
		t.Fatalf("expected asset log to be restored with its entry intact, err=%v content=%s", err, logBytes)
	}
}
