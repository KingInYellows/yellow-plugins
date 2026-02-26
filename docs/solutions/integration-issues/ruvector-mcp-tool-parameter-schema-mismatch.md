---
title: 'ruvector MCP Tool Parameter Schema Mismatch'
date: 2026-02-24
category: integration-issues
tags:
  - ruvector
  - mcp-tools
  - api-mismatch
  - hooks_recall
  - hooks_remember
  - parameter-validation
  - documentation-drift
---

# ruvector MCP Tool Parameter Schema Mismatch

## Problem

PR #49 (feat/memory-aware-workflow-integration) introduced ruvector memory
integration into review and work workflows. Seven files across three plugins
documented MCP tool parameters that do not exist in the actual ruvector MCP
server (v0.1.99):

- `hooks_recall` was called with `namespace="reflexion"` — no `namespace`
  parameter exists. Actual schema: `query` (string, required) + `top_k`
  (number, default 5).
- `hooks_remember` was called with `namespace="reflexion"` and
  `metadata={trigger, insight, action, ...}` — neither parameter exists. Actual
  schema: `content` (string, required) + `type` (string, default "general").
- Response filtering referenced a `similarity` field — the actual field is
  `score`.
- An entire namespace taxonomy (`code`, `reflexion`, `skills`, `sessions`,
  `causal`) was documented as a first-class feature with validation rules,
  anti-patterns, and cross-namespace contamination warnings — none backed by
  any runtime capability.

Files affected: `work.md`, `review-pr.md`, `review-all.md`,
`learning-compounder.md`, `memory-query/SKILL.md`, `yellow-ruvector/CLAUDE.md`,
`post-tool-use.sh`.

## Detection

A comment-analyzer review agent was suspicious of the namespace claims and
inspected the actual installed ruvector package source:

```bash
grep -A 30 'hooks_recall\|hooks_remember' \
  /home/kinginyellow/.nvm/versions/node/v24.12.0/lib/node_modules/ruvector/bin/mcp-server.js
```

This revealed the actual `inputSchema` definitions:

```js
// hooks_recall — actual schema
{ query: { type: 'string' }, top_k: { type: 'number', default: 5 } }

// hooks_remember — actual schema
{ content: { type: 'string' }, type: { type: 'string', default: 'general' } }

// Response mapping — actual field name
results.map(r => ({ score: r.score, content: r.content, type: r.type }))
```

The word `namespace` appears nowhere in the CLI or MCP server source.

## Root Cause

The PR author (or assisting LLM) invented API parameters based on what the
design *wanted* the API to support, rather than verifying against the actual
installed tool schema. The namespace taxonomy was an architectural aspiration
documented as if it were an implemented feature.

This is a known failure mode when:

1. An LLM generates plugin code for an MCP tool it was not trained on (or
   trained on a different version of).
2. The author treats a design document or architectural vision as if it were an
   implementation specification.
3. No empirical verification step is performed before writing agent instructions
   that call the tool.

## Fix

Removed all invented parameters and aligned with actual schema:

**Before:**

```
hooks_recall(namespace="reflexion", query="...", top_k=5)
hooks_remember(namespace="reflexion", content="...", metadata={...})
Discard results with similarity < 0.5
<finding id="1" similarity="X.XX">
```

**After:**

```
hooks_recall(query="...", top_k=5)
hooks_remember(content="...", type="decision")
Discard results with score < 0.5
<finding id="1" score="X.XX">
```

Specific changes across 7 files:

- Removed `namespace="reflexion"` from all `hooks_recall` calls
- Removed `namespace` and `metadata` from all `hooks_remember` calls
- Changed `similarity` to `score` in result filtering and XML templates
- Removed namespace-related anti-patterns from SKILL.md
- Updated dedup logic: `hooks_recall query=content, top_k=1` (no namespace)
- Added dedup section to SKILL.md documenting the 0.82 score threshold

## Prevention

### 1. Verify MCP tool schemas empirically before authoring

Before writing any agent or command file that calls MCP tools, verify the actual
schema:

```bash
# Option A: Inspect source directly
grep -A 20 'inputSchema' node_modules/ruvector/bin/mcp-server.js

# Option B: Run the MCP info command
npx ruvector mcp info

# Option C: Call with bad args and read the validation error
```

**Rule:** No MCP tool call in an agent/command file is valid unless the author
has confirmed the parameter name appears in the server's own schema output.

### 2. Review agents must cross-reference tool schemas

When reviewing files that call MCP tools, extract every parameter and verify it
against the installed server source. Flag any parameter not confirmed in an
authoritative source as P1 — the author must provide evidence, not reassurance.

### 3. No aspirational parameters

If a desired capability (e.g., namespace filtering) does not exist in the
current tool schema, it must not appear as a parameter in agent files. Document
it as a future request in comments, not as a current parameter.

### 4. Inline schema evidence

Above MCP tool call blocks, include a verification comment:

```markdown
<!-- Parameters verified against: npx ruvector mcp info, 2026-02-24 -->
```

## Related

- [ruvector CLI and MCP Tool Name Mismatches](ruvector-cli-and-mcp-tool-name-mismatches.md)
  — same root cause (invented names), different scope (tool names vs parameters)
- [MCP Bundled Server Tool Naming](mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md)
  — covers namespace prefix formula and the "never derive from memory" rule
- MEMORY.md entries: "ruvector CLI & MCP Patterns", "MCP Bundled Server Tool
  Naming"
