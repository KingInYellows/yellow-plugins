# Brainstorm: Borrow Turbo's spec→shells decomposition into yellow-core

**Date:** 2026-06-28
**Status:** Decisions resolved — ready for `/workflows:plan` (or direct-to-`plans/`)
**Companion build brief:** the COMPREHENSIVE brief supplied by the user (the
self-contained build document). This brainstorm is a **decision record** that
complements — not duplicates — that brief.

## Core Idea

yellow-core's planning tops out at one plan file per effort; `/gt-stack-plan`
stacks PRs within a single session. Neither decomposes a large, multi-subsystem
project into independent units of work — each implemented in its own fresh
session, against an explicit dependency graph with requirement-coverage
guarantees. We borrow exactly that one missing capability from Turbo
(`tobihagemann/turbo`, MIT) — its spec→shells decomposition — plus two smaller
refinements, porting the *patterns* into the existing marketplace rather than
migrating onto Turbo.

## Resolved Decisions

| # | Decision | Resolution | Source |
|---|----------|-----------|--------|
| 1 | Command placement | All four under `plugins/yellow-core/commands/workflows/` | deferred to recommendation |
| 2 | Artifact tracking | **Track** `plans/specs/` and `plans/shells/` in git | user |
| 3 | expand-shell vs orchestrator | **Keep separate** | user |
| 4 | Command naming | `decompose` + `pick-next-shell` | user |

### 1 — Command placement: all four under `commands/workflows/`

The four commands form a single forward-motion pipeline
(`spec → decompose → pick-next-shell → expand-shell → work`), and every sibling
the user already chains (`/workflows:plan`, `:work`, `:review`, `:compound`)
lives under `workflows/`. `pick-next-shell` is **orchestration**, not archival
bookkeeping, so it does *not* belong in the `plan:` namespace (which is reserved
for `plan:status` / `plan:complete`). Splitting the feature across two
directories buys nothing. One tab-completable prefix keeps the mental model
coherent. (User deferred this one to the recommendation above.)

### 2 — Track the decomposition artifacts in git

`plans/specs/` and `plans/shells/` are committed, like `plans/` already is —
shareable, PR-reviewable, durable across sessions and machines. The
dependency-satisfaction oracle (`plans/complete/`) is already tracked, so the
whole lifecycle stays in one tracked corpus. (Turbo gitignores `.turbo/`; we
diverge deliberately to match the plan-lifecycle ethos.)

### 3 — Keep `expand-shell` standalone

`/workflows:pick-next-shell` orchestrates: pick lowest-NN unblocked shell →
call `expand-shell` → `compound` → halt. `/workflows:expand-shell` *also* runs
standalone, so a specific shell can be re-expanded without re-running the
picker. Matches Turbo's separation.

### 4 — Naming: `decompose` + `pick-next-shell`

Final command set, all under `commands/workflows/`:

| Command | Writes |
|---------|--------|
| `/workflows:spec` | `plans/specs/<slug>.md` |
| `/workflows:decompose` | `plans/shells/<slug>-NN-<title>.md` |
| `/workflows:expand-shell` | `plans/<shell-slug>.md` (a normal yellow plan) |
| `/workflows:pick-next-shell` | orchestrator (no artifact of its own) |

**Verb/noun ripple (record this):** the command *verb* is `decompose`, but the
artifact directory stays `plans/shells/` and the **"shell" noun-vocabulary is
retained throughout** — `expand-shell`, `pick-next-shell`,
`Produces/Consumes/Covers`, "shell files". So `/workflows:decompose`
*produces shells* — a clean verb/noun split that reads well. **Any reference in
the build brief to `/workflows:shells` or `/workflows:next-shell` must be read
as `/workflows:decompose` and `/workflows:pick-next-shell` respectively.**

## Confirmed / Grounded Technical Assumptions

### Validator scoping is already safe — Phase 0 needs no exclusion code

Confirmed by reading the code (de-risks the Phase 0 "confirm validator globs
non-recursive" task — it resolves to *confirmed, no change required*):

- `scripts/validate-plans.js` is **diff-scoped to `plans/complete/` only**
  (`git diff --name-status -z BASE...HEAD -- 'plans/complete/'`). It never sees
  `plans/specs/` or `plans/shells/`.
- `plan:status` walks `plans/*.md` (a shell glob — **no recursion**) for open
  plans and `find plans/complete -maxdepth 1 -name '*.md'` for archived.
  Subdirectories are ignored by both.

Therefore spec/shell files in `plans/specs/` and `plans/shells/` can **never**
trip Gate A or be miscounted by `plan:status`. Specs/shells additionally use
numbered lists / `R<N>` IDs (never `- [ ]` checkboxes), which is belt-and-braces
on top of the glob scoping.

### Dependency-satisfaction oracle (accepted)

A shell's `depends_on` entry is **satisfied when a file matching the
dependency's expanded-plan slug exists in `plans/complete/`** — matched by slug
*substring* (allowing an optional `YYYY-MM-DD-` archival prefix), not exact
filename. This reuses the existing `/plan:complete` Gate A/C machinery as the
completion oracle with **zero changes** to it. `expand-shell` Step 2 must also
verify the dependency's artifact *actually still exists* in the codebase
(a dependency can be archived "done" but since refactored away).

## Authoring Constraints (carry into implementation)

- The four new command `.md` files MUST use **single-line `description:`**
  frontmatter. Folded/multi-line scalars (`description: >`) and single-quoted
  values that wrap to the next line are **silently truncated** by Claude Code's
  frontmatter parser.
- **Never run `pnpm format` / prettier over `plugins/**.md`** — it refolds long
  single-line `description:` scalars into the truncated multi-line form, and
  `format:check` is in no CI workflow, so the damage ships silently.
- All new files need **LF line endings** (`sed -i 's/\r$//'` after Write on
  WSL2).
- These are **commands, not skills** — auto-discovered under
  `commands/workflows/`, so no `plugin.json` edit is needed for discovery
  (a `pnpm changeset` minor bump to yellow-core is still required by CI).

## Explicitly NOT Ported From Turbo

Borrow the decomposition pattern and nothing else:

- Turbo's flat `~/.claude/skills` distribution (we use the marketplace).
- `consult-oracle` (macOS-only).
- Single-Codex peer review — yellow-council (cross-lineage) is stronger.
- Turbo's markdown memory — ruvector / MemPalace is stronger.
- `refine-plan` review loop — `/workflows:plan` already front-loads research
  (optionally substitute `/workflows:deepen-plan`).

Two smaller refinements *are* in scope but ship as separate PRs/changesets:
the bounded polish loop in `/workflows:work` Phase 3, and the continuation-line
hygiene pass on nested skills.

## Next Step

The build brief is detailed enough that planning may be near-trivial. Two paths:

1. Run `/workflows:plan` — it will auto-detect this brainstorm and produce a
   plan (likely a light pass given the brief's depth).
2. Or save the build brief directly into `plans/`, renamed to a kebab-case
   `*-plan.md` (e.g. `plans/spec-shells-decomposition-plan.md`) so it passes
   `/plan:complete`'s slug regex, then run `/workflows:work` on it. If you do
   this, strip or check the illustrative `- [ ]` lines inside the brief's fenced
   template blocks so they don't read as real worklist items.

Either way, Phase 1 (`/workflows:spec`) is the primary deliverable; Phases 6–7
(polish loop, continuation hygiene) can ship as independent follow-up PRs.
