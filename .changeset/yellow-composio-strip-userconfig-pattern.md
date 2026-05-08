---
"yellow-composio": patch
---

Strip non-standard `userConfig.composio_mcp_url.pattern` field; Claude Code's
remote validator rejects it as `Unrecognized key: "pattern"`, blocking install.
The schema-level `^https://` regex enforcement that landed in PR #409 was an
unsupported extension to the official `userConfig` schema (which only allows
`type, title, description, sensitive, required, default, multiple, min, max`).

Replacement defenses (advisory only — MCP server attaches before any of these
fire, matching pre-PR409 baseline):

- New `hooks/check-mcp-url.sh` SessionStart hook prints a warning if the
  configured `composio_mcp_url` does not start with `https://`.
- Updated `composio_mcp_url.description` and `composio-patterns` SKILL
  Security section to explicitly state HTTPS-only requirement and that
  format validation is not schema-enforced.
- Updated `composio_api_key.description` to note that key format is not
  validated; invalid keys produce a 401 at runtime.
