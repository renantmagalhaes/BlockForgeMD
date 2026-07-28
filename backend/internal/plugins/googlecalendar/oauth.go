package googlecalendar

import (
	"context"
	"fmt"
	"net/http"

	"blockforgemd/internal/cryptoutil"
	"blockforgemd/internal/db"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const scopeCalendarEvents = "https://www.googleapis.com/auth/calendar.events"

// scopeCalendarList grants read-only access to the account's calendar list
// (calendarList.list) — used both to look up the connected account's email
// (the primary calendar's ID) and to populate the "which calendar should
// events sync to" picker. calendar.events alone doesn't cover this endpoint.
const scopeCalendarList = "https://www.googleapis.com/auth/calendar.calendarlist.readonly"

const settingKeyClientID = "plugin_google_client_id"
const secretKeyClientSecret = "google_client_secret"

// ClientCredentials returns the shared, instance-wide Google OAuth Client
// ID/Secret, decrypting the secret with the plugin's encryption key.
// hasSecret is false if no secret has ever been saved (distinct from an
// empty string, which would otherwise be indistinguishable from "not set").
func (p *Plugin) ClientCredentials() (clientID, clientSecret string, hasSecret bool, err error) {
	clientID, _ = p.db.GetSetting(settingKeyClientID, "")
	encSecret, err := p.db.GetEncryptedSecret(secretKeyClientSecret)
	if err != nil {
		return "", "", false, err
	}
	if encSecret == nil {
		return clientID, "", false, nil
	}
	plain, err := cryptoutil.Decrypt(p.encKey, encSecret)
	if err != nil {
		return "", "", false, fmt.Errorf("failed to decrypt client secret: %w", err)
	}
	return clientID, string(plain), true, nil
}

// SaveClientCredentials stores the shared Client ID (plain) and, if
// clientSecret is non-empty, a newly encrypted Client Secret. Passing an
// empty clientSecret leaves the previously stored secret untouched, so the
// Client ID can be updated on its own.
func (p *Plugin) SaveClientCredentials(clientID, clientSecret string) error {
	if err := p.db.SetSetting(settingKeyClientID, clientID); err != nil {
		return err
	}
	if clientSecret == "" {
		return nil
	}
	enc, err := cryptoutil.Encrypt(p.encKey, []byte(clientSecret))
	if err != nil {
		return err
	}
	return p.db.SetEncryptedSecret(secretKeyClientSecret, enc)
}

func (p *Plugin) baseOAuthConfig() (*oauth2.Config, error) {
	clientID, clientSecret, hasSecret, err := p.ClientCredentials()
	if err != nil {
		return nil, err
	}
	if clientID == "" || !hasSecret {
		return nil, fmt.Errorf("google calendar plugin is not configured: set a client ID and secret first")
	}
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     google.Endpoint,
		Scopes:       []string{scopeCalendarEvents, scopeCalendarList},
	}, nil
}

// BuildAuthorizeURL returns the Google consent-screen URL for a given user.
// ApprovalForce + AccessTypeOffline ensure a refresh token is issued even if
// this user previously connected and revoked access.
func (p *Plugin) BuildAuthorizeURL(userID, redirectURL string) (string, error) {
	cfg, err := p.baseOAuthConfig()
	if err != nil {
		return "", err
	}
	cfg.RedirectURL = redirectURL
	state := SignState(userID, p.encKey)
	return cfg.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce), nil
}

// ExchangeCode trades an authorization code for tokens.
func (p *Plugin) ExchangeCode(ctx context.Context, code, redirectURL string) (*oauth2.Token, error) {
	cfg, err := p.baseOAuthConfig()
	if err != nil {
		return nil, err
	}
	cfg.RedirectURL = redirectURL
	return cfg.Exchange(ctx, code)
}

// httpClientForUser returns an http.Client that transparently refreshes the
// given user's access token as needed, persisting any newly minted access
// token back to the DB so the next call doesn't need to refresh again.
func (p *Plugin) httpClientForUser(ctx context.Context, acct *db.GCalAccount) (*http.Client, error) {
	cfg, err := p.baseOAuthConfig()
	if err != nil {
		return nil, err
	}

	refreshToken, err := cryptoutil.Decrypt(p.encKey, acct.RefreshTokenEnc)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt refresh token: %w", err)
	}
	var accessToken string
	if len(acct.AccessTokenEnc) > 0 {
		if plain, err := cryptoutil.Decrypt(p.encKey, acct.AccessTokenEnc); err == nil {
			accessToken = string(plain)
		}
	}

	token := &oauth2.Token{
		AccessToken:  accessToken,
		RefreshToken: string(refreshToken),
		Expiry:       acct.TokenExpiry,
	}

	newToken, err := cfg.TokenSource(ctx, token).Token()
	if err != nil {
		return nil, fmt.Errorf("failed to refresh google token: %w", err)
	}
	if newToken.AccessToken != accessToken {
		if encAccess, err := cryptoutil.Encrypt(p.encKey, []byte(newToken.AccessToken)); err == nil {
			_ = p.db.UpdateGCalTokens(acct.UserID, encAccess, newToken.Expiry)
		}
	}

	return oauth2.NewClient(ctx, oauth2.StaticTokenSource(newToken)), nil
}
