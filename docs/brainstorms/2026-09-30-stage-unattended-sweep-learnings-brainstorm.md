---
title: Stage unattended sweep learnings
date: 2026-09-30
status: brainstorm
---

# Stage unattended sweep learnings

## What We're Building

Make unattended review runs capture learnings through the compound-staging drain
instead of spawning `knowledge-compounder`, whose M3 gate stalls with no human
present and writes nothing.

- `/review:pr` Step 9a, under `--non-interactive`, stages one outcome-narrative
  entry per PR to the compound-staging ledger instead of spawning the
  compounder. The reference is
  `plugins/yellow-review/references/review-pr/knowledge-compounding.md`.
- `/review:sweep-all` Step 6 drops its `/flow:compound` call. Every swept PR
  already stages at Step 9a through `/review:sweep` ->
  `/review:pr --non-interactive`.
- yellow-core gains `cs_stage_entry` in
  `plugins/yellow-core/lib/compound-staging.sh` plus a thin script wrapper that
  command markdown can call.
- Interactive `/review:pr` (no flag) keeps the M3-gated compounder unchanged.

Verified against the codebase:

- The compounder's M3 gate is unconditional.
- Step 9a has no non-interactive branch.
- sweep-all Step 6 invokes `/flow:compound` unconditionally once at least one PR
  was attempted.
- `sweep.md` has no compounding step of its own.
- `compound-staging.sh` has no append function today.
- `docs/solutions/workflow/compounder-m3-gate-non-interactive.md` (2026-07-29)
  names the staging drain as the sanctioned gate-free path.

## Why This Approach

- The drain already scores, dedups and promotes without prompting
  (`staging-scorer` -> `staging-reviewer` -> `staging-promoter`). A quality gate
  stays in place, unlike a gate-free compounder mode.
- A gate-free compounder would let unattended runs write `docs/solutions/`
  directly with no review step.
- Skipping Step 9a would remove the wasted runs but capture nothing.
- Staging writes only under `~/.claude/projects/<slug>/compound-staging/`, so it
  leaves the sweep's working tree clean.
- Per-PR staging at Step 9a already covers sweep-all. A second summary entry or
  a new `/flow:compound` flag would add surface for no new signal. The Stop hook
  does capture the sweep session's last 100 lines, but that is mostly the
  summary table and carries no findings.

## Key Decisions

1. **Entry shape: outcome narrative.** Per finding, record the file, root cause,
   fix applied and verification result, with file and command markers. This
   follows the scorer rubric, which rates "bug + root cause + verified fix" at
   0.85 and generic guidance at 0.40. The markers also satisfy the reviewer's
   Phase 7 sanity check.
2. **sweep-all Step 6: drop `/flow:compound`.** Per-PR Step 9a already stages.
   Update the Error Handling section, and the `/flow:compound` mentions in the
   `sweep-all.md` header and in `yellow-review/CLAUDE.md`.
3. **Missing yellow-core or jq: warn once and skip.** Never abort the sweep.
   This matches the review ledger's rule that a ledger error never aborts a
   review.
4. **Helper.** Add `cs_stage_entry` to `compound-staging.sh`, plus a thin script
   wrapper.
   - Reuse the Stop-hook entry schema: `schema:"1"`, `schema_min_reader`,
     `timestamp`, `session_id`, `content_hash`, `cwd`, `transcript_tail`.
   - Use a synthetic `session_id` (for example `review-pr<N>-<run>`), sanitised
     the way `_stop-capture-subshell.sh` does it (`tr -c 'A-Za-z0-9._-' '_'`).
   - Run the text through `cs_redact_secrets` before hashing or writing, and
     compute `content_hash` over the redacted text.
   - Take `cwd` from the caller.
   - Write atomically through `cs_atomic_jsonl_write`. The caller adds the
     trailing newline.
5. **Lib resolution.** yellow-review finds yellow-core's `compound-staging.sh`
   the way `lib/review-ledger.sh` does: `RL_CORE_LIB`, then a plugin-cache
   lookup.
6. **Tests.** Bats tests cover redaction, atomicity, hash dedup, slug and
   directory resolution, the sanitised `session_id`, and the skip paths for a
   missing lib or jq.
7. **No drain trigger from the sweep.** The existing SessionStart threshold (5
   pending entries, or the oldest over 48h) stays the only trigger.
8. **Release and docs.**
   - Add changesets for yellow-core (new helper, minor) and yellow-review.
   - Update `plugins/yellow-review/CLAUDE.md`.
   - Update the Step 1 non-interactive paragraph in `review-pr.md`, which today
     names only the Step 9 push gate and the Step 9b prompt.
   - Change only the wording of `sweep.md`.

## Risks / Open Items

- **Scorer threshold.** Narratives may still score under 0.5 (or 0.7 without
  ruvector) and be deleted. Before the entry shape is locked, the plan should
  check a sample narrative against the `staging-scorer` rubric.
- **Staleness and supersede are out of scope.** `staging-promoter` only creates
  new docs ("Never modify an existing solution doc"), so this change does not
  address stale or contradicting solution docs.
- **Deferred promotion, in a different checkout.** Promotion happens at a later
  SessionStart in the same project slug. The promoter writes into whichever
  checkout fires that drain, not into the swept PR.
- **Two ledgers.** The compound-staging ledger (yellow-core,
  `~/.claude/projects/<slug>/compound-staging/`) and the review-findings ledger
  (yellow-review, `lib/review-ledger.sh`, `/review:triage`) are different
  stores. Keep them distinct in the plan and the docs.
- **Evidence.** Don't cite PR #972 as evidence of the staleness problem. It is
  an open "add 8 compounded solution docs" PR, and the stale-doc claim wasn't
  confirmed from it.
- **Overlap.** This doesn't overlap the #950–#955 stack, which touches resolve
  scripts, dispositions and resolve-stack callers, not Step 9a or staging.
- **Secret-shaped test fixtures.** GitHub push protection rejects AWS-key-shaped
  literals: `AKIA`/`ASIA` followed by 16 characters, and 40-character
  high-entropy strings. The redaction bats fixtures must build these from pieces
  with shell quote concatenation (`'AKIA''XXXX…'`), as #952 did in
  `check-resolve-text.bats`. #952 also adds `rt_looks_secret_strict`; it is not
  on `main` yet, so `cs_stage_entry` keeps using `cs_redact_secrets`.
