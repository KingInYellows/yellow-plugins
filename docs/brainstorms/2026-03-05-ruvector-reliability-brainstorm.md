# Brainstorm: Ruvector Reliability and Capability Audit

**Date:** 2026-03-05 **Status:** Approach selected **Selected approach:** B —
Belt and Suspenders (Setup Fix + Workflow Hardening)

---

## What We're Building

A reliability fix for the ruvector plugin that eliminates the intermittent
"Skipped -- ruvector recall not available" error across all workflows
(brainstorm, plan, work, compound, review). The fix has three layers: ensuring
the global binary is installed and in PATH via setup, adding an MCP warmup
pattern to absorb cold-start latency, and documenting a retry-once pattern in
the canonical integration skill as the design reference for manual per-command
updates.

Additionally, this brainstorm documents a capability audit of the ruvector MCP
surface area (4 tools used out of 100+ available) to inform a follow-up
expansion brainstorm.

## Problem Statement

The error message "Knowledge Compounding -- Skipped -- ruvector recall not
available" appears frequently across multiple workflows. The ruvector plugin
exposes recall/remember via MCP tools and CLI hooks, but both paths fail
intermittently, causing workflows to silently skip memory operations.

This means:

- Past learnings are not injected into workflow context (brainstorm, plan, work)
- Review findings are not compounded into vector memory
- Session learnings are not recorded after `/workflows:work`
- Hook-based memory injection (user-prompt-submit, pre-tool-use) is entirely
  non-functional without the global binary

## Discovery Q&A Summary

| #   | Question                                 | Answer                                                        |
| --- | ---------------------------------------- | ------------------------------------------------------------- |
| 1   | Which workflow shows the error most?     | Everywhere -- multiple workflows                              |
| 2   | Is ruvector installed globally?          | No, npx-only. Open to global install. Setup should handle it. |
| 3   | What is the primary goal?                | Fix reliability, audit unused capabilities, expand plugin     |
| 4   | Scope for this brainstorm?               | Reliability + audit only. Separate brainstorm for expansion.  |
| 5   | Setup-only fix or also harden workflows? | Let research/approaches guide the decision                    |

## Root Cause Analysis

Three independent failure modes contribute to the error:

### 1. npx Latency Exceeds Hook Budgets

Without a global `ruvector` binary, all CLI calls go through npx, which adds
~1,870ms of startup overhead. This was measured empirically:

```
npx --no ruvector hooks recall --top-k 1 "test"  →  1,869ms
ruvector hooks recall --top-k 1 "test"            →     81ms   (23x faster)
```

Hook timeout budgets make npx-based execution impossible for most hooks:

| Hook             | Budget | npx Latency | Global Binary | Status with npx                   |
| ---------------- | ------ | ----------- | ------------- | --------------------------------- |
| PreToolUse       | 1s     | 1.87s       | 81ms          | ALWAYS SKIPPED                    |
| UserPromptSubmit | 1s     | 1.87s       | 81ms          | ALWAYS SKIPPED                    |
| SessionStart     | 3s     | 1.87s       | 81ms          | MARGINAL (2 recall calls = 3.74s) |
| PostToolUse      | 1s     | 1.87s       | 81ms          | UNRELIABLE                        |
| Stop             | 10s    | 1.87s       | 81ms          | OK                                |

With npx-only, 3 of 5 hooks are guaranteed to fail, and a 4th is marginal. This
means memory injection into prompts, pre-edit context, and post-edit recording
have been non-functional.

### 2. MCP Server Cold Start

The ruvector MCP server starts lazily on first tool call (documented 300-1500ms
cold start in CLAUDE.md). Workflow commands that call `hooks_recall` via MCP may
hit this window, especially early in a session before any hook has warmed the
server. ToolSearch finding the tool does NOT mean the server is running -- the
`mcp-integration-patterns` skill explicitly warns about this gap.

### 3. ToolSearch-to-MCP Execution Gap

The current integration pattern is:

