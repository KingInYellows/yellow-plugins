---
'yellow-ruvector': major
---

**Breaking:** requires Node.js 20+; the global `ruvector` binary is no longer
used, `scripts/install.sh` is removed, and the UserPromptSubmit and Stop hooks
are removed.

Upgrade to ruvector 0.3.3 as a plugin-managed install. The plugin now pins
ruvector in its own `package.json` + committed `package-lock.json` and installs
it into the plugin data dir (`$CLAUDE_PLUGIN_DATA`, or
`${XDG_DATA_HOME:-~/.local/share}/yellow-ruvector`): one `install-<lockhash>`
dir per lockfile plus an atomic `current` symlink, via `npm ci --ignore-scripts`
under `env -i`. The MCP server and every hook run that one copy, so a global
`npm install -g ruvector` is no longer needed or used, and the CLI can no longer
skew from the MCP pin. 0.3.3 fixes the non-atomic store write race
(RuVector#995).

The MCP server now starts through `bin/start-ruvector.sh`, which installs if
needed (waiting for a running prewarm), heals a linked worktree's `.ruvector`
symlink, and starts the server from the git toplevel — sessions launched from a
subdirectory or a fresh worktree use the project store in the same session. When
a fresh store has no embedding stamp and the ONNX model cannot be downloaded
(offline), the server starts without `hooks_remember` so its hash fallback
cannot stamp the store hash/64d (ADR-210).

Session recall is now one semantic `hooks recall` at SessionStart (6s hook
budget) instead of hash-embedded recall that compared 64d queries against 384d
vectors; the per-prompt UserPromptSubmit hook is removed. A new SessionStart
prewarm hook installs ruvector and downloads the model in the background.
`/ruvector:setup`, `/ruvector:status` (install, nested-store, read-only-mode,
and leftover-global-hook checks), and `/ruvector:seed-solutions` use the
plugin-managed CLI through the new `scripts/ruvector-cli.sh`;
`scripts/install.sh` is removed. Requires Node.js 20+.

The `Stop` hook is removed: `hooks session-end` only exported metrics, yet it
rewrote the whole store every turn and raced the MCP server's saves, and with
the plugin-managed CLI it would now run for every user.
