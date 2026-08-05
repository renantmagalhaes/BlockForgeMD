// Package ollamatagger classifies Markdown pages with a user-configured AI
// provider. It deliberately stores only the tags it owns, so users can
// freely keep their own frontmatter tags alongside automated suggestions.
package ollamatagger

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"blockforgemd/internal/cryptoutil"
	"blockforgemd/internal/db"
	"blockforgemd/internal/plugins"
)

const ID = "ollama-tagger"
const minPollIntervalSeconds = 60
const defaultPollIntervalSeconds = 900
const defaultMaxTags = 5
const ollamaProvider = "ollama"
const openRouterProvider = "openrouter"

type LocalWriter interface {
	UpdateFrontMatter(string, map[string]interface{}) error
}
type Plugin struct {
	db     *db.DB
	writer LocalWriter
	encKey [32]byte
	wg     sync.WaitGroup
	locks  *keyedMutex
	// Ollama is usually a single-GPU/single-host service. One shared slot
	// prevents a scheduled vault pass and several file-change events from
	// competing for RAM/VRAM and making every request slower or time out.
	inference chan struct{}
}
type keyedMutex struct {
	mu sync.Mutex
	m  map[string]*sync.Mutex
}

func newKeyedMutex() *keyedMutex { return &keyedMutex{m: map[string]*sync.Mutex{}} }
func (k *keyedMutex) Lock(key string) func() {
	k.mu.Lock()
	l := k.m[key]
	if l == nil {
		l = &sync.Mutex{}
		k.m[key] = l
	}
	k.mu.Unlock()
	l.Lock()
	return l.Unlock
}
func New(database *db.DB, writer LocalWriter, encKey [32]byte) *Plugin {
	return &Plugin{db: database, writer: writer, encKey: encKey, locks: newKeyedMutex(), inference: make(chan struct{}, 1)}
}
func (p *Plugin) Meta() plugins.Meta {
	return plugins.Meta{ID: ID, Name: "AI Auto Tags", Category: "llm", Status: "available"}
}
func (p *Plugin) Start(ctx context.Context) error {
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		ticker := time.NewTicker(minPollIntervalSeconds * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				p.runScheduled(ctx)
			}
		}
	}()
	return nil
}
func (p *Plugin) Stop() error { p.wg.Wait(); return nil }
func (p *Plugin) OnFileChanged(path string) {
	if !strings.HasSuffix(strings.ToLower(path), ".md") {
		return
	}
	cfgs, err := p.db.ListEnabledOllamaTaggerConfigs()
	if err != nil {
		return
	}
	for _, cfg := range cfgs {
		if !cfg.RecheckOnChange || !workspaceAllowed(cfg, path) {
			continue
		}
		cfg := cfg
		go func() { _ = p.tagFile(context.Background(), cfg, path, false) }()
	}
}

type ConfigResult struct {
	Provider            string   `json:"provider"`
	Endpoint            string   `json:"endpoint"`
	HasEndpoint         bool     `json:"hasEndpoint"`
	HasAPIKey           bool     `json:"hasApiKey"`
	Model               string   `json:"model"`
	AutoEnabled         bool     `json:"autoEnabled"`
	RecheckOnChange     bool     `json:"recheckOnChange"`
	PollIntervalSeconds int      `json:"pollIntervalSeconds"`
	MaxTags             int      `json:"maxTags"`
	Workspaces          []string `json:"workspaces"` // empty = all workspaces
}

// ListModels gets the models available from the selected provider.
func (p *Plugin) ListModels(ctx context.Context, userID, provider, endpoint, apiKey string) ([]string, error) {
	if provider == "" {
		cfg, err := p.GetConfig(userID)
		if err != nil {
			return nil, err
		}
		provider = cfg.Provider
		endpoint = cfg.Endpoint
		apiKey = ""
	}
	if provider == openRouterProvider {
		if apiKey == "" {
			var err error
			apiKey, err = p.openRouterKey(userID)
			if err != nil {
				return nil, err
			}
		}
		if apiKey == "" {
			return nil, errors.New("enter an OpenRouter API key first")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://openrouter.ai/api/v1/models", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)
		res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
		if err != nil {
			return nil, fmt.Errorf("could not reach OpenRouter: %w", err)
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return nil, fmt.Errorf("OpenRouter returned %s", res.Status)
		}
		var payload struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			return nil, err
		}
		models := make([]string, 0, len(payload.Data))
		for _, model := range payload.Data {
			if model.ID != "" {
				models = append(models, model.ID)
			}
		}
		sort.Strings(models)
		return models, nil
	}
	if provider != ollamaProvider {
		return nil, errors.New("unsupported AI provider")
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, errors.New("enter a complete Ollama endpoint first")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(endpoint, "/")+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	res, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach Ollama: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("Ollama returned %s", res.Status)
	}
	var payload struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return nil, err
	}
	models := make([]string, 0, len(payload.Models))
	for _, model := range payload.Models {
		if model.Name != "" {
			models = append(models, model.Name)
		}
	}
	sort.Strings(models)
	return models, nil
}

