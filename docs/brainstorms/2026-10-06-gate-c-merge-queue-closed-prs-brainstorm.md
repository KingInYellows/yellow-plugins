# Gate C: pass Graphite merge-queue PRs that stay closed/unmerged

## What We're Building

`/plan:complete` Gate C (plugins/yellow-core/commands/plan/complete.md, Phase 4)
should auto-pass when the plan's delivering PR landed through Graphite's merge
queue and GitHub still shows it as closed, `merged: false`, `merged_at: null`.
Today all three tiers return nothing for these PRs and every archival needs a
manual override. About 38 of the last 300 origin/main commits are plan archives,
so the friction recurs on each one.

New behavior: a fourth path inside the provenance tier. When
`commits/{FILE_SHA}/pulls` returns 0 PRs but FILE_SHA exists, parse the trailing
`(#N)` from FILE_SHA's subject, validate N as a positive integer, and require
that PR N is `closed` and that its paginated files list includes
`plans/<arg>`. A pass proceeds with no prompt and records
`Plan-Verifier-FileProvenance: pr=#N sha=<FILE_SHA> via=commit-subject`.

## Why This Approach

Evidence gathered 2026-10-06 against KingInYellows/yellow-plugins:

- The gap is permanent, not propagation lag. PRs #808, #846, #1029, #1030 and
  #1049 are all `state: closed`, `merged: false`, `merged_at: null`. Their
  `merge_commit_sha` is the queue's temporary merge-group commit, which does not
  exist in the repo (`git cat-file` fails for #808's 7b3205dc).
- `commits/<sha>/pulls` returns `[]` for the last 6 archive squash commits on
  origin/main. The provenance tier already finds the right commit; only the
  commit-to-PR lookup fails.
- Strict and loose tiers use `gh pr list --state merged`, so they cannot see
  these PRs.
- The squash commit subject carries the source PR number: 80f125ddf is
  "...preflight (#808)", and 300 of the last 300 origin/main subjects end in
  `(#N)`.
- `gh api repos/.../pulls/808/files` lists
  `plans/session-continuity-foundation-01-handoff-tool-and-preflight.md`, so the
  files API can confirm the parsed PR actually touched the plan.
- A commit with PR N's number in its subject exists on origin/main only if the
  work landed; an ejected PR never produces one. The files check guards against
  a subject that cites a different PR.

Approach A is deterministic, needs no new trailer name, and is one bash block
plus a bats test of the extractor (same style as `headref_matches_slug`).

### Rejected

- **B. Candidate-confirm prompt** (same parse, never auto-pass, prompt with the
  candidate prefilled). Rejected: it keeps a prompt on every archive and does not
  remove the stated friction. Reasonable only if the subject convention were
  distrusted.
- **C. Widen strict/loose to `--state closed` plus ancestry checks.** Rejected:
  closed PRs include ejected and abandoned ones, slug heuristics on them risk
  false positives, and every candidate would need its own merge verification.

## Key Decisions

1. Auto-pass (Approach A) when the subject-referenced PR is closed and its
   files include the plan path.
2. Reuse `Plan-Verifier-FileProvenance:` with a `via=commit-subject` field. No
   new trailer name (an earlier PR review rejected an invented
   `Plan-Verifier-LandedCommit:`).
3. Same change updates docs:
   - `docs/solutions/workflow/squash-commit-ancestry-verification-in-merge-queue.md`:
     fix "`/plan:complete` Gate C does not run it".
   - `docs/solutions/workflow/plan-lifecycle-management.md`: add an update note
     that the null-`mergedAt` state is permanent for Graphite-landed PRs and
     that the subject-reference path now handles it.
   - Correct the claim that `merged` is the authoritative signal (it is
     permanently false for Graphite-landed PRs) and the invalid
     `gh pr view --json merged` usage (use `gh api pulls/N --jq .merged`).
   - The `gate-c-verify-on-main` user memory becomes obsolete after this ships.
4. Phase 6 stale-main-clone failure stays out of scope (follow-up below).

## Open Questions

- Rebase-merge or plain-merge commits have no `(#N)` subject and fall through
  to the strict, loose and override path. Acceptable, but the fallthrough should
  be tested.
- The path depends on the squash-subject `(#N)` convention. If Graphite or repo
  settings change the format, the path silently stops matching and falls back to
  the override prompt (fail-safe, not fail-open).
- A subject may cite several PRs; take the last trailing `(#N)` and rely on the
  files check to catch a wrong pick.
- The files API is paginated and truncates at very large PR sizes; use
  `--paginate` and treat a truncated or failed lookup as no-evidence.
- Whether to also record a landed-content check (ancestry plus content
  equality) in the trailer or leave the subject plus files check as sufficient.

## Follow-ups (out of scope)

- Phase 6 stale-main-clone: `gt repo sync` stderr is discarded, so a collision
  only surfaces at Phase 8 `gt submit`.
