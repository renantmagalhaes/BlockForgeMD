package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type FileRecord struct {
	Path        string            `json:"path"`
	Title       string            `json:"title"`
	Type        string            `json:"type"` // "document", "task", "canvas"
	ContentHash string            `json:"contentHash"`
	UpdatedAt   time.Time         `json:"updatedAt"`
	Content     string            `json:"content,omitempty"`
	FrontMatter map[string]string `json:"frontMatter,omitempty"`
	Position    float64           `json:"position"`
	// Checklist groups (contiguous runs of `- [ ]`/`- [x]` lines, one group
	// per run) — kept separate from Content so the Kanban board's bulk file
	// list can show checklist progress without shipping every file's full
	// body text (see ListFiles). Populated by parser.ParseFile.
	ChecklistGroups [][]ChecklistItem `json:"checklistGroups,omitempty"`
}

type ChecklistItem struct {
	Done bool   `json:"done"`
	Text string `json:"text"`
	// Indent is the raw leading-whitespace character count (tabs expanded)
	// on the item's source line — the frontend ranks these by distinct
	// value within a group to render nested sub-tasks at the right depth,
	// rather than relying on a specific indent width.
	Indent int `json:"indent"`
}

type PositionUpdate struct {
	Path     string  `json:"path"`
	Position float64 `json:"position"`
}

type TaskRecord struct {
	ID         string `json:"id"`
	FilePath   string `json:"filePath"`
	Content    string `json:"content"`
	Completed  bool   `json:"completed"`
	LineNumber int    `json:"lineNumber"`
}

type DB struct {
	Conn *sql.DB
}