func (p *Plugin) GetConfig(userID string) (ConfigResult, error) {
	c, e := p.db.GetOllamaTaggerConfig(userID)
	if e != nil {
		return ConfigResult{}, e
	}
	if c == nil {
		return ConfigResult{Provider: ollamaProvider, Model: "", RecheckOnChange: true, PollIntervalSeconds: defaultPollIntervalSeconds, MaxTags: defaultMaxTags, Workspaces: []string{}}, nil
	}
	endpoint := ""
	if len(c.EndpointEnc) > 0 {
		b, e := cryptoutil.Decrypt(p.encKey, c.EndpointEnc)
		if e != nil {
			return ConfigResult{}, e
		}
		endpoint = string(b)
	}
	var workspaces []string
	_ = json.Unmarshal([]byte(c.Workspaces), &workspaces)
	if workspaces == nil {
		workspaces = []string{}
	}
	key, err := p.db.GetEncryptedSecret("ai_auto_tags_openrouter_key:" + userID)
	if err != nil {
		return ConfigResult{}, err
	}
	provider := c.Provider
	if provider == "" {
		provider = ollamaProvider
	}
	return ConfigResult{Provider: provider, Endpoint: endpoint, HasEndpoint: endpoint != "", HasAPIKey: len(key) > 0, Model: c.Model, AutoEnabled: c.AutoEnabled, RecheckOnChange: c.RecheckOnChange, PollIntervalSeconds: valueOr(c.PollIntervalSeconds, defaultPollIntervalSeconds), MaxTags: valueOr(c.MaxTags, defaultMaxTags), Workspaces: workspaces}, nil
}
func valueOr(v, d int) int {
	if v > 0 {
		return v
	}
	return d
}
func (p *Plugin) SetConfig(userID, provider, endpoint, apiKey, model string, auto, recheck bool, interval, maxTags int, workspaces []string) error {
	if provider == "" {
		provider = ollamaProvider
	}
	if provider != ollamaProvider && provider != openRouterProvider {
		return errors.New("unsupported AI provider")
	}
	if provider == ollamaProvider {
		if endpoint == "" {
			return errors.New("Ollama endpoint is required")
		}
		u, e := url.Parse(endpoint)
		if e != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return errors.New("endpoint must be a complete http(s) URL")
		}
	} else if apiKey == "" {
		key, err := p.openRouterKey(userID)
		if err != nil {
			return err
		}
		if key == "" {
			return errors.New("OpenRouter API key is required")
		}
	}
	if strings.TrimSpace(model) == "" {
		return errors.New("Ollama model is required")
	}
	if interval < minPollIntervalSeconds {
		return fmt.Errorf("schedule interval must be at least %d seconds", minPollIntervalSeconds)
	}
	if maxTags < 1 || maxTags > 20 {
		return errors.New("max tags must be between 1 and 20")
	}
	enc, e := cryptoutil.Encrypt(p.encKey, []byte(strings.TrimRight(endpoint, "/")))
	if e != nil {
		return e
	}
	if provider == openRouterProvider && apiKey != "" {
		keyEnc, err := cryptoutil.Encrypt(p.encKey, []byte(apiKey))
		if err != nil {
			return err
		}
		if err = p.db.SetEncryptedSecret("ai_auto_tags_openrouter_key:"+userID, keyEnc); err != nil {
			return err
		}
	}
	encodedWorkspaces, _ := json.Marshal(workspaces)
	return p.db.UpsertOllamaTaggerConfig(db.OllamaTaggerConfig{UserID: userID, Provider: provider, EndpointEnc: enc, Model: strings.TrimSpace(model), AutoEnabled: auto, RecheckOnChange: recheck, PollIntervalSeconds: interval, MaxTags: maxTags, Workspaces: string(encodedWorkspaces)})
}

