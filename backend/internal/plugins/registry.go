package plugins

import (
	"context"
	"log"
)

// Registry holds every registered plugin (real + coming-soon placeholders)
// and manages their shared lifecycle.
type Registry struct {
	plugins    []Plugin
	comingSoon []Meta
	cancel     context.CancelFunc
}

func NewRegistry() *Registry {
	return &Registry{}
}

// Register adds a real, running plugin.
func (r *Registry) Register(p Plugin) {
	r.plugins = append(r.plugins, p)
}

// RegisterComingSoon adds a placeholder store-grid card with no backing
// implementation (e.g. "MCP Servers", "LLM Providers").
func (r *Registry) RegisterComingSoon(m Meta) {
	m.Status = "coming_soon"
	r.comingSoon = append(r.comingSoon, m)
}

// StartAll starts every registered plugin under a single cancellable context
// derived from ctx; StopAll cancels it and waits for every plugin to unwind.
func (r *Registry) StartAll(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	for _, p := range r.plugins {
		if err := p.Start(ctx); err != nil {
			cancel()
			return err
		}
	}
	return nil
}

func (r *Registry) StopAll() {
	if r.cancel != nil {
		r.cancel()
	}
	for _, p := range r.plugins {
		if err := p.Stop(); err != nil {
			log.Printf("plugins: %s: stop error: %v", p.Meta().ID, err)
		}
	}
}

// NotifyFileChanged fans a file-change signal out to every plugin, each in
// its own recovered goroutine — a slow or panicking plugin must never stall
// a file save or SSE broadcast.
func (r *Registry) NotifyFileChanged(relPath string) {
	for _, p := range r.plugins {
		p := p
		go func() {
			defer func() {
				if rec := recover(); rec != nil {
					log.Printf("plugins: %s: panic in OnFileChanged: %v", p.Meta().ID, rec)
				}
			}()
			p.OnFileChanged(relPath)
		}()
	}
}

// List returns metadata for every plugin (real + coming-soon) for the store grid.
func (r *Registry) List() []Meta {
	out := make([]Meta, 0, len(r.plugins)+len(r.comingSoon))
	for _, p := range r.plugins {
		out = append(out, p.Meta())
	}
	out = append(out, r.comingSoon...)
	return out
}

// Get returns a registered real plugin by ID.
func (r *Registry) Get(id string) (Plugin, bool) {
	for _, p := range r.plugins {
		if p.Meta().ID == id {
			return p, true
		}
	}
	return nil, false
}
