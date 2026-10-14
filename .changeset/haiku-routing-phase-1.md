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
session's model, so tool wrappers and lookups run on Haiku 5.5 and diagnosis
or fix agents run on Sonnet instead of Opus or Fable. Restore `effort: high`
on the three yellow-core Opus reviewers (Opus 5.5 defaults to medium), and run
the SessionStart compound drain on Haiku (override with
`COMPOUND_DRAIN_MODEL`).
