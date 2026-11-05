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

It prints two lines. Keep the `holder=` value (an opaque `run.XXXXXX` token, or
`none` when the staging dir is a symlink) as the literal `<holder>`. A non-zero
exit is not a stop: keep `none`, add the Notes line
`review-run lock unavailable (a compound drain may write during the run)` and
continue.

`drain=live` means a drain that started before this run is still between writes
(yellow-core's `.drain-lock` is younger than 30 minutes); the lock cannot stop
it. Run Release, then stop before any review step with
`[review:<command>] Error: a compound drain is writing to this checkout; retry after it ends (at most 10 minutes), or run in another worktree.`
`/review:resolve` stops the way a failed Step 2 check does. `drain=idle` goes
on: from here no new drain or promotion starts.

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

## Why acquire also creates the staging dir

When yellow-core has not staged anything in this checkout yet, Acquire creates
the staging dir so the holder exists. A run that stages its own learnings (an
unattended `/review:pr`) would otherwise make a drain eligible mid-run with no
holder to see.
