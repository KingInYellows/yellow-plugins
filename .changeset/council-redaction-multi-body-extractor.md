---
'yellow-council': patch
---

The `tests/redaction.bats` extractor now discovers every copy of the
credential-redaction awk program by content instead of a single fixed opener
pattern, so it returns all bodies a file carries rather than assuming one
body per file. `redaction.bats` runs a fatal identity gate against the
`council-patterns` SKILL.md canonical for every discovered body before the
behavioral suite runs, so a drifted copy fails fast instead of silently
passing behavioral cases with stale logic. `commands/council/council.md`'s
two copies (the Step 4 claude-leg pass and the Step 7 report-build pass) are
now covered by that gate, and its `redaction_known_untested` entry in
`scripts/council-roster.json` is removed now that both bodies are wired in.
