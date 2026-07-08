---
"yellow-composio": patch
---

Align `/composio:setup`, `/composio:status`, and the plugin docs with the
v2.x `command`-type stdio wrapper architecture:

- `/composio:setup` now checks for `node` 18+ (the bundled wrapper runs
  `node bin/composio-proxy.mjs`, whose proxy calls the global `fetch()` API
  that needs Node 18+) — a present-but-too-old node is reported distinctly
  from `ok` so it routes to "upgrade Node," not "restart." When no Composio
  tools are visible, it reads the plugin's own `credential-status.json` to
  give priority-ordered remediation (install/upgrade node → configure
  credentials → restart), including an explicit "status unknown" case when
  the file is unparseable or `jq` is unavailable. The `jq` reads are
  null-safe (`.credentials[]?` / `// []`). Health states use the
  `mcp-health-probe` vocabulary (OFFLINE / DEGRADED / HEALTHY).
- `/composio:status` reports `PRESENT (untested)` / `OFFLINE` per the same
  vocabulary and adds a jq install hint to its hard-exit message.
- Docs: README/CLAUDE.md corrected from the retired `type: http` description
  to the stdio wrapper (with the Node.js requirement); the contradictory
  `required: true` migration sentence fixed.

No behavior change to the wrapper, proxy, or SessionStart hook.
