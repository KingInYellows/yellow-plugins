---
"yellow-composio": patch
---

Align `/composio:setup`, `/composio:status`, and the plugin docs with the
v2.x `command`-type stdio wrapper architecture:

- `/composio:setup` now checks for `node` (the bundled wrapper runs
  `node bin/composio-proxy.mjs`) and, when no Composio tools are visible,
  reads the plugin's own `credential-status.json` to give priority-ordered
  remediation (install node → configure credentials → restart) instead of a
  one-size-fits-all disable/enable hint. Health states now use the
  `mcp-health-probe` vocabulary (OFFLINE / DEGRADED / HEALTHY).
- `/composio:status` reports `PRESENT (untested)` / `OFFLINE` per the same
  vocabulary and adds a jq install hint to its hard-exit message.
- Docs: README/CLAUDE.md corrected from the retired `type: http` description
  to the stdio wrapper (with the Node.js requirement); the contradictory
  `required: true` migration sentence fixed.

No behavior change to the wrapper, proxy, or SessionStart hook.
