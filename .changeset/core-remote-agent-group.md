---
'yellow-core': minor
---

yellow-core adds the `remote-agent` capability provider group: a new
dependency-free resolver (`lib/remote-agent-provider-state.js`) classifies the
Cursor/Devin remote-agent providers into
READY_CURSOR/READY_DEVIN/UNSELECTED/CONFLICT/PARTIAL_TOOLING/CONFIG_INVALID with
Cursor as the preferred recommendation (never auto-selected), and `/setup:all`
gains yellow-cursor coverage plus the remote-agent group section.
