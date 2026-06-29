---
title: "Borrow Turbo's spec→shells decomposition into yellow-core"
type: feat
date: 2026-06-28
brainstorm: docs/brainstorms/2026-06-28-spec-shells-decomposition-brainstorm.md
---

# Feature: Spec→Shells Multi-Session Decomposition (4 new yellow-core commands)

## Enhancement Summary

Built from a COMPREHENSIVE build brief + a decision-record brainstorm, then
hardened by three research passes (repo-research-analyst, best-practices-researcher,
spec-flow-analyzer). Key results folded in below:

- **Design sharpening (from SpecFlow P1-A):** the dependency-satisfaction oracle
  uses **exact slug match after optional date-prefix stripping**, NOT substring
  containment. The brief's "match by slug substring" wording, read literally,
  lets `depends_on: auth` falsely satisfy against `plans/complete/oauth-flow.md`.
  The precise contract closes that false-positive. (This is the brief's *intent*
  made exact, not a reversal.)
- **Six SpecFlow P1 guards baked into command contracts:** exact-match oracle
  (P1-A), deadlock/unsatisfiable-dependency detection (P1-B), expand-shell
  idempotency (P1-C), Consumes-verification failure path (P1-D), coverage table
  shown+blocked before any shell write (P1-E), missing-`plans/shells/` guard (P1-F).
- **Phase 7 (continuation-line hygiene) is confirmed N/A:** repo-research-analyst
  found **zero** SKILL.md files that invoke another skill via the `Skill` tool —
  every cross-component call in this repo goes through `Task` (agent dispatch).
  The command+subagent architecture sidesteps the "stop" problem. Phase 7 becomes
  a verify-and-document closeout, no code.
- **Validator scoping is already safe (verified):** `validate-plans.js` is
  diff-scoped to `plans/complete/` only; `plan:status` uses non-recursive globs.
  `plans/specs/` and `plans/shells/` can never trip Gate A. Phase 0 needs no
  exclusion code.
- **Exact reusable contracts located** (see Technical Specifications): the
  `plan:complete` slug regex, Gate A box-scan regex, the `(^|[/_-])SLUG($|[/_-])`
  branch match, `status.md` globs, and `work.md`'s `$RUN_DIR` reviewer pattern.

---

## Overview

yellow-core's planning tops out at one plan file per effort; `/gt-stack-plan`
stacks PRs within a single session. Neither decomposes a large, multi-subsystem
project into independent units of work — each implemented in its own fresh
session, against an explicit dependency graph with requirement-coverage
guarantees. We borrow exactly that one missing capability from Turbo
(`tobihagemann/turbo`, MIT-licensed), porting the *pattern* into the existing
marketplace as four new commands, plus two smaller refinements.

## Problem Statement

### Current Pain Points
- A single COMPREHENSIVE plan file goes stale mid-project on multi-subsystem work.
- No mechanism locks "what each session builds, what it depends on, what it
  covers" while deferring concrete file references to the moment each session runs.

### User Impact
A developer running a large effort across many sessions has no dependency-ordered,
coverage-guaranteed decomposition. They either over-plan one giant file or lose
the thread between sessions.

### Business Value
Reuses the existing, trusted `/workflows:work` + `/plan:complete` lifecycle as
the execution and completion oracle — adds the missing front-end (spec →
dependency-ordered shells → just-in-time expansion) with zero changes to the
machinery already in place.

## Proposed Solution

### High-Level Architecture

```
/workflows:spec          → plans/specs/<slug>.md          (requirements R1..Rn + design, via dialogue)
/workflows:decompose     → plans/shells/<spec-slug>-NN-*.md (dependency-ordered shells)
/workflows:pick-next-shell → picks lowest-NN unblocked shell, expands it, halts
   └─ (EXISTING) /workflows:work → ship PR → /plan:complete (archives to plans/complete/)
/workflows:pick-next-shell → next shell unblocked because its dependency is now archived
```

### Key Design Decisions (resolved in the brainstorm)
1. **Placement:** all four commands under `plugins/yellow-core/commands/workflows/`
   (one pipeline namespace; auto-discovered, no `plugin.json` edit).
2. **Naming:** `spec`, `decompose`, `expand-shell`, `pick-next-shell`. The command
   verb is `decompose`, but the artifact dir stays `plans/shells/` and the "shell"
   noun-vocabulary is retained throughout (`expand-shell`, `pick-next-shell`,
   Produces/Consumes/Covers). `/workflows:decompose` *produces shells*.
