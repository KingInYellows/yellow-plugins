---
"yellow-codex": patch
---

fix: codex-cli 0.140.0 rejects `-a`/`-s` on `exec review` (and `-a` on plain
`exec`) at argument parse, silently emptying every Codex review leg. All
invocation sites now set posture via `-c` config overrides
(`approval_policy="never"`, `sandbox_mode="read-only"` on review), verified
end-to-end on 0.140.0 and proven to override a permissive
`~/.codex/config.toml`. Adds `-c 'mcp_servers={}'` to `exec review`
invocations (MCP OAuth-stall mitigation), distinguishes exit-2 argument-parse
errors from authentication failures in every error handler, and bumps the
documented CLI floor to v0.140.0.
