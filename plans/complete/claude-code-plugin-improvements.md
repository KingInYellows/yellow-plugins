# Feature: Claude Code Plugin System — Efficiency and Quality Improvements

## Overview

A prioritized, staged improvement pass on the yellow-plugins monorepo (16
plugins, ~55 agents, ~80 commands, ~28 skills) that reduces token consumption
and latency while raising output consistency, agent selection quality, and
observability. The work is organized into three approaches (A: quick wins, B:
shared infrastructure, C: routing + observability) that can ship sequentially.

Source brainstorm:
[2026-04-17-claude-code-plugin-improvements-brainstorm.md](../docs/brainstorms/2026-04-17-claude-code-plugin-improvements-brainstorm.md)

---

## Problem Statement

### Current Pain Points

- **Duplicated prompt content across agents.** `CRITICAL SECURITY RULES` + content
  fencing is copy-pasted into 16 review/research agents (~240 tokens per spawn);
  each parallel review session pays this cost N times.
- **Missing parallelism primitive on review agents.** 13 agents across
  `yellow-core/agents/review/*` (7) and `yellow-review/agents/review/*` (6)
  lack `background: true` — the same flag that `yellow-debt` and `yellow-docs`
  use. Multi-agent review sessions that spawn 4–7 reviewers in parallel are
  silently serializing, or at minimum not benefitting from the parallelism
  primitive the rest of the monorepo uses.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed. All 5 yellow-debt scanners declare `background: true`
> at line 5. None of the 7 yellow-core review agents, 6 yellow-review review
> agents, or 4 yellow-ci agents do. See
> `plugins/yellow-debt/agents/scanners/security-debt-scanner.md:5` for the
> existing pattern.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `background: true` in agent frontmatter is listed as official in
> the plugins-reference, but on its own it is **not sufficient** to force
> parallel execution of Task-spawned subagents — orchestrator commands
> (`review-pr.md`, `work.md`) must also pass `run_in_background: true` on each
> Task invocation to get true parallelism (the spawn returns `async_launched`
> and the orchestrator polls output files). Consider adding an orchestrator-
> side task to audit and update Task invocations.
> See: https://code.claude.com/docs/en/sub-agents
<!-- /deepen-plan -->
- **No opus-class routing anywhere.** All agents declare `model: inherit`
  except `ci/status.md` (haiku) and three yellow-ci commands (sonnet). Deep
  reasoning tasks (`architecture-strategist`, `research-conductor`) run on the
  user's default model with no deliberate choice.
- **Inconsistent prompt-injection hardening.** Security fencing exists in 16
  agents but is absent from 5 yellow-debt scanners and 4 yellow-ci agents that
  also read untrusted code (CI logs, source, dependency files).
- **No plugin.json schema enforcement.** Fields like `hooks`, `outputStyles`,
  `mcpServers`, `userConfig` drift across manifests with no validator.
- **Silent subagent failure.** A `/review:pr` where 2 of 6 agents fail looks
  identical in the user-facing output to one where all 6 succeed — there is no
  structured failure surface.
- **No plugin self-tests.** The only validation is `plugin.json` JSON structure;
  frontmatter completeness, skill reference validity, and required sections
  are not checked.

### User Impact

- **Review latency:** Multi-agent reviews take longer than necessary because
  `background: true` is missing on the most heavily-spawned review agents.
- **Token cost:** Every parallel review pays ~240 × N tokens for duplicated
  security boilerplate, plus oversized command bodies that load phases the
  invocation will never reach.
- **Agent misrouting:** Overlapping descriptions between
  `code-simplicity-reviewer`/`code-simplifier` and
  `security-sentinel`/`security-debt-scanner` can lead Claude Code's adaptive
  selection to the wrong agent.
- **Silent quality loss:** Scanners reading untrusted code without prompt-
  injection hardening are vulnerable to injected instructions; subagent
  failures propagate as missing findings rather than visible errors.

### Value

Measurable reductions in wall-clock time and token spend for review/work
workflows, stronger safety posture (uniform prompt-injection hardening),
cleaner authoring conventions (shared skills, schema validation), and
observability into which subagents ran and whether they succeeded.

---

## Proposed Solution

### High-Level Architecture

Three staged approaches, each independently shippable:

- **Approach A — Quick-Win Pass (1–3 days).** Additive, low-risk frontmatter and
  prose changes across ~25 files. No new infrastructure. Immediate latency
  and safety wins.
- **Approach B — Shared Infrastructure Layer (1–2 weeks).** Extract duplicated
  content into shared internal skills, add `plugin.json` schema validation,
  establish a structured subagent-failure convention.
- **Approach C — Routing + Observability Investment (longer-term).** Introduce
  intentional model routing (haiku for display, opus for deep reasoning), add
  per-plugin shell lint scripts, explore a session-end summary hook.