// NewDB initializes the SQLite database
func NewDB(dbPath string) (*DB, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory: %w", err)
	}

	conn, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable Write-Ahead Logging (WAL) and foreign keys
	if _, err := conn.Exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA foreign_keys=ON;
	`); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to configure sqlite: %w", err)
	}

	db := &DB{Conn: conn}
	if err := db.createTables(); err != nil {
		conn.Close()
		return nil, err
	}

	return db, nil
}

func (db *DB) createTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS files (
			path TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			type TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			updated_at DATETIME NOT NULL,
			content TEXT,
			checklist TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS front_matter (
			file_path TEXT,
			key TEXT,
			value TEXT,
			PRIMARY KEY (file_path, key),
			FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			file_path TEXT,
			content TEXT NOT NULL,
			completed BOOLEAN NOT NULL,
			line_number INTEGER NOT NULL,
			FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			key_hash TEXT NOT NULL UNIQUE,
			label TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_used_at DATETIME,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS plugin_secrets (
			key TEXT PRIMARY KEY,
			value_enc BLOB NOT NULL,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS plugin_gcal_accounts (
			user_id TEXT PRIMARY KEY,
			google_email TEXT,
			access_token_enc BLOB,
			refresh_token_enc BLOB NOT NULL,
			token_expiry DATETIME,
			calendar_id TEXT NOT NULL DEFAULT 'primary',
			sync_token TEXT,
			last_sync_at DATETIME,
			last_sync_error TEXT,
			connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS plugin_gcal_sync_state (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			google_event_id TEXT NOT NULL,
			last_due_date TEXT,
			local_content_hash TEXT,
			last_synced_at DATETIME,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE (user_id, file_path),
			UNIQUE (user_id, google_event_id)
		);`,
		`CREATE TABLE IF NOT EXISTS plugin_gcal_user_config (
			user_id TEXT PRIMARY KEY,
			client_id TEXT NOT NULL DEFAULT '',
			client_secret_enc BLOB,
			poll_interval_seconds INTEGER NOT NULL DEFAULT 0,
			workspaces TEXT NOT NULL DEFAULT '',
			production_confirmed BOOLEAN NOT NULL DEFAULT 0,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS plugin_ollama_tagger_user_config (
			user_id TEXT PRIMARY KEY,
			endpoint_enc BLOB,
			model TEXT NOT NULL DEFAULT '',
			auto_enabled BOOLEAN NOT NULL DEFAULT 0,
			recheck_on_change BOOLEAN NOT NULL DEFAULT 1,
			poll_interval_seconds INTEGER NOT NULL DEFAULT 0,
			max_tags INTEGER NOT NULL DEFAULT 5,
			workspaces TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS plugin_ollama_tagger_state (
			user_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			content_hash TEXT NOT NULL DEFAULT '',
			managed_tags TEXT NOT NULL DEFAULT '[]',
			last_run_at DATETIME,
			last_error TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (user_id, file_path),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
	}

	for _, q := range queries {
		if _, err := db.Conn.Exec(q); err != nil {
			return fmt.Errorf("failed to create tables: %w, query: %s", err, q)
		}
	}

	// Automatic migrations
	_, _ = db.Conn.Exec("ALTER TABLE files ADD COLUMN content TEXT;")
	_, _ = db.Conn.Exec("ALTER TABLE files ADD COLUMN position REAL DEFAULT 0;")
	_, _ = db.Conn.Exec("ALTER TABLE files ADD COLUMN checklist TEXT;")
	_, _ = db.Conn.Exec("ALTER TABLE plugin_ollama_tagger_user_config ADD COLUMN workspaces TEXT NOT NULL DEFAULT '';")
	_, _ = db.Conn.Exec("UPDATE files SET position = rowid WHERE position = 0 OR position IS NULL;")
	_, _ = db.Conn.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('history_limit', '50');")

	if err := db.migrateSharedGCalConfigToPerUser(); err != nil {
		return fmt.Errorf("failed to migrate shared google calendar config: %w", err)
	}

	return nil
}

// migrateSharedGCalConfigToPerUser is a one-time, idempotent backfill: the
// Google Calendar plugin used to have one shared, instance-wide Client
// ID/Secret/poll-interval/workspace-scope; now every user has their own. This
// copies whatever shared value already existed into every existing user's
// new per-user row, once, so whoever already did the real work of creating a
// Google Cloud OAuth Client isn't forced to redo it, and existing connected
// accounts keep working unmodified (many Google accounts can authenticate
// against the same OAuth Client, so sharing the starting point is harmless).
// Guarded by "does plugin_gcal_user_config already have any rows" so it only
// ever runs once — never re-copies after someone has customized their own
// per-user config away from the inherited defaults.
func (db *DB) migrateSharedGCalConfigToPerUser() error {
	var already int
	if err := db.Conn.QueryRow(`SELECT COUNT(*) FROM plugin_gcal_user_config;`).Scan(&already); err != nil {
		return err
	}
	if already > 0 {
		return nil
	}

	clientID, _ := db.GetSetting("plugin_google_client_id", "")
	if clientID == "" {
		return nil // nothing shared was ever configured — fresh instance, nothing to migrate
	}
	secretEnc, err := db.GetEncryptedSecret("google_client_secret")
	if err != nil {
		return err
	}
	pollRaw, _ := db.GetSetting("plugin_gcal_poll_interval_seconds", "")
	pollSecs, _ := strconv.Atoi(pollRaw)
	workspaces, _ := db.GetSetting("plugin_gcal_workspaces", "")
	prodConfirmed, _ := db.GetSetting("plugin_gcal_production_confirmed", "")

	rows, err := db.Conn.Query(`SELECT id FROM users;`)
	if err != nil {
		return err
	}
	var userIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			userIDs = append(userIDs, id)
		}
	}
	rows.Close()

	for _, id := range userIDs {
		_, err := db.Conn.Exec(`
			INSERT INTO plugin_gcal_user_config
				(user_id, client_id, client_secret_enc, poll_interval_seconds, workspaces, production_confirmed)
			VALUES (?, ?, ?, ?, ?, ?);
		`, id, clientID, secretEnc, pollSecs, workspaces, prodConfirmed == "true")
		if err != nil {
			return fmt.Errorf("failed to backfill user %s: %w", id, err)
		}
	}
	return nil
}

// UpsertFile updates or inserts file metadata, front matter, and tasks inside a transaction
func (db *DB) UpsertFile(file FileRecord, fm map[string]interface{}, tasks []TaskRecord) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Checklist groups are stored as JSON — tiny compared to full body text,
	// so unlike Content this is safe to always include in the bulk file list
	// (see ListFiles).
	var checklistJSON string
	if len(file.ChecklistGroups) > 0 {
		bytes, err := json.Marshal(file.ChecklistGroups)
		if err == nil {
			checklistJSON = string(bytes)
		}
	}

	// 1. Insert or update file — preserve position for existing rows, assign max+1 for new ones
	_, err = tx.Exec(`
		INSERT INTO files (path, title, type, content_hash, updated_at, content, checklist, position)
		VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) FROM files), 0) + 1)
		ON CONFLICT(path) DO UPDATE SET
			title = excluded.title,
			type = excluded.type,
			content_hash = excluded.content_hash,
			updated_at = excluded.updated_at,
			content = excluded.content,
			checklist = excluded.checklist;
	`, file.Path, file.Title, file.Type, file.ContentHash, file.UpdatedAt, file.Content, checklistJSON)
	if err != nil {
		return fmt.Errorf("failed to upsert file: %w", err)
	}

	// 2. Delete old front matter
	_, err = tx.Exec("DELETE FROM front_matter WHERE file_path = ?;", file.Path)
	if err != nil {
		return fmt.Errorf("failed to delete front_matter: %w", err)
	}

	// 3. Insert new front matter
	for k, v := range fm {
		var valStr string
		switch typedVal := v.(type) {
		case string:
			valStr = typedVal
		case bool, int, int64, float64:
			valStr = fmt.Sprintf("%v", typedVal)
		default:
			// For slices, maps, serialize as JSON
			bytes, err := json.Marshal(typedVal)
			if err == nil {
				valStr = string(bytes)
			} else {
				valStr = fmt.Sprintf("%v", typedVal)
			}
		}

		_, err = tx.Exec(`
			INSERT INTO front_matter (file_path, key, value)
			VALUES (?, ?, ?);
		`, file.Path, k, valStr)
		if err != nil {
			return fmt.Errorf("failed to insert front_matter (%s=%s): %w", k, valStr, err)
		}
	}

	// 4. Delete old tasks
	_, err = tx.Exec("DELETE FROM tasks WHERE file_path = ?;", file.Path)
	if err != nil {
		return fmt.Errorf("failed to delete tasks: %w", err)
	}

	// 5. Insert new tasks
	for _, task := range tasks {
		_, err = tx.Exec(`
			INSERT OR REPLACE INTO tasks (id, file_path, content, completed, line_number)
			VALUES (?, ?, ?, ?, ?);
		`, task.ID, task.FilePath, task.Content, task.Completed, task.LineNumber)
		if err != nil {
			return fmt.Errorf("failed to insert task: %w", err)
		}
	}

	return tx.Commit()
}

// DeleteFile removes a file and cascadingly deletes front matter and tasks
func (db *DB) DeleteFile(path string) error {
	_, err := db.Conn.Exec("DELETE FROM files WHERE path = ?;", path)
	return err
}

// GetFile retrieves a single file record along with its front matter
func (db *DB) GetFile(path string) (*FileRecord, error) {
	row := db.Conn.QueryRow("SELECT path, title, type, content_hash, updated_at, COALESCE(content, '') FROM files WHERE path = ?;", path)
	var record FileRecord
	err := row.Scan(&record.Path, &record.Title, &record.Type, &record.ContentHash, &record.UpdatedAt, &record.Content)
	if err != nil {
		return nil, err
	}

	// Get front matter
	rows, err := db.Conn.Query("SELECT key, value FROM front_matter WHERE file_path = ?;", path)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	record.FrontMatter = make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			record.FrontMatter[k] = v
		}
	}

	return &record, nil
}

// ListFiles returns metadata for every file (path, title, type, front matter,
// position, etc.) but deliberately omits the content column: this powers the
// sidebar tree/kanban/graph views, which never render file bodies, and it's
// re-fetched on almost every SSE file_update and local mutation — including
// full content here means every client re-downloads the entire vault's text
// on every edit anywhere, which stops scaling once the vault has any size to
// it. Use GetFile or Search when the body text is actually needed.
func (db *DB) ListFiles() ([]FileRecord, error) {
	rows, err := db.Conn.Query("SELECT path, title, type, content_hash, updated_at, COALESCE(position, rowid), COALESCE(checklist, '') FROM files ORDER BY COALESCE(position, rowid) ASC;")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []FileRecord
	recordMap := make(map[string]*FileRecord)

	for rows.Next() {
		var record FileRecord
		var checklistJSON string
		err := rows.Scan(&record.Path, &record.Title, &record.Type, &record.ContentHash, &record.UpdatedAt, &record.Position, &checklistJSON)
		if err == nil {
			record.FrontMatter = make(map[string]string)
			if checklistJSON != "" {
				_ = json.Unmarshal([]byte(checklistJSON), &record.ChecklistGroups)
			}
			records = append(records, record)
		}
	}

	// Create pointers map to populate front matter efficiently
	for i := range records {
		recordMap[records[i].Path] = &records[i]
	}

	// Fetch all front matter
	fmRows, err := db.Conn.Query("SELECT file_path, key, value FROM front_matter;")
	if err == nil {
		defer fmRows.Close()
		for fmRows.Next() {
			var filePath, k, v string
			if err := fmRows.Scan(&filePath, &k, &v); err == nil {
				if rec, ok := recordMap[filePath]; ok {
					rec.FrontMatter[k] = v
				}
			}
		}
	}

	return records, nil
}

// GetFrontMatterFlat returns a single file's front matter as a flat key/value
// map — used where only one specific file's own settings are needed (e.g. a
// board's completedColumns/dueDateAutoUpdate), as opposed to QueryCards
// which is shaped for scanning many files under a folder prefix.
func (db *DB) GetFrontMatterFlat(path string) (map[string]string, error) {
	rows, err := db.Conn.Query(`SELECT key, value FROM front_matter WHERE file_path = ?;`, path)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fm := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			fm[k] = v
		}
	}
	return fm, nil
}

// QueryByFrontMatter fetches files matching a specific front matter key-value criteria (perfect for Kanban board columns)
func (db *DB) QueryByFrontMatter(key, value string) ([]FileRecord, error) {
	query := `
		SELECT f.path, f.title, f.type, f.content_hash, f.updated_at 
		FROM files f
		JOIN front_matter fm ON f.path = fm.file_path
		WHERE fm.key = ? AND fm.value = ?
		ORDER BY f.updated_at DESC;
	`
	rows, err := db.Conn.Query(query, key, value)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []FileRecord
	for rows.Next() {
		var record FileRecord
		err := rows.Scan(&record.Path, &record.Title, &record.Type, &record.ContentHash, &record.UpdatedAt)
		if err == nil {
			records = append(records, record)
		}
	}
	return records, nil
}

// CardResult holds a file record with all its front matter fields flattened for card queries.
type CardResult struct {
	Path      string            `json:"path"`
	Title     string            `json:"title"`
	UpdatedAt string            `json:"updatedAt"`
	Fields    map[string]string `json:"fields"`
}

// QueryCards returns cards (files under a path prefix) with optional filters.
// pathPrefix: directory prefix, e.g. "Default/Boards/board/"
// filters: map of front-matter key → exact value match (e.g. {"status":"Done"})
// dueBefore: if non-empty, only return cards where dueDate < dueBefore (ISO date string)
func (db *DB) QueryCards(pathPrefix string, filters map[string]string, dueBefore string) ([]CardResult, error) {
	// Fetch all files under the prefix, then join all their front matter in one pass.
	rows, err := db.Conn.Query(`
		SELECT f.path, f.title, f.updated_at, fm.key, fm.value
		FROM files f
		LEFT JOIN front_matter fm ON fm.file_path = f.path
		WHERE f.path LIKE ?
		ORDER BY f.path, fm.key;
	`, pathPrefix+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Aggregate front matter per file.
	type entry struct {
		path      string
		title     string
		updatedAt string
		fm        map[string]string
	}
	order := []string{}
	byPath := map[string]*entry{}
	for rows.Next() {
		var path, title, updatedAt string
		var k, v *string
		if err := rows.Scan(&path, &title, &updatedAt, &k, &v); err != nil {
			continue
		}
		if _, ok := byPath[path]; !ok {
			byPath[path] = &entry{path: path, title: title, updatedAt: updatedAt, fm: map[string]string{}}
			order = append(order, path)
		}
		if k != nil && v != nil {
			byPath[path].fm[*k] = *v
		}
	}

	var results []CardResult
	for _, path := range order {
		e := byPath[path]

		// Apply front-matter exact-match filters.
		match := true
		for fk, fv := range filters {
			if e.fm[fk] != fv {
				match = false
				break
			}
		}
		if !match {
			continue
		}

		// Apply due-before date filter.
		if dueBefore != "" {
			d := e.fm["dueDate"]
			if d == "" {
				continue
			}
			// Compare as strings — ISO dates sort lexicographically.
			if d >= dueBefore {
				continue
			}
		}

		results = append(results, CardResult{
			Path:      e.path,
			Title:     e.title,
			UpdatedAt: e.updatedAt,
			Fields:    e.fm,
		})
	}
	return results, nil
}

// GetTasksForFile returns all tasks inside a single file
func (db *DB) GetTasksForFile(filePath string) ([]TaskRecord, error) {
	rows, err := db.Conn.Query(`
		SELECT id, file_path, content, completed, line_number 
		FROM tasks 
		WHERE file_path = ? 
		ORDER BY line_number ASC;
	`, filePath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []TaskRecord
	for rows.Next() {
		var t TaskRecord
		if err := rows.Scan(&t.ID, &t.FilePath, &t.Content, &t.Completed, &t.LineNumber); err == nil {
			tasks = append(tasks, t)
		}
	}
	return tasks, nil
}

// Search queries files where path, title, or content matches the query string
func (db *DB) Search(query, wsPrefix string) ([]FileRecord, error) {
	q := "%" + query + "%"
	var rows *sql.Rows
	var err error
	if wsPrefix != "" {
		rows, err = db.Conn.Query(`
			SELECT path, title, type, content_hash, updated_at, COALESCE(content, '')
			FROM files
			WHERE (path LIKE ? OR title LIKE ? OR content LIKE ?)
			  AND path LIKE ?
			ORDER BY title ASC LIMIT 50;
		`, q, q, q, wsPrefix+"%")
	} else {
		rows, err = db.Conn.Query(`
			SELECT path, title, type, content_hash, updated_at, COALESCE(content, '')
			FROM files
			WHERE path LIKE ? OR title LIKE ? OR content LIKE ?
			ORDER BY title ASC LIMIT 50;
		`, q, q, q)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []FileRecord
	for rows.Next() {
		var record FileRecord
		err := rows.Scan(&record.Path, &record.Title, &record.Type, &record.ContentHash, &record.UpdatedAt, &record.Content)
		if err == nil {
			records = append(records, record)
		}
	}
	return records, nil
}

func (db *DB) GetSetting(key string, defaultValue string) (string, error) {
	var val string
	err := db.Conn.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&val)
	if err != nil {
		return defaultValue, nil
	}
	return val, nil
}

func (db *DB) SetSetting(key string, value string) error {
	_, err := db.Conn.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value)
	return err
}

// RenameWorkspacePaths updates all path columns when a workspace directory is renamed.
func (db *DB) RenameWorkspacePaths(oldName, newName string) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	oldPrefix := oldName + "/"
	newPrefix := newName + "/"
	prefixLen := len(oldPrefix) + 1 // sqlite substr is 1-indexed

	q := "WHERE %s LIKE ?"
	for _, stmt := range []string{
		fmt.Sprintf("UPDATE files SET path = ? || substr(path, ?) "+q, "path"),
		fmt.Sprintf("UPDATE front_matter SET file_path = ? || substr(file_path, ?) "+q, "file_path"),
		fmt.Sprintf("UPDATE tasks SET file_path = ? || substr(file_path, ?) "+q, "file_path"),
	} {
		if _, err := tx.Exec(stmt, newPrefix, prefixLen, oldPrefix+"%"); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AddWorkspacePrefix prepends workspace/name to all path columns.
// Called once during migration from the flat-directory structure.
func (db *DB) AddWorkspacePrefix(workspace string) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	prefix := workspace + "/"
	if _, err := tx.Exec("UPDATE files SET path = ? || path", prefix); err != nil {
		return fmt.Errorf("failed to update files: %w", err)
	}
	if _, err := tx.Exec("UPDATE front_matter SET file_path = ? || file_path", prefix); err != nil {
		return fmt.Errorf("failed to update front_matter: %w", err)
	}
	if _, err := tx.Exec("UPDATE tasks SET file_path = ? || file_path", prefix); err != nil {
		return fmt.Errorf("failed to update tasks: %w", err)
	}
	return tx.Commit()
}

// DeleteWorkspacePaths removes all path-referencing rows for a deleted workspace,
// plus its per-workspace settings (favorites, tag colors).
func (db *DB) DeleteWorkspacePaths(name string) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	prefix := name + "/%"
	for _, stmt := range []string{
		"DELETE FROM files WHERE path LIKE ?",
		"DELETE FROM front_matter WHERE file_path LIKE ?",
		"DELETE FROM tasks WHERE file_path LIKE ?",
	} {
		if _, err := tx.Exec(stmt, prefix); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("DELETE FROM settings WHERE key IN (?, ?)", "favorites_"+name, "tag_colors_"+name); err != nil {
		return err
	}
	return tx.Commit()
}

// UpdatePositions batch-updates the position of files for reordering.
func (db *DB) UpdatePositions(updates []PositionUpdate) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare("UPDATE files SET position = ? WHERE path = ?")
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, u := range updates {
		if _, err := stmt.Exec(u.Position, u.Path); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (db *DB) Close() error {
	return db.Conn.Close()
}

// ── Auth types ────────────────────────────────────────────────────────────────

type UserRecord struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

type APIKeyRecord struct {
	ID         string  `json:"id"`
	UserID     string  `json:"userId"`
	Label      string  `json:"label"`
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt"`
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

