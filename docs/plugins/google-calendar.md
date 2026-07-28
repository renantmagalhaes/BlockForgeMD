# Google Calendar plugin

Two-way sync between any page's `dueDate` (task, note, or document — anything with a due date) and events on your Google Calendar. Sync runs automatically on a poll interval and can also be triggered on demand from **Settings → Plugins → Google Calendar**.

Each BlockForgeMD user connects their own Google account. To enable the plugin at all, you first need to create a Google OAuth Client (Client ID + Secret) and paste it into **Settings → Plugins → Google Calendar** — this is a one-time, instance-wide setup step.

## 1. Create a Google Cloud project

Go to [console.cloud.google.com](https://console.cloud.google.com) and either pick an existing project or create a new one (top-left project dropdown → **New Project**). Any free-tier project works — no billing required.

## 2. Enable the Google Calendar API

In the left sidebar: **APIs & Services → Library**, search "Google Calendar API", click it, then click **Enable**.

## 3. Configure the consent screen ("Google Auth Platform")

Google's console now calls this **Google Auth Platform** rather than a single "OAuth consent screen" page. If you land on a page that says "Google Auth Platform not configured yet", click **Get started** and work through the wizard:

- **App information** — app name (e.g. "BlockForgeMD"), and a user support email (pick your own address).
- **Audience** — choose **External** (unless you have a Google Workspace org and want **Internal**, which skips the verification warning entirely).
- **Contact information** — your email again (developer contact).
- **Finish** — check the box agreeing to the Google API Services User Data Policy, then **Continue** / **Create**.

This lands you on the Google Auth Platform dashboard, with tabs for **Overview, Branding, Audience, Clients, Data Access, Verification Center**. Two things to do from there:

- **Add test users**: **Audience** tab → **Test users** → **Add users** → add every Google account that will connect to BlockForgeMD. While the app is unverified (the default), **only accounts listed as test users can complete the consent screen** — this is the most common thing people miss.
- Scopes don't need to be added here; the app requests `calendar.events` (read/write events) and `calendar.calendarlist.readonly` (looks up your account's email and which calendars you have, for the calendar picker) directly when connecting — you'll see both listed on the consent screen.

## 4. Create the OAuth Client ID

From the Google Auth Platform dashboard, go to the **Clients** tab → **Create client** (this is the same thing older docs call **APIs & Services → Credentials → Create Credentials → OAuth client ID**):

- Application type: **Web application**.
- Name: anything (e.g. "BlockForgeMD").
- **Authorized redirect URIs**: paste the exact URI shown in your app at **Settings → Plugins → Google Calendar** (the box with the copy icon, next to the Client ID field). It must match byte-for-byte, including `http` vs `https` — if you're behind a reverse proxy, make sure that box shows your public-facing URL, not `localhost`.
- Click **Create** — Google shows the **Client ID** and **Client Secret** right away (and you can find them again any time under the **Clients** tab).

## 5. Paste them into BlockForgeMD

Copy both into **Settings → Plugins → Google Calendar → Google OAuth credentials**, click **Save credentials**, then click **Connect Google Calendar** (per user — each person who wants sync connects their own Google account with this same shared Client ID/Secret).

## The "unverified app" warning

Since the app is unverified by default, Google shows an interstitial to anyone connecting. Click **Advanced → Go to [app name] (unsafe)** — this is expected and fine for a self-hosted personal or small-team instance. Verification is only worth pursuing if you're publishing this for the general public.

## How sync works

- Any page (task, note, document) with a `dueDate` frontmatter field syncs automatically — no per-page opt-in needed.
- If the due date has a time of day set (not just a date), the calendar event is created at that exact time, using the timezone your browser was in when you set it. Date-only due dates sync as all-day events.
- Sync is polling-based (not push webhooks), since a self-hosted instance has no guaranteed public HTTPS endpoint for Google to call back to.
- Editing the due date on either side (BlockForgeMD or Google Calendar) propagates to the other on the next sync pass, or immediately via **Sync now**.
- Deleting a page's due date (or the page itself) removes the corresponding calendar event. Deleting the event in Google Calendar clears the page's due date, without deleting the page.
- If multiple users connect their own Google account, the same due-dated page currently syncs to each of their calendars independently (no per-page ownership/assignee filtering yet).

## Choosing which calendar to sync to

By default, events sync to your Google account's primary calendar. To use a different one (e.g. a dedicated "BlockForgeMD" calendar), open **Settings → Plugins → Google Calendar** and pick from the **Sync to calendar** dropdown — it lists every calendar your account can write to. Switching calendars deletes previously synced events from the old calendar and recreates them on the newly selected one on the next sync pass, so nothing is left duplicated.
