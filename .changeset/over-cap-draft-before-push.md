---
'yellow-review': patch
---

`commit-resolve-fixes --over-cap-draft` converts the PR to a draft right before
the push instead of after the head is verified, so an over-cap fix that lands
while a later check fails still waits for human review (CLAUDE-278).
