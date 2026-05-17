---
'yellow-research': patch
'yellow-semgrep': patch
'yellow-core': patch
---

refactor: dedup yellow-research MCP wrappers and credential-status hook scaffold

Consolidates two families of copy-pasted shell (debt findings 011/012/013
and 024/025).

- **011/012/013** — the three `yellow-research/bin/start-{exa,perplexity,
  tavily}.sh` MCP wrappers carried a byte-identical userConfig→env
  resolution block. Extracted to `bin/lib/resolve-mcp-key.sh`
  (`resolve_mcp_key VAR`); each wrapper is now ~4 lines plus its distinct
  `npx` invocation. New `tests/resolve-mcp-key.bats` (5 tests).
- **024/025** — `yellow-research` and `yellow-semgrep`'s
  `hooks/write-credential-status.sh` shared a ~40-line scaffold (version
  read, field classification, status write, `{"continue": true}` exit).
  Extracted to `credential_hook_scaffold` in
  `yellow-core/lib/credential-status.sh`; both hooks are now down to a
  source-guard plus the plugin-specific field-spec list. New
  `credential_hook_scaffold` tests in `credential-status.bats` (4 tests).

Both hooks still emit `{"continue": true}` on every path. Gates:
`validate:plugins`, Bats (resolver 5, credential-status 16), shellcheck —
all green.
