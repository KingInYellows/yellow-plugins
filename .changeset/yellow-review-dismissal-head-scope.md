---
'yellow-review': patch
---

review-gate shadow: match ledger dismissals where they sit at the head commit
and within their enclosing scope (CLAUDE-243).
`review-ledger.sh dismissed-context` now reports each dismissal's head-mapped
location (`head_file`/`head_line` in JSON, and in the fenced block's `<where>`),
so a repeat is still dropped after lines are inserted above it. The shadow
adapter passes the ledger's `<scope>`, and the workflow no longer lets a
rule-only match drop a finding in a different function.
