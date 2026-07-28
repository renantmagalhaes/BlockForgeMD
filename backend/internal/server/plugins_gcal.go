package server

import (
	"encoding/json"
	"fmt"
	"net"
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

// gcalRequestHost resolves the public-facing host as reached by the end
// user's browser, honoring X-Forwarded-Host for reverse-proxy setups.
func gcalRequestHost(r *http.Request) string {
	if fwdHost := r.Header.Get("X-Forwarded-Host"); fwdHost != "" {
		return fwdHost
	}
	return r.Host
}

func gcalRequestScheme(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}
	return scheme
}

// isPrivateIPHost reports whether host (optionally "host:port") is a literal
// private-range IP address — RFC1918 (10/8, 172.16/12, 192.168/16) or its
// IPv6 unique-local equivalent (fc00::/7) — rather than a DNS hostname.
// Google's OAuth flow rejects redirect URIs on a private IP outright (error
// "device_id and device_name are required for private IP" / Error 400:
// invalid_request), so this plugin can never work from one — see
// docs/plugins/google-calendar.md.
func isPrivateIPHost(host string) bool {
	h := host
	if hostOnly, _, err := net.SplitHostPort(host); err == nil {
		h = hostOnly
	}
	ip := net.ParseIP(h)
	if ip == nil {
		return false // a DNS hostname (including "localhost") — not an IP literal, so not restricted
	}
	return ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// privateIPHostError is the message shown wherever a private-IP host would
// otherwise silently break the Google Calendar plugin — connect attempts and
// sync failures alike, so the user sees one clear, actionable explanation
// instead of Google's confusing native error.
func privateIPHostError(host string) error {
	return fmt.Errorf(
		"BlockForgeMD is being accessed at a private IP address (%s). Google's OAuth does not allow private IP addresses as redirect URIs, so this will never work from here. Access the app via a hostname instead (e.g. add an entry to your hosts file mapping a name to this address, or use a reverse proxy), update the OAuth Client's redirect URI in Google Cloud Console to match, then try again — see the Google Calendar setup guide (docs/plugins/google-calendar.md) for details.",
		host,
	)
}

// gcalRedirectURI computes the OAuth callback URL as reached by the end
// user's browser — needed both to build the Google consent-screen URL and to
// show the user exactly what to register in Google Cloud Console. As a side
// effect, persists the origin portion (see googlecalendar.AppBaseURLSettingKey)
// for later use building deep links — but only when the host isn't a private
// IP literal, so a stray request from a private address (e.g. someone
// briefly reaching the app over LAN) can never clobber a previously-good
// stored value. This is what used to require a container restart to recover
// from: once a private-IP request overwrote the stored base URL, nothing
// short of a restart cleared it, since every subsequent legitimate request
// still had to race a fresh write to override the stale one.
func (s *Server) gcalRedirectURI(r *http.Request) string {
	host := gcalRequestHost(r)
	baseURL := gcalRequestScheme(r) + "://" + host
	if !isPrivateIPHost(host) {
		_ = s.db.SetSetting(googlecalendar.AppBaseURLSettingKey, baseURL)
	}
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
		"clientId":            cfg.ClientID,
		"hasClientSecret":     cfg.HasClientSecret,
		"pollIntervalSeconds": cfg.PollIntervalSeconds,
		"redirectUri":         s.gcalRedirectURI(r),
		"isPrivateHost":       isPrivateIPHost(gcalRequestHost(r)),
	})
}

// POST /api/plugins/google-calendar/config
func (s *Server) handleGCalSetConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClientID            string `json:"clientId"`
		ClientSecret        string `json:"clientSecret"`
		PollIntervalSeconds *int   `json:"pollIntervalSeconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := s.gcalPlugin().SetConfig(req.ClientID, req.ClientSecret, req.PollIntervalSeconds); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
	if host := gcalRequestHost(r); isPrivateIPHost(host) {
		http.Error(w, privateIPHostError(host).Error(), http.StatusBadRequest)
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