3. **Artifacts tracked in git:** `plans/specs/` and `plans/shells/` are committed.
4. **`expand-shell` kept standalone** (also callable directly), and orchestrated by
   `pick-next-shell` (pick → expand → compound → halt).

### Dependency-Satisfaction Oracle (exact-match contract — SpecFlow P1-A)
A shell's `depends_on` entries are **exact shell-slugs** (machine-readable, derived
by `decompose` from the shell filenames it generates — never prose). A `depends_on`
entry `<dep-slug>` is **satisfied** iff a file exists in `plans/complete/` whose
basename matches `^([0-9]{4}-[0-9]{2}-[0-9]{2}-)?<dep-slug>\.md$` (exact slug after
stripping an optional `YYYY-MM-DD-` archival prefix). No substring containment.

<!-- deepen-plan: external -->
> **Research (Turbo source):** Turbo's actual mechanism (fetched verbatim from `tobihagemann/turbo`) satisfies a dependency when `.turbo/plans/<slug>.md` exists with `status: done` in YAML frontmatter. Yellow plans have NO status frontmatter — so our `plans/complete/` exact-match oracle is the correct, deliberate yellow adaptation (it is precisely why we reuse `/plan:complete` as the completion oracle). Turbo's three-state `draft → ready → done` plan-frontmatter progression collapses to our two-state `plans/ (expanded) → plans/complete/ (archived)`; `pick-next-shell` therefore does NOT set a `status: ready` flag — it just halts after expansion.
<!-- /deepen-plan -->

### Shell frontmatter + body schema (the shared contract across all four commands)

```
---
spec: plans/specs/<spec-slug>.md
spec-r-ids: [R1, R2, R3, R4]   # canonical R-id set captured at decompose time (re-sync guard, P2-C)
depends_on: []                 # exact dep shell-slugs, e.g. [<spec-slug>-01-setup]
---

# Plan: <Shell Title>

## Context           (1-2 paragraphs, drawn from the spec)
## Produces          (conceptual artifacts — no file paths yet)
## Consumes          ("from Shell <dep-slug>" must appear in depends_on, OR "from existing codebase")
## Covers Spec Requirements   (bare R<N>, or "R<N> (partial: <kebab-slice>)")
## Implementation Steps (High-Level)   (numbered, conceptual — no file paths)
## Open Questions    ("None" or deferred-to-expansion items)
```

Spec/shell artifacts use numbered lists / `R<N>` IDs — **never `- [ ]` checkboxes** —
so they cannot trip Gate A even though validator globs already exclude them.

<!-- deepen-plan: external -->
> **Research (Turbo source):** Turbo's real shell schema confirms ours: frontmatter `spec:` + `depends_on:` (list of shell slugs without `.md`), body `## Context / ## Produces / ## Consumes / ## Covers Spec Requirements / ## Implementation Steps (High-Level) / ## Open Questions`. Two refinements to fold in: (1) keep `## Open Questions` even when empty (write `None`) so structure stays consistent; (2) Turbo also writes a fixed `## Expansion Deferred` boilerplate section noting what expand-shell will fill in — optional but cheap. KEY yellow divergence: Turbo's *expanded plan* uses prose `## Implementation Steps`, but ours MUST use `- [ ]` checkbox tasks because `/workflows:work` parses checkboxes as its task list — and the shell's Produces/Consumes/Covers are NOT carried into the expanded plan (they live only in the shell; we add a `## Origin` block instead).
<!-- /deepen-plan -->

### Coverage contract (SpecFlow P1-E + P2-F)
Before `decompose` writes any shell file, it displays a coverage table and **hard-blocks**
on violations:
- Every `R<N>` in the spec appears in ≥1 shell's `Covers`.
- A bare `R<N>` is claimed exactly once. Two bare claims of the same R-id = block.
- Partial slices use kebab labels (`R3 (partial: schema)`); slices for one R-id must
  be non-overlapping and together complete it. Overlap or gap = block.
- An `UNCOVERED` or `DUPLICATE-BARE` row blocks via AskUserQuestion; only an all-green
  table proceeds to file write.

