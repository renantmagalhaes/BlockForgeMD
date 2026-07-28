// Package googlecalendar implements BlockForgeMD's first real plugin: 2-way
// sync between any page's `dueDate` frontmatter field and events on the
// connecting user's Google Calendar. Sync is polling-based (not push
// webhooks) since a self-hosted instance has no guaranteed public HTTPS
// endpoint for Google to call back to; Google's incremental syncToken keeps
// the remote-side polling cheap.
package googlecalendar

import (
	"context"
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

	wg sync.WaitGroup
}

func New(database *db.DB, writer LocalWriter, encKey [32]byte) *Plugin {
	return &Plugin{db: database, writer: writer, encKey: encKey}
}

func (p *Plugin) Meta() plugins.Meta {
	return plugins.Meta{ID: ID, Name: "Google Calendar", Category: "calendar", Status: "available"}
}

func (p *Plugin) Start(ctx context.Context) error {
	interval := p.pollInterval()
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
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
	raw, _ := p.db.GetSetting(pollIntervalSettingKey, "")
	if raw == "" {
		return defaultPollInterval
	}
	secs, err := strconv.Atoi(raw)
	if err != nil || secs <= 0 {
		return defaultPollInterval
	}
	return time.Duration(secs) * time.Second
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
			logf("push sync failed for user %s path %s: %v", acct.UserID, relPath, err)
		}
	}
}
