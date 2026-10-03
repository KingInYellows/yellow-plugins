---
title: Review resolve hardening
date: 2026-09-30
status: brainstorm
components:
  - plugins/yellow-review/commands/review/resolve-pr.md
  - plugins/yellow-review/commands/review/resolve-stack.md
  - plugins/yellow-review/agents/workflow/pr-comment-resolver.md
  - plugins/yellow-review/skills/pr-review-workflow
---

# Review resolve hardening

## What We're Building

Harden `/review:resolve` and `/review:resolve-stack` so that every unresolved
review thread ends in an honest, durable state, matching an org policy of "no
merge until all comments are resolved; file a follow-up issue only when a
comment is clearly out of scope."

Trigger: agents repeatedly saved two lessons to memory after using the command.
Both are real defects in the command, not just agent quirks:

- `gt modify -m` (resolve-pr.md Step 6, also review-pr.md:1047, review-all.md:376
  and the `pr-review-workflow/SKILL.md` convention) amends the previous commit
  and rewrites its message. Each resolve pass folds into the prior commit and
  force-pushes, so reviewers lose the "changes since my last review" view.
  Separately, `docs/solutions/workflow/gt-modify-no-c-flag-silent-unstaged-miss.md`
  documents that `gt modify` (with or without `-c`) silently skips unstaged
  edits in non-interactive contexts. The Graphite branch of Step 6 never stages
  files; the GitHub branch does (`git add -- <files>`).
- The push-guard hook (`gt-workflow`/`github-workflow` `git-push-detector.js`)
  fails closed on shell it cannot parse. Keeping commit and submit in one
  simple script call avoids complex inline shell.

Scope of this change (Approach A plus hardening):

1. **Disposition model.** Each comment cluster ends in one of four outcomes:
   - Fixed: reply with the commit SHA, then resolve the thread.
   - Already addressed: reply with the evidence, then resolve.
   - Clearly out of scope: file a follow-up issue, reply with the link, then
     resolve.
   - Disagree or unclear: reply with reasoning, leave the thread open, list it
     as blocking merge.
   Nothing is resolved without a fix, a link, or evidence.
2. **Issue-filing gate.**
   - Interactive `/review:resolve`: show the proposed issue (title, body, linked
     thread) via `AskUserQuestion` before filing.
   - Unattended (`--non-interactive`, `/review:resolve-stack`, sweep): file
     automatically only when the resolver gives a one-line out-of-scope reason,
     capped at 3 issues per PR. Over the cap, or no reason, is treated as
     "disagree or unclear": reply, leave open, list as blocking.
   - Tracker: GitHub Issues via `gh` by default; Linear instead when
     `yellow-linear` is installed and the branch has a Linear ID.
   - Every filed issue is listed in the final summary.
3. **Commit step.** `git add` the specific files the resolvers changed, then
   `gt modify -c -m` (new commit, not an amend), submit, and verify. Implemented
   as a tested script (`commit-resolve-fixes`) so it is one simple call. A
   clean-tree check runs between PRs in the stack walk.
4. **Pre-push verification.** Before committing, run `resolve_pr.verify_command`
   from `yellow-plugins.local.md` when set (same convention as
   `resolve_pr.cluster_cap`). Failure means no push; affected clusters are
   blocking.
5. **One bounded re-pass.** After the push, wait, re-fetch, and run at most one
   more resolve round if new actionable threads appeared. Then stop and report.
6. **Thread fetching.** `get-pr-comments` currently filters
   `isOutdated == false`. Include outdated unresolved threads: under
   "require conversation resolution" they still block merge.
7. **Summary.** Add a "Blocking merge" section and a "Follow-up issues filed"
   section. `/review:resolve-stack` keeps exiting 1 when anything blocks.

## Why This Approach

Approach A (in-place upgrade with script-backed mechanics) was chosen over a
ledger-backed design (B) and a separate merge-readiness command (C).

The deciding finding: GitHub thread state is already the durable record, and
the review-findings ledger is the wrong store for it.

