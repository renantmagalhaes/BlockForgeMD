# Plugins

BlockForgeMD ships with a small plugin store (**Settings → Plugins**) for connecting external tools, calendars, and AI providers directly into your workspace.

## ⚠️ Plugin configuration is shared across all users (for now)

There's currently no per-user isolation of plugin settings — every user on an instance hits the same plugin configuration endpoints. Concretely, for Google Calendar: the OAuth Client ID/Secret, the poll interval, and the workspace sync scope are one shared, instance-wide configuration, not per-user. If User 1 sets these up, that configuration is what every other user on the instance sees and is bound by too — there's no "my settings vs. their settings" separation.

What *is* per-user: each person connects their own individual Google account (their own OAuth tokens), and each person's connected calendar is independent of everyone else's.

Configure plugins with this in mind, especially on a shared/multi-user instance — changing the shared settings (e.g. narrowing which workspaces sync, or the poll interval) affects every connected user's sync, not just the person making the change.

## Available

- **[Google Calendar](google-calendar.md)** — 2-way sync between any page's due date and events on your Google Calendar.

## Coming soon

- **MCP Servers** — connect Model Context Protocol servers.
- **LLM Providers** — bring your own LLM provider.

Each plugin gets its own setup guide in this folder as it ships.