<!-- deepen-plan: external -->
> **Research (Turbo source) + Codebase:** In Turbo this coverage invariant is **prose-only** — the model is told to enforce it; there is no validator script. Our blocking coverage table is therefore *stricter* than the upstream pattern. The repo has **no** existing set-union/coverage logic to reuse (confirmed), so author it inline: walk each shell's `Covers`; a bare `R<N>` seen twice = duplicate-bare error; a bare co-occurring with any `R<N> (partial: …)` = error; `uncovered = spec_R_ids − covered.keys()`. The non-overlap check across partial slices stays prose-level (slice labels are natural language) — match Turbo's intent but surface the table before the write gate.
<!-- /deepen-plan -->

---

## Implementation Plan

> Two independent workstreams. **PR 1** (Phases 0–5) is the primary deliverable.
> **PR 2** (Phase 6) is an independent refinement. Phase 7 is verify-only.
> Run `/gt-stack-plan` after if you want these formalized as a stack.

### Phase 0: Scaffolding & guards (PR 1)
- [ ] 0.1: `gt branch create feat-spec-shells-decomposition` (sync trunk first via `gt repo sync`).
- [ ] 0.2: Create `plans/specs/.gitkeep` and `plans/shells/.gitkeep` so the tracked dirs exist; confirm `.gitignore` does not exclude `plans/**`.
- [ ] 0.3: Re-confirm (already verified in research) that `scripts/validate-plans.js` is diff-scoped to `plans/complete/` and `plan:status` globs `plans/*.md` non-recursively — no exclusion code needed. Record this one-liner in the PR description.
- [ ] 0.4: Re-read `AGENTS.md` "Critical Agent Authoring Rules" (lines ~219–293) and `plugins/yellow-core/CLAUDE.md` so frontmatter/fencing rules are in context before authoring.

### Phase 1: `/workflows:spec` (PR 1)
- [ ] 1.1: Write `plugins/yellow-core/commands/workflows/spec.md`. Mirror `brainstorm.md` (dialogue-driven sibling): pre-flight `mkdir -p plans/specs` with `[spec]` prefix + hard-stop; optional ruvector recall block (query prefix `"[spec-dialogue] "`); single-line `description:`; `allowed-tools: [Bash, Read, Glob, Grep, Write, AskUserQuestion, ToolSearch, mcp__plugin_yellow-ruvector_ruvector__hooks_recall, mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities]`.
- [ ] 1.2: Implement the 7-step dialogue (per brief §4 spec): capture vision + derive slug (same `^[a-z0-9]+(-[a-z0-9]+)*$` contract as `plans/`, no date prefix, no underscores/dots — P2-G); collision-check `plans/specs/<slug>.md` via AskUserQuestion (overwrite / suffix / rename — P3-A); opening AskUserQuestion (1–4 items); requirements-before-design deep-dive (one AskUserQuestion at a time, explore codebase via Read/Grep/Glob); draft spec with stable `R<N>` IDs (every design element traces to ≥1 requirement, every component to a consumer); resolve open questions; Approve/Revise gate. On approve print: "Spec ready at plans/specs/<slug>.md. Run /workflows:decompose to decompose it."

<!-- deepen-plan: external -->
> **Research (requirement-ID stability):** Turbo and best-practice both use flat sequential `R1, R2, …`, fixed at first draft. To keep IDs stable as the spec evolves: when a requirement is removed, **tombstone** it (mark obsolete, keep the record, never reuse or renumber the ID) rather than renumbering — renumbering retroactively invalidates every shell's `Covers` field and the `spec-r-ids` drift guard (P2-C). EARS (`When <trigger>, the system shall …`) and user-story+acceptance forms are both valid in one spec; use EARS for testable behavior, user-stories for goals.
<!-- /deepen-plan -->
- [ ] 1.3: `sed -i 's/\r$//' plugins/yellow-core/commands/workflows/spec.md`; run `pnpm validate:agents`.

