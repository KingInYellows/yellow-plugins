---
'yellow-review': minor
---

`/review:resolve` now stops another writer's push from turning into a failed or
stale run (CLAUDE-266). It passes the PR head it checked in Step 2c to
`commit-resolve-fixes --expected-head`, which re-reads the head before staging
and again before the submit and exits 8 (`reason=head-moved`) with nothing
committed when it moved. Step 7 re-checks the head before posting anything and
reports threads another actor resolved as `resolved elsewhere` instead of
blocking. An unattended submit now times out after 120 s, and a failed submit
prints a recovery line with the local commit and the remote head.
`/review:sweep-all` skips a PR whose head commit is less than 15 minutes old
(`YELLOW_REVIEW_RECENT_PUSH_MINUTES`). It reads the commit date, not the push
time, so a fresh push of an older commit is not caught.
