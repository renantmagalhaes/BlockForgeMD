package googlecalendar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const calendarAPIBase = "https://www.googleapis.com/calendar/v3"

// errSyncTokenExpired signals a 410 Gone from events.list — the caller must
// retry with an empty syncToken (a fresh full listing) and start a new one.
var errSyncTokenExpired = errors.New("google calendar sync token expired")

// GEventDateTime mirrors the Calendar API's EventDateTime — exactly one of
// Date (all-day, YYYY-MM-DD) or DateTime is set. When DateTime carries no UTC
// designator/offset, Google requires TimeZone to be set alongside it (an IANA
// name like "America/Sao_Paulo") so the wall-clock time is interpreted
// correctly instead of being assumed to be UTC.
type GEventDateTime struct {
	Date     string `json:"date,omitempty"`
	DateTime string `json:"dateTime,omitempty"`
	TimeZone string `json:"timeZone,omitempty"`
}

// GEvent is the subset of the Calendar API's Event resource this plugin uses.
type GEvent struct {
	ID          string          `json:"id,omitempty"`
	Status      string          `json:"status,omitempty"` // "confirmed" | "cancelled"
	Summary     string          `json:"summary,omitempty"`
	Description string          `json:"description,omitempty"`
	Start       *GEventDateTime `json:"start,omitempty"`
	End         *GEventDateTime `json:"end,omitempty"`
	Updated     string          `json:"updated,omitempty"` // RFC3339, server-set
}

type gEventList struct {
	Items         []GEvent `json:"items"`
	NextSyncToken string   `json:"nextSyncToken"`
	NextPageToken string   `json:"nextPageToken"`
}

// localDateTimeLayout matches the Editor's saved format: "2006-01-02T15:04"
// (no seconds, no offset — a wall-clock time in whatever timezone the user
// was in when they picked it, recorded separately as dueTimeZone).
const localDateTimeLayout = "2006-01-02T15:04"
const localDateTimeLayoutSeconds = "2006-01-02T15:04:05"

// dueDateToGEventTimes converts a page's dueDate (+ optional dueTimeZone)
// frontmatter into Calendar API start/end times. All-day events need an
// exclusive end date (start + 1 day); timed events default to a 30-minute
// block. dueDate carries no seconds/offset (e.g. "2026-08-01T21:00"), so it's
// parsed as a naive local time and re-emitted the same way, paired with an
// explicit IANA TimeZone — that's what tells Google which wall-clock time
// zone to interpret it in, rather than defaulting to UTC.
func dueDateToGEventTimes(dueDate, timeZone string) (start, end GEventDateTime) {
	if strings.Contains(dueDate, "T") {
		t, err := time.Parse(localDateTimeLayout, dueDate)
		if err != nil {
			// Tolerate a value that already carries seconds.
			t, err = time.Parse(localDateTimeLayoutSeconds, dueDate)
		}
		if err != nil {
			// Unparseable — fall back to sending it verbatim rather than
			// dropping the time entirely.
			start = GEventDateTime{DateTime: dueDate, TimeZone: timeZone}
			end = start
			return
		}
		start = GEventDateTime{DateTime: t.Format(localDateTimeLayoutSeconds), TimeZone: timeZone}
		end = GEventDateTime{DateTime: t.Add(30 * time.Minute).Format(localDateTimeLayoutSeconds), TimeZone: timeZone}
		return
	}
	start = GEventDateTime{Date: dueDate}
	if t, err := time.Parse("2006-01-02", dueDate); err == nil {
		end = GEventDateTime{Date: t.AddDate(0, 0, 1).Format("2006-01-02")}
	} else {
		end = start
	}
	return
}

// gEventToDueDate extracts a dueDate-compatible string (and, for timed
// events, its IANA timezone) back from an event's start time. Returns an
// empty dueTimeZone for all-day events, matching how the Editor only records
// dueTimeZone alongside a time-of-day.
func gEventToDueDate(ev *GEvent) (dueDate, dueTimeZone string) {
	if ev.Start == nil {
		return "", ""
	}
	if ev.Start.DateTime != "" {
		// Google always returns dateTime with a numeric offset (e.g.
		// "...-03:00") even when a timeZone name is also present — parse
		// with the offset, then re-emit as a naive local wall-clock string
		// in that same zone, matching what the Editor writes.
		if t, err := time.Parse(time.RFC3339, ev.Start.DateTime); err == nil {
			if ev.Start.TimeZone != "" {
				if loc, err := time.LoadLocation(ev.Start.TimeZone); err == nil {
					t = t.In(loc)
				}
			}
			return t.Format(localDateTimeLayout), ev.Start.TimeZone
		}
		return ev.Start.DateTime, ev.Start.TimeZone
	}
	return ev.Start.Date, ""
}

// ListEventsDelta lists events changed since syncToken (or, if syncToken is
// empty, all upcoming-ish events as a fresh baseline), returning the new
// syncToken to persist for next time. Returns errSyncTokenExpired on a 410.
func ListEventsDelta(ctx context.Context, client *http.Client, calendarID, syncToken string) ([]GEvent, string, error) {
	var allItems []GEvent
	pageToken := ""
	nextSyncToken := ""

	for {
		q := url.Values{}
		q.Set("showDeleted", "true")
		q.Set("singleEvents", "true")
		if syncToken != "" {
			q.Set("syncToken", syncToken)
		} else {
			// Fresh baseline scan — bound it to a year back so we don't pull a
			// decade of history on first connect.
			q.Set("timeMin", time.Now().AddDate(-1, 0, 0).Format(time.RFC3339))
		}
		if pageToken != "" {
			q.Set("pageToken", pageToken)
		}

		reqURL := fmt.Sprintf("%s/calendars/%s/events?%s", calendarAPIBase, url.PathEscape(calendarID), q.Encode())
		items, list, err := doEventsListRequest(ctx, client, reqURL)
		if err != nil {
			return nil, "", err
		}
		allItems = append(allItems, items...)
		if list.NextSyncToken != "" {
			nextSyncToken = list.NextSyncToken
		}
		if list.NextPageToken == "" {
			break
		}
		pageToken = list.NextPageToken
	}

	return allItems, nextSyncToken, nil
}