func (p *Plugin) openRouterKey(userID string) (string, error) {
	enc, err := p.db.GetEncryptedSecret("ai_auto_tags_openrouter_key:" + userID)
	if err != nil || len(enc) == 0 {
		return "", err
	}
	key, err := cryptoutil.Decrypt(p.encKey, enc)
	return string(key), err
}

func workspaceAllowed(cfg db.OllamaTaggerConfig, path string) bool {
	if cfg.Workspaces == "" {
		return true
	}
	var allowed []string
	if json.Unmarshal([]byte(cfg.Workspaces), &allowed) != nil || len(allowed) == 0 {
		return true
	}
	workspace := workspaceOf(path)
	for _, item := range allowed {
		if item == workspace {
			return true
		}
	}
	return false
}
func (p *Plugin) TagNow(ctx context.Context, userID, path string) error {
	c, e := p.db.GetOllamaTaggerConfig(userID)
	if e != nil {
		return e
	}
	if c == nil || c.Model == "" {
		return errors.New("configure an AI provider and model first")
	}
	if !workspaceAllowed(*c, path) {
		return errors.New("this document is outside your Ollama Auto Tags workspace scope")
	}
	return p.tagFile(ctx, *c, path, true)
}
func (p *Plugin) runScheduled(ctx context.Context) {
	cfgs, e := p.db.ListEnabledOllamaTaggerConfigs()
	if e != nil {
		return
	}
	for _, c := range cfgs {
		files, e := p.db.ListFiles()
		if e != nil {
			continue
		}
		for _, f := range files {
			if !strings.HasSuffix(strings.ToLower(f.Path), ".md") {
				continue
			}
			if !workspaceAllowed(c, f.Path) {
				continue
			}
			s, _ := p.db.GetOllamaTaggerState(c.UserID, f.Path)
			if s != nil && s.LastRunAt != nil && time.Since(*s.LastRunAt) < time.Duration(valueOr(c.PollIntervalSeconds, defaultPollIntervalSeconds))*time.Second {
				continue
			}
			_ = p.tagFile(ctx, c, f.Path, false)
		}
	}
}
func (p *Plugin) tagFile(ctx context.Context, c db.OllamaTaggerConfig, path string, force bool) error {
	unlock := p.locks.Lock(c.UserID + ":" + path)
	defer unlock()
	f, e := p.db.GetFile(path)
	if e != nil {
		return e
	}
	if f.Type == "canvas" || f.Content == "" {
		return nil
	}
	sum := fmt.Sprintf("%x", sha256.Sum256([]byte(f.Content)))
	state, _ := p.db.GetOllamaTaggerState(c.UserID, path)
	if !force && state != nil && state.ContentHash == sum {
		return nil
	}
	provider := c.Provider
	if provider == "" {
		provider = ollamaProvider
	}
	endpointRaw, e := cryptoutil.Decrypt(p.encKey, c.EndpointEnc)
	if e != nil {
		return e
	}
	apiKey := ""
	if provider == openRouterProvider {
		apiKey, e = p.openRouterKey(c.UserID)
		if e != nil {
			return e
		}
		if apiKey == "" {
			return errors.New("OpenRouter API key is not configured")
		}
	}
	content := markdownBody(f.Content)
	allWorkspaceTags := workspaceTags(p, f.Path)
	relevantExisting := relevantTags(content, allWorkspaceTags)
	// Serialize model inference across every trigger. Waiting is cancellable,
	// so shutdown and a cancelled browser request never leave work stuck.
	select {
	case p.inference <- struct{}{}:
		defer func() { <-p.inference }()
	case <-ctx.Done():
		return ctx.Err()
	}
	tags, e := generate(ctx, provider, string(endpointRaw), apiKey, c.Model, content, relevantExisting, valueOr(c.MaxTags, defaultMaxTags))
	if e != nil {
		_ = p.db.UpsertOllamaTaggerState(c.UserID, path, sum, nil, time.Now(), e.Error())
		return e
	}
	existing := parseTags(f.FrontMatter["tags"])
	owned := map[string]bool{}
	if state != nil {
		for _, t := range state.ManagedTags {
			owned[normalizeTag(t)] = true
		}
	}
	userTags := make([]string, 0, len(existing))
	userTagSet := make(map[string]bool)
	for _, t := range existing {
		key := normalizeTag(t)
		if !owned[key] && key != "" && !userTagSet[key] {
			userTags = append(userTags, t)
			userTagSet[key] = true
		}
	}
	// A model may sensibly return an already-present tag (e.g. "boot"), but
	// that must neither be duplicated nor be recorded as plugin-owned: it was
	// the user's existing workspace tag, not a new tag introduced by us.
	managedTags := make([]string, 0, len(tags))
	combined := append([]string{}, userTags...)
	relevantExistingSet := make(map[string]bool)
	for _, tag := range relevantExisting {
		relevantExistingSet[normalizeTag(tag)] = true
	}
	for _, tag := range tags {
		key := normalizeTag(tag)
		// Never accept a workspace tag merely because the model echoed the
		// vocabulary. Existing tags must have passed the local relevance filter.
		if containsNormalized(allWorkspaceTags, key) && !relevantExistingSet[key] {
			continue
		}
		if key == "" || userTagSet[key] {
			continue
		}
		userTagSet[key] = true
		combined = append(combined, tag)
		managedTags = append(managedTags, tag)
	}
	if e = p.writer.UpdateFrontMatter(path, map[string]interface{}{"tags": combined}); e != nil {
		return e
	}
	p.ensureTagColors(path, combined)
	return p.db.UpsertOllamaTaggerState(c.UserID, path, sum, managedTags, time.Now(), "")
}

