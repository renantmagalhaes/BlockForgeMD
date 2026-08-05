// Package googlecalendar implements BlockForgeMD's first real plugin: 2-way
// sync between any page's `dueDate` frontmatter field and events on the
// connecting user's Google Calendar. Sync is polling-based (not push
// webhooks) since a self-hosted instance has no guaranteed public HTTPS
// endpoint for Google to call back to; Google's incremental syncToken keeps
// the remote-side polling cheap.
package googlecalendar

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"blockforgemd/internal/db"
	"blockforgemd/internal/plugins"
)

// ID is this plugin's registry identifier and API route segment.
const ID = "google-calendar"

const defaultPollInterval = 2 * time.Minute
const minPollIntervalSeconds = 30

// AppBaseURLSettingKey stores the public origin (scheme + host) this
// instance is reached at, captured by the server package as a side effect of
// computing the OAuth redirect URI (the only place a real browser request's
// Host is reliably available — this plugin's sync engine runs in a
// background goroutine with no HTTP request of its own). Used to build a
// deep link back to the source page in each event's description.
const AppBaseURLSettingKey = "app_base_url"

// LocalWriter is the minimal safe-write capability the plugin needs from the
// host server: applying a frontmatter patch through the same locking /
// reindexing / SSE-broadcast path every other mutation already goes through
// (see Server.UpdateFrontMatter). Defined here, at the point of use, since
// this package can't import the server package (server imports this one).
type LocalWriter interface {
	UpdateFrontMatter(relPath string, updates map[string]interface{}) error
}

type Plugin struct {
	db     *db.DB
	writer LocalWriter
	encKey [32]byte

	wg        sync.WaitGroup
	pushLocks *keyedMutex
}

func New(database *db.DB, writer LocalWriter, encKey [32]byte) *Plugin {
	return &Plugin{db: database, writer: writer, encKey: encKey, pushLocks: newKeyedMutex()}
}

// keyedMutex serializes pushFile calls per (userID, filePath). Two triggers
// for the same page (an event-driven OnFileChanged racing the periodic
// safety-net scan, or — as happened with trash restore — a single action
// accidentally firing the change signal twice) can otherwise both read "no
// mapping yet" and each create a separate Google event for the same page;
// only one ever ends up tracked locally, leaving the other as a permanent,
// undeletable orphan. Serializing makes the second call see the first one's
// result instead of racing it.
type keyedMutex struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func newKeyedMutex() *keyedMutex {
	return &keyedMutex{locks: make(map[string]*sync.Mutex)}
}

func (k *keyedMutex) Lock(key string) (unlock func()) {
	k.mu.Lock()
	l, ok := k.locks[key]
	if !ok {
		l = &sync.Mutex{}
		k.locks[key] = l
	}
	k.mu.Unlock()

	l.Lock()
	return l.Unlock
}

func (p *Plugin) Meta() plugins.Meta {
	return plugins.Meta{ID: ID, Name: "Google Calendar", Category: "calendar", Status: "available"}
}

func (p *Plugin) Start(ctx context.Context) error {
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		// Poll interval is now per-user (each user's own config), so the
		// ticker itself runs on a fixed floor cadence — actual per-user
		// throttling happens inside syncAllAccounts, which only actually
		// syncs an account once that account's own interval has elapsed.
		// This avoids spawning/stopping a goroutine per connected user.
		for {
			timer := time.NewTimer(minPollIntervalSeconds * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
				p.syncAllAccounts(ctx)
			}
		}
	}()
	return nil
}

func (p *Plugin) Stop() error {
	p.wg.Wait()
	return nil
}

// PollIntervalSeconds returns userID's own background sync interval, for
// display/editing in Settings.
func (p *Plugin) PollIntervalSeconds(userID string) int {
	cfg, err := p.db.GetGCalUserConfig(userID)
	if err != nil || cfg == nil || cfg.PollIntervalSeconds <= 0 {
		return int(defaultPollInterval.Seconds())
	}
	return cfg.PollIntervalSeconds
}

// SetPollIntervalSeconds updates how often the background sync loop checks
// userID's account for changes. Enforces a floor to avoid hammering the
// Calendar API.
func (p *Plugin) SetPollIntervalSeconds(userID string, seconds int) error {
	if seconds < minPollIntervalSeconds {
		return fmt.Errorf("poll interval must be at least %d seconds", minPollIntervalSeconds)
	}
	return p.db.SetGCalPollIntervalSeconds(userID, seconds)
}

// workspaceOf returns the workspace name a vault-relative path belongs to —
// the first path segment (e.g. "Default/Boards/board/task.md" -> "Default").
func workspaceOf(relPath string) string {
	if idx := strings.Index(relPath, "/"); idx >= 0 {
		return relPath[:idx]
	}
	return relPath
}

// AllowedWorkspaces returns userID's own workspace allowlist. An empty slice
// means "all workspaces" (the default).
func (p *Plugin) AllowedWorkspaces(userID string) []string {
	cfg, err := p.db.GetGCalUserConfig(userID)
	if err != nil || cfg == nil || cfg.Workspaces == "" {
		return nil
	}
	var list []string
	if err := json.Unmarshal([]byte(cfg.Workspaces), &list); err != nil {
		return nil
	}
	return list
}

func (p *Plugin) workspaceAllowed(userID, relPath string) bool {
	allowed := p.AllowedWorkspaces(userID)
	if len(allowed) == 0 {
		return true // unrestricted — the default
	}
	ws := workspaceOf(relPath)
	for _, w := range allowed {
		if w == ws {
			return true
		}
	}
	return false
}

