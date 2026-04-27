# Brainstorm: Claude Code Plugin System — Efficiency and Quality Improvements

**Date:** 2026-04-17
**Topic:** Ideas on how to improve the yellow-plugins system for efficiency and
quality performance from Claude Code

---

## What We're Building

A prioritized set of improvements to the yellow-plugins monorepo (16 plugins,
~55 agents, ~80 commands, ~28 skills) that reduce token consumption and
latency while raising output consistency, agent selection quality, and
observability. The improvements target the plugin runtime layer — how Claude
Code agents load instructions, route decisions, use tools, and surface failures
— not individual plugin domain logic.

---

## Context Gathered

The exploration covered all 16 plugin manifests, a representative spread of
agents (yellow-core, yellow-review, yellow-debt, yellow-ci, yellow-ruvector,
yellow-research), the canonical `mcp-integration-patterns` and `brainstorming`
skills, the five ruvector hooks, and the `work.md` / `review-pr.md` orchestration
commands in full. Key structural observations:

- **All 54 agent files use `model: inherit`** except five: `ci/status.md` uses
  `haiku`, three yellow-ci commands use `sonnet`, and `scan-verifier` in
  yellow-semgrep uses `sonnet`. There is no use of opus-class routing
  anywhere for heavy reasoning tasks.
- **Security boilerplate is fully duplicated** across 16 review/research agent
  files (`CRITICAL SECURITY RULES` block + content fencing). This accounts
  for ~200-300 tokens of identical prompt per spawned agent.
- **`ToolSearch` is called per-command** (186 occurrences across 76 files) with
  no session-level caching. Each command or agent independently discovers morph
  and ruvector — sub-100ms each but adds up in multi-agent parallelism.
- **ruvector warmup (`hooks_capabilities`) fires 26 times** across 14 command
  files — every command that touches memory independently performs warmup. In a
  `/workflows:work` session that invokes `/review:pr` after submission, warmup
  runs twice in the same session.
- **`CRITICAL SECURITY RULES` exists in 16 agent bodies** but is absent from
  the 8 yellow-debt scanners and 4 yellow-ci agents that also read untrusted
  code. Coverage is inconsistent.
- **`background: true`** is used in 11 agents (yellow-debt scanners,
  yellow-docs generators, repo-research-analyst, research-conductor). This
  is the parallelism primitive, but 8 yellow-core review agents and all
  yellow-review agents do NOT use it — they run synchronously even when
  launched via `Task` in parallel.
- **Manifest schema drift**: `yellow-ci` and `yellow-debt` have `hooks` keys in
  `plugin.json`; `yellow-ruvector` has full hook wiring with 5 scripts;
  `yellow-review` and `yellow-core` have no hooks at all. There is no shared
  schema or lint rule to catch missing fields.
- **Error observability**: subagent failures (Task spawns) have no standard
  propagation pattern. Failures are mentioned as "[graceful degradation]" in
  prose inside commands, but there is no structured failure reporting format
  shared across plugins.
- **The `mcp-integration-patterns` skill is the closest thing to shared
  infrastructure**, but it has no mechanism to self-enforce — consuming commands
  can diverge from it without a test or CI check catching it.
- **No plugin self-tests exist** in any plugin directory. The only validation
  is `plugin.json` JSON structure.

---

## Four Buckets of Findings

### Bucket 1: Token / Context Efficiency

**Finding 1A — Security boilerplate duplication (16 files, ~240 tokens each)**

The `CRITICAL SECURITY RULES` block with content fencing instructions is
copy-pasted verbatim into 16 agent files. When agents are spawned in parallel
(e.g., 4-7 agents during `/review:pr`), each agent pays the full token cost of
loading this block. A shared skill (`security-fencing`) with `user-invokable:
false` would let consuming agents reference it via `skills:` frontmatter and
load it once, reducing per-agent context overhead.

**Finding 1B — Oversized orchestration commands**

