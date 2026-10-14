---
"yellow-browser-test": patch
"yellow-ci": patch
"yellow-codex": patch
"yellow-core": patch
"yellow-docs": patch
"yellow-linear": patch
"yellow-research": patch
"yellow-ruvector": patch
"yellow-semgrep": patch
---

Pin explicit models and effort levels on agents that used to inherit the lead
session's model, so MCP wrappers and lookups run on Haiku 5.5 and diagnosis,
fix, browser-test and Codex wrapper agents run on Sonnet instead of Opus or
Fable. Restore `effort: high` on the three yellow-core Opus reviewers (Opus
5.5 defaults to medium) and give `scan-verifier` an explicit `effort: medium`.
Run the SessionStart compound drain on Haiku (override with
`COMPOUND_DRAIN_MODEL`; an invalid value falls back to Haiku with a warning),
and record the drain's `claude -p` exit status in its log, with a warning
when the drain took none of the entries it was handed.
