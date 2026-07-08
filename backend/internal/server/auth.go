package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type ctxKey string

const ctxUserKey ctxKey = "user"

// requireAuth is a middleware that authenticates via session cookie OR Bearer API key.
// On success it injects the UserRecord into the request context.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 1. Session cookie
		if cookie, err := r.Cookie("bf_session"); err == nil && cookie.Value != "" {
			if user, err := s.db.GetUserBySessionToken(cookie.Value); err == nil && user != nil {
				ctx := context.WithValue(r.Context(), ctxUserKey, user)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		// 2. Bearer API key
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			key := strings.TrimPrefix(auth, "Bearer ")
			sum := sha256.Sum256([]byte(key))
			hash := hex.EncodeToString(sum[:])
			if user, err := s.db.GetUserByAPIKeyHash(hash); err == nil && user != nil {
				go s.db.UpdateAPIKeyLastUsedByHash(hash)
				ctx := context.WithValue(r.Context(), ctxUserKey, user)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
	})
}

// GET /auth/status — public; returns bootstrap flag + current user if any
func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	bootstrapRequired := s.db.IsBootstrapRequired()
	resp := map[string]interface{}{"bootstrapRequired": bootstrapRequired}

	if cookie, err := r.Cookie("bf_session"); err == nil {
		if user, err := s.db.GetUserBySessionToken(cookie.Value); err == nil && user != nil {
			resp["user"] = map[string]string{"id": user.ID, "username": user.Username}
		}
	}
	respondJSON(w, resp)
}

// POST /auth/bootstrap — creates the first admin user; rejected if any user already exists
func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	if !s.db.IsBootstrapRequired() {
		http.Error(w, "bootstrap already complete", http.StatusForbidden)
		return
	}
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
		http.Error(w, "failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]interface{}{
		"status": "ok",
		"user":   map[string]string{"id": user.ID, "username": user.Username},
	})
}

// POST /auth/login
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	user, err := s.db.GetUserByUsername(req.Username)
	if err != nil || user == nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	token, err := s.db.CreateSession(user.ID, time.Now().Add(7*24*time.Hour))
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "bf_session",
		Value:    token,
		Path:     "/",
		MaxAge:   7 * 24 * 3600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	respondJSON(w, map[string]interface{}{
		"status": "ok",
		"user":   map[string]string{"id": user.ID, "username": user.Username},
	})
}

// POST /auth/logout
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("bf_session"); err == nil {
		_ = s.db.DeleteSession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "bf_session", Value: "", Path: "/", MaxAge: -1})
	respondJSON(w, map[string]string{"status": "ok"})
}

// GET /auth/me — returns current user or 401
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("bf_session"); err == nil {
		if user, err := s.db.GetUserBySessionToken(cookie.Value); err == nil && user != nil {
			respondJSON(w, map[string]string{"id": user.ID, "username": user.Username})
			return
		}
	}
	http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
}
