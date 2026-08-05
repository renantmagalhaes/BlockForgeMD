package db

import (
	"database/sql"
	"encoding/json"
	"time"
)

// --- AI tagger: personal provider configuration and per-file ownership
// state. managed_tags tracks only tags written by this plugin, never tags the
// user added themselves.
type OllamaTaggerConfig struct {
	UserID              string
	Provider            string
	EndpointEnc         []byte
	Model               string
	AutoEnabled         bool
	RecheckOnChange     bool
	PollIntervalSeconds int
	MaxTags             int
	Workspaces          string
}

func (db *DB) GetOllamaTaggerConfig(userID string) (*OllamaTaggerConfig, error) {
	var c OllamaTaggerConfig
	err := db.Conn.QueryRow(`SELECT user_id, provider, endpoint_enc, model, auto_enabled, recheck_on_change, poll_interval_seconds, max_tags, workspaces FROM plugin_ollama_tagger_user_config WHERE user_id = ?`, userID).
		Scan(&c.UserID, &c.Provider, &c.EndpointEnc, &c.Model, &c.AutoEnabled, &c.RecheckOnChange, &c.PollIntervalSeconds, &c.MaxTags, &c.Workspaces)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (db *DB) UpsertOllamaTaggerConfig(c OllamaTaggerConfig) error {
	_, err := db.Conn.Exec(`INSERT INTO plugin_ollama_tagger_user_config (user_id, provider, endpoint_enc, model, auto_enabled, recheck_on_change, poll_interval_seconds, max_tags, workspaces) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider, endpoint_enc=excluded.endpoint_enc, model=excluded.model, auto_enabled=excluded.auto_enabled, recheck_on_change=excluded.recheck_on_change, poll_interval_seconds=excluded.poll_interval_seconds, max_tags=excluded.max_tags, workspaces=excluded.workspaces`, c.UserID, c.Provider, c.EndpointEnc, c.Model, c.AutoEnabled, c.RecheckOnChange, c.PollIntervalSeconds, c.MaxTags, c.Workspaces)
	return err
}

func (db *DB) ListEnabledOllamaTaggerConfigs() ([]OllamaTaggerConfig, error) {
	rows, err := db.Conn.Query(`SELECT user_id, provider, endpoint_enc, model, auto_enabled, recheck_on_change, poll_interval_seconds, max_tags, workspaces FROM plugin_ollama_tagger_user_config WHERE auto_enabled = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OllamaTaggerConfig
	for rows.Next() {
		var c OllamaTaggerConfig
		if rows.Scan(&c.UserID, &c.Provider, &c.EndpointEnc, &c.Model, &c.AutoEnabled, &c.RecheckOnChange, &c.PollIntervalSeconds, &c.MaxTags, &c.Workspaces) == nil {
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

type OllamaTaggerState struct {
	ContentHash string
	ManagedTags []string
	LastRunAt   *time.Time
	LastError   string
}

func (db *DB) GetOllamaTaggerState(userID, path string) (*OllamaTaggerState, error) {
	var s OllamaTaggerState
	var tags string
	var last sql.NullTime
	err := db.Conn.QueryRow(`SELECT content_hash, managed_tags, last_run_at, last_error FROM plugin_ollama_tagger_state WHERE user_id=? AND file_path=?`, userID, path).Scan(&s.ContentHash, &tags, &last, &s.LastError)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(tags), &s.ManagedTags)
	if last.Valid {
		s.LastRunAt = &last.Time
	}
	return &s, nil
}
func (db *DB) UpsertOllamaTaggerState(userID, path, hash string, tags []string, run time.Time, lastError string) error {
	b, _ := json.Marshal(tags)
	_, err := db.Conn.Exec(`INSERT INTO plugin_ollama_tagger_state (user_id,file_path,content_hash,managed_tags,last_run_at,last_error) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,file_path) DO UPDATE SET content_hash=excluded.content_hash,managed_tags=excluded.managed_tags,last_run_at=excluded.last_run_at,last_error=excluded.last_error`, userID, path, hash, string(b), run, lastError)
	return err
}

// --- plugin_secrets: generic encrypted key/value store, shared by any future
// plugin that needs to persist a decryptable secret (Google Calendar's OAuth
// client secret today; an LLM provider API key tomorrow). Values are opaque
// ciphertext blobs to this layer — encryption/decryption happens in the
// plugin package that owns the key (see internal/cryptoutil).

func (db *DB) SetEncryptedSecret(key string, ciphertext []byte) error {
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_secrets (key, value_enc, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = CURRENT_TIMESTAMP;
	`, key, ciphertext)
	return err
}

