---
'yellow-council': patch
---

Sync both copies of the credential-redaction awk program in
`commands/council/council.md` (the Step 4 claude-leg pass and the Step 7
report-build pass) to the canonical program in `council-patterns` SKILL.md.
The copies were 101 lines behind: they still ran the single-pass
`strip_deco()` that #703 showed leaks under stacked diff prefixes, and lacked
the `pem_release` / `pem_was_in` stray-window fix. The hardening in #703 never
reached council.md because the redaction test extractor could not see its
indented, two-body layout; a follow-up wires the extractor and identity gate
so the copies cannot drift again.
