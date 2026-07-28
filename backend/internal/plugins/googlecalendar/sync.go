package googlecalendar

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"time"

	"blockforgemd/internal/db"
)

func logf(format string, args ...interface{}) {
	log.Printf("google-calendar: "+format, args...)
}

func contentHash(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// buildEventDescription includes a deep link back to the source page,
// matching the hash-route format the frontend itself uses to open a file
// (App.tsx: `'#/' + encodeURIComponent(path)`). Omits the link (falls back
// to a plain note) if the app's public URL isn't known yet — this is only
// captured once someone visits Settings > Plugins > Google Calendar.
func (p *Plugin) buildEventDescription(relPath string) string {
	baseURL, _ := p.db.GetSetting(AppBaseURLSettingKey, "")
	if baseURL == "" {
		return "Synced from BlockForgeMD: " + relPath
	}
	return "Synced from BlockForgeMD\n\n" + baseURL + "/#/" + encodeURIComponent(relPath)
}

// syncAllAccounts runs one full sync pass (pull + push safety net) for every
// connected user. Called on each poll tick.
func (p *Plugin) syncAllAccounts(ctx context.Context) {
	accounts, err := p.db.ListGCalAccounts()
	if err != nil {
		logf("failed to list accounts: %v", err)
		return
	}
	for _, acct := range accounts {
		if err := p.syncAccount(ctx, acct); err != nil {
			logf("sync failed for user %s: %v", acct.UserID, err)
			_ = p.db.UpdateGCalSyncStatus(acct.UserID, time.Now(), err.Error())
			continue
		}
		_ = p.db.UpdateGCalSyncStatus(acct.UserID, time.Now(), "")
	}
}

// syncAccount does one pass for a single connected user: pull remote changes
// since the last syncToken, then a vault-wide push safety net that catches
// anything missed while the process was down or a push goroutine panicked.
func (p *Plugin) syncAccount(ctx context.Context, acct db.GCalAccount) error {
	client, err := p.httpClientForUser(ctx, &acct)
	if err != nil {
		return err
	}

	// --- Pull: remote -> local ---
	events, nextSyncToken, err := ListEventsDelta(ctx, client, acct.CalendarID, acct.SyncToken)
	if errors.Is(err, errSyncTokenExpired) {
		events, nextSyncToken, err = ListEventsDelta(ctx, client, acct.CalendarID, "")
	}
	if err != nil {
		return err
	}
	for _, ev := range events {
		if err := p.pullEvent(acct, ev); err != nil {
			logf("failed to apply remote event %s for user %s: %v", ev.ID, acct.UserID, err)
		}
	}
	if nextSyncToken != "" {
		_ = p.db.UpdateGCalSyncToken(acct.UserID, nextSyncToken)
	}

	// --- Push safety net: re-scan every due-dated page vault-wide ---
	cards, err := p.db.QueryCards("", nil, "")
	if err != nil {
		return err
	}
	withDue := make(map[string]bool, len(cards))
	for _, c := range cards {
		if c.Fields["dueDate"] != "" {
			withDue[c.Path] = true
		}
	}
	for path := range withDue {
		if err := p.pushFile(ctx, acct, path); err != nil {
			logf("safety-net push failed for %s (user %s): %v", path, acct.UserID, err)
		}
	}

	// Anything still mapped but no longer due-dated (or deleted) needs its
	// event cleared/removed too — pushFile re-reads the file and handles both.
	mappings, err := p.db.ListGCalSyncState(acct.UserID)
	if err == nil {
		for _, m := range mappings {
			if withDue[m.FilePath] {
				continue
			}
			if err := p.pushFile(ctx, acct, m.FilePath); err != nil {
				logf("cleanup push failed for %s (user %s): %v", m.FilePath, acct.UserID, err)
			}
		}
	}

	return nil
}

// pushFile re-reads a page's current state and reconciles it with Google:
// creates/updates the mapped event if a dueDate is present, deletes it if
// the dueDate was cleared or the file no longer exists. State-diffing (not
// "interpret the edit type") keeps this correct across save / frontmatter
// edit / move / restore / external watcher-detected edits alike.
func (p *Plugin) pushFile(ctx context.Context, acct db.GCalAccount, relPath string) error {
	client, err := p.httpClientForUser(ctx, &acct)
	if err != nil {
		return err
	}

	state, err := p.db.GetGCalSyncStateByPath(acct.UserID, relPath)
	if err != nil {
		return err
	}

	file, err := p.db.GetFile(relPath)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	var dueDate, dueTimeZone, title string
	if file != nil {
		dueDate = file.FrontMatter["dueDate"]
		dueTimeZone = file.FrontMatter["dueTimeZone"]
		title = file.Title
	}

	if dueDate == "" {
		// File deleted, or its dueDate was cleared — remove the mapped event, if any.
		if state == nil {
			return nil
		}
		if err := DeleteEvent(ctx, client, acct.CalendarID, state.GoogleEventID); err != nil {
			return err
		}
		return p.db.DeleteGCalSyncStateByPath(acct.UserID, relPath)
	}

	hash := contentHash(title, dueDate, dueTimeZone)
	if state != nil && state.LocalContentHash == hash {
		return nil // nothing changed since last push
	}

	start, end := dueDateToGEventTimes(dueDate, dueTimeZone)
	ev := GEvent{
		Summary:     title,
		Description: p.buildEventDescription(relPath),
		Start:       &start,
		End:         &end,
	}

	var saved *GEvent
	if state != nil {
		saved, err = UpdateEvent(ctx, client, acct.CalendarID, state.GoogleEventID, ev)
		if err != nil {
			// Event may have been deleted on Google's side between polls — recreate it,
			// and drop the stale mapping so we don't keep retrying against a dead ID.
			saved, err = InsertEvent(ctx, client, acct.CalendarID, ev)
		}
	} else {
		saved, err = InsertEvent(ctx, client, acct.CalendarID, ev)
	}
	if err != nil {
		return err
	}

	syncStateID := ""
	if state != nil {
		syncStateID = state.ID
	}
	return p.db.UpsertGCalSyncState(db.GCalSyncState{
		ID:               syncStateID,
		UserID:           acct.UserID,
		FilePath:         relPath,
		GoogleEventID:    saved.ID,
		LastDueDate:      dueDate,
		LocalContentHash: hash,
		LastSyncedAt:     time.Now(),
	})
}

// pullEvent applies one remote Google Calendar event change back to the
// mapped local page. Events BlockForgeMD doesn't have a mapping for are
// ignored — this only mirrors changes to events it created, it never imports
// arbitrary pre-existing Google events as new pages.
func (p *Plugin) pullEvent(acct db.GCalAccount, ev GEvent) error {
	state, err := p.db.GetGCalSyncStateByEventID(acct.UserID, ev.ID)
	if err != nil {
		return err
	}
	if state == nil {
		return nil
	}

	if ev.Status == "cancelled" {
		if err := p.writer.UpdateFrontMatter(state.FilePath, map[string]interface{}{"dueDate": nil, "dueTimeZone": nil}); err != nil {
			return err
		}
		return p.db.DeleteGCalSyncStateByEventID(acct.UserID, ev.ID)
	}

	newDueDate, newDueTimeZone := gEventToDueDate(&ev)
	if newDueDate == "" || newDueDate == state.LastDueDate {
		return nil
	}

	// Last-write-wins: only apply if Google's copy was updated more recently
	// than our last sync (otherwise this is just an echo of our own push).
	if ev.Updated != "" && !state.LastSyncedAt.IsZero() {
		if updatedAt, err := time.Parse(time.RFC3339, ev.Updated); err == nil && !updatedAt.After(state.LastSyncedAt) {
			return nil
		}
	}

	updates := map[string]interface{}{"dueDate": newDueDate}
	if newDueTimeZone != "" {
		updates["dueTimeZone"] = newDueTimeZone
	} else {
		updates["dueTimeZone"] = nil
	}
	if err := p.writer.UpdateFrontMatter(state.FilePath, updates); err != nil {
		return err
	}

	title := state.FilePath
	if file, err := p.db.GetFile(state.FilePath); err == nil && file != nil {
		title = file.Title
	}
	return p.db.UpsertGCalSyncState(db.GCalSyncState{
		ID:               state.ID,
		UserID:           acct.UserID,
		FilePath:         state.FilePath,
		GoogleEventID:    ev.ID,
		LastDueDate:      newDueDate,
		LocalContentHash: contentHash(title, newDueDate, newDueTimeZone),
		LastSyncedAt:     time.Now(),
	})
}
