---
'yellow-ruvector': patch
---

Lower the `RUVECTOR_INSTALL_WAIT` default from 25 s to 20 s. Claude Code's MCP
startup timeout with `MCP_TIMEOUT` unset measured about 26 s from server spawn,
which left no room for the exec and handshake after a 25 s budget. The README
and plugin `CLAUDE.md` record the measurement and the `MCP_TIMEOUT` guidance.