// GetEncryptedSecret returns (nil, nil) if the key has never been set.
func (db *DB) GetEncryptedSecret(key string) ([]byte, error) {
	var val []byte
	err := db.Conn.QueryRow("SELECT value_enc FROM plugin_secrets WHERE key = ?", key).Scan(&val)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return val, nil
}

// --- plugin_gcal_accounts: one connected Google account per BlockForgeMD user.

type GCalAccount struct {
	UserID          string
	GoogleEmail     string
	AccessTokenEnc  []byte
	RefreshTokenEnc []byte
	TokenExpiry     time.Time
	CalendarID      string
	SyncToken       string
	LastSyncAt      *time.Time
	LastSyncError   string
	ConnectedAt     time.Time
}

func (db *DB) UpsertGCalAccount(a GCalAccount) error {
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_gcal_accounts
			(user_id, google_email, access_token_enc, refresh_token_enc, token_expiry, calendar_id)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			google_email = excluded.google_email,
			access_token_enc = excluded.access_token_enc,
			refresh_token_enc = excluded.refresh_token_enc,
			token_expiry = excluded.token_expiry,
			calendar_id = excluded.calendar_id;
	`, a.UserID, a.GoogleEmail, a.AccessTokenEnc, a.RefreshTokenEnc, a.TokenExpiry, a.CalendarID)
	return err
}

// GetGCalAccount returns (nil, nil) if the user hasn't connected an account.
func (db *DB) GetGCalAccount(userID string) (*GCalAccount, error) {
	row := db.Conn.QueryRow(`
		SELECT user_id, COALESCE(google_email, ''), COALESCE(access_token_enc, x''), refresh_token_enc,
		       token_expiry, calendar_id, COALESCE(sync_token, ''),
		       last_sync_at, COALESCE(last_sync_error, ''), connected_at
		FROM plugin_gcal_accounts WHERE user_id = ?;
	`, userID)
	var a GCalAccount
	var tokenExpiry, lastSyncAt sql.NullTime
	if err := row.Scan(&a.UserID, &a.GoogleEmail, &a.AccessTokenEnc, &a.RefreshTokenEnc,
		&tokenExpiry, &a.CalendarID, &a.SyncToken, &lastSyncAt, &a.LastSyncError, &a.ConnectedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if tokenExpiry.Valid {
		a.TokenExpiry = tokenExpiry.Time
	}
	if lastSyncAt.Valid {
		a.LastSyncAt = &lastSyncAt.Time
	}
	return &a, nil
}

func (db *DB) ListGCalAccounts() ([]GCalAccount, error) {
	rows, err := db.Conn.Query(`
		SELECT user_id, COALESCE(google_email, ''), COALESCE(access_token_enc, x''), refresh_token_enc,
		       token_expiry, calendar_id, COALESCE(sync_token, ''),
		       last_sync_at, COALESCE(last_sync_error, ''), connected_at
		FROM plugin_gcal_accounts;
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []GCalAccount
	for rows.Next() {
		var a GCalAccount
		var tokenExpiry, lastSyncAt sql.NullTime
		if err := rows.Scan(&a.UserID, &a.GoogleEmail, &a.AccessTokenEnc, &a.RefreshTokenEnc,
			&tokenExpiry, &a.CalendarID, &a.SyncToken, &lastSyncAt, &a.LastSyncError, &a.ConnectedAt); err != nil {
			continue
		}
		if tokenExpiry.Valid {
			a.TokenExpiry = tokenExpiry.Time
		}
		if lastSyncAt.Valid {
			a.LastSyncAt = &lastSyncAt.Time
		}
		out = append(out, a)
	}
	return out, nil
}