1. Check `.ruvector/` exists
2. Call ToolSearch("hooks_recall") -- if not found, skip
3. Call the MCP tool

Step 2 succeeding does not guarantee step 3 will work. The MCP server may have
crashed, may be mid-restart, or may not have started yet. There is no retry
logic -- a single failure causes the workflow to skip memory operations
entirely.

## Setup Command Gap

The current `/ruvector:setup` command (setup.md):

- Step 2a runs `install.sh` which does
  `npm install -g ruvector --ignore-scripts`
- Step 3 checks for the global binary and warns if not found
- BUT: `install.sh` may silently fall back to `~/.local` prefix without PATH
  configuration
- AND: there is no post-install verification that the binary is actually
  reachable via `command -v ruvector`
- The setup command warns about degraded performance but does not treat a
  missing global binary as a setup failure

## Capability Audit Summary

### Currently Used (4 tools)

| Tool             | Used By                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `hooks_recall`   | brainstorm, plan, work, compound, review-pr, review-all, resolve-pr, search, learn, memory |
| `hooks_remember` | work, compound, review-pr, learn, index                                                    |
| `hooks_stats`    | status, memory                                                                             |
| `hooks_pretrain` | index                                                                                      |

### Available but Unused (100+ tools across 8 categories)

| Category              | Tool Count | Notable Capabilities                                                                           |
| --------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Hooks (analysis)      | ~15        | `diff_analyze`, `diff_classify`, `ast_analyze`, `ast_complexity`, `git_churn`, `security_scan` |
| Hooks (learning)      | ~8         | `learn`, `force_learn`, `batch_learn`, `learning_config`, `learning_stats`, `learning_update`  |
| Hooks (routing)       | ~4         | `route`, `route_enhanced`, `coverage_route`, `coverage_suggest`                                |
| Hooks (compression)   | ~4         | `compress`, `compress_get`, `compress_store`, `compress_stats`                                 |
| Hooks (collaboration) | ~4         | `coedit_record`, `coedit_suggest`, `error_record`, `error_suggest`                             |
| Hooks (trajectory)    | ~3         | `trajectory_begin`, `trajectory_end`, `trajectory_step`                                        |
| Hooks (diagnostics)   | ~6         | `doctor`, `verify`, `capabilities`, `export`, `import`, `watch_status`                         |
| Hooks (advanced)      | ~5         | `rag_context`, `build_agents`, `swarm_recommend`, `graph_cluster`, `graph_mincut`              |
| Brain                 | 16         | `search`, `share`, `sync`, `train`, `vote`, `drift`, `explore`, `partition`, `temporal`        |
| RVF (vector store)    | 9          | `create`, `open`, `ingest`, `query`, `delete`, `derive`, `compact`, `segments`                 |
| Workers               | 12         | `create`, `dispatch`, `run`, `results`, `status`, `custom`, `triggers`, `presets`              |
| RVLite (query)        | 3          | `cypher`, `sparql`, `sql`                                                                      |
| Edge (distributed)    | 4          | `join`, `balance`, `status`, `tasks`                                                           |
| Midstream             | 6          | `search`, `status`, `health`, `benchmark`, `scheduler`, `attractor`                            |
| Identity              | 2          | `generate`, `show`                                                                             |

### Current ruvector Engine Stats

- 208 vector memories, 13 patterns learned, 52 trajectories
- Engine: VectorDB + SONA + Attention all enabled
- Embedding: 256 dimensions (hash-based in CLI, ONNX semantic via MCP)

## Approaches Considered

### Approach A: Fix Setup Only

Update `/ruvector:setup` to ensure the global binary is installed and in PATH,
and add a post-install verification step. Do not change workflows or hooks.

**Pros:**

- Smallest change surface -- only touches `setup.md` and `install.sh`
- Addresses the root cause (npx latency) directly
- No risk of breaking existing workflow logic

**Cons:**

