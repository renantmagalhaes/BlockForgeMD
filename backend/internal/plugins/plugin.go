// Package plugins provides a minimal internal registry/lifecycle contract for
// BlockForgeMD integrations (the "Plugin Store"). This is not a dynamic /
// third-party code loading system — Go can't do that portably, and it isn't
// needed for what's being built. It's just a shared place for real plugins
// (Google Calendar today; MCP servers/LLM providers later) to register a
// background lifecycle and a generic "a file changed" signal, instead of each
// one being wired into the server ad hoc.
package plugins

import "context"

// Meta describes a plugin for the Settings > Plugins store grid.
type Meta struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"` // "calendar" | "mcp" | "llm"
	Status   string `json:"status"`   // "available" | "coming_soon"
}

// Plugin is the lifecycle contract every real (non-placeholder) plugin implements.
type Plugin interface {
	Meta() Meta

	// Start begins any background work (e.g. a polling sync loop). It must
	// return promptly — long-running work belongs in a goroutine tied to ctx.
	Start(ctx context.Context) error

	// Stop blocks until background work started by Start has fully wound down.
	Stop() error

	// OnFileChanged is called after any local file create/update/delete/move
	// (see Server.broadcastEvent). It runs in its own recovered goroutine, so
	// implementations don't need to worry about panics or slowness blocking
	// the caller — but they also can't assume ordering across rapid changes.
	OnFileChanged(relPath string)
}
