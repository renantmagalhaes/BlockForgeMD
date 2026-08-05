package googlecalendar

import (
	"context"
	"errors"
	"fmt"
	"time"

	"blockforgemd/internal/cryptoutil"
	"blockforgemd/internal/db"

	"golang.org/x/oauth2"
)

// This file is the plugin's plain-Go API surface — the thin HTTP handlers in
// server/plugins_gcal.go call these methods and handle request/response
// encoding themselves, so this package stays free of any HTTP-framework
// dependency (chi, etc).

// ConfigResult is returned to the frontend's per-user config panel.
type ConfigResult struct {
	ClientID             string   `json:"clientId"`
	HasClientSecret      bool     `json:"hasClientSecret"`
	PollIntervalSeconds  int      `json:"pollIntervalSeconds"`
	Workspaces           []string `json:"workspaces"`          // empty = all workspaces (default)
	ProductionConfirmed  bool     `json:"productionConfirmed"` // hides the Testing-mode reminder banner once true
	CompletionAction     string   `json:"completionAction"`
	CompletionCalendarID string   `json:"completionCalendarId"`
}

func (p *Plugin) GetConfig(userID string) (ConfigResult, error) {
	clientID, _, hasSecret, err := p.ClientCredentialsForUser(userID)
	if err != nil {
		return ConfigResult{}, err
	}
	workspaces := p.AllowedWorkspaces(userID)
	if workspaces == nil {
		workspaces = []string{}
	}
	return ConfigResult{
		ClientID:             clientID,
		HasClientSecret:      hasSecret,
		PollIntervalSeconds:  p.PollIntervalSeconds(userID),
		Workspaces:           workspaces,
		ProductionConfirmed:  p.ProductionConfirmed(userID),
		CompletionAction:     p.CompletionAction(userID),
		CompletionCalendarID: p.CompletionCalendarID(userID),
	}, nil
}

// SetConfig saves userID's own Client ID/Secret, and if pollIntervalSeconds
// or productionConfirmed are non-nil, updates those too. workspaces replaces
// the full workspace allowlist every time (nil/empty means "all
// workspaces") — unlike clientSecret there's no masking concern, so the
// frontend always round-trips the complete current selection rather than
// needing partial-update semantics.
func (p *Plugin) SetConfig(ctx context.Context, userID, clientID, clientSecret string, pollIntervalSeconds *int, workspaces []string, productionConfirmed *bool, completionAction, completionCalendarID string) error {
	if err := p.SaveClientCredentialsForUser(userID, clientID, clientSecret); err != nil {
		return err
	}
	if pollIntervalSeconds != nil {
		if err := p.SetPollIntervalSeconds(userID, *pollIntervalSeconds); err != nil {
			return err
		}
	}
	if productionConfirmed != nil {
		if err := p.SetProductionConfirmed(userID, *productionConfirmed); err != nil {
			return err
		}
	}
	if err := p.SetAllowedWorkspaces(ctx, userID, workspaces); err != nil {
		return err
	}
	if err := p.SetCompletionPolicy(userID, completionAction, completionCalendarID); err != nil {
		return err
	}
	return nil
}

// StartOAuth returns the Google consent-screen URL for the given user.
func (p *Plugin) StartOAuth(userID, redirectURL string) (string, error) {
	return p.BuildAuthorizeURL(userID, redirectURL)
}

// HandleOAuthCallback verifies state, exchanges the code, fetches the
// account email, and stores the encrypted tokens for that user.
func (p *Plugin) HandleOAuthCallback(ctx context.Context, state, code, redirectURL string) error {
	userID, err := VerifyState(state, p.encKey)
	if err != nil {
		return err
	}

	token, err := p.ExchangeCode(ctx, userID, code, redirectURL)
	if err != nil {
		return fmt.Errorf("token exchange failed: %w", err)
	}
	if token.RefreshToken == "" {
		// Google only issues a refresh token on first consent — BuildAuthorizeURL
		// already forces re-consent (ApprovalForce) so this shouldn't happen, but
		// surface a clear error rather than silently storing an unusable account.
		return errors.New("google did not return a refresh token; try disconnecting and reconnecting")
	}

	encAccess, err := cryptoutil.Encrypt(p.encKey, []byte(token.AccessToken))
	if err != nil {
		return err
	}
	encRefresh, err := cryptoutil.Encrypt(p.encKey, []byte(token.RefreshToken))
	if err != nil {
		return err
	}

	client := oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))
	email, err := GetPrimaryCalendarEmail(ctx, client)
	if err != nil {
		return fmt.Errorf("failed to fetch google account email: %w", err)
	}

	return p.db.UpsertGCalAccount(db.GCalAccount{
		UserID:          userID,
		GoogleEmail:     email,
		AccessTokenEnc:  encAccess,
		RefreshTokenEnc: encRefresh,
		TokenExpiry:     token.Expiry,
		CalendarID:      "primary",
	})
}

// StatusResult is returned to the frontend's per-user connect panel.
type StatusResult struct {
	Connected       bool   `json:"connected"`
	GoogleEmail     string `json:"googleEmail,omitempty"`
	CalendarID      string `json:"calendarId,omitempty"`
	LastSyncAt      string `json:"lastSyncAt,omitempty"`
	LastSyncError   string `json:"lastSyncError,omitempty"`
	SyncedPageCount int    `json:"syncedPageCount"`
}