func (db *DB) DeleteGCalAccount(userID string) error {
	_, err := db.Conn.Exec("DELETE FROM plugin_gcal_accounts WHERE user_id = ?;", userID)
	return err
}

func (db *DB) UpdateGCalTokens(userID string, accessTokenEnc []byte, expiry time.Time) error {
	_, err := db.Conn.Exec(`
		UPDATE plugin_gcal_accounts SET access_token_enc = ?, token_expiry = ? WHERE user_id = ?;
	`, accessTokenEnc, expiry, userID)
	return err
}

func (db *DB) UpdateGCalSyncToken(userID, syncToken string) error {
	_, err := db.Conn.Exec("UPDATE plugin_gcal_accounts SET sync_token = ? WHERE user_id = ?;", syncToken, userID)
	return err
}

// UpdateGCalCalendarID switches which calendar a user's pages sync to, and
// resets sync_token to force a fresh baseline scan of the new calendar on the
// next pull (any prior incremental token belonged to the old calendar).
func (db *DB) UpdateGCalCalendarID(userID, calendarID string) error {
	_, err := db.Conn.Exec(`
		UPDATE plugin_gcal_accounts SET calendar_id = ?, sync_token = '' WHERE user_id = ?;
	`, calendarID, userID)
	return err
}

func (db *DB) UpdateGCalSyncStatus(userID string, lastSyncAt time.Time, lastSyncErr string) error {
	_, err := db.Conn.Exec(`
		UPDATE plugin_gcal_accounts SET last_sync_at = ?, last_sync_error = ? WHERE user_id = ?;
	`, lastSyncAt, lastSyncErr, userID)
	return err
}

// --- plugin_gcal_sync_state: file <-> Google event mapping, per user.

type GCalSyncState struct {
	ID               string
	UserID           string
	FilePath         string
	GoogleEventID    string
	LastDueDate      string
	LocalContentHash string
	LastSyncedAt     time.Time
}

func (db *DB) UpsertGCalSyncState(s GCalSyncState) error {
	if s.ID == "" {
		s.ID = newID()
	}
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_gcal_sync_state
			(id, user_id, file_path, google_event_id, last_due_date, local_content_hash, last_synced_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, file_path) DO UPDATE SET
			google_event_id = excluded.google_event_id,
			last_due_date = excluded.last_due_date,
			local_content_hash = excluded.local_content_hash,
			last_synced_at = excluded.last_synced_at;
	`, s.ID, s.UserID, s.FilePath, s.GoogleEventID, s.LastDueDate, s.LocalContentHash, s.LastSyncedAt)
	return err
}

func scanGCalSyncState(row interface{ Scan(...any) error }) (*GCalSyncState, error) {
	var s GCalSyncState
	if err := row.Scan(&s.ID, &s.UserID, &s.FilePath, &s.GoogleEventID, &s.LastDueDate, &s.LocalContentHash, &s.LastSyncedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

func (db *DB) GetGCalSyncStateByPath(userID, filePath string) (*GCalSyncState, error) {
	row := db.Conn.QueryRow(`
		SELECT id, user_id, file_path, google_event_id, COALESCE(last_due_date, ''), COALESCE(local_content_hash, ''), last_synced_at
		FROM plugin_gcal_sync_state WHERE user_id = ? AND file_path = ?;
	`, userID, filePath)
	return scanGCalSyncState(row)
}

func (db *DB) GetGCalSyncStateByEventID(userID, eventID string) (*GCalSyncState, error) {
	row := db.Conn.QueryRow(`
		SELECT id, user_id, file_path, google_event_id, COALESCE(last_due_date, ''), COALESCE(local_content_hash, ''), last_synced_at
		FROM plugin_gcal_sync_state WHERE user_id = ? AND google_event_id = ?;
	`, userID, eventID)
	return scanGCalSyncState(row)
}

func (db *DB) ListGCalSyncState(userID string) ([]GCalSyncState, error) {
	rows, err := db.Conn.Query(`
		SELECT id, user_id, file_path, google_event_id, COALESCE(last_due_date, ''), COALESCE(local_content_hash, ''), last_synced_at
		FROM plugin_gcal_sync_state WHERE user_id = ?;
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []GCalSyncState
	for rows.Next() {
		var s GCalSyncState
		if err := rows.Scan(&s.ID, &s.UserID, &s.FilePath, &s.GoogleEventID, &s.LastDueDate, &s.LocalContentHash, &s.LastSyncedAt); err == nil {
			out = append(out, s)
		}
	}
	return out, nil
}

