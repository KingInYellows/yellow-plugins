---
title: 'gh wrapper scripts collapse distinct error classes into one exit code or silent none'
date: 2026-10-01
category: integration-issues
track: bug
problem: gh/GraphQL wrappers report rate limits as permissions, drop fetch errors, share exit 1 for auth, and lack timeouts and branch tests
tags: [gh-cli, graphql, rate-limit, exit-codes, timeout, bats, silent-failure, yellow-review]
components: [yellow-review]
---

## Problem

The new `gh` and GraphQL scripts in PR #954 (`get-pr-comments`,
`poll-new-threads`, `resolve-pr-thread`, `gh-graphql.sh`) treated different
failures as the same thing, so callers retried the wrong cases, polled
pointlessly, or read errors as "nothing new".

## Symptoms

- `get-pr-comments`: a secondary rate limit (HTTP 403) was reported as
  insufficient permissions, so `ratelimited` was never set.
- `poll-new-threads`: non-rate-limit fetch errors were dropped, so an auth or
  network failure polled for the whole wait window.
- `resolve-pr-thread`: auth failure returned exit 1, and Step 8 retried exit 1
  three times with no backoff.
- New `gh` calls had no timeout, unlike `commit-resolve-fixes`, so a hung call
  hung the command.
- `poll-new-threads` used `grep -F` against the round-1 list; a blank or CRLF
  line made it report `found=0`, and a `grep` error was read as "none new".
- Tests had no mock arms for the `gh-graphql.sh` rate-limit wait branch
  (`x-ratelimit` headers), the `poll-new-threads` wall-clock guard, bad JSON,
  option validation or mixed outcomes.

## What Didn't Work

- Mapping every non-zero `gh` result to one reason, or to nothing.
- Matching the 403 status before checking for a rate-limit marker.
- Using exit 1 as both "auth failed" and "transient failure".
- Using the exit status of a pipeline stage as if it meant "no match".

## Solution

1. Test for rate limit before the 403 arm so secondary limits set
   `ratelimited`.
2. Give auth its own exit code or a `reason=` line. Retry only transient
   failures, once, after a short sleep.
3. In `poll-new-threads`, forward the first 300 bytes of stderr and exit early
   on auth or not-found instead of polling out the wait.
4. Wrap `gh` in `timeout` with a net-timeout bound and treat a timeout as
   exit 1, matching `commit-resolve-fixes`.
5. Strip blank lines and carriage returns from the round-1 list, and branch on
   `grep` exit status: 0 match, 1 none, 2 or more is an error.
6. Add bats mock arms for each new branch: rate-limit reset in the future, in
   the past and over the cap; the wall-clock guard; bad JSON; option
   validation; mixed outcomes. Extend the `resolve-pr.md` contract test to
   assert the load-bearing tokens in the stage, verify, commit and push phase.

## Why This Works

Each failure class now has a distinct signal, so the caller can choose
retry, wait, stop or report. Bounded calls cannot hang the loop. Normalizing
input and checking `grep` status removes the false "none new" reading. Tests on
each arm keep the classification from regressing.

## Prevention

- For every wrapper, list the failure classes (auth, not-found, rate limit,
  transient, timeout, bad payload) and give each a visible, distinct outcome.
- Never let stderr from a failed fetch be discarded without surfacing at least
  a bounded excerpt.
- Check rate-limit markers before generic permission statuses.
- Retries need a class filter and a sleep; never retry auth.
- Every new error branch gets a mock arm in the bats suite in the same PR.
- Check `$?` for `grep`, not only its output, wherever "no match" is a valid
  result.

See also `docs/solutions/integration-issues/gh-api-graphql-plugin-command-template.md`
for the six required elements for `gh api graphql` calls.

---

## Update — 2026-10-01

The same collapse shows up on the consumer side. `/review:resolve-stack`
decided a PR was rate limited by scanning the resolve output for HTTP
403/429, `rate limit` or retry notices. That heuristic overrode an
explicit `ratelimited=0` on the `Resolve:` contract line. It also matched
a retry notice that later succeeded, a bare 403 that was a permission
error, and review text that merely quoted the phrase. The result was a
walk or batch stopped early for the wrong reason.

Guidance:

- The structured field wins. When the `Resolve:` line is present, use its
  `ratelimited` value and skip text matching entirely.
- Fall back to text only when the line is missing, because the command
  emits no contract line when a rate limit stops it first.
- In the fallback, match only the script's exit-4 markers. Do not match
  bare 403s or prose.
- Define the rule once, in the contract, and have every caller point at
  it. Do not restate it per call site.

---

## Update — 2026-10-01 (resolve scripts, PRs #950 and #952)

The same defect class appears in the yellow-review resolve scripts. The
guard-script contract is: each distinct outcome gets its own exit code, and a
gate sees all of its input.

- **Refusal, transient failure and unavailable are three outcomes.** In
  `commit-resolve-fixes`, exit 3 means "refused" (path, staged-set or
  credential-shaped check) and exit 4 means "commit failed and was undone".
  `reply-pr-thread` uses 3 for "thread not found or not permitted" and 4 for
  rate limit. Callers retry only the transient code. Never map "could not
  list the PR's files" onto the refusal code: a network failure that exits as
  a refusal triggers a revert of every fix. Give "unavailable" its own code
  and do not roll back on it.
- **Do not duplicate the classifier.** `reply-pr-thread` classifies errors
  through the shared `gg_is_rate_limited` / `gg_reason` helpers in
  `lib/gh-graphql.sh`. `file-followup-issue` still has a local `gh_fail` that
  greps stderr for `rate limit|HTTP 429`. Two classifiers will drift. The
  credential heuristics have the same split: `lib/resolve-text.sh`,
  `RL_SUSP_AWK` in `lib/review-ledger.sh` and yellow-core's
  `cs_redact_secrets` are separate implementations. Point-in-time: the
  `lib/gh-graphql.sh` helper (PR #954) and `lib/resolve-text.sh` (PRs #950,
  #952 and #954), both under `plugins/yellow-review/`, exist only on those
  unmerged branches, not on `main`; `RL_SUSP_AWK` and `cs_redact_secrets` are
  already on `main`. Re-grep for `gg_is_rate_limited` before relying on these
  names once those PRs land.
- **A truncated read must not look complete.** `get-pr-comments` warns on
  stderr when pagination stops at the page limit or loses its cursor, then
  continues to exit 0 with a partial thread list. A caller deciding "nothing
  left to resolve" from that list can be wrong. A gate that refuses on what it
  saw must either exit non-zero on truncation or emit an explicit truncated
  marker.
- **`null` cannot mean both "none" and "lookup failed".** `get-pr-blockers`
  passes GitHub's `reviewDecision` through unchanged (null when the repo
  requires no reviews) and also emits null when the lookup fails. A consumer
  cannot tell "no policy" from "unknown". Use a separate failure value, as the
  `conversationResolution: "unknown"` field already does.
- **Check the newest marker-bearing comment, not the last comment.**
  `reply-pr-thread`'s idempotency precheck reads `comments(last: 1)`. If
  another author replies after our marker comment, the precheck misses the
  marker and the script posts again.

Prevention: for each gate script, test a rate-limit stderr, a transient
failure, a refusal and an unavailable lookup, and assert four different exit
codes (or a documented grouping). Test a truncated page and assert it is
reported.
