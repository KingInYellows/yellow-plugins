---
"yellow-review": minor
---

`/review:sweep` reads the PR head's ignore rules through the new
`head-ignore-probe` script (`gh api` at `headRefOid`, under a timeout), not a
`git fetch` of `refs/pull/<N>/head` from a guessed remote. PR-specific stops now
end with `Sweep: skipped (head-ignore-unreadable)`,
`(tracked-here-ignored-on-head)` or `(untracked-here-ignored-on-head)`, which
`/review:sweep-all` records before moving on to the next PR. A rate limit,
network or auth failure still stops the batch. `/review:sweep-all` retries a
transient open-PR check once and skips a PR that is not found. When the
config is ignored on the PR branch but was not snapshotted, the abort now says to
inspect it before any rerun.