func (db *DB) DeleteGCalSyncStateByPath(userID, filePath string) error {
	_, err := db.Conn.Exec("DELETE FROM plugin_gcal_sync_state WHERE user_id = ? AND file_path = ?;", userID, filePath)
	return err
}

func (db *DB) DeleteGCalSyncStateByEventID(userID, eventID string) error {
	_, err := db.Conn.Exec("DELETE FROM plugin_gcal_sync_state WHERE user_id = ? AND google_event_id = ?;", userID, eventID)
	return err
}

// --- plugin_gcal_user_config: every user's own Google Calendar plugin
// configuration (OAuth Client ID/Secret, poll interval, workspace scope,
// production-confirmed dismiss flag) — there is no shared/instance-wide
// config anymore, each user brings their own Google Cloud OAuth Client.

type GCalUserConfig struct {
	UserID              string
	ClientID            string
	ClientSecretEnc     []byte // nil if never set
	PollIntervalSeconds int    // 0 = not set, caller should use the default
	Workspaces          string // raw JSON array; "" = all workspaces
	ProductionConfirmed bool
}

// GetGCalUserConfig returns (nil, nil) if this user has never touched
// Settings > Plugins > Google Calendar.
func (db *DB) GetGCalUserConfig(userID string) (*GCalUserConfig, error) {
	row := db.Conn.QueryRow(`
		SELECT user_id, client_id, client_secret_enc, poll_interval_seconds, workspaces, production_confirmed
		FROM plugin_gcal_user_config WHERE user_id = ?;
	`, userID)
	var c GCalUserConfig
	if err := row.Scan(&c.UserID, &c.ClientID, &c.ClientSecretEnc, &c.PollIntervalSeconds, &c.Workspaces, &c.ProductionConfirmed); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func (db *DB) SetGCalClientID(userID, clientID string) error {
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_gcal_user_config (user_id, client_id) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET client_id = excluded.client_id;
	`, userID, clientID)
	return err
}

func (db *DB) SetGCalClientSecretEnc(userID string, enc []byte) error {
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_gcal_user_config (user_id, client_secret_enc) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET client_secret_enc = excluded.client_secret_enc;
	`, userID, enc)
	return err
}

func (db *DB) SetGCalPollIntervalSeconds(userID string, seconds int) error {
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_gcal_user_config (user_id, poll_interval_seconds) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET poll_interval_seconds = excluded.poll_interval_seconds;
	`, userID, seconds)
	return err
}

func (db *DB) SetGCalWorkspaces(userID, workspacesJSON string) error {
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_gcal_user_config (user_id, workspaces) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET workspaces = excluded.workspaces;
	`, userID, workspacesJSON)
	return err
}

func (db *DB) SetGCalProductionConfirmed(userID string, confirmed bool) error {
	_, err := db.Conn.Exec(`
		INSERT INTO plugin_gcal_user_config (user_id, production_confirmed) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET production_confirmed = excluded.production_confirmed;
	`, userID, confirmed)
	return err
}
