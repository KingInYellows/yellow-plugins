# Plan Lifecycle Management

**Date:** 2026-05-08
**Status:** Superseded for several decisions by `plans/plan-lifecycle-management.md`. Preserved for historical context only — do NOT delete (protected-artifact policy). The frontmatter convention discussed below was added during planning and then dropped after PR #484 review (issues #494 and #496); the final design uses runtime slug derivation from filename, a single-`gh`-call Gate C (no LLM agent), and a PR-touched-files validator scope. Annotations inline below mark the divergent decisions.

## What We're Building

A plan lifecycle management system living in yellow-core that gives the plugin
system authoritative knowledge of which plans are open and which are complete,
with validation that completion is real — not just a flag the user set.

Two new commands extend the existing `/workflows:*` surface in yellow-core:

- `/plan:status` — read-only dashboard: lists open plans (`plans/*.md`) and
  archived plans (`plans/complete/*.md`), annotating each with checkbox
  completion percentage and any known PR merge status
- `/plan:complete <plan-filename>` — explicit archival command that runs two
  validation gates before moving the file:
  1. **Gate A (structural):** All `- [ ]` checkboxes in the plan are checked
     off. Cheap pre-check; fails fast before the agent runs.
  2. **Gate C (semantic):** A lightweight verification agent reads the plan,
     queries `gh` for a merged PR associated with the plan's branch, checks
     that files mentioned in the plan exist on disk, and confirms commits
     referencing the plan landed on main. If all three pass, archival proceeds.
     **(Superseded — see plan):** the LLM verification agent and the
     file-existence + commit-landing checks were dropped during PR #484
     review (#496 YAGNI reduction). The final design uses a single
     `gh pr list --search "in:title $SLUG" --state merged` call inside
     the command itself; no agent, no file-existence check, no commit-log
     scan. Squash-merge resilient because GitHub keeps PR titles regardless
     of merge strategy.

A new `scripts/validate-plans.js` CI validator ensures no plan file in
`plans/complete/` has unchecked boxes — catching manual archival that skipped
the gate.

## Why This Approach

**Friction is real.** Six archival commits landed in two days
(`6f883f7c`, `f056390c`, `3e9baf4d`, `0538866b` and peers), all manual
`git mv` + commit cycles. That's the actual pain — not missing dashboards.

**`/workflows:work` cannot own this.** Work executes during development, before
merge. Completion validation requires post-merge state: a closed PR, commits on
main, artifacts on disk. Splitting into a dedicated `/plan:complete` command
respects that boundary cleanly.

**Two gates, not one.** Checkbox coverage (Gate A) is a mechanical contract
the plan author already made with themselves when writing tasks. The agent
re-review (Gate C) adds semantic confidence: did the right files actually land,
did a PR actually merge? Together they prevent both lazy checkbox-ticking and
accidental archival of stalled work.

**(Superseded — see plan):** "agent re-review" is no longer accurate. Gate C
collapsed to a single `gh pr list` call (no agent in the loop). The
"semantic confidence" claim above survives in spirit — finding a merged PR
whose title matches the slug is itself the semantic check — but no LLM
runs and no on-disk file-existence audit happens.

**No new plugin needed.** Yellow-core already owns the planning surface
(`/workflows:plan`, `/workflows:work`, `/workflows:brainstorm`). Adding
`/plan:status` and `/plan:complete` under a `plan/` subdirectory of commands
follows the same pattern as `workflows/` — zero new plugin manifest overhead.

**Filesystem convention stays unchanged.** _(NOTE: The "no frontmatter required" position below was briefly reversed during planning, then restored in revision after PR #484 review (issues #494, #496). Final design: no frontmatter; the slug is derived at runtime from the filename via `basename "$PLAN" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//'`. The directory split remains the single source of truth for state. See `plans/plan-lifecycle-management.md`.)_ Plans remain plain markdown files.
No frontmatter required. The `plans/` vs `plans/complete/` directory split is
the single source of truth for open vs archived — the same convention already
in use, now enforced by CI.

## Key Decisions

### Command placement in yellow-core

New directory: `plugins/yellow-core/commands/plan/`

```
plugins/yellow-core/commands/plan/
  status.md      → /plan:status
  complete.md    → /plan:complete
```

This mirrors how `commands/workflows/` is laid out and keeps the namespace
intuitive (`/plan:*` = plan lifecycle, `/workflows:*` = execution flows).

### Gate A: checkbox coverage (structural pre-check)

Before spawning any agent, `/plan:complete` runs a Bash check:

```bash
UNCHECKED=$(grep -c '^\s*- \[ \]' "$PLAN_FILE" || true)
[ "$UNCHECKED" -eq 0 ] || { printf '[plan:complete] %d unchecked tasks remain\n' "$UNCHECKED"; exit 1; }
```

This is instant and cannot be argued with. If it fails, the user sees exactly
how many tasks are unfinished. No agent token spend until this passes.

### Gate C: semantic evidence review (agent)

A Task-spawned verification agent receives the plan content (injection-fenced
as reference only) and performs three checks:

1. **PR merge check:** `gh pr list --state merged --search "<plan-slug>"` — if
   no merged PR found, the agent surfaces a warning and asks the user to
   confirm override or provide a PR number manually.
2. **File existence check:** The agent reads the plan, extracts file paths or
   component names mentioned under "Proposed Solution" / task steps, and
   verifies they exist on disk via Glob/Read.
3. **Commit landing check:** `git log main --oneline --grep="<plan-slug>"` —
   confirms at least one commit referencing the plan name landed on main.

All three must pass for automatic archival. If any check is uncertain (e.g.,
PR search returns ambiguous results), the agent presents findings and asks via
`AskUserQuestion` before proceeding — never silently skips.

### Archival mechanics

On success, `/plan:complete` moves the file and creates the commit:

```bash
gt branch create "plan/archive-<slug>"
mv "plans/<file>" "plans/complete/<file>"
gt commit create -m "docs(plans): archive completed <slug> plan"
gt stack submit
```

The user gets a Graphite PR for the archival — keeping the git history clean
and the merge queue flow intact.

### CI validator: validate-plans.js

New script at `scripts/validate-plans.js`, invoked as `pnpm validate:plans`.

Rules enforced:
- Every file in `plans/complete/*.md` must have zero `- [ ]` occurrences
  (unchecked boxes in an archived plan = bypassed gate)
- Every file in `plans/*.md` (open) is valid by existence alone — no rules on
  open plans except that they must be `.md` files

Added to `pnpm release:check` alongside the existing `validate:schemas` chain.

**(Superseded — see plan):** `validate:plans` is wired as a separate
top-level CI step, NOT into `release:check`. Different concern per
project CLAUDE.md — release-readiness vs. plan-corpus health. See
`plans/plan-lifecycle-management.md` Phase 1 for the final wiring.

### /plan:status output format

Plain text table, no external dependencies:

```
OPEN PLANS (3)
  yellow-rtk-plugin.md              [ 4/12 tasks ]
  yellow-symphony-plugin.md         [ 0/8 tasks  ]
  ast-grep-integration.md           [ 11/11 tasks ] -- ready to complete

ARCHIVED PLANS (14)
  plans/complete/everyinc-merge-wave3.md
  plans/complete/audit-followups-2026-05-07.md
  ... (12 more)
```

Plans with 100% checkbox coverage get a `-- ready to complete` annotation as a
nudge to run `/plan:complete`.

## Open Questions

1. **PR search heuristic:** The Gate C PR check uses the plan filename as a
   search term. Plans named generically (e.g., `refactor.md`) may return
   ambiguous results. Should `/workflows:plan` write the plan filename into the
   plan body as a stable identifier, or should `/plan:complete` ask the user
   for a PR number explicitly when the search is ambiguous?
   **(Resolved in plan):** Slug is derived at runtime from the filename
   (no frontmatter); the `--jq` post-filter requires a word-boundary match
   on `headRefName` (`(^|[/_-])$SLUG($|[/_-])`) which mitigates generic-slug
   collisions. When the search returns zero matches, `/plan:complete` prompts
   the user via `AskUserQuestion` for explicit PR-number confirmation, and
   captures the override in a `Plan-Verifier-Override:` commit trailer.

2. **Multi-PR plans:** Large features (e.g., the everyinc merge wave series)
   ship across multiple PRs. Gate C currently expects one merged PR. Should
   the agent accept "any merged PR referencing this plan" or require a
   user-supplied PR list?
   **(Resolved in plan):** Gate C PASSES when `COUNT >= 1` — any merged
   PR whose title contains the slug is sufficient evidence the plan
   shipped. Multi-PR plans are handled implicitly: the first matching
   merged PR satisfies the gate, and the user can override via the
   no-evidence path with an explicit PR number if the search is
   ambiguous (Plan-Verifier-Override commit trailer).

3. **validate-plans.js scope creep risk:** The validator could grow to check
   for plan naming conventions, required sections, etc. Keep it to the one
   rule above for now — unchecked boxes in complete/ only. Resist expansion
   until a specific failure mode demands it.

4. **Stale open plans:** `/plan:status` will surface plans that have been
   sitting open for weeks with zero progress. Worth adding an age annotation
   (last modified date) in a follow-up, but not in v1.

## Considered Alternatives

**Frontmatter-based status field** (`status: complete` in plan YAML): Rejected.
User-settable flags are exactly what the C gate is designed to replace. A field
the user writes is trivially wrong. Directory position is a stronger signal
because it requires the archival command to have run.

**Hooking into `/workflows:work` for automatic completion detection:**
Rejected. `/workflows:work` runs during execution, before merge. It has no
reliable way to know the branch merged. The explicit `/plan:complete` call
respects the actual workflow boundary.

**New dedicated plugin (yellow-plans):** Rejected as YAGNI. Yellow-core already
owns the planning surface. A new plugin adds manifest overhead, a separate
version track, and install friction for what is essentially two command files
and one script.

**Linear integration for plan tracking:** Deferred. Linear adds external
dependency and sync complexity. The filesystem convention is self-contained and
works offline. Revisit if the team grows beyond the current solo/small-team
context.
