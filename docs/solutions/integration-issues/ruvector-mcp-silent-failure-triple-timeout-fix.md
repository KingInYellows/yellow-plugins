---
title: 'ruvector MCP Silent Failure: Triple Timeout Fix (npx Latency + Cold Start + No Retry)'
date: 2026-03-05
category: integration-issues
tags:
  - ruvector
  - mcp
  - timeout
  - npx-latency
  - cold-start
  - retry-pattern
  - hooks
  - graceful-degradation
  - install-script
  - cross-plugin
components:
  - plugins/yellow-ruvector/scripts/install.sh
  - plugins/yellow-ruvector/commands/ruvector/setup.md
  - plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md
  - plugins/yellow-core/commands/workflows/brainstorm.md
  - plugins/yellow-core/commands/workflows/plan.md
  - plugins/yellow-core/commands/workflows/work.md
  - plugins/yellow-core/commands/workflows/compound.md
  - plugins/yellow-review/commands/review/review-pr.md
  - plugins/yellow-review/commands/review/resolve-pr.md
  - plugins/yellow-review/commands/review/review-all.md
---

# ruvector MCP Silent Failure: Triple Timeout Fix

## Problem

All ruvector MCP integration across the yellow-plugins ecosystem silently
failed with the message "Knowledge Compounding -- Skipped -- ruvector recall
not available." Hooks that depend on ruvector (PreToolUse, UserPromptSubmit,
PostToolUse) were silently skipped in every session, and workflow commands
(brainstorm, plan, work, compound, review-pr, resolve-pr) could not recall or
remember learnings.

### Observable Symptoms

- "Knowledge Compounding -- Skipped -- ruvector recall not available" in every
  compound/review session
- Hooks with 1-second budgets (PreToolUse, UserPromptSubmit, PostToolUse)
  always timed out and were silently discarded
- First MCP tool call in a session consistently failed or timed out
- Transient MCP errors (timeout, connection refused) caused permanent skip with
  no recovery attempt for the rest of the session

## Root Cause

Three independent failure modes compounded to make ruvector MCP integration
functionally broken:

### 1. npx Latency (23x Overhead)

`npx` adds approximately 1,869ms overhead per invocation due to package
resolution. The global binary (`ruvector`) takes only 81ms -- a 23x difference.
Hooks with 1-second execution budgets always exceeded their timeout when
invoked via `npx`, causing silent skip every time.

```text
npx ruvector hooks recall: ~1,869ms (exceeds 1s budget -> silent skip)
ruvector hooks recall:     ~81ms    (within budget -> works)
```

### 2. MCP Cold Start (300-1500ms)

The MCP server takes 300-1500ms to initialize on the first tool call per
session. No built-in warmup mechanism exists in the MCP protocol. ToolSearch
locating a tool does not guarantee the MCP server is running -- it only
confirms the tool is registered in the plugin manifest.

### 3. No Retry on Transient Errors

MCP execution errors (timeout, connection refused, service unavailable) caused
an immediate and permanent skip for the remainder of the workflow. A single
transient failure during cold start was enough to disable all ruvector
integration for the entire session.

## Fix

A three-layer "belt and suspenders" approach, each layer addressing one failure
mode independently:

### Layer 1: Global Binary Verification (install.sh)

Changed the install script to require a global binary in PATH, not just an npx-
resolvable package.

**Key changes:**

- Verification changed from `npx ruvector --version` to `command -v ruvector`
- Added nvm/fnm detection with warnings about per-version binary isolation
- Auto-configures PATH in shell rc file (`~/.zshrc`/`~/.bashrc`) for
  `--prefix ~/.local` fallback installs
- Uses `printf %q` for safe rc file writing (prevents shell injection via
  `$HOME` containing special characters)
- Hard failure if global binary is not in PATH after install -- degraded mode
  with npx is misleading because hooks would still be broken

```bash
# Verification: global binary required
if ! command -v ruvector >/dev/null 2>&1; then
  error "ruvector global binary not found in PATH after install. \
Hooks with 1-second budgets require the global binary \
(npx adds ~1900ms overhead)."
fi
```

**Why hard failure instead of fallback:** With npx overhead of ~1,900ms, hooks
are functionally broken even though they technically exist. Allowing the install
to succeed would create a misleading "everything is fine" state where all hook-
based features silently do nothing.

### Layer 2: MCP Warmup via hooks_capabilities()

All 7 consuming commands now call `hooks_capabilities()` before `hooks_recall`
to absorb the MCP cold start penalty.

```text
1. Call ToolSearch("hooks_recall"). If not found: skip entirely.
2. Warmup: call hooks_capabilities(). This absorbs MCP cold start
   (300-1500ms on first tool call per session). If it errors: note
   "[ruvector] Warning: MCP warmup failed" and skip recall entirely.
3. Proceed with hooks_recall() (server is now warm, sub-100ms).
```

`hooks_capabilities()` is a no-side-effect call that returns the engine status.
It forces the MCP server through its initialization handshake before the real
recall call, converting the cold start cost from an unexpected timeout into a
predictable warmup step.

**Warmup placement:** Warmup is placed before `hooks_recall` only, not before
`hooks_remember`. If recall already ran earlier in the same session, the MCP
server is warm and remember does not need another warmup. This is documented
in `mcp-integration-patterns/SKILL.md`.

### Layer 3: Retry-Once on Transient MCP Errors

On timeout, connection refused, or service unavailable: wait approximately
500ms, then retry exactly once with the same parameters.