func doEventsListRequest(ctx context.Context, client *http.Client, reqURL string) ([]GEvent, gEventList, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, gEventList{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, gEventList{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone {
		return nil, gEventList{}, errSyncTokenExpired
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, gEventList{}, fmt.Errorf("google calendar list events failed: %s: %s", resp.Status, string(body))
	}

	var list gEventList
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, gEventList{}, err
	}
	return list.Items, list, nil
}

// InsertEvent creates a new event on the given calendar.
func InsertEvent(ctx context.Context, client *http.Client, calendarID string, ev GEvent) (*GEvent, error) {
	reqURL := fmt.Sprintf("%s/calendars/%s/events", calendarAPIBase, url.PathEscape(calendarID))
	return doEventWriteRequest(ctx, client, http.MethodPost, reqURL, ev)
}

// UpdateEvent replaces an existing event's fields in place, via a full
// resource PUT rather than a partial PATCH. This matters specifically when
// an event flips between all-day (start.date) and timed (start.dateTime):
// PATCH merges the start/end sub-objects instead of replacing them, so
// pushing a timed start (dateTime set, date omitted via omitempty) onto an
// event that currently has start.date leaves Google with both fields set,
// which it rejects with a 400 — PUT replaces the whole start/end object
// every time, so the old shape is always fully cleared.
func UpdateEvent(ctx context.Context, client *http.Client, calendarID, eventID string, ev GEvent) (*GEvent, error) {
	reqURL := fmt.Sprintf("%s/calendars/%s/events/%s", calendarAPIBase, url.PathEscape(calendarID), url.PathEscape(eventID))
	return doEventWriteRequest(ctx, client, http.MethodPut, reqURL, ev)
}

func doEventWriteRequest(ctx context.Context, client *http.Client, method, reqURL string, ev GEvent) (*GEvent, error) {
	body, err := json.Marshal(ev)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("google calendar %s event failed: %s: %s", method, resp.Status, string(b))
	}
	var out GEvent
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteEvent removes an event; a 404/410 (already gone) is not an error.
func DeleteEvent(ctx context.Context, client *http.Client, calendarID, eventID string) error {
	reqURL := fmt.Sprintf("%s/calendars/%s/events/%s", calendarAPIBase, url.PathEscape(calendarID), url.PathEscape(eventID))
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, reqURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusGone {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("google calendar delete event failed: %s: %s", resp.Status, string(b))
	}
	return nil
}

// GCalendarListEntry is a calendar the connected account can see (own
// calendars plus any shared ones they've added), from calendarList.list.
type GCalendarListEntry struct {
	ID         string `json:"id"`
	Summary    string `json:"summary"`
	Primary    bool   `json:"primary"`
	AccessRole string `json:"accessRole"`
}

type gCalendarListResponse struct {
	Items         []GCalendarListEntry `json:"items"`
	NextPageToken string               `json:"nextPageToken"`
}

// ListCalendars returns every calendar the account can write events to
// (minAccessRole=writer — read-only shared calendars are excluded since the
// plugin needs to create/update/delete events).
func ListCalendars(ctx context.Context, client *http.Client) ([]GCalendarListEntry, error) {
	var all []GCalendarListEntry
	pageToken := ""
	for {
		q := url.Values{}
		q.Set("minAccessRole", "writer")
		if pageToken != "" {
			q.Set("pageToken", pageToken)
		}
		reqURL := calendarAPIBase + "/users/me/calendarList?" + q.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		var list gCalendarListResponse
		decodeErr := json.NewDecoder(resp.Body).Decode(&list)
		if resp.StatusCode >= 300 {
			resp.Body.Close()
			return nil, fmt.Errorf("google calendar list calendars failed: %s", resp.Status)
		}
		resp.Body.Close()
		if decodeErr != nil {
			return nil, decodeErr
		}
		all = append(all, list.Items...)
		if list.NextPageToken == "" {
			break
		}
		pageToken = list.NextPageToken
	}
	return all, nil
}

// GetPrimaryCalendarEmail returns the connected account's email address (the
// "primary" calendar's ID is always the account's email in the Calendar API).
func GetPrimaryCalendarEmail(ctx context.Context, client *http.Client) (string, error) {
	cals, err := ListCalendars(ctx, client)
	if err != nil {
		return "", err
	}
	for _, c := range cals {
		if c.Primary {
			return c.ID, nil
		}
	}
	return "", fmt.Errorf("no primary calendar found for this account")
}

// encodeURIComponent mirrors JavaScript's encodeURIComponent exactly
// (including percent-encoding "/"), so a path built here matches the hash
// route the frontend itself generates (App.tsx: `'#/' + encodeURIComponent(path)`).
// Go's url.QueryEscape is close but not identical (it encodes space as "+",
// not "%20", among other differences), so it can't be reused directly here.
func encodeURIComponent(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '!' || c == '~' || c == '*' || c == '\'' || c == '(' || c == ')' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// revokeToken best-effort revokes a refresh token with Google. Uses a plain
// client (not the user's token-refreshing one) since revocation identifies
// the token via the request body, not Bearer auth.
func revokeToken(ctx context.Context, token string) error {
	reqURL := "https://oauth2.googleapis.com/revoke?token=" + url.QueryEscape(token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}