### Phase 2: `/workflows:decompose` (PR 1)
- [ ] 2.1: Write `plugins/yellow-core/commands/workflows/decompose.md`. Single-line `description:`; `allowed-tools: [Bash, Read, Glob, Grep, Write, AskUserQuestion]`.
- [ ] 2.2: Resolve source spec (explicit path → explicit slug → single file in `plans/specs/` → most recent); enumerate `R<N>` IDs (none → AskUserQuestion: re-run /workflows:spec or stop).
- [ ] 2.3: Decompose into dependency-ordered seams (setup → data/domain → core logic → API → UI → integration). Assign NN numbers and slugs `<spec-slug>-NN-<title>`. Set each shell's `depends_on` to the **exact slugs** of prior shells it consumes (P1-A). Bundle tightly-coupled producer/consumer pairs; keep each shell reachable/integrated.
- [ ] 2.4: Recommend shell count + confirm via AskUserQuestion (recommended first; always offer a leaner option when ≥2; round down on close calls). Single-shell bail-out: if decomposition yields one shell, write nothing — tell the user the spec is plan-shaped, use `/workflows:plan`.
- [ ] 2.5: **Coverage gate (P1-E/P2-F):** compute and display the coverage table; hard-block on UNCOVERED / DUPLICATE-BARE / overlapping-or-gapped partial slices via AskUserQuestion. Only an all-green table proceeds.
- [ ] 2.6: Collision-check every generated shell slug against existing `plans/`, `plans/complete/`, and `plans/shells/` files before writing (P2-D); on collision, AskUserQuestion to rename.
- [ ] 2.7: Write shell files to `plans/shells/` per the schema above, including `spec-r-ids:` (canonical set, P2-C) and exact `depends_on`. Enforce: every `Consumes` traces to a `depends_on` shell's `Produces` or "from existing codebase". Approve/Revise gate. On approve print: "Run /workflows:pick-next-shell to start implementing."
- [ ] 2.8: `sed -i 's/\r$//' ...decompose.md`; run `pnpm validate:agents`.

### Phase 3: `/workflows:expand-shell` (PR 1)
- [ ] 3.1: Write `plugins/yellow-core/commands/workflows/expand-shell.md`. Single-line `description:`; `allowed-tools: [Bash, Read, Glob, Grep, Write, AskUserQuestion, Task]`.
- [ ] 3.2: **Input-type + idempotency guards (P1-C, P2-A):** verify the argument is a shell file (has `spec:` and `depends_on:` frontmatter), not an already-expanded plan. If `plans/<shell-slug>.md` already exists, stop with: "Shell already expanded — plan at plans/<shell-slug>.md. Delete it and re-run to redo, or run /workflows:work." If neither shell nor plan exists, report the inconsistency and stop.
- [ ] 3.3: Parse frontmatter (`spec`, `spec-r-ids`, `depends_on`) + body. **Spec-drift check (P2-C):** compare `spec-r-ids` against the current spec's R-id set; on mismatch, warn and offer reconcile/proceed via AskUserQuestion.
- [ ] 3.4: **Verify Consumes against the live codebase (P1-D).** "from existing codebase" → grep/read to confirm presence; "from Shell <dep-slug>" → confirm its expanded plan is archived in `plans/complete/` (exact-match oracle) AND the artifact still exists now. On any failure, AskUserQuestion: (a) artifact renamed — provide new path, update shell; (b) show upstream PR to reconcile; (c) skip check — emit a visible `> WARNING: Consumes '<X>' not found at expand time` into the generated plan. Do not proceed silently.
- [ ] 3.5: Pattern survey: delegate via Task to `yellow-core:research:repo-research-analyst` (and/or `yellow-core:review:pattern-recognition-specialist`), scoped to the shell's Produces/steps. Use `run_in_background: true` + a wait gate.
- [ ] 3.6: Escalate the shell's Open Questions only (AskUserQuestion). Write the expanded plan to `plans/<shell-slug>.md` per brief §3c: checkbox tasks (`- [ ]` items) with concrete file paths + named symbols; include an `## Origin` block citing the spec path + the `Covers` R-ids (P3-D).
- [ ] 3.7: Verify plan-vs-shell: every Produces created by a step; every Consumes referenced; every Covers R-id addressed; Context preserved; no scope creep. Revise until all pass.
- [ ] 3.8: **Approval + safe deletion (P2-E, P3-C):** Approve/Revise gate whose prompt names BOTH actions and shows a plan summary ("Approve this plan and delete the shell file plans/shells/<file>?"). Only after approval, delete the source shell. If deletion fails, emit a visible warning instructing manual removal (the "expanded-but-not-cleaned" split state is handled by Phase 4).
- [ ] 3.9: `sed -i 's/\r$//' ...expand-shell.md`; run `pnpm validate:agents`.

