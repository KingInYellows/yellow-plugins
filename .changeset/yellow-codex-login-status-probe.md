---
"yellow-codex": patch
---

# Fix auth detection for Codex CLI v0.118+ across `/codex:setup` and `/codex:status`

Replace the `~/.codex/auth.json` file-existence check in
`/codex:setup` Step 2 and `/codex:status` Step 4 with a
`codex login status` probe. The Rust-based CLI (v0.118+) stores
OAuth state in the OS keyring (libsecret on Linux, Keychain on
macOS, Credential Manager on Windows) rather than `auth.json`, so
the old check reported "not configured" for every authenticated
user on a current CLI.

`codex login status` is the canonical, version-stable probe — it
reads from wherever the installed CLI persists credentials and
returns a string like `Logged in using ChatGPT` or `Not logged in`.
The grep match is anchored to `^logged in` so the negative case
`Not logged in` is not silently classified as authenticated. Both
commands fall through to a "legacy auth.json found" note when the
file still exists (for users on pre-v0.118 CLIs) and to "not
configured" otherwise.

Companion doc updates:

- `plugins/yellow-codex/skills/codex-patterns/SKILL.md` —
  Authentication Methods table updated: ChatGPT OAuth row points
  to OS keyring with `codex login status` as the state probe;
  legacy `auth.json` retained as a separate row for pre-v0.118.
  Prose corrected to scope `codex login status` to OAuth/keyring
  state; API key auth is checked via `[ -n "$OPENAI_API_KEY" ]`.
- `plugins/yellow-codex/CLAUDE.md` — Required Environment section
  rewritten to describe the keyring-based storage and the
  `codex login status` probe.

No agent or command behavior changes — `codex exec` invocations
are unaffected (they read auth from wherever the CLI resolves it).
