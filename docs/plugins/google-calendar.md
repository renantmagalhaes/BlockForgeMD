# Google Calendar plugin

Two-way sync between any page's `dueDate` (task, note, or document — anything with a due date) and events on your Google Calendar. Sync runs automatically on a poll interval and can also be triggered on demand from **Settings → Plugins → Google Calendar**.

**Everything about this plugin is per-user — there is no shared/instance-wide configuration.** Each BlockForgeMD user creates their own Google Cloud project and OAuth Client (Client ID + Secret), sets their own poll interval and workspace scope, and connects their own Google account, all in **Settings → Plugins → Google Calendar**. Nothing you configure here affects any other user on this instance; see [docs/plugins/README.md](README.md).

> ## ⚠️ Requirement: BlockForgeMD must be reachable at a real hostname, not a private IP
>
> **This plugin cannot work if you access BlockForgeMD at a private/LAN IP address** — e.g. `http://10.0.10.10:8080`, `http://192.168.1.50:8080`, or `http://172.16.x.x:8080` (any RFC1918 range). Google's OAuth rejects private IP addresses as redirect URIs outright, failing with a confusing `Error 400: invalid_request` / *"device_id and device_name are required for private IP"* message that has nothing to do with BlockForgeMD itself — it's Google refusing the request before it ever reaches this app.
>
> **Fix:** access the app via a hostname instead of the raw IP:
>
> - **Simplest** — add an entry to your `/etc/hosts` file (or `C:\Windows\System32\drivers\etc\hosts` on Windows) on whatever machine your browser runs on: `10.0.10.10  blockforge.local`, then always browse to `http://blockforge.local:8080` instead of the IP.
> - **Or** put a real reverse proxy / domain name in front of the instance (recommended for anything beyond solo local testing anyway).
> - **Or**, if you're SSH'd into the server, tunnel `ssh -L 8080:localhost:8080 user@host` and use `http://localhost:8080` — Google does allow plain `localhost`.
>
> Whichever hostname you settle on, **register that same hostname's redirect URI in Google Cloud Console** (step 4 below) and always access the app through it going forward — mixing IP and hostname access breaks the OAuth redirect match.
>
> The app itself now detects this and shows a warning banner directly in Settings → Plugins → Google Calendar, and refuses the "Connect" click with a clear error instead of sending you into Google's confusing one — but there's no way to make Google accept a private IP, so a hostname is the only real fix.

## 1. Create a Google Cloud project

Go to [console.cloud.google.com](https://console.cloud.google.com) and either pick an existing project or create a new one (top-left project dropdown → **New Project**). Any free-tier project works — no billing required.

## 2. Enable the Google Calendar API

In the left sidebar: **APIs & Services → Library**, search "Google Calendar API", click it, then click **Enable**.

## 3. Configure the consent screen ("Google Auth Platform") — and publish it right away

Google's console now calls this **Google Auth Platform** rather than a single "OAuth consent screen" page. If you land on a page that says "Google Auth Platform not configured yet", click **Get started** and work through the wizard:

- **App information** — app name (e.g. "BlockForgeMD"), and a user support email (pick your own address).
- **Audience** — choose **External** (unless you have a Google Workspace org and want **Internal**, which skips the verification warning entirely).
- **Contact information** — your email again (developer contact).
- **Finish** — check the box agreeing to the Google API Services User Data Policy, then **Continue** / **Create**.

This lands you on the Google Auth Platform dashboard, with tabs for **Overview, Branding, Audience, Clients, Data Access, Verification Center**. Before doing anything else:

**Go to the Audience tab and click "Publish app"**, switching the publishing status from **Testing** to **Production**. Do this now, not as an afterthought — while an app sits in Testing, Google expires every connected user's refresh token after 7 days, forcing a full disconnect/reconnect weekly. Publishing to Production removes that expiry entirely and doesn't require completing Google's verification process for a small personal/self-hosted setup — it only means the consent screen isn't capped to a test-user allowlist anymore. There's no reason to leave this in Testing for a real setup.

Scopes don't need to be added here; the app requests `calendar.events` (read/write events) and `calendar.calendarlist.readonly` (looks up your account's email and which calendars you have, for the calendar picker) directly when connecting — you'll see both listed on the consent screen.

## 4. Create the OAuth Client ID

From the Google Auth Platform dashboard, go to the **Clients** tab → **Create client** (this is the same thing older docs call **APIs & Services → Credentials → Create Credentials → OAuth client ID**):

- Application type: **Web application**.
- Name: anything (e.g. "BlockForgeMD").
- **Authorized redirect URIs**: paste the exact URI shown in your app at **Settings → Plugins → Google Calendar** (the box with the copy icon, next to the Client ID field). It must match byte-for-byte, including `http` vs `https` — if you're behind a reverse proxy, make sure that box shows your public-facing URL, not `localhost`.
- Click **Create** — Google shows the **Client ID** and **Client Secret** right away (and you can find them again any time under the **Clients** tab).