`work.md` is 686 lines. `review-pr.md` and `plan.md` are also long multi-phase
documents. When Claude Code reads these as the command file, the entire body is
in context even for the simplest invocations (e.g., single-branch work with no
stack decomposition loads 200+ lines of stack execution logic it will never
use). Phase-gating via shorter up-front dispatch + lazy Skill references for
phases only reached conditionally could reduce initial context by 30-50%.

**Finding 1C — Agent description overlap causing selection confusion**

`code-simplicity-reviewer` (yellow-core) and `code-simplifier` (yellow-review)
have overlapping descriptions: both mention simplification, YAGNI, and removing
unnecessary code. The key distinction (pre-fix vs post-fix pass) is in a
parenthetical. Similarly, `security-sentinel` (yellow-core) and
`security-debt-scanner` (yellow-debt) both scan for security issues but differ
in focus (active vulnerabilities vs debt). When Claude Code's adaptive selection
reads agent descriptions to route, these overlaps create ambiguity. Sharpening
the `description:` field with the trigger condition in the first clause (not the
second) and removing hedging language would reduce misrouting.

**Finding 1D — `mcp-integration-patterns` skill size vs consumption frequency**

The skill is 263 lines and loaded by 14 command files. However, each command
only uses 1-2 of the 3 patterns (Recall-Before-Act, Tiered-Remember-After-Act,
Morph-Discovery). Splitting into three focused sub-skills
(`memory-recall-pattern`, `memory-remember-pattern`, `morph-discovery-pattern`)
would let each command declare only what it needs, reducing context by ~60-100
tokens per command.

---

### Bucket 2: Latency / Parallelism

**Finding 2A — ruvector warmup fires redundantly per command**

`hooks_capabilities` warmup appears in 14 command files. In a chained session
(brainstorm → plan → work → review), each command independently warms up the
MCP server. Since MCP servers stay running across commands in a session, a
session-level warmup flag (set by the first recall call) would eliminate
redundant warmup calls in commands invoked after the first. This requires no
infrastructure change — just a shared convention: if `hooks_recall` has already
been called this session (inferred by checking if the ruvector session-start
hook ran), skip warmup.

**Finding 2B — yellow-core review agents lack `background: true`**

The 8 review agents in yellow-core/agents/review (security-sentinel,
performance-oracle, architecture-strategist, polyglot-reviewer,
code-simplicity-reviewer, test-coverage-analyst, pattern-recognition-specialist)
all use `model: inherit` with no `background: true`. They are spawned in
parallel via `Task` in `work.md` Phase 3 and `review-pr.md`, but without
`background: true` the Claude Code runtime may serialize them. Adding
`background: true` to these 7 agents (matching the pattern already used in
yellow-debt scanners and repo-research-analyst) would enable true parallel
execution and reduce multi-agent review wall time.

**Finding 2C — Hook overhead accumulates on every edit**

The ruvector `pre-tool-use.sh` fires on every Edit, Write, MultiEdit, and Bash
call. For a session where `/workflows:work` makes 50+ edits, that is 50+ hook
invocations. The hook is well-optimized (fires pre-edit in background, exits
immediately), but the hook itself calls `ruvector hooks pre-edit` as a
background subprocess. If the ruvector binary is a global install and fast
(62ms), overhead is negligible. But the session-start hook already loads top
learnings — the pre-tool-use hook adds marginal value for routine edits. A
`PRE_TOOL_USE_ENABLED` env flag (or a `.ruvector/config.json` setting) would
let power users disable it on large-edit sessions.

**Finding 2D — Serial ruvector dedup before every `hooks_remember` call**

Pattern 2 in `mcp-integration-patterns` requires a dedup recall (top_k=1,
score > 0.82) before every store. In a session with multiple remember calls
(brainstorm + work + review), this adds 3-5 serial MCP round-trips before
storage. Dedup is important for quality but could be made async (fire-and-forget
with a best-effort cancel if duplicate detected) or batched at session-end
rather than per-call.