### Key Design Decisions

1. **Ship A before B.** Approach A closes coverage gaps and unlocks parallelism
   immediately. Approach B is cleaner but requires migrating consumers; doing
   it after A lets us measure B's gain over an already-improved baseline.
2. **`background: true` is the highest-leverage single change.** It matches an
   existing pattern (yellow-debt, yellow-docs), is zero-risk additive, and
   directly affects the most-used review workflows.
3. **Shared `security-fencing` skill vs inline boilerplate is deferred to B.**
   Until skill-loading cost for frequently-spawned agents is confirmed
   negligible, Approach A closes coverage via inline additions. B extracts
   once the cost question is settled.
4. **Model routing starts conservative.** `haiku` only for pure display
   commands; `opus` only after specific bottleneck agents are confirmed. No
   blanket sweep.

### Trade-offs Considered

- **Inline vs shared security block.** Inline = zero new dependency, immediate
  coverage, but permanent duplication. Shared skill = clean but adds a
  skill-load dependency. Resolved by doing inline first (A), extracting
  second (B).
- **Splitting `mcp-integration-patterns` into three sub-skills.** Saves
  tokens per consumer but multiplies files and references. Deferred to B
  pending data on whether declaring more `skills:` inflates per-agent init.
- **Structured failure convention.** Prose-in-docs is lightweight but
  advisory; shared-skill is enforceable but heavier. B starts with prose;
  enforcement can come later if adoption lags.

---

## Implementation Plan

### Phase 1: Approach A — Quick-Win Pass

<!-- deepen-plan: external -->
> **Research:** Phase 1.1 + 1.2 are necessary but may be insufficient for the
> target latency win. Adding `background: true` to agent frontmatter is valid
> (field is in the official plugins-reference), but the orchestrator must also
> pass `run_in_background: true` when calling the Task tool. Consider adding
> a task 1.9 to audit Task invocations in `plugins/yellow-review/commands/review/review-pr.md`
> and `plugins/yellow-core/commands/workflows/work.md` and ensure each parallel
> review-agent spawn sets `run_in_background: true`.
> See: https://code.claude.com/docs/en/sub-agents
<!-- /deepen-plan -->

- [ ] **1.1** Add `background: true` to 7 yellow-core review agents:
  - `plugins/yellow-core/agents/review/security-sentinel.md`
  - `plugins/yellow-core/agents/review/performance-oracle.md`
  - `plugins/yellow-core/agents/review/architecture-strategist.md`
  - `plugins/yellow-core/agents/review/polyglot-reviewer.md`
  - `plugins/yellow-core/agents/review/code-simplicity-reviewer.md`
  - `plugins/yellow-core/agents/review/test-coverage-analyst.md`
  - `plugins/yellow-core/agents/review/pattern-recognition-specialist.md`
- [ ] **1.2** Add `background: true` to 6 yellow-review review agents:
  - `plugins/yellow-review/agents/review/code-reviewer.md`
  - `plugins/yellow-review/agents/review/pr-test-analyzer.md`
  - `plugins/yellow-review/agents/review/comment-analyzer.md`
  - `plugins/yellow-review/agents/review/type-design-analyzer.md`
  - `plugins/yellow-review/agents/review/silent-failure-hunter.md`
  - `plugins/yellow-review/agents/review/code-simplifier.md`
<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — the `CRITICAL SECURITY RULES` block is absent from
> all 5 yellow-debt scanners and all 4 yellow-ci agents. No collision risk with
> existing content. (`audit-synthesizer.md:82` contains an unrelated "CRITICAL"
> string about slug derivation — not the fencing block.)
<!-- /deepen-plan -->

- [ ] **1.3** Add `CRITICAL SECURITY RULES` + content fencing block to 5
  yellow-debt scanners that read untrusted code:
  - `plugins/yellow-debt/agents/scanners/ai-pattern-scanner.md`
  - `plugins/yellow-debt/agents/scanners/architecture-scanner.md`
  - `plugins/yellow-debt/agents/scanners/duplication-scanner.md`
  - `plugins/yellow-debt/agents/scanners/security-debt-scanner.md`
  - `plugins/yellow-debt/agents/scanners/complexity-scanner.md`
- [ ] **1.4** Add `CRITICAL SECURITY RULES` + content fencing to 4 yellow-ci
  agents that read untrusted logs/configs:
  - `plugins/yellow-ci/agents/ci/failure-analyst.md`
  - `plugins/yellow-ci/agents/ci/workflow-optimizer.md`
  - `plugins/yellow-ci/agents/ci/runner-assignment.md`
  - `plugins/yellow-ci/agents/maintenance/runner-diagnostics.md`
