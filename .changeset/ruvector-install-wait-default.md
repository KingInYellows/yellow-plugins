---
'yellow-ruvector': patch
---

Lower the `RUVECTOR_INSTALL_WAIT` default from 25 s to 20 s so the launcher's
wait stays under Claude Code's measured ~26 s MCP startup timeout, and make the
timeout hint name both `MCP_TIMEOUT` and `RUVECTOR_INSTALL_WAIT`.