---

### Bucket 3: Consistency

**Finding 3A — `background: true` usage is uneven by plugin**

yellow-debt scanners: all use `background: true`. yellow-docs generators: all
use `background: true`. yellow-core review agents: none use `background: true`.
yellow-review review agents: none use `background: true`. The pattern exists but
is not uniformly applied. A lint rule in CI (`grep -rL 'background: true'
plugins/*/agents/`) that flags non-orchestrator agents without `background: true`
would catch regressions.

**Finding 3B — No shared `plugin.json` schema or validator**

Manifests drift: some have `hooks`, some have `outputStyles`, some have
`mcpServers`, none have required-field enforcement. There is no JSON Schema file
in the repo and no CI step validating structure. A `schemas/plugin.schema.json`
validated by `ajv-cli` in CI would prevent field typos (like the Codacy config
node version typo mentioned in recent commits) and document the allowed shape.

**Finding 3C — `CRITICAL SECURITY RULES` is absent from 23 agents that read
untrusted code**

yellow-debt scanners (security-debt-scanner, complexity-scanner,
architecture-scanner, duplication-scanner, ai-pattern-scanner) and yellow-ci
agents (failure-analyst, workflow-optimizer, runner-diagnostics) all read
untrusted code — CI logs, dependency files, source files — but lack the security
fencing instructions present in yellow-core and yellow-review review agents.
This is a correctness/consistency gap: the instruction defends against prompt
injection from file content, which is equally relevant for debt scanners and CI
analysts.

**Finding 3D — Frontmatter completeness varies widely**

Some agents have: name, description, model, memory, tools, skills, background,
color. Others have only name, description, model, tools. The `memory: true`
field enables Claude Code's internal memory feature but is present in only ~8
agents. `color:` is used only in `failure-analyst`. There is no guidance in
`create-agent-skills` on which fields are required vs recommended vs optional
for different agent archetypes. Adding an agent archetype table to
`create-agent-skills/SKILL.md` (reviewer archetype: needs model, tools,
background; orchestrator archetype: needs skills, tools, AskUserQuestion) would
standardize authoring.

---

### Bucket 4: Quality

**Finding 4A — No model routing for heavy vs light tasks**

Every agent uses `model: inherit`, meaning the user's active model (typically
Sonnet) runs all tasks. But tasks have very different complexity requirements:
- `ci/status.md` correctly uses `haiku` for a status-display-only command.
- Deep reasoning tasks (architecture-strategist evaluating SOLID principles,
  research-conductor doing multi-source synthesis) would benefit from opus
  routing.
- Fast pattern-matching tasks (content-fencing checks, simple grep + report
  agents) could use haiku.

A tiered model routing convention (`model: haiku` for display/status, `model:
inherit` for standard review, `model: opus` for architecture/deep research)
embedded in `create-agent-skills` would let authors make intentional choices
rather than defaulting to inherit universally.

**Finding 4B — Subagent failure has no structured surface**

When a `Task` spawned agent fails (crashes, times out, returns empty), the
orchestrating command's handling is prose-level: "if Skill invocation fails,
skip silently" or "inform the user". There is no structured failure object
format. This means the user experience of a multi-agent review where two of six
agents silently fail is indistinguishable from one where all six succeed. A
lightweight convention — agents that fail should return a structured JSON object
`{"agent": "...", "status": "failed", "reason": "..."}` as their last line
before exiting — would let orchestrators distinguish partial-success from full
success and report accurately.

**Finding 4C — Plugin self-tests are entirely absent**

No plugin has a test directory or validation script. The only "test" is whether
the plugin works in a live Claude Code session. This makes it hard to detect
regressions (e.g., when updating `mcp-integration-patterns`, all 14 consuming
commands should be checked). Lightweight shell-based tests that validate
frontmatter completeness, slug correctness, skill references, and required
sections in agent bodies would catch a class of bugs before commit. The
`plans/yellow-morph-improvements.md` already identified the
`ENABLED_TOOLS`/`ALL_TOOLS` env var discrepancy — a test could have caught that.

