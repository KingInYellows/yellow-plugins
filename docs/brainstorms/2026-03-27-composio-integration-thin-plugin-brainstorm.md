# Composio Integration -- Thin Plugin Brainstorm

**Date:** 2026-03-27
**Status:** Complete -- ready for planning

---

## What We're Building

A thin `yellow-composio` plugin that provides setup validation, usage monitoring, and a skill documenting Composio MCP tool patterns. The plugin acts as an optional accelerator for existing workflows (review:all, review:pr, semgrep:fix-batch, Linear batch ops) -- not a new workflow layer. Consuming plugins detect Composio availability via ToolSearch and gracefully degrade when it is absent.

### Plugin Components

- **`/composio:setup` command** -- Validates that the Composio MCP server is registered in Claude Code, checks API key availability, initializes a local usage counter at `.claude/composio-usage.json`.
- **`/composio:status` command** -- Displays local execution counts, per-tool breakdown, and threshold warnings when approaching self-imposed limits.
- **`composio-patterns` skill** -- Documents MCP tool patterns (`COMPOSIO_REMOTE_WORKBENCH`, `COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_MANAGE_CONNECTIONS`), the execution model (local vs remote), the local usage tracking JSON format, and the graceful degradation pattern for consuming plugins.
- **No agents in v1** -- Deferred until batch execution patterns crystallize through real usage.

### Consuming Plugin Changes

| Plugin | Workflow | Composio Use | Execution Model |
|---|---|---|---|
| yellow-review | review:all, review:pr | Cross-PR finding aggregation | Hybrid (local aggregation, structured Composio output) |
| yellow-semgrep | semgrep:fix-batch | Batch scan execution and result structuring | Remote via Workbench |
| yellow-linear | sync-all, triage, plan-cycle | Issue batch-fetch and classification | Remote via Workbench |

All consumers load the `composio-patterns` skill when detected and fall back silently when absent.

---

## Why This Approach

### Problem Context

Composio is already working at the user level as an MCP connector. The goal is to formalize this into the plugin system so existing batch-heavy workflows can optionally offload expensive operations to Composio's remote Workbench -- without making Composio a hard dependency for any workflow.

### Approach Selection

Three approaches were evaluated:

#### Approach A: Skill-Only (No Plugin)

A `composio-patterns` skill bundled into yellow-core with no dedicated plugin, no setup command, and no status tracking.

**Pros:** Zero new plugin overhead, fastest to ship.
**Cons:** No setup validation (users debug MCP registration issues blind), no usage tracking, patterns buried inside yellow-core rather than owning their own namespace.
**Best when:** Composio is a minor convenience with minimal adoption risk.

#### Approach B: Thin Plugin (Selected)

A dedicated `yellow-composio` plugin with setup, status, and a skill -- but no agents. Consuming plugins use ToolSearch detection and skill preloading.

**Pros:** Clean namespace separation, setup validation catches misconfiguration early, local usage tracking provides budget awareness, skill is loadable by any consuming plugin, minimal surface area to maintain.
**Cons:** New plugin to release and version, consumers need instruction augmentation.
**Best when:** Composio is an optional accelerator used across multiple plugins with meaningful cost/usage implications.

#### Approach C: Full Plugin with Orchestration Agents

Everything in Approach B plus dedicated agents that orchestrate batch operations (e.g., a `composio-batch-runner` agent that handles Workbench session lifecycle).

**Pros:** Consuming plugins delegate entirely, consistent batch execution patterns.
**Cons:** Premature abstraction -- batch patterns are not yet stable, agent overhead for operations that may be simple tool calls, harder to debug.
**Best when:** Batch execution patterns are well-understood and reused across 3+ workflows with identical lifecycle needs.

### Rationale for Approach B

Approach B hits the right balance: it gives Composio a proper home in the plugin system with setup validation and usage tracking (which Approach A lacks), without prematurely abstracting batch orchestration into agents (which Approach C does before patterns are stable). The skill-based knowledge sharing means consuming plugins get the patterns they need without tight coupling.

---

## Key Decisions

