// Package googlecalendar implements BlockForgeMD's first real plugin: 2-way
// sync between any page's `dueDate` frontmatter field and events on the
// connecting user's Google Calendar. Sync is polling-based (not push
// webhooks) since a self-hosted instance has no guaranteed public HTTPS
// endpoint for Google to call back to; Google's incremental syncToken keeps
// the remote-side polling cheap.
package googlecalendar

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"blockforgemd/internal/db"
	"blockforgemd/internal/plugins"
)

// ID is this plugin's registry identifier and API route segment.
const ID = "google-calendar"

const defaultPollInterval = 2 * time.Minute
const pollIntervalSettingKey = "plugin_gcal_poll_interval_seconds"

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
		for {
			// Re-read the interval each cycle (rather than fixing it once in
			// a time.Ticker) so changing it in Settings takes effect from
			// the next tick onward, with no restart needed.
			timer := time.NewTimer(p.pollInterval())
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

func (p *Plugin) pollInterval() time.Duration {
	return time.Duration(p.PollIntervalSeconds()) * time.Second
}

// PollIntervalSeconds returns the current background sync interval, for
// display/editing in Settings.
func (p *Plugin) PollIntervalSeconds() int {
	raw, _ := p.db.GetSetting(pollIntervalSettingKey, "")
	if raw == "" {
		return int(defaultPollInterval.Seconds())
	}
	secs, err := strconv.Atoi(raw)
	if err != nil || secs <= 0 {
		return int(defaultPollInterval.Seconds())
	}
	return secs
}

// SetPollIntervalSeconds updates how often the background sync loop checks
// for changes. Enforces a floor to avoid hammering the Calendar API.
func (p *Plugin) SetPollIntervalSeconds(seconds int) error {
	const minSeconds = 30
	if seconds < minSeconds {
		return fmt.Errorf("poll interval must be at least %d seconds", minSeconds)
	}
	return p.db.SetSetting(pollIntervalSettingKey, strconv.Itoa(seconds))
}

// OnFileChanged pushes a single changed page's dueDate to every connected
// user's calendar. It's called by the registry in its own goroutine, so
// errors are logged, not returned.
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
