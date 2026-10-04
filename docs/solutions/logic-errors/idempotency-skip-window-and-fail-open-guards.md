---
title: 'Idempotency skips, bounded dedupe windows and fail-open lookups in resolve guard scripts'
date: 2026-10-03
category: logic-errors
track: bug
problem: 'Marker-presence idempotency skips a different outcome, a fixed 200-issue dedupe window exits 5 forever, and an ownership check proceeds when its lookup fails'
tags: [idempotency, dedupe, fail-closed, pagination, bash-timeout, exit-codes, yellow-review]
components: [yellow-review]
---

## Problem

The `/review:resolve` guard scripts from PR #950
(`plugins/yellow-review/skills/pr-review-workflow/scripts/reply-pr-thread`,
`file-followup-issue`, `get-pr-blockers`) passed their happy-path tests but
failed in four ways that only a multi-reviewer pass found. They are
point-in-time findings on the PR #950 head (`4b4ec0ed6`); re-read the scripts
before relying on line-level detail once the PR lands.

Error-class collapse, the `comments(last: 1)` marker pre-check, the
duplicated rate-limit classifier and `null` meaning both "none" and "failed"
are already covered in
`docs/solutions/integration-issues/gh-wrapper-scripts-collapse-error-classes.md`.
This doc covers what that one does not.

## Symptoms

- `reply-pr-thread` skipped on a prior marker of any disposition. A stale
  `unclear` or `disagree` reply followed by a requested `fixed` or `oos`
  resolve skipped the reply, then the orchestrator resolved the thread with
  no evidence reply for the new outcome (P1).
- `file-followup-issue` listed the viewer's latest 200 issues and, when no
  marker matched in a full window, exited 5. Once the viewer owned 200 or
  more issues, every new thread hit that exit and could never get a follow-up.
- When the thread-ownership lookup failed for a reason the script did not
  classify, it fell back to linking the PR and filed the issue anyway.
- A script whose worst case is about 180 s (retries times a per-call
  timeout) ran under the Bash tool's 120 s default; the Bash timeouts section
  of `plugins/yellow-review/references/resolve/dispositions.md` listed only
  verify, the re-pass poll and `commit-resolve-fixes`.

## What Didn't Work

- Keying the skip on "a viewer-authored marker for this thread exists". That
  proves some reply landed, not that the requested one did.
- Treating the bounded window as safe because exceeding it fails closed. It
  fails closed correctly, but permanently, so the feature dies at scale.
- Using the PR-URL link as a catch-all fallback for any lookup error. A
  fallback is only valid for "lookup succeeded, field absent".

## Solution

1. **Compare outcomes, not presence.** Skip only when the prior marker's
   disposition equals the requested one. Treat `fixed` and `oos` as distinct
   even though both resolve the thread: their replies and evidence differ. Put the comparison in the contract: the skip JSON already reports
   the prior disposition, so the orchestrator checks it against its own and
   posts a new reply when they differ.
2. **Make the dedupe lookup target the marker.** Search issues for the thread
   marker, or paginate until the list ends. Keep the fail-closed exit for a
   truncated scan, but never let a fixed window decide it.
3. **Fail closed on unclassified ownership-lookup failure.** Exit 1 and file
   nothing. Keep the PR-URL fallback only when the lookup succeeded and
   returned no comment URL.
4. **Document every script's worst-case runtime.** Add a Bash timeouts row
   for each script (retry count times per-call timeout, plus pacing) and
   require callers to pass that `timeout`.
5. **Keep sibling scripts in step.** The same condition (thread not found)
   exited 2 in `file-followup-issue` and 3 in `reply-pr-thread`, credential
   refusal shared exit 2 with usage errors, and `get-pr-blockers` turned
   every failure, including a rate limit, into `lookupFailed` with exit 0 and
   no reason. Pick one code per condition, keep one exit-code table, and add a
   `lookupReason` (or equivalent) wherever a failure is reported as data.

## Why This Works

An idempotency key must identify the operation, not just the target. A guard
that decides on bounded or partial evidence needs a lookup whose cost does not
grow with unrelated data. A fallback is a success path, so it must run only
after a success. Runtime budgets are part of the interface, so they belong
beside the exit codes.

## Prevention

- For every skip-if-already-done check, test "prior marker, different
  requested outcome" and assert a new action is taken.
- For every list-then-scan dedupe, ask what happens at N+1 items; add a test
  fixture with a full page and no match.
- Write the failure matrix for each lookup: failed, succeeded-empty,
  succeeded-wrong-owner. Only the second may use a fallback.
- When adding a script, grep its siblings for the same error condition and
  match the exit code; update the table in the same PR.
- Compute worst-case wall time for each script and list it in the contract.
