---
'yellow-review': minor
---

Add a sticky "blocking threads" PR comment for repositories that do not
enforce conversation resolution (CLAUDE-55). `/review:resolve` Step 9 runs the
new `sync-blocking-comment` script when `get-pr-blockers` reports
`conversationResolution` as `not_enforced` or `unknown`: it keeps one comment,
found by a marker line among the viewer's own comments and edited in place,
listing every unresolved thread (outdated included) with a link, `path:line`,
the opener's login and the run's status for it. It carries no reviewer prose,
never creates a comment when nothing blocks, and is off with
`YELLOW_REVIEW_BLOCKING_COMMENT=0`. `get-pr-comments` now also returns each
comment's `url`.
