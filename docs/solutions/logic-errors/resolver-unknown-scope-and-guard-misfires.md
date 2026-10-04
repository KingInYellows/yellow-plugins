---
title: 'Resolver scope input that fails to "unknown" acts as a value, and guards misfire on tool state and unproven fixes'
date: 2026-10-03
category: logic-errors
track: bug
problem: 'A failed changed-ranges call reaches resolvers as unknown and drives oos, public free-text lacks a read deny list, and verify guards trip on tool-state writes'
tags: [pr-comment-resolver, review-resolve, fail-closed, scope-classification, gitignored-state, silent-failure, yellow-review]
components: [yellow-review]
---

## Problem

Point-in-time findings on the unmerged PR #954 head (`b0492c5a`), which wires
`pr-comment-resolver` per-thread dispositions into `/review:resolve`. File and
line references come from the review table and may move before merge; re-read
the files before relying on them. This doc covers only what the existing
resolve docs do not:

- Stale-marker skip, fail-open lookups: `docs/solutions/logic-errors/idempotency-skip-window-and-fail-open-guards.md`
- Error-class collapse, retry ladders: `docs/solutions/integration-issues/gh-wrapper-scripts-collapse-error-classes.md`
- Gitignored deny-listed paths, self-reported `Files modified`: `docs/solutions/security-issues/resolver-guards-trust-prompt-and-git-status-only.md`
- Unpublished restack, frozen ranges: `docs/solutions/logic-errors/resolve-stack-state-stale-after-fix-commit-push.md`
- Credential-shape heuristics: `docs/solutions/security-issues/credential-heuristic-exemptions-fail-both-ways.md`
- Prose drift, duplicated rules: `docs/solutions/code-quality/state-rules-once-and-update-unwired-prose.md`

## Symptoms

- **Unknown scope acts as a value (P1, three reviewers).** When
  `pr-changed-ranges` failed, `resolve-pr.md` passed `unknown` to the
  resolvers. They proposed `oos` for threads they could not place, so an
  unattended run filed follow-up issues and resolved threads that were in
  scope.
- **Public free text, no read deny list (P1, security).** The resolver has
  `Read` but no deny list for secret paths, and its `evidence` and `oos_reason`
  fields are posted publicly on the PR. The allowlist and credential screen
  also miss bare alphanumeric secrets, so a read secret can be quoted into a
  reply.
- **Tool-state writes trip the ignored-file guard (P1, adversarial).** The
  yellow-ruvector hook writes gitignored `.ruvector/coedit-sessions` during
  resolver edits. The `--ignored-since` scan counted that as a resolver edit,
  so verify refused to run and the fixes were reverted.
- **Deleted-line comments forced to `oos`.** A thread anchored on a deleted
  line has no added-line range, so it classed `oos`, and bot threads on it were
  auto-resolved.
- **"Addressed" cites an uncommitted edit.** A thread was marked addressed
  from an edit that a later verify failure reverted.
- **Resolve line hides why a run stopped.** An error stop and "nothing to do"
  printed the same `Resolve:` line.
- **Cluster blast radius.** A resolver that omitted its `Files modified`
  block reverted every cluster's work; covered in
  `docs/solutions/security-issues/resolver-guards-trust-prompt-and-git-status-only.md`.
  New here is the narrower remedy: revert only the offending cluster.
- **Edit bound enforced only for files.** The line-range bound in
  `plugins/yellow-review/references/resolve/clusters.md` is prompt-only; only file membership is
  checked in `commit-resolve-fixes`.
- **Unbounded `--wait`.** `poll-new-threads` accepted an arbitrarily long
  number, so the loop could spin.
- **Tracked-config check.** Any git failure in the check mapped to
  "untracked", the safe-looking answer.

## What Didn't Work

- Handing the resolver `unknown` and trusting its prompt to say `unclear`.
  A disposition vocabulary with `oos` available makes `oos` the default guess.
- Counting every gitignored change as resolver output. Tool-owned state
  directories are ignored by design and change on every edit.
- Treating "committed locally" as proof of "addressed" before verify and push.
- Reading the absence of an error line as "nothing to do".

## Solution

1. **Make failure a distinct state, not a value.** Retry `pr-changed-ranges`
   once, then mark every affected thread `unclear` and skip the resolver. If a
   resolver still receives `unknown`, its contract says to propose `unclear`,
   and the orchestrator downgrades any `oos` proposed under `unknown` to
   `unclear`. `oos` requires a computed range, not a missing one.
2. **Record deletion points.** Have `pr-changed-ranges` emit a deletion point
   per hunk and the thread's `diffSide`, so a deleted-line comment maps to the
   nearest surviving line instead of falling out of every range. Pass
   `diffHunk` (and `originalLine` for outdated threads) to the resolver.
3. **Give the resolver a read deny list and screen what it publishes.** Apply
   the resolve deny list to `Read` and `Grep` for secret paths. Redact or omit
   credential-bearing text from `evidence` and `oos_reason` before posting.
   Sentence shape is not a security boundary, so do not rely on a
   plain-sentence check or the credential regex alone.
4. **Exclude tool-state directories from the ignored-file scan**
   (`.ruvector/` first), keyed by an explicit list so a resolver edit to a
   real ignored file still fails closed.
5. **Cite only committed, verified edits.** If the cited edit is later
   reverted, downgrade the thread to `unclear`. Revert only the cluster whose
   resolver omitted `Files modified`, not every cluster.
6. **Add a `stopped=` field to the `Resolve:` line** so an error stop,
   a cap stop and nothing-to-do differ. Make the tracked-config check fail
   closed on any git result it does not recognise. Cap `--wait` at four digits.
7. **Enforce the line-range bound in `commit-resolve-fixes`**, or reword the
   contract to say only file membership is enforced.

## Why This Works

Each fix keeps a failure from posing as an ordinary answer. `unknown`, an
unrecognised git result and a missing `Files modified` block are all absence
of evidence, and the rule is that absence moves toward `unclear`, a stop or a
narrower revert. The tool-state exclusion removes the false positive without
loosening the guard for real ignored files.

## Prevention

- Any scope or classification input that can fail needs a test where its
  producer fails, asserting the result is `unclear` and nothing is filed or
  resolved.
- For every disposition value that causes an external action (`oos` files an
  issue), list which input states may produce it, and exclude unknown ones.
- Run the verify guard in a repo with each installed plugin's hooks live and
  check which ignored paths they write before choosing the scan scope.
- Text a resolver can post publicly needs a read-side limit as well as a
  write-side screen; test with a fixture secret in a denied path.
- Give every stop a distinct reason in the final status line, and test that an
  error stop and an empty run print different lines.
- Tests that pin prose break on rewording; keep structural assertions
  (tokens, exit codes, field names) and use `run grep` with a status check for
  negations (`docs/solutions/code-quality/bats-negated-grep-mid-test-never-fails.md`).
