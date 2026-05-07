# Audit Followups — 2026-05-07

## What We're Building

This document records the decisions made after the 2026-05-07 read-only audit of the
yellow-plugins marketplace (see `AUDIT_REPORT.md` in the repo root). The audit produced
10 prioritized improvement items and 7 open risks; this brainstorm dialogue worked through
all of them and assigned each a disposition: apply, defer, or split.

---

## Decisions Table

| Item | Disposition | One-line rationale |
|---|---|---|
| C-02 | Apply | Mechanical 3-line fix removes 3 INFO warnings; plan.md is the most-used entry point |
| X-02 | Apply | Active release blocker — hard ERROR on a correct CHANGELOG entry |
| H-01 | Apply | Biggest user-visible perf win; async pattern removes the blocking 30s cold-session cost |
| X-01 | Apply | Declares silent cross-plugin deps that currently fail opaquely at runtime |
| A-01 | Apply | Completes an existing pattern; 5 deep-analysis personas need opus for quality guarantees |
| M-01 | Apply (extended) | Fix 14→18 + add lint to prevent recurrence; no automation currently catches the drift |
| M-02 | Apply | Clears the lone WARNING from `pnpm validate:schemas`; one command |
| C-01 | Defer + document | No concrete collision trigger; rename costs exceed theoretical risk; note the exception |
| A-02 | Split | Phase 1 (read-only agents) applies now; Phase 2 (write-capable agents) needs per-agent judgment |
| S-01 | Defer | 13 lines over a soft cap on a working skill; no proven duplication found |
| Risk 1 | Resolved | Obsoleted by X-02 apply — validator workaround no longer needed |
| Risk 2 | Inherited | X-01 acceptance criteria include a fresh-install smoke test gate |
| Risk 5 | Apply | Add `validate-doc-counts.js` lint wired into `release:check` |
| Risk 6 | Out of scope | Changeset enforcement gap is a separate audit topic |
| Risk 7 | Deferred | Empirical latency timing is a separate project from the H-01 async fix |

---

## Why This Approach

The dialogue surfaced a consistent preference: fix things that are broken or actively
blocking, document things that are theoretical, and defer anything that requires a
judgment call across 20+ files. The split on A-02 reflects this — the obvious read-only
restrictions are unambiguous, while write-capable agent restrictions need per-agent
analysis that belongs in its own pass.

C-01 was the only item where the answer was "you don't need to do anything" — the audit
trigger was anxiety about future collisions, not an actual problem. The CLAUDE.md note
resolves that for future contributors without incurring rename churn.

---

## Key Decisions

### Apply items with acceptance criteria

#### C-02 — Fix legacy 2-segment subagent_types in `plan.md`
- **File:** `plugins/yellow-core/commands/workflows/plan.md` lines 90, 98, 132
- **Changes:**
  - `yellow-core:repo-research-analyst` → `yellow-core:research:repo-research-analyst`
  - `yellow-core:best-practices-researcher` → `yellow-core:research:best-practices-researcher`
  - `yellow-core:spec-flow-analyzer` → `yellow-core:workflow:spec-flow-analyzer`
- **Verify:** `pnpm validate:agents` shows no INFO warnings on these three values
- **Changeset:** patch bump on yellow-core

#### X-02 — Fix validator CHANGELOG false positive
- **File:** `scripts/validate-agent-authoring.js`
- **Approach:** frontmatter-only matching — only flag `subagent_type:` values found inside
  YAML frontmatter blocks (between `---` delimiters), not in prose, code fences, or CHANGELOG entries
- **Rationale for approach:** skip-CHANGELOG-entirely would also miss a future README or
  solution doc that documents a deleted agent; frontmatter-only matches the validator's
  actual intent ("catch broken declarations")
- **Verify:** `pnpm release:check` passes cleanly; `yellow-review/CHANGELOG.md` no longer
  triggers the hard ERROR
- **Changeset:** not required (scripts/ change, no plugin content change)

#### H-01 — Morph prewarm async background
- **Files:**
  - `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`
  - `plugins/yellow-morph/.claude-plugin/plugin.json`
- **Changes:**
  - `prewarm-morph.sh`: parent process emits `{"continue": true}` immediately; actual
    prewarm work runs in a detached background subshell (`( prewarm_work ) & disown`)
    before the JSON output line
  - `plugin.json`: lower SessionStart `timeout: 30` → `timeout: 5` (parent exits in <1s;
    the 5s is a defensive ceiling in case the parent itself stalls)
- **Edge case to document in prewarm-morph.sh:** if the user invokes a morph tool within
  ~30s of session start on a slow connection, they may still hit a cold cache. This is the
  accepted trade-off.