### Phase 4: `/workflows:pick-next-shell` (PR 1)
- [ ] 4.1: Write `plugins/yellow-core/commands/workflows/pick-next-shell.md`. Single-line `description:`; `allowed-tools: [Bash, Read, Glob, Skill, AskUserQuestion]`.
- [ ] 4.2: **Missing-dir + terminal-state guards (P1-F, P2-B):** if `plans/shells/` does not exist → "No shells directory found. Run /workflows:decompose first." If it exists but is empty → terminal success: "All shells expanded and shipped — spec complete. Run /plan:status to verify." Use the `ls plans/shells/*.md >/dev/null 2>&1` existence guard before any glob.
- [ ] 4.3: Scan: glob `plans/shells/*.md`, read frontmatter. **Split-state skip (P2-E):** if both `plans/<shell-slug>.md` and the shell file exist, skip (expanded-but-not-cleaned). A `depends_on` entry is satisfied via the exact-match oracle against `plans/complete/`. Candidates = all deps satisfied; pick lowest NN; ties → AskUserQuestion.
- [ ] 4.4: **Deadlock / unsatisfiable detection (P1-B, P3-B):** if zero candidates but unexpanded shells remain, build the dependency graph and topo-sort. Report a cycle explicitly if found; otherwise report each `depends_on` slug present in neither `plans/shells/` nor `plans/complete/` by name, and offer recovery (treat-as-satisfied / re-decompose / edit-frontmatter). Never return silently.
- [ ] 4.5: Orchestrate: invoke `/workflows:expand-shell` via the Skill tool with the picked shell path; then invoke `/workflows:compound` via the Skill tool to capture planning learnings (replaces Turbo's self-improve); optionally `/workflows:deepen-plan` if yellow-research is installed (skippable).
- [ ] 4.6: Halt with: "Plan ready at plans/<shell-slug>.md. Context is likely full — run /clear, then /workflows:work plans/<shell-slug>.md. Ship it, run /plan:complete, then /workflows:pick-next-shell for the next shell." Do not auto-implement; never edit the spec.
- [ ] 4.7: `sed -i 's/\r$//' ...pick-next-shell.md`; run `pnpm validate:agents`.

### Phase 5: Wire into pipeline, docs, ship (PR 1)
- [ ] 5.1: In `plugins/yellow-core/commands/workflows/plan.md` Phase 5 (Post-Generation), add a routed option: "This is multi-subsystem — run /workflows:spec instead" when complexity reads as spec-tier.
- [ ] 5.2: Update `plugins/yellow-core/CLAUDE.md` Commands catalog: **count actual command files** (`fd . plugins/yellow-core/commands -e md | wc -l`) and set the `### Commands (N)` heading to the true value, reconciling any pre-existing drift; add prose entries for the four new commands.
- [ ] 5.3: Update `plugins/yellow-core/README.md` Commands table (add 4 rows) and the root `README.md` command count (line ~30 and the tree view ~267) — set to the true count, +4.
- [ ] 5.4: `pnpm changeset` — `yellow-core` **minor**; clear CHANGELOG entry naming the four commands.
- [ ] 5.5: Gate: `pnpm validate:schemas && pnpm validate:agents && pnpm validate:plugins && pnpm test:unit && pnpm lint && pnpm typecheck` — all green.
- [ ] 5.6: `sed -i 's/\r$//'` over all new/changed `.md`; `gt commit create` + `gt stack submit`. Verify on a clean Claude Code install (local pass ≠ remote acceptance).

### Phase 6: Bounded polish loop in `/workflows:work` (PR 2 — independent changeset)
- [ ] 6.1: In `plugins/yellow-core/commands/workflows/work.md` Phase 3, wrap the four-reviewer suite (lines ~481–513) in a re-run-until-stable loop: after the apply step, if any file changed, re-run review on changed files; cap at 2–3 iterations. Keep the existing trivial-skip gate (lines ~445–447) narrow (doc/comment/rename-only). Preserve the `$RUN_DIR` mktemp + `*.json` collection + mandatory cleanup pattern.
- [ ] 6.2: On hitting the cap with outstanding P1/P2, AskUserQuestion (continue / stop / escalate to `/council` for cross-lineage review) using the established three-option pattern.
- [ ] 6.3: `pnpm changeset` (separate, yellow-core patch/minor); gate; `sed -i 's/\r$//'`; submit as an independent PR.

### Phase 7: Continuation-line hygiene (verify-only — no PR)
- [ ] 7.1: Confirm the research finding (grep `plugins/*/skills/**/SKILL.md` for in-conversation `Skill(`/`skill:` invocation of another skill): **zero matches** — all cross-skill calls go through `Task`. Record "N/A — architecture sidesteps it" in the PR 1 description / brainstorm closeout. No file changes.

### Phase 8: Closeout
- [ ] 8.1: After PR 1 (and PR 2) merge, run `/plan:complete spec-shells-decomposition-plan.md`.

## Technical Specifications

### Files to Create
- `plugins/yellow-core/commands/workflows/spec.md` — dialogue → `plans/specs/<slug>.md`
- `plugins/yellow-core/commands/workflows/decompose.md` — spec → `plans/shells/<spec-slug>-NN-*.md`
- `plugins/yellow-core/commands/workflows/expand-shell.md` — shell → `plans/<shell-slug>.md`
- `plugins/yellow-core/commands/workflows/pick-next-shell.md` — orchestrator
- `plans/specs/.gitkeep`, `plans/shells/.gitkeep`
- `.changeset/<slug>.md` (PR 1), `.changeset/<slug>.md` (PR 2)

### Files to Modify
- `plugins/yellow-core/commands/workflows/plan.md` — Phase 5 spec-tier hint
- `plugins/yellow-core/commands/workflows/work.md` — Phase 3 polish loop (PR 2)
- `plugins/yellow-core/CLAUDE.md`, `plugins/yellow-core/README.md`, root `README.md` — command catalog/counts

### Reusable contracts (mirror exactly — from research, `path:line`)
- **Slug regex** (`plan/complete.md:85–98`): `^([0-9]{4}-[0-9]{2}-[0-9]{2}-)?[a-z0-9]+(-[a-z0-9]+)*\.md$`; derive slug = `basename` minus date prefix; underscores/dots disallowed.
- **Gate A box scan** (`plan/complete.md:127–139`): `grep -cE '^[[:space:]]*- \[ \]'` — reuse to detect checkbox presence/absence.
- **Word-boundary branch match** (`plan/complete.md:153–187`): `(^|[/_-])SLUG($|[/_-])`.
- **Non-recursive globs** (`plan/status.md:31,55–67`): `plans/*.md` open, `find plans/complete -maxdepth 1 -name '*.md'` archived; `ls ... >/dev/null 2>&1` guard before loops.
- **Reviewer suite + $RUN_DIR** (`work.md:445–447 skip gate, 458–469 mktemp, 481–513 four agents, 533–547 cleanup`).
- **Recall block** (`plan.md:49–67`) and **dual-background dispatch + wait gate** (`plan.md:82–107`).
- **Confirmed `subagent_type` strings:** `yellow-core:research:repo-research-analyst`, `yellow-core:research:best-practices-researcher`, `yellow-core:review:pattern-recognition-specialist`, `yellow-core:workflow:spec-flow-analyzer`.

<!-- deepen-plan: codebase -->
> **Codebase (line-number corrections):** Re-validation found two drifted ranges — `plan/status.md` archived block is actually lines **54–75** (the `find` is at 59), not `55–67`; `work.md` mktemp prose starts at **449** with the `mktemp` command at **459** (claimed `458–469` — command is in range, safe). All other cited ranges (slug regex 85–98, Gate A 127–139, branch-match 153–187, skip gate 445–447, four agents 481–513, cleanup 533–547, recall 49–67, dual-dispatch 82–107) verified accurate. Re-grep at implementation time regardless — these are reference commands and line numbers drift.
<!-- /deepen-plan -->

### Authoring rules that gate CI (must satisfy — from best-practices-researcher)
- Single-line `description:` (folded/multi-line scalars silently truncated; AGENTS.md:233–236). **Never `pnpm format` over `plugins/**.md`.**
- No `BASH_SOURCE` in command frontmatter/code blocks (`validate-agent-authoring.js:619–632`) — use `${CLAUDE_PLUGIN_ROOT}` or a real path.
- Every `subagent_type` must be a literal, registered 3-segment `plugin:dir:agent` string (`validate-agent-authoring.js:461–491`).
- `allowed-tools` lists only tools the body calls; include `Task` when delegating, `Skill` when invoking a command, `ToolSearch` when using deferred MCP tools.
- Fence untrusted input in `--- begin/end (reference only) ---` delimiters.
- LF endings — `sed -i 's/\r$//'` after every Write (WSL2 CRLF); `.gitattributes` forces LF.
- Any `plugins/` change requires a `.changeset/*.md` (CI blocks otherwise) + README/CLAUDE.md catalog update.

## Testing Strategy
- **Dry-run Phase 1–4 on a small real feature:** spec with 3–4 R-ids → decompose to 2–3 shells (verify coverage table, exact `depends_on`, slug/NN naming) → pick-next-shell expands shell 01 (verify idempotency guard, Consumes check, shell deleted only post-approval) → simulate `/plan:complete` archiving → pick-next-shell unblocks shell 02 via the exact-match oracle.
- **Edge cases to exercise:** single-shell bail-out; circular `depends_on` (deadlock report); missing `plans/shells/` dir; substring near-miss (shell `auth` must NOT satisfy against `plans/complete/oauth-flow.md`); re-run expand-shell on an expanded shell.
- **Phase 6:** make a change whose first-pass fix introduces a second-order issue; confirm the loop catches it and the cap→AskUserQuestion fires.
- **Gates:** the full CI baseline (5.5) on every PR.

## Acceptance Criteria
1. `/workflows:spec` writes `plans/specs/<slug>.md` with stable `R<N>` IDs and mandatory Overview/Requirements/Design.
2. `/workflows:decompose` writes dependency-ordered shells where Covers-union == full R-id set, every Consumes is backed by a `depends_on` edge or "from existing codebase", and a one-shell result bails to `/workflows:plan`. The coverage table blocks on gaps/duplicates before writing.
3. `/workflows:expand-shell` refuses to proceed on unsatisfied Consumes, is idempotent on re-run, writes a valid checkbox plan to `plans/`, passes the plan-vs-shell check, and deletes the shell only post-approval.
4. `/workflows:pick-next-shell` selects the lowest-NN shell whose deps are archived (exact-match oracle), reports deadlocks/missing-deps explicitly, signals the terminal state, and never returns silently.
5. An end-to-end 2-shell project completes using only existing `/workflows:work` + `/plan:complete` — no changes to those commands.
6. All marketplace validators pass; changesets exist; docs/counts updated; LF throughout; Graphite used for all branch/PR ops.

## Edge Cases & Guards (SpecFlow → guard mapping)
| Gap | Guard | Task |
|---|---|---|
| P1-A substring false match | exact-slug match after date strip | 2.3, 4.3 |
| P1-B deadlock/unsatisfiable dep | topo-sort + explicit report | 4.4 |
| P1-C double-expansion | plan-exists idempotency guard | 3.2 |
| P1-D Consumes diverged | 3-way AskUserQuestion + visible warning | 3.4 |
| P1-E coverage unproven | blocking coverage table before write | 2.5 |
| P1-F missing shells dir | existence guard + message | 4.2 |
| P2-A out-of-order invocation | input-type guards per command | 1.2, 3.2, 4.2 |
| P2-B terminal state silent | explicit "spec complete" signal | 4.2 |
| P2-C spec edited after shells | `spec-r-ids` frontmatter + drift warn | 2.7, 3.3 |
| P2-D slug collision | pre-write collision check | 2.6, 3.2 |
| P2-E write-then-delete split | skip expanded-but-uncleaned in picker | 3.8, 4.3 |
| P2-F partial-slice syntax | kebab labels, non-overlap check | 2.5 |
| P2-G spec slug format | same `plans/` slug contract | 1.2 |
| P3-A duplicate spec | spec-exists collision prompt | 1.2 |
| P3-D no audit trail | `## Origin` block in expanded plan | 3.6 |

<!-- deepen-plan: external -->
> **Research (deadlock detection):** For `pick-next-shell` P1-B, use Kahn's algorithm (process in-degree-zero nodes) — one O(V+E) pass yields both a valid implementation order for unblocked shells AND cycle detection (nodes with nonzero in-degree at the end are in a cycle). Turbo itself runs NO graph algorithm — it only prose-reports "these shells are blocked, waiting on X"; our algorithmic detection is an improvement. Human output: `Deadlock detected — shell-b depends on shell-c, shell-c depends on shell-b. No order satisfies both; edit a depends_on to break the cycle.` Distinguish a true cycle from an unsatisfiable-missing-dep (a slug in neither `plans/shells/` nor `plans/complete/`).
<!-- /deepen-plan -->

## Security Considerations
- Treat spec dialogue input, prior plan content, and any API/PR responses as untrusted; fence before acting (AGENTS.md). No credential values printed/written.
- Before the only destructive action (`expand-shell` shell deletion), require explicit approval naming the deletion (3.8).

## References
- Build brief + decision record: `docs/brainstorms/2026-06-28-spec-shells-decomposition-brainstorm.md`
- Patterns to mirror: `plugins/yellow-core/commands/workflows/{plan,brainstorm,work}.md`, `commands/plan/{complete,status}.md`
- Authoring rules: `AGENTS.md` "Critical Agent Authoring Rules", `plugins/yellow-core/CLAUDE.md`, `CONTRIBUTING.md` (changesets)
- Turbo source to translate: `tobihagemann/turbo` `claude/skills/{draft-spec,draft-shells,expand-shell,pick-next-shell}/SKILL.md`

<!-- deepen-plan: external -->
> **Research (primary sources fetched 2026-06-28):** Turbo's four SKILL.md files were retrieved verbatim from `https://raw.githubusercontent.com/tobihagemann/turbo/main/claude/skills/{draft-spec,draft-shells,expand-shell,pick-next-shell}/SKILL.md` and corroborate this port. Confirmed mappings: Turbo's `refine-plan` → our optional `/workflows:deepen-plan`; Turbo's `self-improve` → our `/workflows:compound` (both run by `pick-next-shell` after expand, matching task 4.5).
<!-- /deepen-plan -->
<!-- deepen-plan: codebase -->
> **Codebase (no overlap with gt-stack-plan):** Confirmed distinct — `gt-stack-plan` decomposes one feature into PR branches *within a single session* using positional `Depends on: #N` ordinals and no cross-session oracle; this pipeline decomposes into independent `plans/shells/` files scheduled *across sessions* via the `plans/complete/` exact-slug oracle with a requirement-coverage guarantee. Complementary at different granularities.
<!-- /deepen-plan -->

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

> Linear stack, executed bottom-up: #1 → #2 → #3. #2's orchestrator consumes
> #1's shell front-end (a real dependency). #3 (the `work.md` polish loop) is
> logically orthogonal but stacks cleanly on #2 — it touches only `work.md`,
> which #1/#2 never modify, so there is no conflict. Each `plugins/`-touching PR
> carries its OWN `.changeset/*.md` and incremental catalog/count update (CI
> requires one per PR): #1 adds spec + decompose (+2), #2 adds expand-shell +
> pick-next-shell (+2) and does the final count reconcile, #3 touches no command
> count. The plan + brainstorm land as a foundation commit at the bottom of #1.
> Phase 8 (`/plan:complete`) runs after merge — not part of any stack item.

### 1. agent/feat/spec-decompose-frontend
- **Type:** feat
- **Description:** add /workflows:spec + /workflows:decompose (spec → dependency-ordered shells)
- **Scope:** plugins/yellow-core/commands/workflows/spec.md, plugins/yellow-core/commands/workflows/decompose.md, plans/specs/.gitkeep, plans/shells/.gitkeep, plugins/yellow-core/CLAUDE.md, plugins/yellow-core/README.md, .changeset/
- **Tasks:** 0.1, 0.2, 0.3, 0.4, 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
- **Depends on:** (none)

### 2. agent/feat/expand-pick-next-orchestrator
- **Type:** feat
- **Description:** add /workflows:expand-shell + /workflows:pick-next-shell (JIT expansion + cross-session loop)
- **Scope:** plugins/yellow-core/commands/workflows/expand-shell.md, plugins/yellow-core/commands/workflows/pick-next-shell.md, plugins/yellow-core/commands/workflows/plan.md, plugins/yellow-core/CLAUDE.md, plugins/yellow-core/README.md, README.md, .changeset/
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1
- **Depends on:** #1

### 3. agent/feat/work-polish-loop
- **Type:** feat
- **Description:** bounded review→fix polish loop in /workflows:work Phase 3
- **Scope:** plugins/yellow-core/commands/workflows/work.md, .changeset/
- **Tasks:** 6.1, 6.2, 6.3
- **Depends on:** #2

## Stack Progress
<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. agent/feat/spec-decompose-frontend (completed 2026-06-29)
- [x] 2. agent/feat/expand-pick-next-orchestrator (completed 2026-06-29)
- [ ] 3. agent/feat/work-polish-loop