// The editor normally assigns colors when a person adds a tag. Scheduled
// plugin runs have no browser interaction, so mirror that behavior here and
// persist a stable, varied palette entry for every newly seen tag.
func (p *Plugin) ensureTagColors(path string, tags []string) {
	workspace := workspaceOf(path)
	key := "tag_colors_" + workspace
	raw, err := p.db.GetSetting(key, "{}")
	if err != nil {
		return
	}
	colors := map[string]string{}
	if json.Unmarshal([]byte(raw), &colors) != nil {
		colors = map[string]string{}
	}
	palette := []string{"#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e"}
	changed := false
	for _, tag := range tags {
		if tag == "" || colors[tag] != "" {
			continue
		}
		digest := sha256.Sum256([]byte(tag))
		colors[tag] = palette[int(digest[0])%len(palette)]
		changed = true
	}
	if changed {
		if encoded, err := json.Marshal(colors); err == nil {
			_ = p.db.SetSetting(key, string(encoded))
		}
	}
}

// workspaceTags is the controlled vocabulary for a page. We intentionally
// scope it to the page's workspace: tags then converge among related notes
// without an unrelated workspace's terminology leaking into the choice.
func workspaceTags(p *Plugin, path string) []string {
	files, err := p.db.ListFiles()
	if err != nil {
		return nil
	}
	workspace := workspaceOf(path)
	seen := make(map[string]bool)
	tags := make([]string, 0)
	for _, file := range files {
		if workspaceOf(file.Path) != workspace {
			continue
		}
		for _, tag := range parseTags(file.FrontMatter["tags"]) {
			key := strings.ToLower(tag)
			if key != "" && !seen[key] {
				seen[key] = true
				tags = append(tags, tag)
			}
		}
	}
	sort.Strings(tags)
	return tags
}

func workspaceOf(path string) string {
	if i := strings.Index(path, "/"); i >= 0 {
		return path[:i]
	}
	return path
}

func containsNormalized(tags []string, target string) bool {
	for _, tag := range tags {
		if normalizeTag(tag) == target {
			return true
		}
	}
	return false
}