```text
1. Call hooks_recall(query, top_k=5)
2. If MCP execution error (timeout, connection refused, or service
   unavailable): wait approximately 500 milliseconds, then retry
   exactly once with the same parameters.
   - If the retry succeeds: continue with its results.
   - If the retry also fails: note "[ruvector] Warning: recall
     unavailable after retry" and skip to next workflow step.
   - Do NOT retry on validation errors or parameter errors.
   - Do NOT attempt alternative approaches or workarounds.
```

**Why retry-once, not exponential backoff:** The 500ms window is sufficient for
MCP server initialization to complete. If the server is genuinely down (not just
cold-starting), exponential backoff would add latency without benefit. The
retry-once pattern bounds the worst case to ~1 second of additional wait.

**Why not retry validation errors:** Validation/parameter errors are
deterministic -- retrying would produce the same error and could mask bugs in
the calling code.

## Files Changed (10 files, 3 plugins)

| File | Layer | Change |
|---|---|---|
| `plugins/yellow-ruvector/scripts/install.sh` | 1 | Global binary verification, nvm/fnm detection, rc file PATH config |
| `plugins/yellow-ruvector/commands/ruvector/setup.md` | 1 | Hard failure on missing binary, smoke test with gtimeout macOS fallback |
| `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md` | 2+3 | Canonical warmup + retry-once patterns (design reference) |
| `plugins/yellow-core/commands/workflows/brainstorm.md` | 2+3 | Warmup + retry-once for recall |
| `plugins/yellow-core/commands/workflows/plan.md` | 2+3 | Warmup + retry-once for recall |
| `plugins/yellow-core/commands/workflows/work.md` | 2+3 | Warmup + retry-once for recall and remember |
| `plugins/yellow-core/commands/workflows/compound.md` | 2+3 | Warmup + retry-once for recall and remember |
| `plugins/yellow-review/commands/review/review-pr.md` | 2+3 | Warmup + retry-once for recall and remember |
| `plugins/yellow-review/commands/review/resolve-pr.md` | 2+3 | Warmup + retry-once for recall |
| `plugins/yellow-review/commands/review/review-all.md` | — | Added hooks_remember to allowed-tools |

## Key Design Decisions

### Inline patterns in each command (no shared include mechanism)

No skill tag or include mechanism exists in Claude Code command files. Patterns
from `SKILL.md` must be manually propagated to all 7 consuming commands. The
`SKILL.md` serves as the canonical reference, and each command file includes
the full warmup + retry-once pattern inline.

### Auto-write to rc file

The install script intentionally writes to the user's shell rc file to ensure
zero-interaction plugin setup. This is protected by:

- `grep` dedup check (does not add if the line already exists)
- `printf %q` escaping (prevents shell injection via `$HOME`)
- Only triggers in the fallback path (when `--prefix ~/.local` was needed)

### Hard failure on missing global binary

A deliberate choice: npx overhead (1,869ms) makes hooks functionally broken,
so allowing installation to "succeed" with only npx would create a false sense
of correctness where every hook silently does nothing.

## Review Findings Applied

The following findings from PR review were incorporated:

| Severity | Finding | Fix |
|---|---|---|
| P1 | Deprecated `npm bin -g` in install.sh | Replaced with `npm config get prefix` + `/bin` |
| P2 | Ambiguous step references in workflow commands | Disambiguated step references in compound.md, review-pr.md, work.md, resolve-pr.md |
| P2 | Inconsistent warning labels | Standardized to `[ruvector] Warning` prefix across all commands |
| P2 | hooks_remember silently skipped (asymmetric with recall which warned) | Changed to emit warning on skip |
| P2 | hooks_remember missing from review-all.md allowed-tools | Added to allowed-tools |
| P2 | fnm detection used wrong env var (FNM_USING_NODE) | Changed to FNM_DIR + `command -v fnm` |
| P3 | No macOS timeout fallback in setup.md smoke test | Added gtimeout macOS fallback |
| P3 | Used `which` instead of POSIX-compliant `command -v` | Replaced throughout |

## Prevention

### 1. Benchmark npx vs global binary for hook-invoked CLIs

Before referencing any CLI tool in a hook with a time budget, measure the npx
overhead:

```bash
time npx <tool> --version    # npx path
time <tool> --version        # global binary path
```

If the npx overhead exceeds the hook's time budget, the global binary must be
required (not optional).

### 2. Always include MCP warmup before first real tool call

Any workflow that calls an MCP tool should include a warmup step with a no-
side-effect call (such as `hooks_capabilities()`) to absorb cold start latency.
Do not assume ToolSearch success means the MCP server is running.

### 3. Implement retry-once for transient MCP errors

Every MCP tool call in a workflow command should handle transient errors
(timeout, connection refused, service unavailable) with a single retry after
~500ms. Never retry validation or parameter errors.

### 4. Test MCP integration end-to-end on cold session start

The failure mode only manifests on the first MCP call after session start.
Testing mid-session (when the server is warm) will not catch cold start issues.

### 5. Document warmup placement decisions

When a workflow uses both recall and remember, document which call handles the
warmup so future maintainers do not add redundant warmup calls.

## Related Documentation

- [ruvector MCP Tool Parameter Schema Mismatch](ruvector-mcp-tool-parameter-schema-mismatch.md)
  -- same ecosystem (ruvector MCP), different failure mode (invented parameters)
- [ruvector CLI and MCP Tool Name Mismatches](ruvector-cli-and-mcp-tool-name-mismatches.md)
  -- same ecosystem, different failure mode (fictitious tool names)
- [MCP Bundled Server Tool Naming](mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md)
  -- MCP plugin authoring patterns
- `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md`
  -- canonical warmup + retry-once patterns (design reference for all commands)