### 1. Optional Accelerator, Not Required Dependency

Every workflow that uses Composio must work without it. Composio detection happens via ToolSearch at runtime. When absent, workflows execute their existing local codepaths. This means no plugin.json dependency declarations and no setup-time failures.

### 2. Hybrid Execution Model

Not everything goes remote. Cross-PR finding aggregation stays local (the data is local git state) but benefits from Composio's structured output tooling. Semgrep batch scans and Linear issue fetches are genuinely remote operations that benefit from Workbench execution. Each consumer decides its own execution model.

### 3. Local Usage Tracking with Warnings

**Key finding:** Composio has no monthly usage/billing API. Rate limit headers (`X-RateLimit-Remaining`) only track per-10-minute-window rate limits, not cumulative usage. Local tracking at `.claude/composio-usage.json` is the only viable option for execution budget awareness. The status command reads this file and warns when approaching user-configured thresholds.

### 4. No Agents in v1

Agents would orchestrate Workbench session lifecycle (create session, execute tools, collect results, tear down). But the batch execution patterns across review, semgrep, and Linear are different enough that a generic agent would either be too abstract or too leaky. Ship the skill first, let consuming plugins establish their own patterns, then extract common orchestration into agents in v2 if warranted.

### 5. Instruction Augmentation in Consumers

Rather than the composio plugin injecting behavior into consumers, each consuming plugin augments its own agents/commands with Composio-aware instructions. This keeps control with the consuming plugin and avoids cross-plugin coupling beyond skill loading.

---

## Discovery Process

### Questions and Answers

**Q1: What is the primary goal -- supplement existing workflows or create new Composio-native ones?**
A: Supplement existing workflows. The three targets are review:all/review:pr (finding aggregation), semgrep:fix-batch (batch execution), and Linear batch ops (issue fetch/classify). No new workflows.

**Q2: What is the current Composio usage level -- production, exploratory, or not yet started?**
A: Exploratory. A user-level MCP connector is already working, but nothing is formalized in the plugin system.

**Q3: Which batch operations should go remote vs stay local?**
A: Hybrid. Cross-PR finding aggregation stays local (local git data, structured Composio output). Semgrep batch execution and Linear issue batch-fetch go remote via Workbench.

**Q4: What constraints matter most -- cost visibility, graceful degradation, or execution speed?**
A: Graceful degradation first (A2), then cost visibility via local tracking (C1+C2). Speed is a benefit but not a constraint.

### Research Conducted

**Codebase research** identified existing plugin patterns (setup commands, skill structures, ToolSearch detection) that inform the plugin's structure.

**External research** (documented in `docs/research/composio-claude-code-integration-capabil.md`) revealed:
- Composio MCP server exposes tools via `COMPOSIO_` prefix conventions
- `COMPOSIO_REMOTE_WORKBENCH` enables remote execution with file system and tool access
- `COMPOSIO_MULTI_EXECUTE_TOOL` batches multiple tool calls in a single request
- No billing/usage API exists -- only per-window rate limit headers
- Authentication is API-key-based with connection management via `COMPOSIO_MANAGE_CONNECTIONS`

---

## Open Questions

1. **Usage tracking schema** -- What fields belong in `.claude/composio-usage.json`? Per-tool counts, timestamps, session IDs? Needs design during planning.

2. **Threshold configuration** -- Where do users configure their usage warning thresholds? In the JSON file itself, a separate config, or via the setup command?

3. **Workbench session lifecycle** -- Does each batch operation create its own Workbench session, or should sessions be reused across operations within a single workflow run? Needs experimentation.

4. **MCP server version pinning** -- Should the setup command validate the Composio MCP server version, or just check for presence? Version mismatches could cause tool signature changes.

5. **Skill preloading mechanics** -- Can consuming plugins conditionally preload `composio-patterns` only when Composio is detected, or must it be declared statically in agent frontmatter? May need a `skills:` conditional pattern.

6. **Rate limit header forwarding** -- Even though per-window rate limits are not billing data, should the status command also display current rate limit state (remaining calls in window) alongside cumulative local counts?