- Does not help if MCP server crashes mid-session
- Does not help users who skip setup or have PATH issues
- Workflows still have no retry or warmup
- Users must re-run setup to get the fix

**Best when:** npx latency is the only cause and MCP reliability is already
fine.

### Approach B: Belt and Suspenders (Setup Fix + Workflow Hardening) -- SELECTED

Fix the setup command AND harden the integration patterns with three layers:
setup ensures global binary, workflows absorb MCP cold start via warmup, and a
retry-once pattern handles transient MCP failures.

**Pros:**

- Addresses all three root causes: npx latency, MCP cold start, MCP execution
  failures
- Warmup pattern is cheap (sub-100ms) and prevents cold-start surprises
- Retry-once is conservative -- does not add meaningful latency on success
- `mcp-integration-patterns` stays the canonical design reference for the
  per-command updates
- Global binary makes ALL 5 hooks functional

**Cons:**

- Larger change surface -- touches setup, install script, integration skill, and
  workflow commands
- No include/shared-expansion mechanism exists, so every consuming command still
  needs a manual update
- Retry logic adds a small amount of complexity to the integration pattern
- Warmup call is technically wasteful on already-warm sessions

**Best when:** You want ruvector to "just work" across all workflows without
users needing to debug MCP issues.

### Approach C: Architectural Shift -- CLI-First with MCP Fallback

Have workflow commands call the ruvector CLI directly via Bash instead of MCP,
falling back to MCP only when CLI is unavailable.

**Pros:**

- Eliminates MCP as a failure point for core operations
- CLI calls are deterministic (81ms with global binary)
- Hooks and workflows use the same code path

**Cons:**

- Goes against plugin architecture conventions (MCP is the integration point)
- Loses structured JSON responses from MCP
- Other plugins cannot easily call Bash-based ruvector
- Significant refactor of all consuming workflow commands

**Best when:** MCP server reliability is fundamentally unreliable and should be
abandoned as the primary integration path.

## Why This Approach

Approach B was selected because it addresses all three root causes without
abandoning the MCP architecture. The global binary fix is necessary (it makes
hooks functional), but not sufficient (MCP cold start and crashes still cause
workflow failures). The warmup and retry patterns are low-cost additions that
make the entire system resilient.

The key insight from research: with the global binary installed, ruvector CLI
responds in 81ms. This makes hooks reliable and removes CLI startup as a
separate latency source. The warmup pattern (`hooks_capabilities`) absorbs the
remaining MCP cold-start penalty, and retry-once handles the rare server crash.

## Key Decisions

### 1. Setup must treat missing global binary as a failure, not a warning

Currently setup warns "hooks with 1-second budgets will be skipped." This should
be escalated: if the global binary is not in PATH after install, setup should
retry with `--prefix ~/.local`, verify PATH includes `~/.local/bin`, and fail
explicitly if the binary remains unreachable. The user should not leave setup
with a degraded installation.

### 2. MCP warmup via hooks_capabilities, not hooks_recall

The warmup call should use `hooks_capabilities` (returns engine status, no side
effects, sub-100ms) rather than a throwaway `hooks_recall` query. This avoids
polluting recall metrics and is semantically appropriate -- we are checking
capability before using it.

### 3. Retry-once with 500ms pause, not exponential backoff

A single retry after 500ms is sufficient for the MCP server to recover from a
cold start or restart. Exponential backoff adds complexity for a scenario that
either resolves immediately or is a hard failure. If retry fails, emit a warning
and skip gracefully.

### 4. Update mcp-integration-patterns skill as the canonical design reference

The canonical patterns should live in `mcp-integration-patterns` SKILL.md, but
that document is not an include mechanism. Consuming commands do NOT inherit
changes automatically. The remediation still requires manual propagation to each
consuming workflow command or inline flow (`brainstorm`, `plan`, `work`,
`compound`, `review-pr`, `resolve-pr`, and `review-all`). Keeping the skill
accurate still reduces maintenance burden by providing a single reference for
those manual updates.