## 5. Paste them into BlockForgeMD

Copy both into **Settings → Plugins → Google Calendar → Google OAuth credentials**, click **Save settings**, then click **Connect Google Calendar**. Every person who wants sync repeats steps 1-5 for their own Google Cloud project and their own Client ID/Secret — there's nothing shared to reuse from someone else's setup.

## The "unverified app" warning

Since the app is unverified by default, Google shows an interstitial to anyone connecting. Click **Advanced → Go to [app name] (unsafe)** — this is expected and fine for a self-hosted personal or small-team instance. Verification is only worth pursuing if you're publishing this for the general public. This is separate from the Production publishing status set in step 3 — you'll see this warning either way, since it's tied to verification, not publishing status.

With the app published (step 3) and a connection established, it's effectively permanent: no forced expiry, no need to ever reconnect for its own sake. The only things that can still end a connection are ones fully in your control or genuinely rare — you manually revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), the token goes fully unused for 6 months, or you disconnect/reconnect enough times to hit Google's ~50-refresh-tokens-per-user-per-client cap. If a refresh token ever does become invalid for any reason, **Settings → Plugins → Google Calendar** shows a clear "disconnect and reconnect this account" message rather than a raw error.

## How sync works

- Any page (task, note, document) with a `dueDate` frontmatter field syncs automatically — no per-page opt-in needed.
- If the due date has a time of day set (not just a date), the calendar event is created at that exact time, using the timezone your browser was in when you set it. Date-only due dates sync as all-day events.
- Changes made **in BlockForgeMD** push out to Google immediately (within a second or two) — this direction isn't polling-based.
- Changes made **directly in Google Calendar** (editing an event's time, deleting it) are only picked up on the next background poll, since a self-hosted instance has no guaranteed public HTTPS endpoint for Google to push changes to. The poll interval defaults to 2 minutes and is adjustable in **Settings → Plugins → Google Calendar → "Check for changes every ___ minutes"** (minimum 30 seconds) — or trigger one immediately with **Sync now**. A changed interval takes effect from the next check onward, no restart needed.
- Deleting a page's due date (or the page itself — including moving it to Trash) removes the corresponding calendar event. Deleting the event in Google Calendar clears the page's due date, without deleting the page. Restoring a page from Trash recreates its calendar event if it still has a due date.
- **Disconnecting** deletes every event that connection created before revoking access — it doesn't just make BlockForgeMD forget about them. If you disconnect and reconnect without this cleanup (e.g. on an older version), previously-synced events are left behind untracked, and reconnecting will push fresh duplicates of anything still due-dated.
- **A page only syncs to its assignee.** A due-dated page's `assignee` frontmatter field is matched (case-insensitively) against connected users' usernames — only the one matching account gets the event; everyone else's calendar is unaffected. If `assignee` doesn't match any real username (a typo, a client's name, left blank), the page doesn't sync to anyone. Reassigning a page moves the event: the old assignee's copy is removed and the new assignee's is created on the next sync.
- **New pages get an owner automatically.** Whenever you create a page with no `assignee` already set, it's automatically assigned to you (the creator) — so a fresh task/document with a due date routes to your own calendar immediately, with nothing to configure. This only applies going forward; pages created before this existed keep whatever `assignee` they already have (often blank) until set manually.

## Choosing which calendar to sync to

By default, events sync to your Google account's primary calendar. To use a different one (e.g. a dedicated "BlockForgeMD" calendar), open **Settings → Plugins → Google Calendar** and pick from the **Sync to calendar** dropdown — it lists every calendar your account can write to. Switching calendars deletes previously synced events from the old calendar and recreates them on the newly selected one on the next sync pass, so nothing is left duplicated.

## Completed Kanban cards

In **Settings → Plugins → Google Calendar**, choose what happens when a card enters a board column marked **Completed**:

- **Keep its event** leaves the event on the normal sync calendar (the default).
- **Remove its event** deletes the event but deliberately keeps the card's `dueDate`. The plugin records that choice so normal two-way sync does not recreate the event or clear the card's due date.
- **Move its event** copies the event to a calendar you select for completed items, then removes it from the normal sync calendar. The card's due date is retained.

Reopening a completed card removes a moved event from the completed-items calendar, then resumes normal sync to the main calendar. The setting applies to Kanban columns marked Completed, not to pages with a manually entered status alone.

## Choosing which workspaces sync

By default, **all workspaces** in the vault sync — this is the default for backward compatibility, so nothing changes until you touch this setting. To restrict sync to specific workspaces, open **Settings → Plugins → Google Calendar**, uncheck **All workspaces**, and pick individual ones from the list.

This is **entirely your own setting** — it only affects your own sync; other users' workspace scope is independent. Narrowing it best-effort deletes your own already-synced events for pages that fall outside the new selection; newly-included workspaces aren't pushed immediately — they pick up on your next sync check, or via **Sync now**.
