---
'yellow-review': patch
'yellow-codex': patch
'yellow-semgrep': patch
'yellow-ruvector': patch
'yellow-council': patch
---

Residual P2 fixes from the #670–#672 sweep-all batch: guard the
`resolve-pr` branch-verification redirect against zsh noclobber (`2>|`);
drop drifting hard pattern-counts from yellow-codex redaction prose; add
the missing "Cannot verify — semgrep CLI not found" branch (and
`unverified` commit trailer) to `/semgrep:fix`; bound memory-manager
flush retries at 3 attempts per entry; centralize the council reviewers'
Write-grant rationale in the council-patterns skill; feed the gemini
council pack via stdin (ARG_MAX) and guard the opencode pack size; cap
reviewer FINDINGS output at 200 lines / 20000 bytes.