**Finding 4D — `memory: true` is underused for learning continuity**

`memory: true` in agent frontmatter enables Claude Code's built-in session
memory. Only 8 agents declare it (review agents in yellow-core and yellow-review).
Workflow orchestrators (brainstorm-orchestrator, knowledge-compounder,
spec-flow-analyzer) that make multi-step decisions would benefit from memory
continuity if the user reopens a session mid-workflow. This is distinct from
ruvector (project-level vector memory) — it is the in-session memory feature
that prevents re-reading already-parsed context.

---

## Three Concrete Approaches

### Approach A: Targeted Quick-Win Pass (recommended starting point)

Apply the highest-impact, lowest-effort improvements as a focused batch: add
`background: true` to the 7 yellow-core review agents and 6 yellow-review review
agents (2A + 2B); sharpen the 5-6 most ambiguous agent `description:` fields
(1C); add `CRITICAL SECURITY RULES` to the 5 yellow-debt scanners and 4
yellow-ci agents that read untrusted code (3C); add `memory: true` to workflow
orchestrators (4D). This pass touches ~25 files, changes no logic, and delivers
measurable improvements to parallelism, safety, and agent selection quality.

**Pros:**
- Zero risk of breaking working behavior — all changes are additive or
  clarifying
- Immediate benefit to review latency (parallel background agents)
- Can ship as a single PR with clear before/after evidence
- No new infrastructure required

**Cons:**
- Does not address structural issues (duplicated boilerplate, command size,
  schema validation)
- Model routing improvements require more judgment calls

**Best when:** you want demonstrable improvement fast, or as a first step before
tackling structural changes.

---

### Approach B: Shared Infrastructure Layer

Extract duplicated concerns into shared artifacts: create a
`security-fencing` skill (internal, `user-invokable: false`) that all agents
reference instead of inlining the boilerplate; split `mcp-integration-patterns`
into three focused sub-skills; add `schemas/plugin.schema.json` with `ajv-cli`
CI validation; establish a structured subagent failure format convention.
This is architectural — it changes how content is organized and referenced
across the monorepo.

**Pros:**
- Permanently eliminates duplication — new agents get security fencing for free
- Schema validation prevents manifest drift
- Structured failure format gives observability without new tooling

**Cons:**
- Larger change surface — touching skills requires updating consuming agents'
  frontmatter
- If Claude Code skill loading has overhead, more `skills:` declarations could
  increase per-agent initialization cost (needs verification)
- Requires migration of all existing consumers to use shared skills

**Best when:** you're planning a batch of new plugins and want authoring
conventions to be self-enforcing from the start.

---

### Approach C: Model Routing + Observability Investment

Introduce intentional model routing (`haiku` for display commands, `opus` for
architecture/deep research) across the plugin ecosystem; add plugin self-tests
(shell scripts that lint frontmatter, validate skill references, check required
sections); and add a session-level observation layer (a hook or post-session
summary) that reports which agents ran, which succeeded, and what they found.

**Pros:**
- Model routing reduces cost on cheap tasks and improves quality on hard ones
- Self-tests catch regressions before they reach users
- Observability makes multi-agent sessions debuggable

**Cons:**
- Model routing requires per-agent judgment and may need tuning
- Self-tests require ongoing maintenance as plugin structure evolves
- Observation layer is novel infrastructure — no existing hook for "session
  summary" beyond ruvector's stop.sh

**Best when:** you're investing in the plugin ecosystem as a long-term product
and want quality gates at authoring time, not just runtime.

---

## Recommended Next Steps

**Quick wins (1-3 days, Approach A):**