func (db *DB) IsBootstrapRequired() bool {
	var count int
	db.Conn.QueryRow("SELECT COUNT(*) FROM users;").Scan(&count)
	return count == 0
}

// ── Users ─────────────────────────────────────────────────────────────────────

func (db *DB) CreateUser(username, passwordHash string) (*UserRecord, error) {
	id := newID()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Conn.Exec(
		`INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?);`,
		id, username, passwordHash, now, now,
	)
	if err != nil {
		return nil, err
	}
	return &UserRecord{ID: id, Username: username, CreatedAt: now, UpdatedAt: now}, nil
}

func (db *DB) GetUserByUsername(username string) (*UserRecord, error) {
	row := db.Conn.QueryRow(
		`SELECT id, username, password_hash, created_at, updated_at FROM users WHERE username = ?;`, username)
	return scanUser(row)
}

func (db *DB) GetUserByID(id string) (*UserRecord, error) {
	row := db.Conn.QueryRow(
		`SELECT id, username, password_hash, created_at, updated_at FROM users WHERE id = ?;`, id)
	return scanUser(row)
}

func (db *DB) ListUsers() ([]UserRecord, error) {
	rows, err := db.Conn.Query(`SELECT id, username, password_hash, created_at, updated_at FROM users ORDER BY created_at ASC;`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserRecord
	for rows.Next() {
		u, err := scanUser(rows)
		if err == nil {
			out = append(out, *u)
		}
	}
	return out, nil
}

func (db *DB) DeleteUser(id string) error {
	res, err := db.Conn.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("user not found")
	}
	// Clean up sessions and API keys so they don't linger
	_, _ = db.Conn.Exec(`DELETE FROM sessions WHERE user_id = ?`, id)
	_, _ = db.Conn.Exec(`DELETE FROM api_keys WHERE user_id = ?`, id)
	return nil
}

