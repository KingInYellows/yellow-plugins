---
'yellow-core': minor
---

feat(yellow-core): credential-status protocol foundation

Adds the credential-status JSON protocol that lets `/setup:all` classify
plugins as READY/PARTIAL/NEEDS SETUP without probing the system keychain.

- `plugins/yellow-core/lib/credential-status.sh` — reusable Bash helper
  exposing `write_credential_status(plugin, version, fields_json)`. Source
  from any SessionStart hook in a credential-bearing plugin.
- `docs/plugin-credential-status-protocol.md` — schema spec, lifecycle,
  reader/writer contracts, and known Claude Code bugs (#41156 protected-dir
  prompt, #51398 Cowork Desktop session-scoped data dir).
- `AGENTS.md` — new authoring rules for credential-bearing MCP servers
  covering the 3-element fallback pattern and the status-file protocol.

This is the foundation PR for the plugin-install-resilience stack. Subsequent
PRs (yellow-semgrep, yellow-composio, yellow-research, /setup:all dashboard)
consume this helper to emit/read status files.