1. Add `background: true` to all non-orchestrator agents in yellow-core/review
   and yellow-review/review (7 + 6 = 13 files). File list: security-sentinel,
   performance-oracle, architecture-strategist, polyglot-reviewer,
   code-simplicity-reviewer, test-coverage-analyst, pattern-recognition-specialist
   in yellow-core; code-reviewer, pr-test-analyzer, comment-analyzer,
   type-design-analyzer, silent-failure-hunter, code-simplifier in yellow-review.
2. Add `CRITICAL SECURITY RULES` + content fencing to yellow-debt scanners
   (5 files) and yellow-ci agents (4 files).
3. Add `memory: project` to brainstorm-orchestrator, knowledge-compounder,
   spec-flow-analyzer, devin-orchestrator. (Official Claude Code agent
   schema requires a scope string: `user`, `project`, or `local` — not boolean.)
4. Sharpen description fields for code-simplicity-reviewer vs code-simplifier
   and security-sentinel vs security-debt-scanner to put the trigger condition
   first.

**Medium initiatives (1-2 weeks, Approach B elements):**

5. Extract `CRITICAL SECURITY RULES` into a `security-fencing` internal skill
   and update all 16 current consumers.
6. Split `mcp-integration-patterns` into 3 focused sub-skills.
7. Add `schemas/plugin.schema.json` + CI validation step.
8. Document the agent archetype table in `create-agent-skills/SKILL.md`.

**Longer-term investments (Approach C elements):**

9. Introduce model routing convention: identify 3-5 agents that clearly warrant
   `haiku` (status/display) or `opus` (deep architecture reasoning) and set
   them as examples.
10. Add per-plugin lint scripts that validate frontmatter and skill references.
11. Explore a session-end summary hook (extending ruvector's stop.sh) that
    emits which workflows ran and which subagents succeeded or failed.

---

## Key Decisions

1. **`background: true` on review agents** — This is the single highest-impact
   change. Review sessions spawn 4-7 agents; making them truly parallel cuts
   wall time proportionally. The yellow-debt and yellow-docs patterns already
   demonstrate this works.

2. **Shared `security-fencing` skill vs inline boilerplate** — Shared skill is
   cleaner but introduces a loading dependency. Until skill loading cost is
   confirmed negligible for frequently-spawned agents, both options remain valid.
   Quick-win approach (item 2 above) closes the coverage gap immediately even if
   the shared skill comes later.

3. **Model routing conservatism** — Defaulting everything to `inherit` is safe
   but leaves quality and cost on the table. The correct first step is `haiku`
   for pure display commands (status, setup confirmation) and `inherit` for
   everything else. Opus routing should wait until specific agents are confirmed
   as bottlenecks.

4. **Plugin self-tests scope** — Start with frontmatter lint (does every agent
   have name, description, model, tools?) before more complex behavioral tests.
   Shell-only, no new dependencies.

---

## Open Questions

1. Does `background: true` actually enable Claude Code parallelism when agents
   are spawned via `Task`, or does it only affect agent-initiated spawns?
   The documentation is ambiguous — needs a runtime verification test.

2. Is there a cost to declaring more `skills:` in agent frontmatter? If
   Claude Code loads all declared skills before the agent runs, splitting
   `mcp-integration-patterns` could increase per-agent startup time.

3. Can ruvector warmup be made session-scoped (fire once, share state across
   commands) without changes to the ruvector MCP server? The current
   per-command warmup pattern is defensive but redundant in chained sessions.

4. What is the actual token cost of `CRITICAL SECURITY RULES` + content fencing
   per agent spawn? Confirming this with a token counter would help prioritize
   the shared skill extraction.

5. Should the structured failure format for subagents be a convention (prose in
   `create-agent-skills`) or enforced via a shared skill that all agents load?
   The latter is higher fidelity but heavier.

6. For the `memory:` field (scope string: `user` / `project` / `local`) —
   does enabling it on workflow orchestrators interact with ruvector's
   session-level recall, or are they orthogonal memory systems?
