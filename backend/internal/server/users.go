package server

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"blockforgemd/internal/db"
	"golang.org/x/crypto/bcrypt"

	"github.com/go-chi/chi/v5"
)

// GET /api/users — list all users (no password hashes)
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.db.ListUsers()
	if err != nil {
		http.Error(w, "failed to list users", http.StatusInternalServerError)
		return
	}
	type safeUser struct {
		ID        string `json:"id"`
		Username  string `json:"username"`
		CreatedAt string `json:"createdAt"`
	}
	out := make([]safeUser, len(users))
	for i, u := range users {
		out[i] = safeUser{ID: u.ID, Username: u.Username, CreatedAt: u.CreatedAt}
	}
	respondJSON(w, map[string]interface{}{"users": out})
}

// POST /api/users — create a user
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Username) == "" || len(req.Password) < 6 {
		http.Error(w, "username and password (min 6 chars) required", http.StatusBadRequest)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	user, err := s.db.CreateUser(strings.TrimSpace(req.Username), string(hash))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "username already exists", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	respondJSON(w, map[string]string{"id": user.ID, "username": user.Username})
}

// DELETE /api/users/{id} — delete a user (cannot delete yourself)
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	caller := userFromCtx(r)
	id := chi.URLParam(r, "id")
	if caller != nil && caller.ID == id {
		http.Error(w, "cannot delete your own account", http.StatusBadRequest)
		return
	}

	// Disconnect this user's Google Calendar first (best-effort): DeleteUser
	// cascades and wipes plugin_gcal_accounts/plugin_gcal_sync_state for this
	// user, which would otherwise permanently orphan any events already
	// created on their Google Calendar — nothing left afterward could ever
	// reference them to clean them up. A failure here (e.g. Google API
	// hiccup) must not block removing the user account.
	if err := s.gcalPlugin().Disconnect(r.Context(), id); err != nil {
		log.Printf("failed to disconnect google calendar for user %s before deletion: %v", id, err)
	}

	if err := s.db.DeleteUser(id); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

// PATCH /api/users/{id}/password — change a user's password
func (s *Server) handleChangeUserPassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Password) < 6 {
		http.Error(w, "password (min 6 chars) required", http.StatusBadRequest)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := s.db.UpdateUserPassword(id, string(hash)); err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

// GET /api/keys — list API keys for current user
func (s *Server) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	keys, err := s.db.ListAPIKeys(user.ID)
	if err != nil {
		http.Error(w, "failed to list keys", http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]interface{}{"keys": keys})
}

// POST /api/keys — generate a new API key; returns plaintext once
func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		Label string `json:"label"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "API Key"
	}

	rawBytes := make([]byte, 30)
	if _, err := rand.Read(rawBytes); err != nil {
		http.Error(w, "failed to generate key", http.StatusInternalServerError)
		return
	}
	plaintext := "sk_live_" + base64.RawURLEncoding.EncodeToString(rawBytes)
	sum := sha256.Sum256([]byte(plaintext))
	keyHash := hex.EncodeToString(sum[:])

	id, err := s.db.CreateAPIKey(user.ID, keyHash, label)
	if err != nil {
		http.Error(w, "failed to store key", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	respondJSON(w, map[string]string{
		"id":  id,
		"key": plaintext,
	})
}

// DELETE /api/keys/{id} — revoke a key (scoped to current user)
func (s *Server) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	if err := s.db.DeleteAPIKey(id, user.ID); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

func userFromCtx(r *http.Request) *db.UserRecord {
	user, _ := r.Context().Value(ctxUserKey).(*db.UserRecord)
	return user
}
