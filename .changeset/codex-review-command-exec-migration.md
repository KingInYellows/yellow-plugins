---
"yellow-codex": patch
---

Migrate `/codex:review` off the broken `codex exec review` invocation onto
the canonical plain `codex exec` + strict-mode `--output-schema` pattern
that `codex-reviewer.md` and `codex-patterns/SKILL.md` established in
#697: pre-written diff file named in the prompt, fail-closed empty-diff
and schema-missing guards, anti-injection diff framing, `</dev/null`
stdin handling, and out-of-range priority diagnostics. Closes the last
`exec review` invocation site in the plugin (its `--output-schema` was
silently ignored on every model, so the "may be structured JSON" parsing
branch was dead text). Also re-widens the CLAUDE.md convention bullet to
cover both review surfaces now that both conform.