- [ ] **1.5** Add `memory: project` to workflow orchestrators (NOT `memory: true`):
  - `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md`
  - `plugins/yellow-core/agents/workflow/knowledge-compounder.md`
  - `plugins/yellow-core/agents/workflow/spec-flow-analyzer.md`
  - `plugins/yellow-devin/agents/workflow/devin-orchestrator.md`

<!-- deepen-plan: external -->
> **Research (pass 2) — CRITICAL CORRECTION:** The `memory` frontmatter field
> takes a **scope string**, not a boolean. Valid values: `memory: user`,
> `memory: project`, or `memory: local`. A literal `memory: true` is NOT the
> documented form and will likely be a no-op or error. For workflow
> orchestrators that benefit from cross-session learning within a project,
> use `memory: project`. Each subagent gets its own
> `~/.claude/projects/<project>/memory/MEMORY.md` that is injected (first 200
> lines / 25 KB) into the agent's system prompt on every spawn — so
> `memory:` adds a per-spawn token cost proportional to MEMORY.md size.
> Audit existing agents with `memory: true` (yellow-core review agents) to
> confirm behavior.
> See: https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/memory
<!-- /deepen-plan -->
- [ ] **1.6** Sharpen `description:` trigger clauses for overlap pairs:
  - `code-simplicity-reviewer` (yellow-core) vs `code-simplifier` (yellow-review)
    — lead with "pre-fix" vs "post-fix" trigger condition.
  - `security-sentinel` (yellow-core) vs `security-debt-scanner` (yellow-debt)
    — lead with "active vulnerability" vs "debt pattern" trigger.
- [ ] **1.7** Add `.changeset/*.md` entries for each affected plugin (minor
  bump: yellow-core, yellow-review, yellow-debt, yellow-ci, yellow-devin;
  patch bump where only descriptions changed).
- [ ] **1.8** Run `pnpm validate:schemas` to confirm no manifest drift.

### Phase 2: Approach B — Shared Infrastructure Layer

<!-- deepen-plan: external -->
> **Research:** Skills declared in agent frontmatter (`skills: [...]`) inject
> the **full SKILL.md content** into each subagent's context at spawn time
> (not lazily; subagents do not inherit parent skills). So 25 consumers × full
> security-fencing skill = content duplicated across 25 independent spawns.
> This only saves tokens if `SKILL.md` + its description < the current inline
> block. Measure actual token sizes before committing to Phase 2.1–2.2.
> Also: the correct frontmatter field is `user-invocable: false` (not
> `user-invokable`) — see GitHub Issue #19141.
> See: https://code.claude.com/docs/en/sub-agents,
> https://github.com/anthropics/claude-code/issues/19141
<!-- /deepen-plan -->

- [ ] **2.1** Create `plugins/yellow-core/skills/security-fencing/SKILL.md`
  (internal, `user-invocable: false`) containing the canonical `CRITICAL
  SECURITY RULES` + content fencing block.

