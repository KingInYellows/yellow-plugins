---
'yellow-semgrep': minor
---

fix(yellow-semgrep): honor shell env as fallback for SEMGREP_APP_TOKEN

The previous `plugin.json` env block set `SEMGREP_APP_TOKEN` directly to
`${user_config.semgrep_app_token}`, which OVERWROTE any pre-existing shell
env `SEMGREP_APP_TOKEN` with an empty string when the user dismissed the
userConfig prompt. Power users on multi-host fleets who set the token in
`.zshrc` / direnv / a secrets manager were silently downgraded to a broken
MCP server.

This change introduces `bin/start-semgrep.sh` (mirroring the canonical
yellow-research/yellow-morph wrapper pattern) that resolves the token in
this precedence order:
1. userConfig value (preferred)
2. Shell env `SEMGREP_APP_TOKEN` (fallback)
3. Unset entirely (MCP sees "absent" not "empty string")

Also adds a SessionStart hook (`hooks/write-credential-status.sh`) emitting
`credential-status.json` per the protocol introduced in the previous
yellow-core PR. `/setup:all` will consume this to render an accurate
classification for yellow-semgrep without probing the keychain.
