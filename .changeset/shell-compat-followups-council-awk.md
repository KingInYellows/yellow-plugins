---
'yellow-council': patch
---

`council-patterns`: the diff-truncation `awk '…'` program in the review pack
builder no longer breaks. An apostrophe in one of its comments
(`character's`) closed the single-quoted program early, so the block failed
to parse in both bash and zsh whenever a diff exceeded the byte budget.
