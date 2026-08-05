# AI Auto Tags

AI Auto Tags uses Ollama or OpenRouter models to add contextual `tags` frontmatter to Markdown pages.

## Providers and privacy

- **Ollama** sends document content only to the self-hosted Ollama endpoint you configure.
- **OpenRouter** sends document content to OpenRouter and the model provider it routes your request to. Review OpenRouter's privacy and data policies before using it with sensitive documents.

Provider settings are personal to each BlockForgeMD user. Ollama endpoints and OpenRouter API keys are encrypted at rest.

## Setup

1. In **Settings → Plugins → AI Auto Tags**, choose **Ollama** or **OpenRouter**.
2. For Ollama, enter an endpoint reachable from BlockForgeMD (for example `http://10.0.10.11:11434`). For OpenRouter, enter an API key.
3. Select **Fetch models**, then search for and select a model. You can also enter a model ID manually.
4. Choose the maximum number of tags the plugin can own per document. Existing tags are retained.
5. Optionally limit processing to selected workspaces; leaving this disabled is the default and covers all workspaces.
6. Optionally enable scheduled processing and rechecks after a page changes.

## How it works

Before classifying, the plugin builds a vocabulary from tags already used in the page's workspace. The selected AI model is instructed to reuse those exact tags whenever they fit and create a new tag only for a concept the workspace does not already describe. This keeps related pages cohesive without mixing terminology from unrelated workspaces. It records which tags it created per user and removes/replaces only those tags on a later pass, preserving manually-added tags. Requests have a two-minute timeout and scheduled work is throttled per user.

Use **Auto tags** in an open Markdown document to tag it immediately, without enabling the schedule. The workspace scope applies to this manual action too.