### 5. Capability audit informs follow-up, not this implementation

The audit of 100+ unused ruvector tools is documented here for reference but is
explicitly out of scope for this implementation. A separate brainstorm will
prioritize which capabilities to surface based on workflow value.

## Implementation Steps (Approach B)

### Layer 1: Setup Fix

1. **Update `install.sh`:**
   - After `npm install -g`, verify with `command -v ruvector`
   - If not found, retry with `--prefix ~/.local`
   - If still not found, print exact PATH guidance for `~/.local/bin` and how to
     add it to the user's shell profile
   - Final verification: `command -v ruvector` must succeed or script exits 1

2. **Update `setup.md`:**
   - Step 3 verification: treat missing global binary as a failure, not a
     warning
   - Add smoke test: run
     `timeout 1 ruvector hooks recall --top-k 1 "setup-test"` and verify it
     completes within 1 second
   - Report table should show global binary as REQUIRED, not optional

### Layer 2: MCP Warmup Pattern

3. **Update `mcp-integration-patterns` SKILL.md Pattern 1 (Recall-Before-Act):**
   - Add warmup step between ToolSearch and the real call:
     ```
     1. Fast-path: test -d .ruvector || skip
     2. Call ToolSearch("hooks_recall"). If not found: skip.
     3. NEW: Warmup — call hooks_capabilities(). If error: note warning, skip.
     4. Call hooks_recall(query, top_k=5)
     ...
     ```
   - Document: warmup absorbs MCP cold start (300-1500ms). The capabilities call
     is idempotent and returns engine status.

### Layer 3: Retry-Once Pattern

4. **Update `mcp-integration-patterns` SKILL.md Pattern 1 execution:**
   - Change step 2 (MCP execution error handling) to:
     ```
     2. If MCP execution error on first attempt: pause 500ms, retry once.
        If retry also fails: note `[ruvector] Warning`, skip to next step.
     ```
   - Apply same retry-once to Pattern 2 (Tiered-Remember-After-Act) for
     `hooks_remember` calls, with a warning when remember is skipped after the
     retry.

### Layer 4: Propagate to Consuming Commands

5. **Manually propagate the updated patterns to consuming commands and inline
   flows using the skill as the reference:**
   - `brainstorm.md` -- uses Pattern 1 (recall before act)
   - `plan.md` -- uses Pattern 1
   - `work.md` -- uses Pattern 1 (recall) and Pattern 2 (remember)
   - `compound.md` -- uses Pattern 2 (remember with dedup)
   - `review-pr.md` -- uses Pattern 1 (Step 3b) and Pattern 2 (Step 9b)
   - `resolve-pr.md` -- uses Pattern 1
   - `review-all.md` -- needs its inline review flow and `allowed-tools` kept in
     sync with `review-pr`

6. **Add `hooks_capabilities` to allowed-tools** in commands that use
   recall/remember (needed for the warmup call).

## Open Questions

- Should the warmup call happen once per session (via session-start hook) or
  once per workflow command invocation? Session-level warmup would be more
  efficient but requires hook coordination.
- Should `install.sh` pin a minimum ruvector version (currently installs
  `latest`)? The plugin references v0.1.96+ CLI conventions but current version
  is 0.2.11.
- For the follow-up expansion brainstorm: should we prioritize hooks that
  enhance existing workflows (diff_analyze for review, trajectory tracking for
  work) or entirely new capabilities (brain sharing, workers, RVLite queries)?
- The hook recall uses hash embeddings (not ONNX semantic) -- should the warmup
  pattern also verify embedding engine availability via `hooks_capabilities`
  response fields?

## Follow-Up

A separate brainstorm should be conducted for **ruvector capability expansion**
-- prioritizing which of the 100+ unused MCP tools to surface as commands,
integrate into existing workflows, or expose as agent capabilities. The
capability audit in this document provides the starting inventory.

Suggested command:
`/workflows:brainstorm ruvector capability expansion -- which unused tools to surface`
