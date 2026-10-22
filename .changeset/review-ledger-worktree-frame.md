---
"yellow-review": patch
---

The review ledger's fix-up pass (`observe --step 8 --anchor-source worktree`)
now maps existing findings through the uncommitted edits into the worktree
snapshot before comparing them with new observations, so the line-map, alias
and scope passes all work in one frame. The scopeless re-observation merge
from CLAUDE-88 is switched back on for that pass (CLAUDE-179).