- The ledger is local to one clone (`$(git rev-parse --git-common-dir)/yellow-review/findings/`,
  mode 0700/0600) and locked as "no GitHub-visible output". Teammates, CI and
  other machines cannot see it. A GitHub thread is visible to everyone.
- Ledger findings require a file anchor, a closed-vocabulary category and rule,
  fingerprints and redaction. A reviewer's free-text thread has none of these.
- `/review:triage` reconciles against local git, not GitHub `isResolved`, so a
  thread resolved in the UI would leave a stale ledger entry and need a second
  reconcile loop.
- Key Decision #2 of `docs/brainstorms/2026-09-23-review-findings-ledger-brainstorm.md`
  (and `docs/solutions/workflow/review-sweep-residual-findings-attended-fix-all.md`)
  deliberately keeps `/review:resolve` GitHub-only. Routing threads through the
  ledger would reverse it.
- The SessionStart hook is local-only and counts "fixes found but not applied",
  a different action from "waiting on a reviewer".

A hybrid (write only blocking or deferred threads to the ledger) adds a second
source of truth whose only unique benefit is a no-network session-start nudge.
That can be added later as a thin optional sidecar if blocked threads get
forgotten; nothing here prevents it.

`resolve-pr.md` is 466 lines against the 500-line ceiling, so the mechanics go
into scripts in `pr-review-workflow/scripts/` (`reply-pr-thread`,
`commit-resolve-fixes`, an `--include-outdated` option on `get-pr-comments`) and
the disposition contract into a reference file under `references/`, instead of
growing the command.

### How a fix can be missed, and what catches it

"A" is the plan with the hardening rules below.

| Miss mode | Caught by A (and where) | GitHub guarantee |
| --- | --- | --- |
| Unstaged edits | `commit-resolve-fixes` checks a clean tree, expected files in `HEAD`, and remote head equals local after submit; threads resolve only after that; clean-tree check between PRs (the 2026-08-06 update in the gt-modify doc records 19 fixes left unstaged in one batch) | Threads stay open if resolve is last |
| Skipped or partial clusters | Resolve only on an explicit `complete` status. Today Step 7 does not clearly exclude `skipped`/`partial`, which is a bug to fix. Listed under "Blocking merge" | Open thread |
| Disagree or unclear, left open | Summary; reply carries a hidden marker so a re-run skips threads whose last comment is ours with no newer reviewer reply (no duplicate replies) | Open thread plus reply |
| Late bot comments after the re-pass | Summary reports the final re-fetch count; the next `/review:resolve-stack` or `/review:sweep-all` (loops over every open PR you authored) picks them up | New open thread is the safety net |
| The 3-issue cap | Over-cap threads become "disagree or unclear" (reply, leave open, blocking) | Open thread |
| Issue filed but reply or resolve fails | Issue body carries the thread ID; a re-run finds it and only replies and resolves | The issue is the record |
| Failed `verify_command` | No push; save the diff as a patch, revert the tree (so the next PR does not hit the dirty-tree stop), report the patch path, leave threads open | Open threads |
| Interrupted session | Resolve is last, so threads stay open. Crash after push but before resolve lands in the "already addressed" lane on re-run. Crash before push leaves a dirty tree and `/review:resolve` stops with a message | Open threads |
| Stack-walk abort | Per-PR continue-on-failure and re-run safety already exist; print each PR's summary row as it completes so a hard abort still leaves a record | Unvisited PRs keep open threads |
| `CHANGES_REQUESTED` reviews and review-level comments | No thread to resolve, so the agent cannot close them; report as blocking, only a reviewer can clear them | Only reviewer approval, if required approvals are enforced |

Hardening rules (design requirements that came out of the table):

1. Resolve last: resolve a thread only after a verified push and a posted
   reply. Skipped, partial, context-not-found and unknown statuses never
   resolve.
2. Idempotency markers (thread ID and disposition) in replies and issue
   bodies, so re-runs do not duplicate replies or issues.
