# Handoff: /review:sweep-all close-out for PRs #670–#672

## Current task

A full /review:sweep-all batch over the three open PRs (#670 yellow-council
Write-tool staging, #671 cross-plugin contract-wording follow-ups, #672
plan-archive rename) ran to completion on 2026-07-28/29. Every PR was
multi-agent reviewed (17/17/5 reviewers), all P0/P1 findings fixed and
pushed, and every review thread resolved (9 + 5 + 0). This handoff captures
the loose ends left deliberately uncommitted or deferred.

## Workflow status

> **Status: COMPLETE — retrospective record.** All three PRs merged, and
> all follow-on work tracked in this handoff has since shipped (PRs
> #676–#680). See the EXECUTED postscript at the bottom of this file for
> final disposition; the "awaiting merge" language immediately below is
> a point-in-time snapshot from 2026-07-29, superseded by that postscript.

Batch complete. All three PRs are green from the sweep's perspective and
awaiting the user's merge decision (Graphite queue). #670 and #671 are
stacked (671 on 670); #672 is independent off main. No sweep work remains.

## Active artifacts

- PR #670 — branch agent/fix/deferred-security-followups (4 sweep
  commits; pre-rebase hashes were discarded by the merge queue — the
  merged squash commit on main is 67865ade; cite by message/PR, not
  pre-rebase hash)
- PR #671 — branch agent/fix/deferred-review-followups (stacked on #670;
  sweep commits landed in merged squash commit 4b35a760)
- PR #672 — branch agent/plan/archive-review-schema-and-codex-references-followups
  (untouched by sweep; clean review)
- plans/handoff/2026-07-28-pr666-667-deferred-review-followups.md — the
  PREVIOUS session's handoff listing deferred #666/#667 follow-up work;
  much of its Tier 1 was implemented by PRs #670/#671, but it has NOT been
  audited line-by-line against what shipped. Do that before acting on it.

## Open decisions

1. Where to land two uncommitted batch-compound docs currently sitting on
   #672's branch (deliberately not committed — would mix scope with the
   plans-archive PR): amend into an existing PR, or a small standalone
   docs PR. Files listed under In-flight changes.
2. Residual P2s from the sweep (candidates for one follow-up PR):
   - devin-orchestrator.md non-interactive max_acu_limit omission — design
     question: default cap vs omit-with-disclosure; also "no user
     available" has no detectable trigger condition (4 reviewers)
   - semgrep fix.md has no branch for scan-verifier's documented "Cannot
     verify — semgrep CLI not found" outcome (flow reaches commit with a
     Verified: claim)
   - ruvector memory-manager.md unbounded retry of persistently-failing
     file_change batches (no attempt cap)
   - yellow-council: Write-grant rationale duplicated verbatim between
     gemini/opencode reviewers (centralize in council-patterns SKILL.md);
     FINDINGS length cap; gemini -p "$(cat ...)" ARG_MAX risk
   - rescue.md prose still says "8-pattern redaction block" in
     codex-patterns SKILL.md + yellow-codex CLAUDE.md — now 9 patterns
     (AIza added) — prose-count drift
   - resolve-pr.md:97 unguarded 2> redirect after mktemp (zsh noclobber;
     grep-confirmed, not fixed — plugin files were frozen at the time)
3. Whether to introduce a canonical-source + drift lint for the
   AskUserQuestion "Other"-label rule (15+ restatement sites, architecture
   reviewer recommendation, RULE-16 precedent).

## In-flight changes

- M docs/solutions/code-quality/automated-bot-review-false-positives.md
  (FP7 extended to pre-dispatch stale-bot-thread check)
- A docs/solutions/workflow/compounder-m3-gate-non-interactive.md (new)
- ?? plans/handoff/ (this file + the 2026-07-28 predecessor)

## Next concrete action

> **SUPERSEDED — do not execute.** These steps were carried out on
> 2026-07-29; see the EXECUTED postscript below before acting on
> anything in this section.

Decide placement for the two uncommitted docs/solutions files (open
decision 1) and land them; then merge the three PRs via the Graphite queue
(670 → 671 stacked, 672 independent). After merge: gt repo sync, then audit
plans/handoff/2026-07-28-pr666-667-deferred-review-followups.md against
what #670/#671 actually shipped and fold the still-open items into the
residual-P2 follow-up PR (open decision 2).

---

## EXECUTED 2026-07-29 (session_01Pp9szNyFFYzYj7Jbw22szX)

All next actions complete: docs landed via PR #674 (after substantive
bot-review corrections to the compounder-M3 doc), #670/#671/#672 merged
via Graphite queue (required first landing #673 — snapshot regen; see
memory: version-packages-breaks-characterization-snapshot), predecessor
handoff audited (items 1–12 shipped; 13–19 were not), residual P2s +
open Tier-4 items implemented in PR #676. Still deferred by design at
that point: devin-orchestrator cap semantics, generate-manifests
pollution scoping (item 16), low-value polish (item 19) — all three
since decided (brainstorm + plans/sweep-670-672-deferred-design-decisions.md,
committed alongside this file) and implemented via PRs #677, #678, #679,
with the Codacy MD041 item shipping as PR #680.