func scanUser(s interface {
	Scan(...any) error
}) (*UserRecord, error) {
	var u UserRecord
	if err := s.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt, &u.UpdatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}

// ── Sessions ──────────────────────────────────────────────────────────────────

func (db *DB) CreateSession(userID string, expires time.Time) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	_, err := db.Conn.Exec(
		`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?);`,
		token, userID, expires.UTC().Format(time.RFC3339),
	)
	return token, err
}

func (db *DB) GetUserBySessionToken(token string) (*UserRecord, error) {
	row := db.Conn.QueryRow(`
		SELECT u.id, u.username, u.password_hash, u.created_at, u.updated_at
		FROM users u
		JOIN sessions s ON s.user_id = u.id
		WHERE s.token = ? AND s.expires_at > datetime('now');
	`, token)
	return scanUser(row)
}

func (db *DB) DeleteSession(token string) error {
	_, err := db.Conn.Exec(`DELETE FROM sessions WHERE token = ?;`, token)
	return err
}

func (db *DB) PruneExpiredSessions() {
	db.Conn.Exec(`DELETE FROM sessions WHERE expires_at <= datetime('now');`)
}

// ── API Keys ──────────────────────────────────────────────────────────────────

func (db *DB) CreateAPIKey(userID, keyHash, label string) (string, error) {
	id := newID()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Conn.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash, label, created_at) VALUES (?, ?, ?, ?, ?);`,
		id, userID, keyHash, label, now,
	)
	return id, err
}

func (db *DB) GetUserByAPIKeyHash(keyHash string) (*UserRecord, error) {
	row := db.Conn.QueryRow(`
		SELECT u.id, u.username, u.password_hash, u.created_at, u.updated_at
		FROM users u
		JOIN api_keys k ON k.user_id = u.id
		WHERE k.key_hash = ?;
	`, keyHash)
	return scanUser(row)
}

func (db *DB) ListAPIKeys(userID string) ([]APIKeyRecord, error) {
	rows, err := db.Conn.Query(`
		SELECT id, user_id, label, created_at, last_used_at
		FROM api_keys WHERE user_id = ? ORDER BY created_at DESC;
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []APIKeyRecord
	for rows.Next() {
		var k APIKeyRecord
		if err := rows.Scan(&k.ID, &k.UserID, &k.Label, &k.CreatedAt, &k.LastUsedAt); err == nil {
			out = append(out, k)
		}
	}
	return out, nil
}

func (db *DB) DeleteAPIKey(id, userID string) error {
	_, err := db.Conn.Exec(`DELETE FROM api_keys WHERE id = ? AND user_id = ?;`, id, userID)
	return err
}

func (db *DB) UpdateAPIKeyLastUsedByHash(keyHash string) {
	db.Conn.Exec(`UPDATE api_keys SET last_used_at = datetime('now') WHERE key_hash = ?;`, keyHash)
}

// newID generates a random hex ID.
func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
