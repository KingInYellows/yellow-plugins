---
'yellow-review': minor
---

`sync-blocking-comment` takes `--risk <file>` (`classify-risk` output) and shows
the PR's risk tier and policy source on a "Risk tier" line in the sticky
blocking-threads comment. `/review:resolve` Step 9 classifies the PR with the
policy read at the default branch's tip and passes the result; when the
classification fails the comment is written without the line.
