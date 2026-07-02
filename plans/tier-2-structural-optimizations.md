# Feature: Tier 2 Structural Optimizations (C6–C11)

Source: `docs/optimization/analysis.md` §4 Tier 2 (approved 2026-07-01).
Detail level: COMPREHENSIVE. Five independently-shippable structural items
(C6–C10) plus one decision-gate item (C11). Each phase below is its own PR;
no phase depends on another unless stated.

## Overview

Adopt the structural patterns the Phase 1 benchmark proved out in the two
reference systems: CE-style progressive disclosure for oversized skill/command
files, sentinel-plus-lint drift control for a duplicated cross-plugin protocol,
one documented scope/mode interface, session-survivable execution state in
plan files, and CI enforcement of the repo's own (currently prose-only)
authoring standards.

**Verification honesty note:** C6's core mechanism — an agent actually Reading
a reference file at runtime — cannot be observed by CI. Acceptance for C6 is
CI-verifiable proxies (stub present, path resolves, no content loss) plus a
manual e2e checklist, the same method accepted for `/council` (PR #3 history).

## Problem Statement

`docs/optimization/analysis.md` §3.2–§3.5: only 6/39 skills use reference-file
offload; 12 commands exceed 500 lines and load fully on every invocation; the
ruvector memory protocol is specified twice across plugins with no drift gate;
scope/mode conventions are per-command inventions; non-stack `/workflows:work`
progress dies with the session; three authoring rules are claimed-but-not-
enforced; three memory systems answer the same trigger phrases.

<!-- deepen-plan: codebase -->
> **Codebase:** Counts verified: 39 skills and 12 commands >500 lines are
> exact. The "6/39 offload" figure is `analysis.md`'s own and internally
> inconsistent — the true count of currently *wired* reference-offload skills
> is 5 (ci-conventions, create-agent-skills, git-worktree, devin-workflows,
> library-context). A 6th, `plugins/yellow-semgrep/skills/semgrep-conventions/references/`
> (3 files), exists on disk but is referenced by nothing — a live in-repo
> example of the exact failure mode C6 must avoid (a references/ split with
> no load stub). Cite it in Phase B's risk framing.
<!-- /deepen-plan -->

## Key Design Decisions (from research + SpecFlow, all verified)

1. **Load-stub style = imperative directive** ("load `references/X.md`"), the
   `ci-conventions` pattern with a proven downstream consumer
   (`plugins/yellow-ci/skills/ci-conventions/SKILL.md:32,52,99` consumed by
   `agents/ci/failure-analyst.md:49,66,177`) — not the passive markdown-link
   style. CE stub rules apply: unconditional at reach point, names the failure
   mode of skipping, exact path, no improvisable detail, never `@`-inclusion
   (CE `AGENTS.md:134-149`).

<!-- deepen-plan: codebase -->
> **Codebase:** All ci-conventions/failure-analyst citations confirmed at the
> exact lines. But imperative-directive is the *minority* pattern among the 5
> wired precedents: only ci-conventions uses it; create-agent-skills,
> devin-workflows, git-worktree, and library-context all use the passive
> markdown-link style this decision rejects. Standardizing on imperative is
> defensible (ci-conventions has the clearest proven consumer chain) but
> frame it as picking a winner, not codifying the established convention.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Anthropic's official skill best-practices doc takes no
> position on imperative vs passive link phrasing. The verbatim-confirmed CE
> mechanism is sharper than verb choice: a load stub works because it keeps
> "no detail an agent could improvise from" — "a paraphrase of the
> reference's substance … suppresses the load" (CE
> `docs/solutions/skill-design/post-menu-routing-belongs-inline.md`). Enforce
> stub completeness (condition + exact path + failure mode, zero
> substitutable content), not just the verb. See:
> https://github.com/EveryInc/compound-engineering-plugin/blob/main/AGENTS.md
<!-- /deepen-plan -->