// relevantTags reduces the existing vocabulary before it reaches the model.
// A tag is a candidate only when it is visibly grounded in the page text
// (including simple stems like "config" / "configuration"). This prevents a
// small model from blindly echoing every tag in a workspace.
func relevantTags(document string, tags []string) []string {
	text := strings.ToLower(document)
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		key := normalizeTag(tag)
		if len(key) >= 3 && strings.Contains(text, key) {
			out = append(out, tag)
		}
	}
	return out
}
func parseTags(s string) []string {
	s = strings.Trim(strings.TrimSpace(s), "[]")
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := []string{}
	for _, v := range parts {
		v = strings.Trim(strings.TrimSpace(v), "\"'")
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func normalizeTag(tag string) string { return strings.ToLower(strings.TrimSpace(tag)) }

// markdownBody removes YAML frontmatter before classification. In particular,
// a page's old tags must not be mistaken for concepts mentioned by its body.
func markdownBody(content string) string {
	if !strings.HasPrefix(content, "---\n") {
		return content
	}
	if end := strings.Index(content[4:], "\n---"); end >= 0 {
		return strings.TrimLeft(content[end+8:], "\r\n")
	}
	return content
}
func generate(ctx context.Context, provider, endpoint, apiKey, model, document string, existingTags []string, max int) ([]string, error) {
	vocabulary := "(no existing workspace tags)"
	if len(existingTags) > 0 {
		vocabulary = strings.Join(existingTags, ", ")
	}
	prompt := fmt.Sprintf("Return JSON only: an object with a `tags` array containing at most %d concise lowercase topical tags for this Markdown document. Reuse an exact item from Candidate existing tags only when it is central to this document. Do not output every candidate. Create a new tag only when no candidate accurately describes that concept. Do not include # or explanations. Candidate existing tags: %s\nDocument:\n%s", max, vocabulary, document[:min(len(document), 3500)])
	schema := map[string]interface{}{"type": "object", "properties": map[string]interface{}{"tags": map[string]interface{}{"type": "array", "items": map[string]string{"type": "string"}}}, "required": []string{"tags"}}
	payload := map[string]interface{}{"model": model, "messages": []map[string]string{{"role": "user", "content": prompt}}}
	url := strings.TrimRight(endpoint, "/") + "/api/chat"
	if provider == openRouterProvider {
		url = "https://openrouter.ai/api/v1/chat/completions"
		payload["response_format"] = map[string]string{"type": "json_object"}
		payload["temperature"] = 0.1
	} else {
		payload["stream"] = false
		payload["keep_alive"] = "10m"
		payload["format"] = schema
		payload["options"] = map[string]interface{}{"temperature": 0.1}
	}
	body, _ := json.Marshal(payload)
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if e != nil {
		return nil, e
	}
	req.Header.Set("Content-Type", "application/json")
	if provider == openRouterProvider {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	res, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("%s returned %s", provider, res.Status)
	}
	var reply struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if e = json.NewDecoder(res.Body).Decode(&reply); e != nil {
		return nil, e
	}
	contentReply := reply.Message.Content
	if provider == openRouterProvider && len(reply.Choices) > 0 {
		contentReply = reply.Choices[0].Message.Content
	}
	tags, e := decodeTags(contentReply)
	if e != nil {
		return nil, e
	}
	seen := map[string]bool{}
	out := []string{}
	for _, t := range tags {
		t = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(t, "#")))
		if t != "" && !seen[t] && len(t) <= 48 {
			seen[t] = true
			out = append(out, t)
			if len(out) == max {
				break
			}
		}
	}
	return out, nil
}

// decodeTags accepts the requested {"tags":[...]} response plus common
// Ollama/model variants such as a root array or {"value":[...]}. This keeps
// the integration compatible with models that obey JSON but choose a wrapper.
func decodeTags(content string) ([]string, error) {
	content = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(content), "```json"), "```"))
	if content == "" {
		return nil, errors.New("the AI provider returned an empty model response; choose a different model")
	}
	var data interface{}
	if err := json.Unmarshal([]byte(content), &data); err != nil {
		return nil, errors.New("the AI provider did not return valid JSON tags")
	}
	var find func(interface{}) ([]string, bool)
	find = func(v interface{}) ([]string, bool) {
		switch x := v.(type) {
		case []interface{}:
			out := make([]string, 0, len(x))
			for _, item := range x {
				s, ok := item.(string)
				if !ok {
					return nil, false
				}
				out = append(out, s)
			}
			return out, true
		case map[string]interface{}:
			for _, key := range []string{"tags", "value"} {
				if child, ok := x[key]; ok {
					if out, ok := find(child); ok {
						return out, true
					}
				}
			}
			for _, child := range x {
				if out, ok := find(child); ok {
					return out, true
				}
			}
		}
		return nil, false
	}
	if tags, ok := find(data); ok {
		return tags, nil
	}
	return nil, errors.New("the AI provider returned JSON without a tag array")
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