- **Verify:** session start no longer blocks; background process does not leave zombie
  children (standard `& disown` handles this); `pnpm validate:schemas` passes
- **Changeset:** patch bump on yellow-morph

#### X-01 — Declare cross-plugin MCP dependencies
- **Files:**
  - `schemas/plugin.schema.json` — add optional `dependencies` array field
  - `scripts/validate-plugin.js` — warn (not error) when a declared dep isn't in the
    marketplace catalog
  - `plugins/yellow-debt/.claude-plugin/plugin.json` — add `dependencies: [{plugin: "yellow-linear", reason: "debt:sync uses mcp__plugin_yellow-linear_linear__create_issue"}]`
  - `plugins/yellow-ci/.claude-plugin/plugin.json` — same pattern for yellow-linear
  - `plugins/yellow-chatprd/.claude-plugin/plugin.json` — same pattern for yellow-linear
- **Field shape (recommendation, final shape is implementation's call):**
  ```json
  "dependencies": [
    { "plugin": "yellow-linear", "reason": "string" }
  ]
  ```
- **Verify:** `pnpm validate:schemas` passes; validator warns (not errors) on a manifest
  that declares a dep not in marketplace.json
- **Required gate:** fresh `claude plugin install` smoke test on a clean machine before
  tagging any release that ships this schema change (Risk 2 — local CI passing does not
  guarantee remote validator acceptance)
- **Changeset:** patch bumps on yellow-debt, yellow-ci, yellow-chatprd; scripts/ change
  does not require a changeset

#### A-01 — Pin models on deep-analysis review personas
- **Files (5 agent `.md` files):**
  - `plugins/yellow-core/agents/review/security-sentinel.md` → `model: claude-opus-4-5` (or current opus)
  - `plugins/yellow-core/agents/review/performance-oracle.md` → opus
  - `plugins/yellow-core/agents/review/adversarial-reviewer.md` → opus
  - `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md` → opus
  - `plugins/yellow-review/agents/review/agent-native-reviewer.md` → opus
- **Existing pinned agents (do not change):** `architecture-strategist`, `audit-synthesizer`,
  `research-conductor` → opus; `coherence-reviewer` → haiku; `design-lens`,
  `scope-guardian`, `security-lens-reviewer` → sonnet
- **Verify:** `pnpm validate:agents` clean; each file's frontmatter has a single-line
  `model:` field
- **Changeset:** patch bumps on yellow-core and yellow-review

#### M-01 — Fix plugin count + add lint
- **Reactive fix:** `CLAUDE.md` line 8 — update `"14 plugins"` → `"18 plugins"`
- **Preventive fix — new file:** `scripts/validate-doc-counts.js` (~50 lines)
  - Reads `.claude-plugin/marketplace.json` to derive the canonical plugin count
  - Greps `CLAUDE.md`, `README.md`, and any other root-level narrative docs for patterns
    matching `\d+ plugins`, `\d+ consumers`, `\d+ marketplace plugins`
  - Fails with non-zero exit code if any claim mismatches the canonical count
  - Prints a clear message naming the file, line, found count, and expected count
- **Wire into release pipeline:** add `node scripts/validate-doc-counts.js` to `pnpm release:check`
  (or as a standalone `pnpm validate:doc-counts` that release:check calls)
- **Verify:** `pnpm release:check` passes after M-01 reactive fix; adding a fake
  "17 plugins" string to CLAUDE.md triggers the lint failure
- **Changeset:** not required (CLAUDE.md edit is repo-level, not a plugin change; scripts/ change has no changeset requirement)

#### M-02 — `chmod +x` morph prewarm hook
- **File:** `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`
- **Change:** `chmod +x` — hook already works (invoked via `bash script.sh`) but this
  clears the lone WARNING from `pnpm validate:schemas`
- **Verify:** `pnpm validate:schemas` produces no WARNING on this file
- **Changeset:** patch bump on yellow-morph (can bundle with H-01)

#### A-02 Phase 1 — Tool restrictions on read-only research agents
- **Approach:** add `tools: [Read, Grep, Glob]` to agents that have no legitimate need
  for workspace modification
- **Files (confirmed read-only research agents):**
  - `plugins/yellow-core/agents/research/learnings-researcher.md`
  - `plugins/yellow-core/agents/research/repo-research-analyst.md`
  - `plugins/yellow-core/agents/research/best-practices-researcher.md`
  - `plugins/yellow-core/agents/research/git-history-analyzer.md` — may need `Bash` for
    git commands; verify before restricting to Read/Grep/Glob only
  - `plugins/yellow-core/agents/workflow/spec-flow-analyzer.md`
  - `plugins/yellow-research/agents/research/code-researcher.md` (verify agent path)
  - `plugins/yellow-codex/agents/research/codex-analyst.md` (verify agent path)
  - `plugins/yellow-linear/agents/research/linear-explorer.md` (verify agent path)
- **Note:** verify each file's actual path before editing — agent paths above are inferred
  from the audit's 3-segment FQDNs; use `find plugins -name '<agent>.md'` to confirm
- **Verify:** `pnpm validate:agents` clean; each file's `tools:` field is populated
- **Changeset:** patch bumps on affected plugins

---

### C-01 — gt-workflow namespace exception (defer + document)

No command rename. Add a "Namespace exception" section to
`plugins/gt-workflow/CLAUDE.md` with the following content (exact wording is implementation's
call, but these three points must be covered):

1. The 7 commands (`gt-amend`, `gt-sync`, `gt-nav`, `gt-stack-plan`, `gt-cleanup`,
   `gt-setup`, `smart-submit`) ship un-namespaced intentionally — they predate the
   `plugin-name:command` namespacing convention.
2. Collision risk is low: six of the seven are `gt-`-prefixed and no other plugin would
   plausibly register them. `smart-submit` is the only generic name; no competing plugin
   has been observed shipping it.
3. Future contributors and auditors should not re-flag this without a concrete trigger
   (an actual collision or an incoming plugin that would clash).

Changeset: patch bump on gt-workflow for the CLAUDE.md edit, OR skip if the team treats
CLAUDE.md-only changes as no-bump. Recommendation: skip — this is documentation of an
existing convention, not a behavior change.

---

## Open Questions

1. **X-01 field shape** — the brainstorm recommends `{plugin, reason}` for each dep entry,
   but the exact field names and whether to support version constraints is left to the
   implementation pass.
2. **git-history-analyzer tools** — needs `Bash` for git commands. Verify whether
   `[Read, Grep, Glob, Bash]` is the right restriction or whether it should be unrestricted.
3. **A-02 agent paths** — the 8 agents listed for Phase 1 are inferred from 3-segment FQDNs;
   confirm each file's actual path before editing.
4. **yellow-research and yellow-codex agents** — `code-researcher` and `codex-analyst` need
   path verification; the audit's Phase 1 list is best-effort on those two.

---

## Suggested PR Slicing

Group the 11 apply items into 6 stacked PRs. Stack them so reviewers see the release
blocker first and the schema change (which needs an install smoke test) isolated.

| PR | Items | Why grouped |
|---|---|---|
| PR 1 | X-02 | Release blocker — merge this first to unblock `pnpm release:check` |
| PR 2 | C-02, M-01 (reactive), M-02, C-01 doc note | All mechanical / single-file; one small commit each; one changeset covers yellow-core + gt-workflow + yellow-morph |
| PR 3 | H-01 | Perf change isolated; easier to revert if async pattern behaves unexpectedly |
| PR 4 | X-01 | Schema + manifest change; **must not tag a release until fresh-install smoke test passes** |
| PR 5 | A-01, A-02 phase 1 | Agent frontmatter; same reviewer can check both; validate:agents covers both |
| PR 6 | M-01 (lint), validate-doc-counts.js | Preventive infrastructure; low risk, no plugin touches |

PRs 2 and 6 can land in any order relative to each other. PR 4 is the only one with an
explicit external gate before release.

---

## Items NOT Addressed in This Cycle

**A-02 Phase 2 — write-capable agent tool restrictions**
Deferred because write-capable agents (`correctness-reviewer`, `silent-failure-hunter`,
`code-simplifier`, persona reviewers with autofix paths) require per-agent judgment on
whether `Edit`/`Write` are legitimate. This belongs in a separate `/workflows:brainstorm`
pass tagged "A-02 phase 2."

**S-01 — `create-agent-skills` SKILL.md redundancy audit**
Deferred because 513 lines is 13 over a soft cap on a working skill, and the audit did not
prove actual duplication. If the skill grows further or a content audit surfaces verbatim
overlaps with `optimize/SKILL.md` or `git-worktree/SKILL.md`, address it then.

**Risk 6 — changeset enforcement gap**
Out of scope for this audit. The changeset gate and version-sync rules were assumed working
because `validate-versions.js` is part of the validation chain. A dedicated audit of the
CI enforcement layer is a separate project.

**Risk 7 — empirical hook latency measurement**
The H-01 async fix is correct on principle (session-start blocking 30s is objectively bad).
A real cold-start timing harness (hooks-debug enabled, representative machine) would
validate the fix and establish a baseline for H-02 (ruvector 1s timeout). Deferred as a
separate project.