2. **council-patterns is preload-constrained by THREE consumers** —
   `gemini-reviewer.md:11-12`, `opencode-reviewer.md:11-12`, AND
   `council.md:13-14` itself. Runtime-load-bearing sections stay inline
   (`:75` output schema, `:97` redaction block, `:142` fence format, `:294`
   atomic-write, `Synthesis Format (V1)` `:365` — council.md Step 5 implements
   it). Only provably non-executed prose (candidate: "Cross-References" `:309`,
   confirm by grep before moving) may move. Do NOT convert preloaded sections
   into Read instructions — that reintroduces skip-risk with no anti-skip
   scaffolding in place (that's Tier 3 C12).
3. **C7 approach = sentinel + drift lint, canonical in yellow-ruvector.**
   Cross-plugin `skills:` preload is impossible (claude-code#15944; ruling in
   `docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md`).
   "Shrink to a pointer" is rejected: protocol parameters (top_k=5, score<0.5,
   0.82 dedup, 800-char truncation) are load-bearing at runtime. Canonical
   home = `plugins/yellow-ruvector/skills/memory-query/SKILL.md` (owns the MCP
   tools); yellow-core's `memory-recall-pattern`/`memory-remember-pattern`
   become marked replicas. The existing "Design reference" blockquotes in the
   yellow-core pair (declaring THEMSELVES canonical and listing ~8 consuming
   command files) must be updated in the same PR — otherwise docs contradict
   the lint.
4. **C9 = writeback AND resume-read.** The stack path already has both
   (`work.md:250-268` writeback; `:276-279` re-parse on revision). The
   non-stack path gets: tick the plan's own existing task checkboxes in place
   (1:1 with execution steps — turbo granularity rule), NO parallel
   `## Progress` section (avoids the dual-checkbox-section hazard —
   `validate-plans.js:86` CHECKBOX_RE and `/plan:complete` Gate A are
   section-blind), plus a Phase 2 entry step that reads the plan and resumes
   from the first unchecked box.
5. **C10 rules are all warning-tier** (warnings infra exists:
   `validate-agent-authoring.js` warnings array + `logWarning`, "Warnings do
   NOT affect exit code" ~`:768`). Data: heading compliance would fail
   multiple skills today; 500-line ceiling fails `create-agent-skills` (513)
   until Tier 1 C4 lands; trigger-clause fails 2 skills until Tier 1 C1 lands.
   Warning-tier removes all hard Tier-1 ordering dependencies. Convention:
   internal `RULE <N>` numbering with ad-hoc messages; NO
   `packages/domain/.../errorCatalog.ts` entry (that catalog belongs to the
   validate-plans/validate-solutions lineage — undocumented split, easy to
   get wrong).

<!-- deepen-plan: codebase -->
> **Codebase:** Warnings infra confirmed exactly (`warnings = []` :749,
> logWarning loop :769-771, the :768 comment verbatim; PR #477 / `2545cce7`
> confirmed scripts-only with no changeset). But the data points are stale:
> Tier 1 has already landed (`plans/complete/tier-1-optimization-quick-wins.md`,
> fully checked off) — `create-agent-skills` is now 365 lines and **0 skills
> currently exceed 500 lines**. The three-heading rule currently fails 7/39
> skills: ci-conventions, diagnose-ci, codex-patterns, composio-patterns,
> docs-conventions, research-patterns, semgrep-conventions.
<!-- /deepen-plan -->

6. **C11 is a decision-gate, not a shippable diff.** Deliverable = overlap
   table + AskUserQuestion maintainer decision; the routing table must NOT be
   pre-decided by the implementer.

## Implementation Plan

### Phase A (C10): SKILL.md lint rules — no changeset (scripts/-only, PR #477 precedent)

- [x] A.1 Add a 4th `walk()` file set in `scripts/validate-agent-authoring.js`
      `main()` (~`:721-742`): `skillFiles` = path contains `/skills/`,
      filename `SKILL.md`.
- [x] A.2 Implement `validateSkillFiles(skillFiles, { errors, warnings })`
      (parallel to the calls at ~`:763-765`) with three warning-tier rules
      (next free RULE numbers): (a) >500 lines → warn; (b) missing any of
      `## What It Does` / `## When to Use` / `## Usage` → warn; (c)
      `description:` lacking a "Use when" clause → warn. Also warn on
      folded-scalar `description: >`/`|` (closes the Tier 1 C5 gap at
      warning tier).

<!-- deepen-plan: codebase -->
> **Codebase:** "Next free RULE numbers" is concretely RULE 15+: the highest
> in active use is RULE 14 (plus a 14b sub-variant); RULE 13 is the existing
> context7 drift lint at `validate-agent-authoring.js:453-499`. Phase C's
> drift lint then takes RULE 16+.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The >500-line warn threshold matches Anthropic's official
> guidance verbatim ("Keep SKILL.md body under 500 lines for optimal
> performance"), giving rule (a) a citable official source. See:
> https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
<!-- /deepen-plan -->

- [x] A.3 Fixture tests: `tests/integration/validate-agent-authoring-skill-rules.test.ts`
      (naming convention: one file per rule-slug) — trigger + pass cases per rule.
- [x] A.4 Acceptance run: rules against current HEAD produce **0 errors**
      (warnings allowed and expected: 7 skills warn on RULE 15b, matching
      the deepen-plan prediction exactly).

### Phase B (C6): progressive-disclosure splits — changesets: yellow-core, yellow-council, yellow-review

- [x] B.1 `plugins/yellow-core/skills/optimize/SKILL.md` (461, zero preload
      consumers): move judge-prompt template + failure-mode notes to
      `references/`, imperative load stubs at reach points. Target ≤ 300.
- [x] B.2 `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` (414, zero
      preload consumers): move scoring formula details + clustering mechanics
      to `references/`. Target ≤ 300.
- [x] B.3 `plugins/yellow-council/skills/council-patterns/SKILL.md` (398):
      move ONLY confirmed-non-executed prose per Design Decision 2. If the
      grep shows "Cross-References" is consumed, skip this file entirely and
      record why.
- [x] B.4 Commands (new pattern for commands/ — no precedent exists; model on
      ci-conventions): extract conditional/late-sequence blocks —
      `review-pr.md` Step 9a/9b (`:746`,`:773`) + legacy fallback (`:377`);
      `work.md` Graphite cheat-sheet (`:770-794`); `setup/all.md` Steps
      1.6/1.7 (`:312`,`:355`) — each to a plugin-local reference file loaded
      by an imperative stub at the branch point. Keep always-executed routing
      inline.

<!-- deepen-plan: codebase -->
> **Codebase:** No-precedent claim confirmed — zero `references/` dirs exist
> under any `plugins/*/commands/`. Minor line corrections: review-pr.md Step
> 9a is at `:748`, 9b at `:775`; work.md's cheat-sheet code block closes at
> `:796`. Legacy fallback `:377` and setup/all.md `:312`/`:355` are exact.
> Related wiring risk: the orphaned `semgrep-conventions/references/` dir
> (see Problem Statement note) argues for a converse acceptance check in B —
> every file under a new `references/` dir must be named by at least one
> stub, not just the stub→file direction.
<!-- /deepen-plan -->

- [x] B.5 Content moves verbatim: net line delta across (source + new
      references) ≈ 0. No rewriting/"improving" moved prose.
- [x] B.6 Update the stale provenance comment in
      `plugins/yellow-core/skills/debugging/SKILL.md` ("yellow-core skills
      consistently use a single SKILL.md" — already false, and C6 widens it).
- [x] B.7 Manual e2e checklist doc for stub-firing verification (pattern:
      yellow-council PR #3 e2e checklist).

<!-- deepen-plan: external -->
> **Research:** CE's extraction heuristic is verbatim-confirmed upstream
> (extract when a block is conditional or late-sequence AND ~20%+ of the
> skill) but is CE prior art, not Anthropic doctrine — official docs give
> only the 500-line ceiling, require references be directly linked, and keep
> them one level deep (no reference chaining). For the e2e checklist,
> distinguish two documented failure modes: the "skip" problem (reference
> never loaded — what stub-firing verification catches) and the "stop"
> problem (agent halts its turn at a skill boundary; turbo documents it
> citing anthropics/claude-code#17351) — B.4's command extractions can
> surface both.
<!-- /deepen-plan -->

### Phase C (C7): memory-protocol drift control — changesets: yellow-core, yellow-ruvector

- [x] C.1 Declare `plugins/yellow-ruvector/skills/memory-query/SKILL.md`
      canonical (add a Canonical Source header block modeled on
      library-context/security-fencing sentinel pattern).

<!-- deepen-plan: codebase -->
> **Codebase:** Correction — neither library-context nor security-fencing has
> a literal "Canonical Source" header block. library-context documents a
> sentinel *phrase* enforced by an active lint (RULE 13,
> `validate-agent-authoring.js:453-499`); security-fencing declares itself
> canonical in prose and explicitly says no drift lint exists yet. Model C.1
> on RULE 13's sentinel+lint shape (the only working precedent) and design
> the header block fresh rather than copying one.
<!-- /deepen-plan -->

- [x] C.2 Mark `memory-recall-pattern` + `memory-remember-pattern`
      (yellow-core) as replicas; rewrite their "Design reference" blockquotes
      (~lines 28-42 in each) so canonical ownership no longer contradicts C.1.
- [x] C.3 Add a grep-able sentinel line carrying the protocol constants
      (top_k=5 / score<0.5 / top-3 / 800-char / 0.82 dedup) to all three
      skills, byte-identical.
- [x] C.4 New RULE-N drift lint in `validate-agent-authoring.js`: all
      sentinel-carrying files must match the canonical sentinel exactly.
      Lint surface EXPLICITLY includes the ~8 consuming command files listed
      in the blockquotes (`brainstorm.md`, `plan.md`, `compound.md`,
      `work.md`, `review-pr.md`, `resolve-pr.md`, `review-all.md`,
      `ruvector/learn.md`) — or, if any of those inline a paraphrase rather
      than the sentinel, document them as out of CI scope with rationale.

<!-- deepen-plan: codebase -->
> **Codebase:** (1) The "~8 consuming files" list undercounts:
> memory-recall-pattern's blockquote lists 10 consumers (adding
> `ruvector/search.md` and `ruvector/memory.md`); memory-remember-pattern's
> lists 8. Live drift to route into this task's documented fallback:
> `ruvector/search.md` calls hooks_recall with `top_k=10`, not 5 — a
> legitimate user-facing search pattern but a real paraphrase-mismatch of a
> constant this plan calls load-bearing; and `ruvector/learn.md` carries ZERO
> protocol constants and lacks the dedup call (`hooks_recall` top_k=1 /
> score>0.82) its blockquote claims (its Step 4, `:59-66`, has only
> ToolSearch/warmup checks) — the lint needs a "sentinel required but
> absent" mode to catch that file, and whether the missing dedup is a bug or
> an intentional simplification is a maintainer question to surface before
> scoping. (2) Use RULE 13 (`validate-agent-authoring.js:453-497`) as the
> implementation template, including its exemption scoping: its original
> `skills:`-membership exemption lacked a plugin-ownership check, was flagged
> in PR #597 review, and was fixed same-PR in commit `3c8f6962`. A naive C.4
> lint spanning three plugins can reintroduce exactly that bug class.
<!-- /deepen-plan -->

- [x] C.5 Red/green test: desync one parameter in one replica → lint fails;
      restore → passes. Test file per naming convention.

### Phase D (C8): scope/mode interface protocol doc — no changeset for the doc; per-plugin changesets only if command text gains cross-reference lines

- [x] D.1 Write `docs/plugin-scope-mode-protocol.md` modeled structurally on
      `docs/plugin-credential-status-protocol.md` (File Location → Contract
      tables → adopter/non-adopter enumeration). Content documents CURRENT
      behavior: `--non-interactive` contract (review-pr.md:36-38 =
      resolve-pr.md:32-34, forwarded by sweep/sweep-all/resolve-stack);
      `--in-pr` (compound.md:56-62); debt scanner JSON-file interface
      (debt-conventions Scanner Output Schema v2.0); workflows:review
      positional-type detection (:31-92). Include turbo's diff-vs-file-scope
      semantic distinction as a RECOMMENDED convention for future surfaces,
      explicitly marked not-yet-uniform.
- [x] D.2 Add one-line "conforms to / diverges from" cross-references in the
      4 surface files. Zero logic changes — `git diff` on non-doc lines empty.
- [x] D.3 Explicit non-goal recorded in the doc: unifying divergent semantics
      is future work, not this PR.

### Phase E (C9): non-stack execution writeback + resume — changeset: yellow-core

- [x] E.1 `plugins/yellow-core/commands/workflows/work.md` Phase 2: after each
      completed execution step, Edit the plan file to tick that step's own
      checkbox (`- [ ]` → `- [x]`), with the same read-back verification the
      stack path uses (`:264-268`). No new `## Progress` section.

<!-- deepen-plan: codebase -->
> **Codebase:** Stack-path citations confirmed (writeback `:250-268`; the
> resume re-parse verb sits at `:278-279`). One structural fact the plan
> omits: Phase 2 (`work.md:291+`) already tracks per-step progress via the
> Task tool (`TaskUpdate` status transitions). Hook the checkbox tick into
> the same loop iteration as the existing TaskUpdate call — one execution
> step = one TaskUpdate = one checkbox — rather than adding an independent
> tracking pass.
<!-- /deepen-plan -->

- [x] E.2 Phase 2 entry: read the plan file; if any task checkboxes are
      already `[x]`, announce resume mode and start from the first unchecked
      box (mirror of stack path `:276-279`).
- [x] E.3 Granularity guard in the command text: checkbox granularity must
      match execution-step granularity 1:1 (turbo SKILL-CONVENTIONS:12
      rationale).

<!-- deepen-plan: external -->
> **Research:** turbo's granularity rule is verbatim-confirmed but is
> expressed via Claude Code's TaskCreate/TaskList task-tracking entries, not
> literal markdown checkboxes: "Body steps should match task tracking entries
> one-to-one." Cite it as "task-tracking-entry granularity" — which also
> dovetails with hooking E.1's writeback into the existing TaskUpdate sites.
> See: https://github.com/tobihagemann/turbo/blob/main/claude/SKILL-CONVENTIONS.md
<!-- /deepen-plan -->

- [x] E.4 Verify gates unaffected: `validate-plans.js` + `/plan:complete`
      Gate A pass on a mid-execution plan (boxes all ticked by archive time —
      semantics unchanged).
- [x] E.5 Manual resume test: run `/workflows:work` on a half-ticked plan in a
      fresh session; completed steps are not re-executed. (Recorded as rows in
      docs/testing/c6-progressive-disclosure-stub-firing-checklist.md — the
      fresh-session run needs a human session; this session dogfooded the
      writeback half by ticking this very plan per-step.)

### Phase F (C11): memory-router decision gate — no changeset (root doc); description edits ride Tier 1 C2's convention

- [x] F.1 Produce the trigger-overlap table (verified rows: "remember this" →
      `ruvector/learn.md:3` + `memory-manager.md:3` vs `memory-archivist.md:3`
      "save a memory / record a decision"; "recall/what do we know" →
      `ruvector/memory.md:3` vs `mempalace/search.md:3`; MEMORY.md pipeline =
      trigger-free staging-promoter).

<!-- deepen-plan: codebase -->
> **Codebase:** All trigger citations confirmed, but the
> `ruvector/memory.md:3` ↔ `mempalace/search.md:3` row is already partially
> resolved: both descriptions cross-reference each other today, landed with
> Tier 1 C2 (see `plans/complete/tier-1-optimization-quick-wins.md`). Record
> that row as already-disambiguated so the maintainer decision focuses on the
> still-live "remember this" collision.
<!-- /deepen-plan -->

- [x] F.2 AskUserQuestion decision point with the maintainer: per trigger
      phrase, which system fires; are ruvector and mempalace disjoint domains
      or dual-write. DO NOT pre-decide.
- [x] F.3 On decision: write `docs/memory-routing-protocol.md` (sibling of
      plugin-credential-status-protocol.md) + apply one-sentence
      disambiguation clauses to the affected descriptions (C2 pattern).

## Technical Details

New files: `references/*.md` under optimize/, compound-lifecycle/,
(conditionally) council-patterns/, yellow-review/commands-adjacent reference
dir, yellow-core commands reference dirs; `docs/plugin-scope-mode-protocol.md`;
`docs/memory-routing-protocol.md` (post-decision);
`tests/integration/validate-agent-authoring-skill-rules.test.ts` + drift-lint
test. Modified: the 6 C6 targets, 3 memory skills + blockquotes, work.md,
4 C8 surface files, validate-agent-authoring.js, debugging/SKILL.md comment.

Per-item effort/risk: C10 M/low · C6 L/medium (stub-firing unverifiable in CI;
council-patterns preload constraint) · C7 M/low-medium (canonical flip must
land atomically with blockquote rewrite) · C8 S/low (docs-only by
construction) · C9 M/medium (touches the most-used workflow command; bounded
by mirroring proven stack-path mechanics) · C11 S/low (decision gate).

## Acceptance Criteria (binary, per phase)

1. **A:** new rules yield 0 errors on current HEAD (warnings allowed); both
   fixture test cases pass; no errorCatalog.ts diff.
2. **B:** each split file ≤ target lines; every `references/` path referenced
   by a stub exists (`test -f`); net moved-content line delta ≈ 0; the three
   council-patterns preloaders still contain (inline) every section cited at
   gemini-reviewer:175, SKILL.md:75/:97/:142/:294; e2e checklist doc exists.
3. **C:** deliberate one-parameter desync fails the lint, restore passes;
   `grep -rn "<sentinel>" plugins/` hits exactly the declared surface; no
   remaining blockquote claims yellow-core as canonical.
4. **D:** protocol doc exists; `git diff` on the 4 surfaces contains only
   added cross-reference prose lines.
5. **E:** fresh-session resume test skips completed steps; Gate A +
   validate-plans.js pass unchanged; no `## Progress` section introduced.
6. **F:** decision recorded (doc exists) OR explicitly deferred by maintainer;
   no routing implemented without the recorded decision.

## Edge Cases

- B.3: if "Cross-References" turns out to be consumed by any grep hit, skip
  council-patterns entirely — a 398-line preloaded skill is legal; C10 only
  warns at >500.
- B.4 command extractions change what loads per invocation — extraction must
  be limited to blocks gated by conditions the command already evaluates
  (stack-mode, compounding opt-in, credential-file presence).
- C.4: sentinel must be a single line (YAML/regex-safe, `[ \t]*` not `\s*`
  per feedback_yaml_regex_newline_gotcha) and identical byte-for-byte in all
  copies — em-dash/quote variants are how RULE 13's sentinel bugs happened.
- E.1: plans authored before this change (no per-step boxes, prose-only
  steps) → writeback becomes a no-op; resume step must tolerate zero-checkbox
  plans (fall through to normal execution).
- Never `pnpm format` over `plugins/**/*.md` during any phase.

## Sequencing

A (C10, cheap, independent) → Tier 1 C4/C1 land whenever → B (C6) → C and E in
parallel (disjoint files) → D anytime → F last (decision gate). C6+C7 authors
should coordinate on yellow-core skill files to avoid conflicts.

<!-- deepen-plan: codebase -->
> **Codebase:** Stale: Tier 1 C1/C4 have already landed (plan archived in
> `plans/complete/`), so the "land whenever" dependency is satisfied and
> A → B can proceed immediately.
<!-- /deepen-plan -->

## References

- `docs/optimization/analysis.md` §3.2–3.5, §4 Tier 2
- CE: `AGENTS.md:122-149` (deletion test, inline-the-trigger, extraction
  threshold), `CONCEPTS.md:65-67` (load stub), `skills/ce-plan/SKILL.md:762-766`
- turbo: `claude/SKILL-CONVENTIONS.md:9-17` (task-tracking rationale, standard
  interfaces, scope interface), `claude/skills/simplify-code/SKILL.md:10-16`
  (3-branch scope resolution — the concrete shape for D.1's recommendation)
- `docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md` (C7 ruling)
- `docs/plugin-credential-status-protocol.md` (C8/F doc template)
- `plugins/yellow-ci/skills/ci-conventions/` + `agents/ci/failure-analyst.md`
  (imperative load-stub precedent)
- PR #477 / commit `2545cce7` (warnings infra + scripts-only no-changeset precedent)

<!-- deepen-plan: external -->
> **Research:** Both upstream repos located and all cited rules
> verbatim-confirmed: CE =
> https://github.com/EveryInc/compound-engineering-plugin (AGENTS.md /
> CONCEPTS.md — deletion test, load-stub definition, inline-the-trigger,
> `@`-inclusion ban); turbo = https://github.com/tobihagemann/turbo
> (SKILL-CONVENTIONS.md — diff-vs-file scope interface; also
> `claude/docs/skill-loading-reasoning.md`, documenting the "stop problem"
> with anthropics/claude-code#17351). Official 500-line source:
> https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
<!-- /deepen-plan -->
