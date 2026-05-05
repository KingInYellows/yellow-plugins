---
"yellow-semgrep": patch
---

Close the semgrep-mcp-migration plan after runtime tool-list verification
against the built-in `semgrep mcp` server (semgrep v1.154.0): drop
`semgrep_whoami` from the documented MCP tool surface (it is not exposed by
the built-in server) and rewrite the stale "whoami does not work with API
tokens" caveat in `CLAUDE.md` and `README.md` to point at REST `GET
/api/v1/me` as the authoritative token-validation path. Affects
`plugins/yellow-semgrep/{CLAUDE.md,README.md,commands/semgrep/setup.md}`.
Documentation-only — no behavior changes.
