---
'yellow-codex': patch
---

`README.md` gains a "Model Selection" section: no `-m` by default,
resolution is `CODEX_MODEL` → `~/.codex/config.toml` `model` → account
default, `CODEX_SMOKE_MODEL` affects `/codex:setup` only, and what the
`Codex rejected model <name>` (HTTP 400) message means. `/codex:review` now
redacts its diagnostics before applying the byte cap — the API error message
is extracted uncapped and the 500-byte `head -c` runs after the redaction
awk (matching `/codex:rescue` and `/codex:setup`), so a credential that
straddled the old 400-byte cut can no longer surface as an unredacted
fragment. The plugin's first bats suite, `tests/redaction.bats`, pins that
order by extracting the awk program from `review.md` at run time.
