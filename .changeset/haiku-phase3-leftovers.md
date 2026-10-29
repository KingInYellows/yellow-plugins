---
'yellow-semgrep': patch
'yellow-core': patch
'yellow-debt': patch
---

Eval-gated model swaps from the Phase 3 leftovers eval (CLAUDE-194):
`scan-verifier` moves to haiku/low, `staging-promoter` to haiku/medium, and
`audit-synthesizer` from opus/high to sonnet/medium. `/semgrep:fix` Step 9 now
treats a verifier answer with no `Verification:` verdict (empty or refused) like
"Cannot verify" and offers to commit with the new
`unverified (no verifier result)` trailer, instead of reading it as a pass.
