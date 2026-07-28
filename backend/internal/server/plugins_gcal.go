package server

import (
	"encoding/json"
	"net/http"

	"blockforgemd/internal/plugins/googlecalendar"
)

// gcalPlugin fetches the registered Google Calendar plugin instance. It is
// always present (registered unconditionally in NewServer), so a missing
// registration here indicates a startup wiring bug, not a runtime condition
// callers need to handle gracefully.
func (s *Server) gcalPlugin() *googlecalendar.Plugin {
	p, ok := s.plugins.Get(googlecalendar.ID)
	if !ok {
		panic("google-calendar plugin not registered")
	}
	return p.(*googlecalendar.Plugin)
}

// gcalRedirectURI computes the OAuth callback URL as reached by the end
// user's browser — needed both to build the Google consent-screen URL and to
// show the user exactly what to register in Google Cloud Console. Honors
// X-Forwarded-Proto/Host since this app is commonly run behind a reverse
// proxy. As a side effect, persists the origin portion (see
// googlecalendar.AppBaseURLSettingKey) for later use building deep links.
func (s *Server) gcalRedirectURI(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}
	host := r.Host
	if fwdHost := r.Header.Get("X-Forwarded-Host"); fwdHost != "" {
		host = fwdHost
	}
	baseURL := scheme + "://" + host
	_ = s.db.SetSetting(googlecalendar.AppBaseURLSettingKey, baseURL)
	return baseURL + "/api/plugins/google-calendar/oauth/callback"
}

// GET /api/plugins — store grid listing (real + coming-soon plugins).
func (s *Server) handleListPlugins(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, map[string]interface{}{"plugins": s.plugins.List()})
}

// GET /api/plugins/google-calendar/config
func (s *Server) handleGCalGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.gcalPlugin().GetConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]interface{}{
		"clientId":        cfg.ClientID,
		"hasClientSecret": cfg.HasClientSecret,
		"redirectUri":     s.gcalRedirectURI(r),
	})
}

// POST /api/plugins/google-calendar/config
func (s *Server) handleGCalSetConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := s.gcalPlugin().SetConfig(req.ClientID, req.ClientSecret); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

// GET /api/plugins/google-calendar/oauth/start
func (s *Server) handleGCalOAuthStart(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	authorizeURL, err := s.gcalPlugin().StartOAuth(user.ID, s.gcalRedirectURI(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, map[string]string{"authorizeUrl": authorizeURL})
}

// GET /api/plugins/google-calendar/oauth/callback — public route, see server.go.
func (s *Server) handleGCalOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		http.Error(w, "google authorization was not granted: "+errParam, http.StatusBadRequest)
		return
	}
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if state == "" || code == "" {
		http.Error(w, "missing state or code", http.StatusBadRequest)
		return
	}
	if err := s.gcalPlugin().HandleOAuthCallback(r.Context(), state, code, s.gcalRedirectURI(r)); err != nil {
		http.Error(w, "failed to connect google calendar: "+err.Error(), http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

// GET /api/plugins/google-calendar/status
func (s *Server) handleGCalStatus(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	status, err := s.gcalPlugin().Status(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, status)
}

// POST /api/plugins/google-calendar/disconnect
func (s *Server) handleGCalDisconnect(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := s.gcalPlugin().Disconnect(r.Context(), user.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

// POST /api/plugins/google-calendar/sync-now
func (s *Server) handleGCalSyncNow(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := s.gcalPlugin().SyncNow(user.ID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	respondJSON(w, map[string]string{"status": "syncing"})
}

// GET /api/plugins/google-calendar/calendars
func (s *Server) handleGCalListCalendars(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	calendars, err := s.gcalPlugin().ListCalendars(r.Context(), user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, map[string]interface{}{"calendars": calendars})
}

// POST /api/plugins/google-calendar/calendar
func (s *Server) handleGCalSetCalendar(w http.ResponseWriter, r *http.Request) {
	user := userFromCtx(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		CalendarID string `json:"calendarId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CalendarID == "" {
		http.Error(w, "missing calendarId", http.StatusBadRequest)
		return
	}
	if err := s.gcalPlugin().SetCalendar(r.Context(), user.ID, req.CalendarID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}
