# Review-run lock

yellow-core's SessionStart hook can start a compound-staging drain (a background
`claude -p`) that writes `docs/solutions/*.md` and gitignored `*.promote-done`
sentinels into the checkout. `/review:resolve` treats any new gitignored file as
a resolver escaping its bounds and stops (the ignored-file stop), so a drain
running during a review turns a good run into a stop. On 2026-10-20 that ended a
`/review:sweep-all` with nothing landed.

`/review:resolve`, `/review:sweep`, `/review:sweep-all` and
`/review:resolve-stack` therefore hold the review-run lock for the length of the
run. While any holder is live, yellow-core's hook starts no drain and
staging-promoter writes nothing (the entry waits in `processing/` for a later
drain). Nested commands each hold their own holder, so an inner release never
frees an outer run. The lock is advisory and per checkout: a drain in another
worktree writes to that worktree, not this one.

Do not widen the ignored-file guard's exemptions to `*.promote-done` instead:
that would also hide a resolver writing there.

## Acquire

Run once, after the command's pre-flight passes and before any review step:

```bash
"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/review-run-lock" acquire
```

Keep the printed `holder=` value as the literal `<holder>`. `holder=none` means
this checkout has no compound-staging dir (no drain can run here); keep `none`.
A non-zero exit is not a stop: keep `none`, add the Notes line
`review-run lock unavailable (a compound drain may write during the run)` and
continue.

## Release

At every end of the run after Acquire, the final report and every stop alike,
run:

```bash
"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/review-run-lock" release "<holder>"
```

A failed or missed release is not an error: a holder older than 120 minutes
stops counting and the next `acquire` reaps it.

## Refresh

A run that can outlast 120 minutes (`/review:sweep-all`,
`/review:resolve-stack`) refreshes its holder before each PR with
`review-run-lock refresh "<holder>"` (skip when `none`). Exit 1 (the holder was
reaped) means acquire again and keep the new value.

## A drain that is already running

The lock stops new drains and promotions, not a drain that started earlier and
is between writes. `/review:sweep-all`'s pre-flight therefore also runs
`review-run-lock drain-live` after Acquire: `drain=live` (yellow-core's
`.drain-lock` is younger than 30 minutes) stops the batch before any PR, with
`[review:sweep-all] Error: a compound drain is writing to this checkout; retry after it ends (at most 10 minutes), or run the sweep in another worktree.`
Release the holder first.
