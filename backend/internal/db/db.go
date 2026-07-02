package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
			content TEXT
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
	}

	for _, q := range queries {
		if _, err := db.Conn.Exec(q); err != nil {
			return fmt.Errorf("failed to create tables: %w, query: %s", err, q)
		}
	}

	// Automatic migrations
	_, _ = db.Conn.Exec("ALTER TABLE files ADD COLUMN content TEXT;")
	_, _ = db.Conn.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('history_limit', '50');")

	return nil
}

// UpsertFile updates or inserts file metadata, front matter, and tasks inside a transaction
func (db *DB) UpsertFile(file FileRecord, fm map[string]interface{}, tasks []TaskRecord) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Insert or replace file
	_, err = tx.Exec(`
		INSERT OR REPLACE INTO files (path, title, type, content_hash, updated_at, content)
		VALUES (?, ?, ?, ?, ?, ?);
	`, file.Path, file.Title, file.Type, file.ContentHash, file.UpdatedAt, file.Content)
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

// ListFiles returns all files in the database, including their front matter
func (db *DB) ListFiles() ([]FileRecord, error) {
	rows, err := db.Conn.Query("SELECT path, title, type, content_hash, updated_at, COALESCE(content, '') FROM files ORDER BY path ASC;")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []FileRecord
	recordMap := make(map[string]*FileRecord)

	for rows.Next() {
		var record FileRecord
		err := rows.Scan(&record.Path, &record.Title, &record.Type, &record.ContentHash, &record.UpdatedAt, &record.Content)
		if err == nil {
			record.FrontMatter = make(map[string]string)
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
func (db *DB) Search(query string) ([]FileRecord, error) {
	q := "%" + query + "%"
	rows, err := db.Conn.Query(`
		SELECT path, title, type, content_hash, updated_at, COALESCE(content, '') 
		FROM files 
		WHERE path LIKE ? OR title LIKE ? OR content LIKE ?
		ORDER BY title ASC LIMIT 50;
	`, q, q, q)
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

func (db *DB) Close() error {
	return db.Conn.Close()
}
