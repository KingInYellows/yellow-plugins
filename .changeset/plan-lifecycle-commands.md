---
'yellow-core': minor
---

feat(yellow-core): `/plan:status` and `/plan:complete` lifecycle commands
for the plan-archival corpus

Adds two commands under the new `/plan:*` namespace, sibling to
`/workflows:plan` (plan creation lives under `/workflows:*`; lifecycle
ops on existing plans live under `/plan:*` — namespace split documented
in `plugins/yellow-core/CLAUDE.md`).

- **`/plan:status`** — read-only dashboard. Walks `plans/*.md` (open)
  and `plans/complete/*.md` (archived), counts checked / unchecked task
  boxes per file, renders a plain-text table. Open plans at 100% are
  annotated `-- ready to complete`.
- **`/plan:complete <plan>`** — archive a single open plan via two
  gates:
  - **Gate A** scans the plan body for `^[[:space:]]*- \[ \]`; any
    unchecked task box is a hard block.
  - **Gate C** queries GitHub for a merged PR via
    `gh pr list --state merged --search 'in:title "<slug>"'` and
    post-filters on `headRefName` with a word-boundary regex
    (`^|$|/|_|-` around `<slug>`). Word-boundary protection blocks
    short/generic slugs (e.g., `refactor`) from matching unrelated
    branches. NO-EVIDENCE prompts via `AskUserQuestion` with an
    `Other` (free-text) option for a PR-number override; the decision
    is recorded as a `Plan-Verifier-Override:` commit trailer.
  - Archival branch is `plan/archive-<slug>`; the rename is staged via
    `git mv` and submitted with `gt submit --no-interactive`.

Companion (already shipped in the bottom of the stack — PR #556):

- `scripts/validate-plans.js` — PR-diff-scoped CI gate that enforces
  the same Gate A rule on `plans/complete/*.md` files added or modified
  in the diff. Catches premature archival without re-touching legacy
  dirty plans (54 % of the 71-file archived corpus has stray boxes as
  of 2026-05-28; PR-scoping sidesteps them entirely).
- `ErrorCategory.PLAN_LIFECYCLE` + `ERROR-PLAN-001` (PLAN_STRAY_CHECKBOX)
  in the canonical catalog at `packages/domain/src/validation/`.

Smoke tests at `plugins/yellow-core/tests/plan-commands.bats` exercise
the slug-derivation regex and the Gate A `grep -c` regex on fixtures
(14 cases, all passing). End-to-end `/plan:complete` flow involves
`AskUserQuestion` + `gh` + `gt` and is documented as a manual
verification checklist in `plans/plan-lifecycle-management.md`.

Solution doc at `docs/solutions/workflow/plan-lifecycle-management.md`
captures the load-bearing decisions (runtime slug derivation,
single-`gh`-call Gate C, override trailer convention, PR-diff scoping
rationale).
