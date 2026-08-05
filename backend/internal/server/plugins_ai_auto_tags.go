package server

import (
	"blockforgemd/internal/plugins/aitags"
	"encoding/json"
	"net/http"
)

func (s *Server) aiTagsPlugin() *aitags.Plugin {
	p, ok := s.plugins.Get(aitags.ID)
	if !ok {
		panic("ai-auto-tags plugin not registered")
	}
	return p.(*aitags.Plugin)
}
func (s *Server) handleAITagsGetConfig(w http.ResponseWriter, r *http.Request) {
	u := userFromCtx(r)
	if u == nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	c, e := s.aiTagsPlugin().GetConfig(u.ID)
	if e != nil {
		http.Error(w, e.Error(), 500)
		return
	}
	respondJSON(w, c)
}
func (s *Server) handleAITagsSetConfig(w http.ResponseWriter, r *http.Request) {
	u := userFromCtx(r)
	if u == nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	var q struct {
		Provider            string   `json:"provider"`
		Endpoint            string   `json:"endpoint"`
		APIKey              string   `json:"apiKey"`
		Model               string   `json:"model"`
		AutoEnabled         bool     `json:"autoEnabled"`
		RecheckOnChange     bool     `json:"recheckOnChange"`
		PollIntervalSeconds int      `json:"pollIntervalSeconds"`
		MaxTags             int      `json:"maxTags"`
		Workspaces          []string `json:"workspaces"`
	}
	if json.NewDecoder(r.Body).Decode(&q) != nil {
		http.Error(w, "invalid request body", 400)
		return
	}
	if e := s.aiTagsPlugin().SetConfig(u.ID, q.Provider, q.Endpoint, q.APIKey, q.Model, q.AutoEnabled, q.RecheckOnChange, q.PollIntervalSeconds, q.MaxTags, q.Workspaces); e != nil {
		http.Error(w, e.Error(), 400)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleAITagsModels(w http.ResponseWriter, r *http.Request) {
	u := userFromCtx(r)
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	models, err := s.aiTagsPlugin().ListModels(r.Context(), u.ID, r.URL.Query().Get("provider"), r.URL.Query().Get("endpoint"), r.Header.Get("X-OpenRouter-Key"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, map[string]interface{}{"models": models})
}
func (s *Server) handleAITagsTagFile(w http.ResponseWriter, r *http.Request) {
	u := userFromCtx(r)
	if u == nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	var q struct {
		Path string `json:"path"`
	}
	if json.NewDecoder(r.Body).Decode(&q) != nil || q.Path == "" {
		http.Error(w, "path is required", 400)
		return
	}
	if e := s.aiTagsPlugin().TagNow(r.Context(), u.ID, q.Path); e != nil {
		http.Error(w, e.Error(), 400)
		return
	}
	file, err := s.db.GetFile(q.Path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]interface{}{"status": "ok", "tags": file.FrontMatter["tags"]})
}
