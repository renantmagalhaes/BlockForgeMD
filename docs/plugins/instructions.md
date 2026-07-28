# Building a new plugin

This is the internal spec for adding a plugin to BlockForgeMD's Plugin Store
(**Settings → Plugins**). It's written from the Google Calendar plugin, the
first real one — follow its files as the reference implementation. This
document is for whoever (human or Claude) builds the next one; it captures the
requirements, hard constraints, and mistakes already made and fixed once so
they aren't repeated.

## Non-negotiable requirements

1. **Per-user, not instance-wide. No exceptions.** Every setting a plugin
   has — API keys/OAuth client credentials, poll intervals, scope toggles,
   feature flags, whatever — is stored per `user_id`, and one user's
   configuration must never affect another user's. This was a real migration
   done once already (flat shared `settings` keys → a `plugin_<name>_user_config`
   table keyed on `user_id`); don't reintroduce the shared pattern even for a
   single value that looks "obviously global." If something is genuinely
   instance-wide (e.g. the server's own public URL — `app_base_url`), it
   belongs in the existing shared `settings` table, not a plugin table, and
   you should be able to justify why it's a server property and not a plugin
   setting.
2. **Secrets are encrypted at rest, always.** Any client secret, API key,
   access/refresh token, or similarly sensitive value goes through
   `backend/internal/cryptoutil` (`cryptoutil.Encrypt(encKey, []byte(plain))` /
   `cryptoutil.Decrypt(encKey, blob)`, AES-256-GCM). Store the resulting
   `[]byte` in a `BLOB` column, never plaintext. The plugin's constructor
   receives `encKey` the same way `googlecalendar.New(database, s, encKey)`
   does — thread it through, don't invent a new key-management path.
3. **A plugin never blocks the server.** `OnFileChanged` runs in its own
   goroutine per plugin, already recovered from panics by the registry
   (`Registry.NotifyFileChanged`) — implementations still must not do anything
   that can hang indefinitely (unbounded retries, no timeout on outbound
   HTTP). `Start(ctx)` must return promptly; long-running work (polling
   loops, etc.) goes in a goroutine tied to `ctx` and must exit when `ctx` is
   cancelled. `Stop()` blocks until that goroutine has actually wound down —
   don't fire-and-forget.
4. **No dynamic/third-party code loading.** "Plugin" here means "a Go package
   under `backend/internal/plugins/<name>/` that implements the `Plugin`
   interface and is compiled into the binary," registered once in
   `server.go`. It is not an extension system for user-supplied code.
5. **Never sync/act on stale or ambiguous state.** If a precondition for
   doing the plugin's work isn't met (wrong scope, no matching user, missing
   auth), treat it identically to "there's nothing to do" — see the
   dueDate-blanking pattern below — rather than guessing or falling back to a
   default that touches the wrong user's data.

## Reference architecture (Google Calendar)

```
backend/internal/plugins/
  plugin.go                    — Plugin interface + Meta (the contract, shared)
  registry.go                  — Registry: lifecycle, fan-out, store-grid listing
  googlecalendar/
    plugin.go                  — struct, Start/Stop/OnFileChanged, per-user getters/setters
    oauth.go                   — OAuth config building, token exchange/refresh
    api.go                     — GetConfig/SetConfig/Status/Disconnect/SyncNow (called by HTTP handlers)
    sync.go                    — the actual sync logic (pushFile, syncAllAccounts)
    calendar_client.go         — thin REST client for the external API
    state.go                   — signed OAuth `state` param helpers

backend/internal/db/
  db.go                        — CREATE TABLE for plugin_<name>_user_config, migration
  plugins.go                   — Go structs + Get/Set accessors for that table

backend/internal/server/
  server.go                    — registry.Register(...) wiring, one line
  plugins_<name>.go            — thin HTTP handlers: parse request, resolve user, call api.go, encode response
  docs.go                      — /docs API reference entries for every new endpoint

frontend/src/components/
  PluginsSettings.tsx          — store grid card + a "<Name>Detail" component for the settings UI

docs/plugins/
  <name>.md                    — end-user setup guide (own OAuth app, redirect URI, etc.)
  README.md                    — one-line entry in the Available/Coming soon list
```

### `Plugin` interface (`backend/internal/plugins/plugin.go`)

Every real plugin implements exactly this:

```go
type Plugin interface {
    Meta() Meta
    Start(ctx context.Context) error
    Stop() error
    OnFileChanged(relPath string)
}
```

`Meta.Category` is a free-form string used only for frontend copy branching
(`"calendar" | "mcp" | "llm"` today — add a new one as needed, it's not an
enum enforced anywhere). `Meta.Status` is `"available"` for anything with a
real backing `Plugin`, `"coming_soon"` for a placeholder registered via
`RegisterComingSoon(Meta{...})` with no implementation at all — a legitimate
way to reserve a spot on the store grid before building the real thing.

If a plugin doesn't need a background loop or file-change reaction, `Start`/
`Stop`/`OnFileChanged` can be no-ops — the interface doesn't distinguish
"active sync plugin" from "on-demand only plugin."

### Per-user settings table pattern

One table per plugin, `PRIMARY KEY (user_id)`, `FOREIGN KEY (user_id)
REFERENCES users(id) ON DELETE CASCADE` so a deleted user's plugin config
disappears with them. Each settable field gets its own
`INSERT ... ON CONFLICT(user_id) DO UPDATE SET <col> = excluded.<col>` setter
(see `SetGCalClientID` etc. in `backend/internal/db/plugins.go`) so any single
setter can create the row on first use — don't require a separate "create the
row" step before setting individual fields.

Use a real typed zero-value to mean "not set, use default" rather than a
sentinel string: `0` for an unset interval (never itself valid — enforce a
floor in the setter), `''` for "no restriction" on a scope field, a real
`BOOLEAN` column for a confirmed/dismissed flag (SQLite scans it straight into
a Go `bool` here — no string-hack needed, see `tasks.completed`). For an
encrypted secret column, leave it nullable and do **not** `COALESCE` it in
reads — `nil` (never set) must stay distinguishable from "set, but the value
happens to be empty."

### Multi-account routing: assignee-matching pattern

Google Calendar routes each due-dated page to at most one connected account:
the one whose `users.username` case-insensitively matches the page's
`assignee` frontmatter field. This works safely with zero reassignment
bookkeeping because `users.username` has a `UNIQUE` constraint — at most one
account can ever match a given assignee string, so there's no ambiguity to
resolve. If a future plugin needs similar per-page/per-user routing, prefer
matching against an existing unique field over inventing new mapping tables.

The actual matching function treats "no match" as absolute — no fallback to
"sync to everyone" or "sync to whoever set it up first":

```go
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
```

And the general "not applicable" pattern used throughout `sync.go`'s
`pushFile`: fold every disqualifying condition into the same variable you'd
also blank for "nothing to sync," so cleanup code only has to exist once:

```go
if !p.workspaceAllowed(acct.UserID, relPath) {
    dueDate = ""
}
if dueDate != "" && !p.assigneeMatches(acct.UserID, assignee) {
    dueDate = ""
}
// downstream code just checks `dueDate == ""` for "remove/skip", uniformly
```

### Concurrency: keyed mutex per (user, resource)

Sync/write operations that can be triggered from two different paths (a poll
tick and an on-demand `OnFileChanged` call, for example) need a
`keyedMutex` — see `plugin.go`'s use around `pushFile` — keyed on something
like `userID + ":" + relPath`, so two concurrent triggers for the *same*
user+resource serialize, but different users/resources never block each
other. This was added as defense-in-depth after a real duplicate-event bug
(a file restore both went through the normal watcher-index broadcast path
*and* an explicit redundant broadcast call — the actual fix was removing the
double-fire, but the mutex closes the door on any future path that
re-introduces double-triggering).

### Polling loops: fixed floor ticker, per-account throttling inside

Don't spin up one goroutine/ticker per user for a per-user poll interval.
`Start()` runs a single ticker at a fixed floor cadence (`minPollIntervalSeconds
= 30`); each tick calls a `syncAllAccounts`-style function that loops every
connected account and decides *inside the loop* whether that account's own
configured interval has actually elapsed yet (`acct.LastSyncAt` vs.
`now.Sub(*acct.LastSyncAt) < interval`). A manual "sync now" action must call
the underlying per-account sync function directly, bypassing this throttle
entirely — a user-initiated action should never be rate-limited by the
background poll interval.

### OAuth specifics (if the next plugin also uses OAuth)

- Sign the OAuth `state` param (HMAC) binding the initiating user's ID —
  see `state.go`. The callback route is necessarily public/unauthenticated
  (Google redirects the browser there directly, no session cookie context to
  rely on), so `state` is the only thing recovering *which user* initiated
  the flow. Verify it before trusting anything in the callback.
- Detect and reject private-IP redirect hosts (`net.IP.IsPrivate()`, RFC1918)
  before building an authorize URL — Google (and likely most OAuth providers)
  will reject a private-IP redirect URI outright, and the resulting error
  from Google's side is opaque. Fail fast locally with a clear message
  instead.
- Detect provider-side "invalid/expired grant" errors specifically
  (`errors.As(err, &retrieveErr)` for `*oauth2.RetrieveError` style errors)
  and surface a clear, actionable message ("disconnect and reconnect") rather
  than a raw error passthrough — this was a real gap found and fixed.
- If the provider has a "testing/sandbox vs. production" publishing distinction
  that causes forced short-lived tokens in the unpublished state (Google's
  7-day forced expiry in "Testing" is the concrete example that bit this
  project), the in-app UI and setup docs must explicitly tell the user to
  publish to production — don't mention the sandbox/testing mode as an
  acceptable resting state, since it silently breaks after a week in a way
  that's hard to diagnose later.
- Any one-line "is this configured correctly" banner/warning in the settings
  UI should be genuinely one line with a link to the full docs, not several
  lines of inline explanation — settings panels here are narrow, and verbose
  inline warnings are exactly what caused the layout bug fixed just before
  this doc was written (see "Frontend layout" below).

### HTTP layer

- Routes live in `server.go`'s `setupRoutes()`, grouped under the
  `r.Use(s.requireAuth)` block alongside the other authenticated routes —
  session cookie or bearer API key, both work. The **one exception** is a
  public OAuth callback endpoint (nothing to authenticate against yet, the
  browser is mid-redirect) — register that one outside the `requireAuth`
  group and rely on the signed `state` param instead, same as
  `/api/plugins/google-calendar/oauth/callback`.
- Every authenticated handler must call `userFromCtx(r)` and use the
  resulting `user.ID` — this sounds obvious but was actually missed once
  (`handleGCalGetConfig`/`handleGCalSetConfig` sat behind `requireAuth` yet
  never read the authenticated user, silently defeating the whole per-user
  model until caught in review). Grep for `userFromCtx` in the new handler
  file and confirm it's actually there before considering the plugin done.
- Handlers themselves should be thin: decode request → resolve user →
  delegate to a function in the plugin's own `api.go` → encode response. Put
  logic in the plugin package, not the handler.
- Add every new endpoint to `docs.go`'s API reference (`CATS` array) — each
  entry needs a working `curl` field or the `/docs` page breaks entirely (a
  real regression fixed once: one missing `curl` field threw
  `ep.curl is not a function` and broke the whole page, not just that one
  endpoint's row).

### Frontend

- `PluginsSettings.tsx` fetches `/api/plugins` once, renders `status ===
  'available'` plugins as a clickable grid card and `'coming_soon'` ones as a
  disabled placeholder card. A new plugin needs: a new `view` union member
  (currently `'grid' | 'google-calendar'`), a grid card entry gated on
  `plugins.find(p => p.id === '<your-id>')`, and its own
  `<YourPlugin>Detail` component following the `GoogleCalendarDetail` shape
  (its own local state, fetch its own config/status endpoints, render its own
  settings form).
- Copy in the detail view must say the settings are personal to the signed-in
  user (mirror the existing "just for your account — nothing here is shared
  with other users on this instance" framing) — don't let old
  "shared/instance-wide" language leak into a new plugin's copy.
- **Frontend layout constraint, learned the hard way**: the Settings modal's
  content pane (in `App.tsx`) and its wrapper have `overflow-hidden` with no
  horizontal scroll fallback. Any flex child in that tree that gets
  `whitespace-nowrap` + `shrink-0` (e.g. a "Setup guide" link) is asserting a
  minimum width — if any ancestor in the chain is missing `min-w-0`, that
  assertion propagates all the way up and silently clips content with no
  visual indication anything is wrong (no scrollbar, no overflow marker).
  When adding a new plugin's settings UI:
  - Give every flex row that mixes a shrinkable text element with a
    fixed-width icon/button/badge a `min-w-0` on the text side and
    `shrink-0` on the fixed side.
  - Prefer `truncate` (with a `title` attribute for the full value) or
    `break-words` over `whitespace-nowrap` for anything that isn't
    guaranteed short.
  - If something still won't fit, verify the fix with real DOM measurement,
    not just eyeballing — `getComputedStyle`/`scrollWidth` vs `clientWidth`
    at 900px viewport width was what actually found the last bug, after
    several rounds of component-local CSS changes did nothing because the
    real culprit was a shared ancestor.

### Docs

- `docs/plugins/<name>.md`: setup steps (creating a developer account/API
  key/OAuth client on the external provider's side, any redirect URI to
  register, production/publishing guidance if applicable), then a "How sync
  works" (or equivalent) section covering exactly what triggers the plugin's
  behavior and any per-user routing rules.
- `docs/plugins/README.md`: one bullet under **Available**, linking to the
  new file. Keep the "fully per-user" framing at the top of that file
  accurate — don't reintroduce "shared across all users" language for a new
  plugin unless it is genuinely, deliberately instance-wide (and if so, be
  explicit about why it's different from every other plugin).

## Checklist for a new plugin

- [ ] `backend/internal/plugins/<name>/` package implementing `Plugin`
- [ ] Per-user settings table + typed accessors in `backend/internal/db/`
- [ ] Secrets go through `cryptoutil`, stored as `BLOB`, never plaintext
- [ ] `Start`/`Stop` respect `ctx` cancellation; no per-user goroutines for polling
- [ ] `registry.Register(...)` wired in `server.go`
- [ ] Thin HTTP handlers in `backend/internal/server/plugins_<name>.go`, every one calling `userFromCtx(r)`
- [ ] New endpoints added to `docs.go`'s `CATS` array with a working `curl` field
- [ ] Grid card + detail view added to `PluginsSettings.tsx`, following the `min-w-0`/`shrink-0`/`truncate` layout rules above
- [ ] `docs/plugins/<name>.md` written; `docs/plugins/README.md` updated
- [ ] `go build ./... && go vet ./... && go test ./...` clean in `backend/`
- [ ] `npx tsc -b` clean in `frontend/`
- [ ] Manually verified in-browser at both a wide and a narrow (~900px) viewport
