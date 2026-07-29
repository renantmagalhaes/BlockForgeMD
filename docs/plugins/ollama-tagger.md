# Ollama Auto Tags

Ollama Auto Tags uses a model you run yourself to add contextual `tags` frontmatter to Markdown pages.

## Privacy-first provider support

This plugin supports **Ollama only**. It is intentionally focused on private, self-hosted AI tools: document content is sent only to the Ollama server you configure, never to a hosted LLM provider through this plugin.

## Setup

1. Run an Ollama server that the BlockForgeMD server can reach, then pull a capable instruct model.
2. In **Settings → Plugins → Ollama Auto Tags**, enter its endpoint (for example `http://10.0.10.11:11434`) and model name.
3. Choose the maximum number of tags the plugin can own per document. Existing tags are retained.
4. Optionally limit processing to selected workspaces; leaving this disabled is the default and covers all workspaces.
5. Optionally enable scheduled processing and rechecks after a page changes.

Settings, including the endpoint, are personal to each BlockForgeMD user. The endpoint is encrypted at rest. No document content is sent to a third-party service; it is sent only to the Ollama endpoint configured by that user.

## How it works

Before classifying, the plugin builds a vocabulary from tags already used in the page's workspace. Ollama is instructed to reuse those exact tags whenever they fit and create a new tag only for a concept the workspace does not already describe. This keeps related pages cohesive without mixing terminology from unrelated workspaces. It records which tags it created per user and removes/replaces only those tags on a later pass, preserving manually-added tags. Requests have a 45-second timeout and scheduled work is throttled per user.

Use **Auto tags** in an open Markdown document to tag it immediately, without enabling the schedule. The workspace scope applies to this manual action too.