3. `commit-resolve-fixes` verifies a clean tree, the expected files in
   `HEAD`, and local head equals remote head after submit.
4. A failed `verify_command` saves a patch, reverts the tree, and leaves
   threads open.
5. Per-PR summary rows stream as each PR completes.
6. "Blocking merge" includes `CHANGES_REQUESTED` reviews and review-level
   threads.
7. `/review:sweep-all` is documented as the re-entry sweeper for late
   comments.

## Key Decisions

- **GitHub thread state is the durable record.** No ledger integration in this
  change. `/review:resolve` stays GitHub-only (keeps Key Decision #2 of the
  ledger brainstorm intact).
- **Four dispositions, agent resolves** fixed, already-addressed and
  out-of-scope threads; disagree or unclear threads stay open and block.
- **Issue filing is gated by mode.** Interactive asks first. Unattended files
  only with a one-line reason, max 3 per PR; overflow blocks. GitHub Issues by
  default, Linear when `yellow-linear` is installed and the branch has a
  Linear ID.
- **Commits:** `git add` specific files, then `gt modify -c -m`. `-c` alone does
  not fix the silent unstaged miss; the explicit `git add` does. Between PRs,
  the stack walk checks a clean tree.
- **Verification is opt-in:** `resolve_pr.verify_command` in
  `yellow-plugins.local.md`; unset means skip.
- **One bounded re-pass** after the push, then stop. No unbounded loops in an
  unattended stack walk.
- **Include outdated unresolved threads** in `get-pr-comments`.
- **Mechanics live in scripts and a reference file**, not in `resolve-pr.md`,
  to stay under the 500-line ceiling and to give each new behavior a bats test.
- **Dependency recorded:** the "GitHub thread state blocks merge" guarantee
  relies on branch protection "require conversation resolution", and
  enforcement varies by repository. Where it is off, an unresolved thread is
  only a convention, not a block.
- **Scope kept tight.** The `gt modify -m` convention is updated in
  `resolve-pr.md` and `pr-review-workflow/SKILL.md` (whose "single-commit
  branches" guidance is the source of the pattern) in this change.
  `review-pr.md` and `review-all.md` carry the same pattern and are a
  follow-up (see Open Questions).

## Open Questions

- **Fallback where conversation resolution is not enforced.** Options: a sticky
  blocking-threads PR comment, updated in place (shared, no local state), or
  recommending the protection rule be enabled. Treated as a follow-up, not part
  of this change.
- **`review-pr.md` and `review-all.md` `gt modify -m` follow-up.** Same
  amend-and-rename behavior; decide whether to fix in the same PR or a
  separate one. `review-pr` also auto-applies fixes, so the same staging check
  applies there.
- **Optional local session-start nudge** (a per-PR blocked-thread count
  sidecar) if blocked threads turn out to get forgotten. Deferred under YAGNI.
- **Approach C (`/review:merge-ready`)**: a read-only gate for threads
  (including outdated), `CHANGES_REQUESTED` reviews and CI. Not needed now;
  does not conflict with A.
- **Failed `verify_command` handling:** patch location and retention (for
  example under the git common dir) is an implementation detail for the plan.
- **Bounded re-pass wait time** and how it interacts with bot re-review latency
  is a plan-level detail; a config knob (like `resolve_pr.cluster_cap`) may be
  warranted.
- **Reply wording and marker format** for dispositions and issue bodies
  (hidden HTML comment with thread ID and disposition) to be defined in the
  plan, plus tests in `plugins/yellow-review/tests/`.
- **Docs and gates to update with the change:** `plugins/yellow-review/CLAUDE.md`
  and `README.md`, `docs/plugin-scope-mode-protocol.md` if the
  `--non-interactive` contract changes (the issue-filing gate is a new
  suppressed gate), a changeset, and the validators (`pnpm validate:agents`,
  `pnpm lint:plugins`, `pnpm validate:shell-compat`).