// assigneeMatches reports whether assignee (a page's frontmatter value)
// case-insensitively matches userID's own username. An empty/unresolved
// assignee never matches anyone — there is no "sync to everyone" fallback.
func (p *Plugin) assigneeMatches(userID, assignee string) bool {
	if assignee == "" {
		return false
	}
	user, err := p.db.GetUserByID(userID)
	if err != nil || user == nil {
		return false
	}
	return strings.EqualFold(user.Username, assignee)
}

// SetAllowedWorkspaces updates which workspaces are in userID's sync scope.
// If this narrows the scope, it best-effort cleans up this user's
// already-synced events whose page now falls outside it — mirroring how
// SetCalendar cleans up before switching calendars, so narrowing the scope
// doesn't leave orphaned events sitting untracked in Google Calendar. Newly
// *included* workspaces aren't proactively pushed here; they pick up on the
// next periodic sync pass (or an explicit Sync now), same as SetCalendar.
func (p *Plugin) SetAllowedWorkspaces(ctx context.Context, userID string, workspaces []string) error {
	if workspaces == nil {
		workspaces = []string{}
	}
	encoded, err := json.Marshal(workspaces)
	if err != nil {
		return err
	}
	if err := p.db.SetGCalWorkspaces(userID, string(encoded)); err != nil {
		return err
	}
	if len(workspaces) == 0 {
		return nil // now unrestricted — nothing could have fallen out of scope
	}

	allowed := make(map[string]bool, len(workspaces))
	for _, w := range workspaces {
		allowed[w] = true
	}

	acct, err := p.db.GetGCalAccount(userID)
	if err != nil || acct == nil {
		return nil // not connected yet — nothing to clean up
	}
	mappings, err := p.db.ListGCalSyncState(userID)
	if err != nil {
		return nil // best-effort cleanup — don't fail the settings save over this
	}
	client, cerr := p.httpClientForUser(ctx, acct)
	if cerr != nil {
		logf("could not build client to clean up out-of-scope events for user %s: %v", userID, cerr)
		return nil
	}
	for _, m := range mappings {
		if allowed[workspaceOf(m.FilePath)] {
			continue
		}
		if derr := DeleteEvent(ctx, client, acct.CalendarID, m.GoogleEventID); derr != nil {
			logf("failed to delete event %s while narrowing workspace scope for user %s: %v", m.GoogleEventID, userID, derr)
		}
		_ = p.db.DeleteGCalSyncStateByPath(userID, m.FilePath)
	}
	return nil
}

// ProductionConfirmed reports whether userID has acknowledged publishing
// their own OAuth Client to Production. There's no way to verify this via
// API — Google doesn't expose OAuth consent screen publishing status to a
// Calendar-scoped token, and querying it at all would require the much
// broader cloud-platform scope plus GCP project admin rights, disproportionate
// to what this plugin needs — so this is a manual acknowledgment, used only
// to stop showing the reminder banner once someone has confirmed it.
func (p *Plugin) ProductionConfirmed(userID string) bool {
	cfg, err := p.db.GetGCalUserConfig(userID)
	if err != nil || cfg == nil {
		return false
	}
	return cfg.ProductionConfirmed
}

func (p *Plugin) SetProductionConfirmed(userID string, confirmed bool) error {
	return p.db.SetGCalProductionConfirmed(userID, confirmed)
}

func (p *Plugin) CompletionAction(userID string) string {
	cfg, err := p.db.GetGCalUserConfig(userID)
	if err != nil || cfg == nil || cfg.CompletionAction == "" {
		return "keep"
	}
	return cfg.CompletionAction
}
func (p *Plugin) CompletionCalendarID(userID string) string {
	cfg, err := p.db.GetGCalUserConfig(userID)
	if err != nil || cfg == nil {
		return ""
	}
	return cfg.CompletionCalendarID
}
func (p *Plugin) SetCompletionPolicy(userID, action, calendarID string) error {
	if action == "" {
		action = "keep"
	}
	if action != "keep" && action != "remove" && action != "move" {
		return fmt.Errorf("invalid completion action")
	}
	if action == "move" && calendarID == "" {
		return fmt.Errorf("choose a completion calendar")
	}
	if action != "move" {
		calendarID = ""
	}
	return p.db.SetGCalCompletionPolicy(userID, action, calendarID)
}

// OnFileChanged pushes a single changed page to every connected account —
// pushFile itself decides (via workspace scope + assignee match) whether
// that account is actually the right target. It's called by the registry in
// its own goroutine, so errors are logged, not returned.
func (p *Plugin) OnFileChanged(relPath string) {
	accounts, err := p.db.ListGCalAccounts()
	if err != nil {
		logf("failed to list accounts for push sync: %v", err)
		return
	}
	ctx := context.Background()
	for _, acct := range accounts {
		if err := p.pushFile(ctx, acct, relPath); err != nil {
			// Previously only logged server-side — invisible in the UI, so a
			// failed delete/edit push (e.g. a stale token, a transient
			// Calendar API error) looked like silent, unexplained drift
			// between BlockForgeMD and Google Calendar. Surfacing it here
			// means it shows up as lastSyncError immediately, not just after
			// the next periodic pass (which also still runs as a safety net).
			logf("push sync failed for user %s path %s: %v", acct.UserID, relPath, err)
			_ = p.db.UpdateGCalSyncStatus(acct.UserID, time.Now(), err.Error())
		}
	}
}