func (p *Plugin) Status(userID string) (StatusResult, error) {
	acct, err := p.db.GetGCalAccount(userID)
	if err != nil {
		return StatusResult{}, err
	}
	if acct == nil {
		return StatusResult{Connected: false}, nil
	}
	mappings, _ := p.db.ListGCalSyncState(userID)
	res := StatusResult{
		Connected:       true,
		GoogleEmail:     acct.GoogleEmail,
		CalendarID:      acct.CalendarID,
		LastSyncError:   acct.LastSyncError,
		SyncedPageCount: len(mappings),
	}
	if acct.LastSyncAt != nil {
		res.LastSyncAt = acct.LastSyncAt.Format(time.RFC3339)
	}
	return res, nil
}

// CalendarOption is one entry in the "which calendar should events sync to" picker.
type CalendarOption struct {
	ID      string `json:"id"`
	Summary string `json:"summary"`
	Primary bool   `json:"primary"`
}

// ListCalendars returns every calendar the connected user can write events
// to, for the calendar picker.
func (p *Plugin) ListCalendars(ctx context.Context, userID string) ([]CalendarOption, error) {
	acct, err := p.db.GetGCalAccount(userID)
	if err != nil {
		return nil, err
	}
	if acct == nil {
		return nil, errors.New("not connected")
	}
	client, err := p.httpClientForUser(ctx, acct)
	if err != nil {
		return nil, err
	}
	cals, err := ListCalendars(ctx, client)
	if err != nil {
		return nil, err
	}
	out := make([]CalendarOption, len(cals))
	for i, c := range cals {
		out[i] = CalendarOption{ID: c.ID, Summary: c.Summary, Primary: c.Primary}
	}
	return out, nil
}

// SetCalendar switches which calendar the user's pages sync to. Any events
// already synced to the previous calendar are best-effort deleted first (so
// switching doesn't silently leave orphaned duplicates behind), and all
// sync-state mappings are cleared so the next sync recreates fresh events on
// the newly selected calendar.
func (p *Plugin) SetCalendar(ctx context.Context, userID, calendarID string) error {
	acct, err := p.db.GetGCalAccount(userID)
	if err != nil {
		return err
	}
	if acct == nil {
		return errors.New("not connected")
	}
	if calendarID == acct.CalendarID {
		return nil
	}

	client, err := p.httpClientForUser(ctx, acct)
	if err != nil {
		return err
	}
	mappings, err := p.db.ListGCalSyncState(userID)
	if err != nil {
		return err
	}
	for _, m := range mappings {
		if err := DeleteEvent(ctx, client, acct.CalendarID, m.GoogleEventID); err != nil {
			logf("failed to delete event %s on old calendar %s while switching calendars for user %s: %v", m.GoogleEventID, acct.CalendarID, userID, err)
		}
		_ = p.db.DeleteGCalSyncStateByPath(userID, m.FilePath)
	}

	return p.db.UpdateGCalCalendarID(userID, calendarID)
}

// Disconnect deletes every event this connection created (best-effort),
// revokes the token with Google, then deletes the account and all of its
// sync-state mappings. Cleaning up the actual events (not just the local
// mappings) matters: otherwise disconnecting only makes BlockForgeMD forget
// about them while they stay in Google Calendar forever, and reconnecting
// later re-pushes everything still due-dated as brand new events —
// duplicating whatever was already there from before the disconnect.
func (p *Plugin) Disconnect(ctx context.Context, userID string) error {
	acct, err := p.db.GetGCalAccount(userID)
	if err != nil {
		return err
	}
	if acct == nil {
		return nil
	}

	if client, cerr := p.httpClientForUser(ctx, acct); cerr == nil {
		mappings, _ := p.db.ListGCalSyncState(userID)
		for _, m := range mappings {
			if derr := DeleteEvent(ctx, client, acct.CalendarID, m.GoogleEventID); derr != nil {
				logf("failed to delete event %s while disconnecting user %s: %v", m.GoogleEventID, userID, derr)
			}
		}
	} else {
		logf("could not build client to clean up events while disconnecting user %s (token may already be invalid, continuing): %v", userID, cerr)
	}

	if refreshPlain, derr := cryptoutil.Decrypt(p.encKey, acct.RefreshTokenEnc); derr == nil {
		if err := revokeToken(ctx, string(refreshPlain)); err != nil {
			logf("token revoke failed for user %s (continuing with local disconnect): %v", userID, err)
		}
	}
	if err := p.db.DeleteGCalAccount(userID); err != nil {
		return err
	}
	mappings, _ := p.db.ListGCalSyncState(userID)
	for _, m := range mappings {
		_ = p.db.DeleteGCalSyncStateByPath(userID, m.FilePath)
	}
	return nil
}

// SyncNow kicks one immediate sync pass for a user in the background.
func (p *Plugin) SyncNow(userID string) error {
	acct, err := p.db.GetGCalAccount(userID)
	if err != nil {
		return err
	}
	if acct == nil {
		return errors.New("not connected")
	}
	go func() {
		if err := p.syncAccount(context.Background(), *acct); err != nil {
			logf("manual sync failed for user %s: %v", userID, err)
			_ = p.db.UpdateGCalSyncStatus(userID, time.Now(), err.Error())
			return
		}
		_ = p.db.UpdateGCalSyncStatus(userID, time.Now(), "")
	}()
	return nil
}
