---
'yellow-review': patch
'yellow-core': patch
---

Add `rule` and `scope` to the compact-return schema of every review persona
(including yellow-core's `security-reviewer` and `performance-reviewer`).
`/review:pr` and `/review:all` inject the rule vocabulary into reviewer prompts
and default a missing `rule`/`scope` to `unclassified`/`unscoped` instead of
dropping the return. Document heading-separator escaping (` \> `) so duplicate
headings whose text contains a literal ` > ` verify instead of falling back to
`unscoped`.