<!-- deepen-plan: codebase -->
> **Codebase (pass 2) — empirical measurement:** The `CRITICAL SECURITY RULES`
> block in `plugins/yellow-core/agents/review/security-sentinel.md` measures
> 29 lines, 120 words, 780 bytes → **~160–195 tokens** (plan's 240 estimate was
> high by ~25%). Across 25 post-Phase-1 consumers × 180 tokens = ~4,500 tokens
> of duplication per parallel spawn session. Break-even for extraction: the
> shared skill's SKILL.md + description must come in under ~180 tokens to
> match current inline cost.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (pass 2):** Confirmed — skills listed in agent frontmatter are
> NOT deduplicated across parallel spawns. Each of N parallel agents pays the
> full skill content cost (GitHub Issue #21891, open feature request). So
> extracting `security-fencing` trades 25× inline × 180 tokens = 4,500 tokens
> for N_spawned × skill_size tokens. Since N_spawned in a review session is
> typically 5–7 (not 25), the real comparison is 5×180 = 900 inline tokens
> vs 5×skill_size when the skill is loaded. The win is smaller than the
> "eliminate duplication" framing suggests.
> See: https://github.com/anthropics/claude-code/issues/21891
<!-- /deepen-plan -->
- [ ] **2.2** Migrate all 25 current consumers (16 existing + 9 added in Phase 1)
  to reference `security-fencing` via `skills:` frontmatter; delete inline
  blocks.
- [ ] **2.3** Split `plugins/yellow-core/skills/mcp-integration-patterns/` into
  three focused sub-skills:
  - `memory-recall-pattern` — Recall-Before-Act
  - `memory-remember-pattern` — Tiered-Remember-After-Act
  - `morph-discovery-pattern` — Morph discovery + fallback
  Update the 9 consuming commands to declare only what they use.

<!-- deepen-plan: codebase -->
> **Codebase:** Consumer count is **9, not 14**. No command currently
> declares `mcp-integration-patterns` in a `skills:` frontmatter block
> (grep for `  - mcp-integration-patterns` returns zero hits). The 9 commands
> listed in the skill's internal "Design reference" (`SKILL.md:16-20`) —
> `brainstorm.md`, `plan.md`, `compound.md`, `work.md`, `review-pr.md`,
> `resolve-pr.md`, `review-all.md`, `ruvector/search.md`, `ruvector/learn.md`,
> `ruvector/memory.md` — consume patterns by inlining MCP tool names directly
> in `allowed-tools`. Splitting the skill file changes documentation only
> unless consumers simultaneously migrate to `skills:` frontmatter references.
<!-- /deepen-plan -->
- [ ] **2.4** ~~Add `schemas/plugin.schema.json`~~ **Extend** existing
  `schemas/plugin.schema.json` if it does not already cover `hooks`,
  `outputStyles`, `mcpServers`, `userConfig` fields. Existing
  `scripts/validate-plugin.js` uses `ajv` programmatically — add new field
  validation rules there rather than introducing `ajv-cli`.
- [ ] **2.5** ~~Add CI step~~ **Verify** existing
  `.github/workflows/validate-schemas.yml` runs against the updated schema
  across its four matrix targets (`marketplace`, `plugins`, `contracts`,
  `examples`).

<!-- deepen-plan: codebase -->
> **Codebase:** `schemas/plugin.schema.json`, `scripts/validate-plugin.js`,
> and `.github/workflows/validate-schemas.yml` **already exist and are
> functional**. `scripts/validate-plugin.js` is a full-featured Node.js
> validator with hook-path resolution. `ajv@^8.12.0` and `ajv-formats@^2.1.1`
> are devDependencies but `ajv-cli` is not — the existing pattern is to
> extend `validate-plugin.js`, not add a new CLI. Phase 2.4–2.5 scope
> reduces from "build" to "extend and verify coverage."
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Official plugin.json fields per the plugins-reference:
> `name` (required), `version`, `description`, `author`, `homepage`,
> `repository`, `license`, `keywords`, `skills`, `commands`, `agents`,
> `hooks`, `mcpServers`, `outputStyles`, `lspServers`, `monitors`,
> `userConfig`, `channels`, `dependencies`. Verify the existing schema
> covers all of these before extending.
> See: https://code.claude.com/docs/en/plugins-reference
<!-- /deepen-plan -->
- [ ] **2.6** Document structured subagent-failure convention in
  `plugins/yellow-core/skills/create-agent-skills/SKILL.md`: agents that fail
  write a structured JSON result to `${CLAUDE_PLUGIN_DATA}/agent-result.json`
  (status, findings, errors) before exiting; orchestrators read the file
  after Task returns — robust against bugs where the Task tool return value
  is unreliable.

<!-- deepen-plan: external -->
> **Research:** No established Claude Code community convention exists for
> structured subagent failure reporting (GitHub Issue #25818 is on the
> backlog, not shipped). The working community pattern is the **output-file
> convention**: instruct the subagent in its prompt to write JSON to a known
> path before exiting; the orchestrator reads the file after the Task call
> returns. This is robust against the `classifyHandoffIfNeeded` class of bugs
> (GitHub Issue #24181) where the Task tool returns a generic error string
> with no partial-result access. Adopt this convention rather than the
> "final-line JSON blob" approach — files are more reliable than parsing
> agent stdout.
> See: https://github.com/anthropics/claude-code/issues/25818,
> https://github.com/anthropics/claude-code/issues/24181
<!-- /deepen-plan -->
- [ ] **2.7** Update `review-pr.md` and `work.md` orchestrators to parse
  structured failure blobs and surface them in the user-facing summary.
- [ ] **2.8** Add agent archetype table to `create-agent-skills/SKILL.md`
  (reviewer / orchestrator / scanner / research archetypes — required fields
  per archetype).

### Phase 3: Approach C — Routing + Observability

- [ ] **3.1** Identify 3–5 agents that clearly warrant deliberate model
  routing. Candidate initial set:
  - `model: haiku` for pure display/status: `ci/status.md` (already done),
    `debt/status.md`, `semgrep/status.md`.
  - `model: opus` (when available) for heavy reasoning:
    `architecture-strategist`, `research-conductor`, `audit-synthesizer`.

<!-- deepen-plan: external -->
> **Research:** `model:` accepts `haiku`, `sonnet`, `opus`, or `inherit`
> (official). Anthropic's own pattern: Haiku for read-only/search (built-in
> Explore agent uses Haiku), Sonnet for implementation, Opus for
> architectural reasoning. **Caveats before routing:**
> - GitHub Issue #14863: Haiku agents error on `tool_reference` blocks —
>   verify fix status in your current Claude Code version before routing any
>   ToolSearch-using agent to Haiku.
> - GitHub Issue #29768: Explore subagents were inheriting Opus instead of
>   using Haiku as specified; verify your routing takes effect by observing
>   actual model in logs.
> See: https://github.com/anthropics/claude-code/issues/14863,
> https://github.com/anthropics/claude-code/issues/29768
<!-- /deepen-plan -->
- [ ] **3.2** Add per-plugin `scripts/lint-plugin.sh` that validates
  frontmatter completeness (name, description, model, tools present),
  skill references resolve, and required sections exist. Start with
  yellow-core and yellow-review.
- [ ] **3.3** Wire lint scripts into CI via a shared
  `.github/workflows/lint-plugins.yml`.
- [ ] **3.4** Explore a session-end summary hook. **Prefer consolidating
  into yellow-ruvector's existing Stop hook array rather than registering
  a separate hook from yellow-core** — cross-plugin hook ordering is not
  guaranteed. Spike first; ship only if the hook API supports it cleanly.

<!-- deepen-plan: codebase -->
> **Codebase:** ruvector's `stop.sh` lives at
> `plugins/yellow-ruvector/hooks/scripts/stop.sh` (not `hooks/stop.sh`). It is
> a 43-line bash hook: reads JSON from stdin, extracts `.cwd`, resolves the
> ruvector binary, calls `ruvector hooks session-end`, returns
> `{"continue": true}`. Registered via `plugins/yellow-ruvector/hooks/hooks.json`
> as a `Stop` event. Extend before/after line 40 or register a second hook.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `SessionEnd` is an official Claude Code hook event per the
> plugins-reference. Registering a new hook (rather than extending
> `stop.sh`) keeps plugin boundaries clean — yellow-core could own the
> session-summary hook without coupling to yellow-ruvector.
> See: https://code.claude.com/docs/en/plugins-reference
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (pass 2) — revises prior guidance:** Cross-plugin hook ordering
> is **non-deterministic** (GitHub Issue #24115 documents hooks firing twice
> from marketplace source + cache; Issue #4784 notes last-writer-wins on
> mutating hooks when run in parallel). Within a single plugin's hook array,
> order is deterministic by array position. **Safer pattern:** consolidate
> ruvector's `stop.sh` + the new summary emitter into a single plugin's
> Stop-hook array so ordering is predictable. Prior suggestion to put the
> summary hook in yellow-core was wrong — it should live alongside
> ruvector's stop.sh in yellow-ruvector, or both should move to yellow-core.
> See: https://github.com/anthropics/claude-code/issues/24115,
> https://github.com/anthropics/claude-code/issues/4784
<!-- /deepen-plan -->
- [ ] **3.5** Investigate ruvector session-scoped warmup: set a session flag
  on first `hooks_recall` so subsequent commands skip `hooks_capabilities`.
  Requires ruvector MCP-server support or a convention in
  `mcp-integration-patterns`.
- [ ] **3.6** Measure token cost of `CRITICAL SECURITY RULES` block empirically
  (per-agent spawn) to confirm or refute the ~240-token estimate; use the
  number to prioritize shared-skill extraction or additional consolidation.

### Phase 4: Testing & Validation

- [ ] **4.1** Manual smoke test of `/review:pr` on a sample branch after
  Phase 1 — confirm multi-agent parallelism by observing wall time vs the
  current baseline.
- [ ] **4.2** Manual smoke test of `/debt:audit` after Phase 1 — confirm
  scanner outputs are unchanged (security block is additive, not behavioral).
- [ ] **4.3** Run `pnpm validate:schemas` after every phase.
- [ ] **4.4** Lint-plugin self-test run after Phase 3.2.
- [ ] **4.5** Ship each phase as a separate PR via Graphite (`gt create` +
  `gt submit --no-edit`) for reviewability.

---

## Technical Specifications

### Files to Modify

Phase 1 (frontmatter + description changes):
- 13 review agents (7 yellow-core, 6 yellow-review) — add `background: true`
- 9 scanner/analyst agents (5 yellow-debt, 4 yellow-ci) — add security block
- 4 orchestrator agents (yellow-core, yellow-devin) — add `memory: project` (the official Claude Code agent schema requires a scope string: `user`, `project`, or `local` — not boolean)
- 4 description fields sharpened (overlap pairs)

Phase 2 (shared infrastructure):
- 25 agents migrate from inline security block to `skills: [security-fencing]`
- 14 commands split their `mcp-integration-patterns` references
- `scripts/validate-plugin.js` + CI workflow extension

Phase 3:
- 3–5 agents set explicit `model:` field
- New: `plugins/*/scripts/lint-plugin.sh`, `.github/workflows/lint-plugins.yml`

### Files to Create

- `plugins/yellow-core/skills/security-fencing/SKILL.md`
- `plugins/yellow-core/skills/memory-recall-pattern/SKILL.md`
- `plugins/yellow-core/skills/memory-remember-pattern/SKILL.md`
- `plugins/yellow-core/skills/morph-discovery-pattern/SKILL.md`
- `schemas/plugin.schema.json` (if not already covered by existing schemas/)
- `plugins/*/scripts/lint-plugin.sh` (one per plugin, at least yellow-core + yellow-review to start)
- `.github/workflows/lint-plugins.yml`

### Dependencies

- No new runtime dependencies.
- Phase 2.4 uses `ajv-cli` if not already installed as a devDependency.

### API / Convention Changes

- **New convention:** Agents that read untrusted content MUST include the
  security fencing block (Phase 1) or reference the `security-fencing` skill
  (Phase 2).
- **New convention:** Review-type agents SHOULD declare `background: true`
  unless there is a documented reason not to.
- **New convention:** Subagents SHOULD emit a structured final-line JSON
  failure blob when they fail. Orchestrators SHOULD parse and surface it.
- **No breaking API changes.** All frontmatter changes are additive; all
  skill extractions preserve semantics.

---

## Testing Strategy

- **Manual workflow smoke tests** after Phase 1 and Phase 2 (review, debt
  audit, work, brainstorm). No automated test harness exists for plugin
  behavior today; Phase 3.2 adds the first lint layer.
- **Schema validation** (`pnpm validate:schemas`) after every phase.
- **Graphite stack**: each phase as a separate PR, allowing incremental
  rollout and easy revert if a phase regresses.

---

## Acceptance Criteria

1. `/review:pr` on a representative PR completes measurably faster
   post-Phase 1 (target: 20%+ wall-time reduction on a 5+-agent spawn,
   pending empirical measurement).
2. All 9 yellow-debt + yellow-ci agents that read untrusted code include the
   security block (verifiable via `rg -l 'CRITICAL SECURITY RULES' plugins/yellow-debt plugins/yellow-ci`).
3. `pnpm validate:schemas` passes after every phase.
4. Agent archetype table exists in `create-agent-skills/SKILL.md` and
   documents required frontmatter fields per archetype.
5. `schemas/plugin.schema.json` is enforced in CI; a PR that introduces a
   malformed manifest fails validation.
6. At least one agent deliberately routes to `haiku` and at least one to
   `opus` (if available in the user's model tier) with an inline comment
   explaining the choice.
7. Subagent failure in `/review:pr` or `/workflows:work` produces a distinct,
   visible surface in the user-facing output.

---

## Edge Cases & Error Handling

- **Skill reference fails to resolve after extraction.** Consuming agents
  must degrade gracefully (log a warning, continue without the skill).
  Covered by Phase 2.4 schema validation + Phase 3.2 lint.
- **`background: true` not supported on a given model tier.** Claude Code
  silently ignores it on unsupported tiers — no regression risk.
- **Existing consumers break when `mcp-integration-patterns` is split.**
  Phase 2.3 must update all 14 consumers atomically in a single PR, or the
  old skill is kept as a re-export alias until migration is complete.
- **Schema validator rejects an existing valid manifest.** Phase 2.4 must
  run against the current manifest set as a dry-run before enforcing in CI.
- **Structured failure format conflicts with existing agent output.**
  Adoption is opt-in in Phase 2.6; orchestrators must handle both formats
  (structured blob if present, plain error text otherwise).

---

## Performance Considerations

- **Token savings (estimated):** ~240 tokens × 16 current consumers = ~3,800
  tokens saved per parallel review once Phase 2.2 lands. Phase 2.3 adds
  ~60–100 tokens saved per command × 14 commands.
- **Wall-time savings (estimated):** Phase 1.1 + 1.2 parallelism depends on
  actual Claude Code runtime behavior — needs empirical measurement. The
  yellow-debt scanners already demonstrate the pattern works.
- **No negative performance impact expected** from any phase. Schema
  validation adds <1s to CI; lint scripts are shell-only.

---

## Security Considerations

- Phase 1.3 + 1.4 **improve** security posture by closing prompt-injection
  coverage gaps on 9 agents that read untrusted content.
- Phase 2.1 + 2.2 centralize security content — regressions in the shared
  skill would affect all consumers, so the skill is marked internal and
  tested by Phase 3.2's lint.
- No changes to authentication, authorization, or data handling.

---

## Migration & Rollback

- **Rollout:** Each phase as a separate PR. Phase 1 is additive and can merge
  incrementally (e.g., 1.1 + 1.2 as one PR, 1.3 + 1.4 as another).
- **Rollback:** `gt` revert of the specific PR. All changes are contained
  in frontmatter/agent bodies — no state migrations.
- **Breaking change mitigation:** Phase 2.3 (skill split) is the only
  migration with consumer-facing impact. Mitigated by keeping the original
  skill as an alias until all consumers are migrated, then deprecating.

---

## Open Questions

1. ~~Does `background: true` actually enable Claude Code parallelism when
   agents are spawned via `Task`~~ **Answered (pass 1):** Frontmatter alone is
   not sufficient; orchestrators must pass `run_in_background: true` on each
   Task invocation. Phase 1.1–1.2 need a companion orchestrator-side task.
2. ~~Is there a per-agent startup cost to declaring more `skills:`?~~
   **Answered (pass 1+2):** Yes — full skill content is injected per spawn
   with no deduplication across parallel spawns (Issue #21891). Phase 2.3
   savings only materialize when consumers migrate to `skills:` frontmatter
   AND declare only the sub-skill they use.
3. Can ruvector warmup be made session-scoped without changes to the
   ruvector MCP server? (Affects Phase 3.5 scope. Pass-1 research found
   ToolSearch auto-persists within a session via `tool_reference` blocks
   but not across commands — per-session MCP profiles are a feature request
   on the backlog, Issue #45293.)
4. ~~What is the actual measured token cost of the security block per spawn?~~
   **Answered (pass 2):** ~160–195 tokens (780 bytes, 120 words). Plan's
   240-token estimate was ~25% high. Real break-even for extraction depends
   on shared SKILL.md size.
5. Should the structured subagent-failure format be convention-only or
   enforced via a shared skill? (Pass-1 research suggested the output-file
   convention — file at known path — as the most robust approach, sidestepping
   the enforcement question.)
6. ~~Does `memory: true` on workflow orchestrators interact with ruvector's
   session-level recall, or are they orthogonal?~~ **Answered (pass 2):**
   Orthogonal. `memory: <scope>` uses per-subagent markdown files at
   `~/.claude/projects/<project>/memory/`; ruvector uses project-level
   vector embeddings. No documented cross-integration. Note: correct form
   is `memory: user|project|local`, NOT `memory: true`.
7. **New (pass 2):** How many review agents does a typical `/review:pr` run
   spawn concurrently in practice? The Phase 2.1 cost model is sensitive to
   this — 5–7 parallel agents paints a different picture than 25 total
   potential consumers.
8. **New (pass 2):** Is the existing `memory: true` usage in yellow-core
   review agents also wrong, or is Claude Code lenient about the field type?
   Audit before Phase 1.5 ships.

---

## References

- Source brainstorm: `docs/brainstorms/2026-04-17-claude-code-plugin-improvements-brainstorm.md`
- Existing pattern for `background: true`: `plugins/yellow-debt/agents/scanners/*.md`
- Existing pattern for `CRITICAL SECURITY RULES`: `plugins/yellow-core/agents/review/security-sentinel.md`
- Canonical `mcp-integration-patterns` skill:
  `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md`
- Agent authoring guide: `plugins/yellow-core/skills/create-agent-skills/SKILL.md`
- Changesets workflow: `docs/CLAUDE.md` (Versioning section)

<!-- deepen-plan: external -->
> **Research:** Official Claude Code documentation used to validate this plan:
> - Plugins reference (canonical plugin.json schema):
>   https://code.claude.com/docs/en/plugins-reference
> - Subagents reference (frontmatter fields, skill injection, model routing):
>   https://code.claude.com/docs/en/sub-agents
> - Unofficial JSON Schema for Claude Code:
>   https://github.com/hesreallyhim/claude-code-json-schema
>
> Relevant open GitHub issues that affect this plan:
> - #25818 — orchestrator failure diagnostic context (backlog)
> - #24181 — Task tool agents always report failed (bug)
> - #14851 — skills loaded into context without invocation
> - #19141 — `user-invocable` vs `disable-model-invocation`
> - #29768 — Haiku model inheritance bug
> - #14863 — Haiku + `tool_reference` blocks error
> - #45293 — per-session MCP profiles (feature request)
> - #21891 — Skill tool should deduplicate across parallel spawns (open FR)
> - #24115 — Plugin hooks fire twice (cross-plugin hook ordering bug)
> - #4784 — Proactive hooks / deterministic chaining (FR)
> - #27208, #31002 — hierarchical deferred tool discovery / system tools behind ToolSearch
<!-- /deepen-plan -->

---

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

## Stack Decomposition

### 1. feat/review-agents-parallel-execution
- **Type:** feat
- **Description:** enable true parallel Task execution for multi-agent review
- **Scope:** plugins/yellow-core/agents/review/*.md, plugins/yellow-review/agents/review/*.md, plugins/yellow-review/commands/review/review-pr.md, plugins/yellow-core/commands/workflows/work.md
- **Tasks:** 1.1, 1.2, 1.7 (partial — changesets for yellow-core, yellow-review)
- **Depends on:** (none)
- **Notes:** Add `background: true` to 13 review agents AND update orchestrator Task invocations to pass `run_in_background: true`. Frontmatter change alone is insufficient per pass-1 research.

### 2. feat/security-fencing-coverage-debt-ci
- **Type:** feat
- **Description:** add prompt-injection hardening to debt scanners and CI agents
- **Scope:** plugins/yellow-debt/agents/scanners/*.md, plugins/yellow-ci/agents/ci/*.md, plugins/yellow-ci/agents/maintenance/*.md
- **Tasks:** 1.3, 1.4, 1.7 (partial — changesets for yellow-debt, yellow-ci)
- **Depends on:** #1

### 3. chore/orchestrator-memory-and-descriptions
- **Type:** chore
- **Description:** set memory scope on orchestrators, sharpen overlap descriptions
- **Scope:** plugins/yellow-core/agents/workflow/{brainstorm-orchestrator,knowledge-compounder,spec-flow-analyzer}.md, plugins/yellow-devin/agents/workflow/devin-orchestrator.md, plugins/yellow-core/agents/review/code-simplicity-reviewer.md, plugins/yellow-review/agents/review/code-simplifier.md, plugins/yellow-core/agents/review/security-sentinel.md, plugins/yellow-debt/agents/scanners/security-debt-scanner.md
- **Tasks:** 1.5, 1.6, 1.8
- **Depends on:** #2
- **Notes:** Use `memory: project` (scope string), NOT `memory: true`. Audit existing `memory: true` usage while here.

### 4. feat/plugin-schema-coverage
- **Type:** feat
- **Description:** extend plugin.json schema for hooks/outputStyles/mcpServers/userConfig fields
- **Scope:** schemas/plugin.schema.json, scripts/validate-plugin.js, .github/workflows/validate-schemas.yml
- **Tasks:** 2.4, 2.5
- **Depends on:** #3
- **Notes:** schema file and validator already exist — extend coverage, don't create from scratch.

### 5. refactor/extract-security-fencing-skill
- **Type:** refactor
- **Description:** extract shared security-fencing internal skill, migrate inline consumers
- **Scope:** plugins/yellow-core/skills/security-fencing/SKILL.md (new), 25 agent files migrated
- **Tasks:** 2.1, 2.2
- **Depends on:** #4
- **Notes:** Measure skill token cost before shipping — if SKILL.md + description exceeds ~180 tokens, keeping inline may be cheaper given skills don't dedupe across parallel spawns (Issue #21891).

### 6. refactor/split-mcp-integration-patterns
- **Type:** refactor
- **Description:** split mcp-integration-patterns into 3 focused sub-skills
- **Scope:** plugins/yellow-core/skills/{memory-recall-pattern,memory-remember-pattern,morph-discovery-pattern}/SKILL.md (new), 9 consuming commands updated to declare specific sub-skill in frontmatter
- **Tasks:** 2.3
- **Depends on:** #5
- **Notes:** Only delivers token savings if consumers simultaneously migrate from inline `allowed-tools` references to `skills:` frontmatter.

### 7. docs/subagent-conventions
- **Type:** docs
- **Description:** document output-file failure convention, agent archetype table; wire orchestrator parsers
- **Scope:** plugins/yellow-core/skills/create-agent-skills/SKILL.md, plugins/yellow-review/commands/review/review-pr.md, plugins/yellow-core/commands/workflows/work.md
- **Tasks:** 2.6, 2.7, 2.8
- **Depends on:** #6
- **Notes:** Adopt output-file convention (${CLAUDE_PLUGIN_DATA}/agent-result.json) over final-line JSON blob — more robust against Task tool bugs (Issue #24181).

### 8. feat/model-routing-and-plugin-lint
- **Type:** feat
- **Description:** deliberate haiku/opus routing on select agents + per-plugin frontmatter lint
- **Scope:** 3–5 target agent files (model:), plugins/yellow-core/scripts/lint-plugin.sh (new), plugins/yellow-review/scripts/lint-plugin.sh (new), .github/workflows/lint-plugins.yml (new)
- **Tasks:** 3.1, 3.2, 3.3
- **Depends on:** #7
- **Notes:** Verify Issues #14863 (Haiku + tool_reference) and #29768 (model inheritance) are resolved in current Claude Code version before routing. Tasks 3.4 (session-summary hook) and 3.5 (ruvector warmup) punted to separate exploratory spikes.
