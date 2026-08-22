---
'yellow-devin': major
---

yellow-devin is now a legacy provider: catalog lifecycle marks it
legacy/manual-install/security-fixes-only with yellow-cursor as its named
replacement, and the bundled public DeepWiki MCP server moves to yellow-research
(canonical home). `/devin:wiki` remains as a compatibility shim that discovers
the yellow-research DeepWiki server (falling back to older bundled installs) and
points users at yellow-research when neither is present. All Devin session
commands keep working unchanged; existing users can keep delegating through
Devin by enabling yellow-devin and selecting it as the remote-agent provider (or
passing `--provider devin` to `/linear:delegate`).
