# Plan: yellow-ruvector Plugin

---
title: "feat: Add yellow-ruvector plugin with vector memory, semantic search, and agent learning"
type: feat
date: 2026-02-11
---

## Enhancement Summary

**Deepened on:** 2026-02-11
**Sections enhanced:** All 9 major sections
**Research agents used:** 18 (architecture, security, performance, simplicity, pattern-recognition, silent-failure, spec-flow, best-practices, framework-docs, repo-conventions, learnings, hook-dev, plugin-structure, mcp-integration, bash-defensive, agent-native, ruvector-research, vector-db-research)

### Critical Corrections Discovered

1. **Hooks are bash scripts, NOT JavaScript** — Claude Code hooks must be bash scripts configured via `hooks/hooks.json`, not `.js` files. Hook input arrives as JSON on stdin, output as JSON on stdout.
2. **Hooks CANNOT call MCP tools** — Hooks run as subprocesses without MCP client access. Must use CLI commands or delegate to agents via `systemMessage`.
3. **ruvector has 30+ MCP tools** — Not just basic vector ops. Includes AgenticDB with native `reflexion_episodes`, `skills_library`, `causal_edges`, `learning_sessions` tables.
4. **Default embedding model is all-MiniLM-L6-v2** (384 dims, ONNX WASM) — NOT `ruvltra-small-q4_k_m.gguf`. No evidence "ruvllm" exists as a standalone tool.
5. **MCP tool naming must be `mcp__plugin_yellow-ruvector_ruvector__*`** — Not `mcp__ruvector__*`.
6. **MCP server command is `npx ruvector mcp-server`** — Not `ruvector-mcp --transport stdio`.
7. **Storage uses `.ruvector/intelligence/memory.rvdb`** (rvlite format) — Not `config.toml`.

### Key Improvements

1. Corrected hook architecture from JS to bash scripts with `hooks/hooks.json`
2. Added 2 Critical + 3 High security mitigations (npm hijacking, JSONL injection, ReDoS, TOCTOU, MCP validation)
3. Added tree-sitter-based semantic chunking recommendation (40%+ accuracy improvement over fixed-size)
4. Added RRF (Reciprocal Rank Fusion) ranking instead of simple weighted sum
5. Expanded spike validation from 2-4 hours to 4-6 hours with 4 additional validation items
6. Added Phase 6: Maintenance Operations (uninstall, upgrade, team usage)
7. Added 17 missing flows and edge cases from spec-flow analysis
8. Added performance budget breakdowns and optimization strategies

### New Considerations Discovered

- Stop hook should delegate queue flushing to agent via `systemMessage` (not MCP calls)
- ruvector has built-in hooks system (`ruvector hooks init/install`) — explore native integration
- SessionStart worst-case 5.4s violates 3s budget — needs work prioritization
- PostToolUse O(n) dedup reads entire JSONL per tool use — use append-only, dedup at flush
- Consider deferring hooks to v2 for simplification (start with 3 commands: setup, index, search)

### Technical Review Findings Incorporated (2026-02-12)

**P1 Critical (5 fixes applied):**
1. Path traversal mitigation upgraded from bash pattern matching to `realpath` + prefix check
2. memory-manager agent `allowed-tools` now includes `Bash` and `Write` for queue manipulation
3. Hook JSONL construction uses `jq -n --arg` instead of string interpolation
4. SessionStart budget now includes MCP cold start mitigation (lazy init, 300-1500ms budget)
5. MCP tool naming validation added as explicit Phase 0 spike item #11

**P2 Important (10 fixes applied):**
6. Hook input trust boundary: explicit validation rules for all stdin JSON fields
7. Queue rotation strategy defined: rename to `.jsonl.1` at 10MB, create new queue
8. Agent descriptions updated with user behavior triggers ("Use when user says...")
9. MCP server lifecycle documented (start on first tool call, restart instructions)
10. memory-manager agent splitting consideration noted (writer + advisor for v2)
11. Stop hook delegation failure mode documented with SessionStart recovery
12. plugin.json MCP config: removed redundant `entrypoints.mcpServers`
13. All command frontmatter now includes `description` with "Use when..." trigger phrases
14. ShellCheck validation added per-phase (not just Phase 5)
15. MCP cold start profiling added to Phase 0 spike

---

## Overview

Build a Claude Code plugin that integrates [ruvector](https://github.com/ruvnet/ruvector) — a Rust-based, self-learning vector database — as a persistent agent intelligence layer. The plugin provides semantic code search, agent memory (reflexion, skills, causal), and hook-driven passive learning capture.

**Brainstorm:** `docs/brainstorms/2026-02-11-yellow-ruvector-plugin-brainstorm.md`

**Component inventory:** 2 agents, 6 commands, 2 skills, 3 hooks, 1 MCP server, 1 install script

**Novel patterns (first in this repo):**
- First stdio-based MCP server (all existing plugins use HTTP)
- First plugin to implement hooks (bash scripts via `hooks/hooks.json`)
- First plugin with local persistent storage (`.ruvector/` in project root)

### Research Insights: Overview

**ruvector Capabilities (verified via GitHub research):**
- 30+ MCP tools including AgenticDB tables: `reflexion_episodes`, `skills_library`, `causal_edges`, `learning_sessions`
- Built-in hooks system: `ruvector hooks init/install/pre-edit/post-edit/session-start/session-end`
- Storage: `.ruvector/intelligence/` with `memory.rvdb` (rvlite format)
- Default embedding: all-MiniLM-L6-v2 (384 dims) via ONNX WASM runtime
- Sub-millisecond latency for 1M vectors
- npm package v0.1.23, Rust crate v0.1.2
- Installation: `claude mcp add ruvector-mcp -- npx ruvector mcp-server`

**Simplification Opportunity (from simplicity review):**
Consider a phased approach:
- **MVP (Phase 1-2):** 3 commands (setup, index, search) + MCP server. No hooks, no memory.
- **v2 (Phase 3-4):** Add memory commands, learning skill, hooks
- This reduces initial LOC by ~35-40% and avoids the unvalidated hook architecture risk

## Problem Statement

Claude Code agents have no persistent memory across sessions. Each session starts from zero — agents can't remember past mistakes, successful patterns, or project-specific conventions beyond what's manually captured in CLAUDE.md or auto-memory. There's no semantic code search beyond keyword-based grep.

ruvector solves this by providing a local, self-improving vector database with purpose-built agent learning APIs (reflexion memory, skill library, causal memory graphs).

## Proposed Solution

A plugin structured as:

```
plugins/yellow-ruvector/
├── .claude-plugin/
│   └── plugin.json          # MCP server config (stdio), permissions, entrypoints
├── agents/
│   └── ruvector/
│       ├── semantic-search.md
│       └── memory-manager.md
├── commands/
│   └── ruvector/
│       ├── setup.md
│       ├── index.md
│       ├── search.md
│       ├── memory.md
│       ├── learn.md
│       └── status.md
├── skills/
│   ├── ruvector-conventions/
│   │   └── SKILL.md
│   └── agent-learning/
│       └── SKILL.md
├── hooks/
│   ├── hooks.json            # Hook configuration (NOT .js files)
│   └── scripts/
│       ├── session-start.sh  # Bash script receiving JSON on stdin
│       ├── post-tool-use.sh  # Bash script receiving JSON on stdin
│       └── stop.sh           # Bash script receiving JSON on stdin
├── scripts/
│   └── install.sh
├── config/
│   └── ruvector.mcp.json
├── CLAUDE.md
├── .gitattributes
└── README.md
```

### Research Insights: Plugin Structure

**Corrected hooks directory (from hook-dev agent):**
Claude Code hooks are NOT JavaScript files. They must be bash scripts configured via `hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh",
        "timeout": 3
      }]
    }],
    "PostToolUse": [{
      "matcher": "Edit|Write|Bash",
      "hooks": [{
        "type": "command",
        "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/post-tool-use.sh",
        "timeout": 1
      }]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/stop.sh",
        "timeout": 10
      }]
    }]
  }
}
```

**plugin.json hooks registration:** `"hooks": "./hooks/hooks.json"` (path to JSON file, NOT inline object)

**Corrected plugin.json entrypoints (from plugin-structure + mcp-integration agents):**
```json
{
  "name": "yellow-ruvector",
  "version": "0.1.0",
  "description": "Persistent vector memory and semantic code search for Claude Code agents via ruvector",
  "author": "kinginyellow",
  "license": "MIT",
  "repository": "https://github.com/kinginyellow/yellow-plugins",
  "homepage": "https://github.com/kinginyellow/yellow-plugins/tree/main/plugins/yellow-ruvector",
  "mcpServers": {
    "ruvector": {
      "command": "npx",
      "args": ["ruvector", "mcp-server"],
      "env": {
        "RUVECTOR_STORAGE_PATH": "${PWD}/.ruvector/"
      }
    }
  },
  "hooks": "./hooks/hooks.json",
  "entrypoints": {
    "commands": [
      "commands/ruvector/setup.md",
      "commands/ruvector/index.md",
      "commands/ruvector/search.md",
      "commands/ruvector/memory.md",
      "commands/ruvector/learn.md",
      "commands/ruvector/status.md"
    ],
    "agents": [
      "agents/ruvector/semantic-search.md",
      "agents/ruvector/memory-manager.md"
    ],
    "skills": [
      "skills/ruvector-conventions/SKILL.md",
      "skills/agent-learning/SKILL.md"
    ]
  },
  "permissions": [
    {
      "scope": "filesystem",
      "reason": "Read/write .ruvector/ directory for vector storage and queue files",
      "paths": [".ruvector/"]
    },
    {
      "scope": "shell",
      "reason": "Run ruvector CLI, npm, and hook scripts",
      "commands": ["ruvector", "npx", "npm", "jq", "git"]
    }
  ],
  "keywords": ["vector-search", "agent-memory", "semantic-search", "embeddings", "self-learning"],
  "compatibility": {
    "claudeCodeMin": "2.0.0"
  }
}
```

**MCP tool naming convention:** All commands/agents must reference MCP tools as `mcp__plugin_yellow-ruvector_ruvector__*` (e.g., `mcp__plugin_yellow-ruvector_ruvector__vector_db_search`). ToolSearch is required before first MCP call in hooks.

## Technical Approach

### Architecture

```
Claude Code Session
  │
  ├─ SessionStart hook (bash script via hooks.json)
  │   ├─ Check .ruvector/ exists — exit silently if not
  │   ├─ Flush stale pending-updates.jsonl via ruvector CLI (NOT MCP)
  │   ├─ Incremental index via ruvector CLI (NOT MCP)
  │   └─ Load top 5 learnings via ruvector CLI → return as systemMessage
  │
  ├─ Agent/User work
  │   ├─ semantic-search agent → MCP search tools (via ToolSearch discovery)
  │   ├─ memory-manager agent → MCP memory tools (via ToolSearch discovery)
  │   └─ Commands → MCP tools + Bash for CLI operations
  │
  ├─ PostToolUse hook (bash script, on Edit/Write/Bash)
  │   └─ Append to .ruvector/pending-updates.jsonl (non-blocking, NO MCP)
  │
  └─ Stop hook (bash script)
      ├─ Return systemMessage asking Claude to flush queue via memory-manager agent
      └─ Agent flushes pending-updates.jsonl → ruvector via MCP
```

**MCP Server:** ruvector runs as stdio transport via `npx ruvector mcp-server`, configured in plugin.json. Storage path resolves relative to CWD (project root), not plugin root.

**Queue architecture:** Hooks never write directly to ruvector (hooks CANNOT access MCP). They append to a local JSONL queue file. The Stop hook delegates flushing to the memory-manager agent via `systemMessage`. SessionStart flushes stale queues via ruvector CLI.

**Concurrency model:** `pending-updates.jsonl` uses atomic append (O_APPEND). Multiple sessions on the same project append safely. Queue flush uses file locking (flock) to prevent double-processing. ruvector handles its own DB-level locking.

**Deduplication:** PostToolUse appends all events (append-only, no dedup at write time). Deduplication happens at flush time — only the latest entry per file_path is processed. This avoids the O(n) read bottleneck on every PostToolUse.

### Research Insights: Architecture

**Critical constraint — hooks cannot call MCP tools (from framework-docs agent):**
Hook scripts run as subprocesses with stdin/stdout JSON communication. They do NOT have access to the MCP client connection. This means:
- SessionStart: Use `ruvector search` CLI (not `vector_db_search` MCP tool)
- PostToolUse: Append to JSONL queue only (no MCP needed)
- Stop: Return `systemMessage` asking Claude to call memory-manager agent to flush queue

**Corrected Stop hook flow:**
```bash
#!/bin/bash
set -eu
# Read queue size
if [ ! -s "${CLAUDE_PROJECT_DIR}/.ruvector/pending-updates.jsonl" ]; then
  printf '{"continue": true}\n'
  exit 0
fi
count=$(wc -l < "${CLAUDE_PROJECT_DIR}/.ruvector/pending-updates.jsonl")
cat <<EOF
{
  "systemMessage": "There are $count pending ruvector updates in .ruvector/pending-updates.jsonl. Please use the ruvector-memory-manager agent to flush them before ending the session.",
  "continue": true
}
EOF
```

**Environment variables available in hooks:**
- `$CLAUDE_PROJECT_DIR` — Project root path
- `$CLAUDE_PLUGIN_ROOT` — Plugin directory
- `$CLAUDE_ENV_FILE` — SessionStart only: persist env vars

**Performance budget concern (from performance + architecture agents — P1 CRITICAL):**
SessionStart worst-case: 5.4s with 50 queue entries (violates 3s budget). Additionally, MCP cold start adds 300-1500ms on first tool call after session start — this is unanalyzed and could blow the budget.

**Mitigations:**
- Cap flush at 20 entries (not 50), skip incremental index if flush takes >1.5s
- Work prioritization: flush queue (highest) > load learnings (medium) > incremental index (lowest, skip if over budget)
- MCP lazy initialization: SessionStart hook uses CLI only (no MCP cold start penalty). First MCP call happens later when agent/command is invoked.
- Phase 0 spike must profile MCP cold start time and document in `docs/hook-api-contract.md`
- If cold start > 1s, add explicit warm-up note to CLAUDE.md ("first search may be slow")

**Silent failure risks (from silent-failure agent):**
- SessionStart silent exit ambiguity: log why hook exited early (no .ruvector/ vs error vs budget exceeded)
- PostToolUse append failure: if disk full or permissions issue, fail silently but log to stderr
- Partial queue flush: process entries atomically, write processed-count marker
- MCP server crash: detect via stderr, surface restart instructions
- JSONL corrupt lines from power loss: skip malformed lines with `jq -c '.' 2>/dev/null || continue`

**Queue rotation strategy (from architecture + performance agents — P2):**
Queue can grow unbounded if Stop hook delegation fails repeatedly. Define bounded growth:
- **At 10MB:** Rotate queue file — rename `pending-updates.jsonl` to `pending-updates.jsonl.1`, create new empty queue
- **At flush time:** Process both `.jsonl` and `.jsonl.1` (current + rotated)
- **After successful flush:** Delete `.jsonl.1`
- **Max rotated files:** 1 (cap total queue at ~20MB)
- **Stale queue cleanup:** SessionStart deletes `.jsonl.1` files older than 7 days
- **Status reporting:** `/ruvector:status` shows queue entries count, total size, and age of oldest entry
- **Warn threshold:** `/ruvector:status` warns if queue > 5MB or > 1000 entries

### Implementation Phases

#### Phase 0: Expanded Spike Validation (Pre-Phase 1)

Before committing to implementation, validate these blockers. **Expected duration: 5-7 hours** (expanded from 2-4 based on architectural review + technical review).

**Original spike items:**

1. **Install ruvector** — `npm install -g ruvector`. Verify binary works on WSL2.
2. **Test MCP stdio** — Run `npx ruvector mcp-server`, send a basic tool call, verify response.
3. **Test Claude Code MCP integration** — Configure a minimal plugin.json with ruvector MCP, verify Claude Code discovers tools via ToolSearch.
4. **Test embeddings quality** — Index a small codebase (~50 files), run search queries, evaluate result relevance. Verify all-MiniLM-L6-v2 model quality.
5. **Test hook execution** — Create a minimal plugin with a SessionStart hook (bash script in `hooks/hooks.json`), verify it fires and receives expected data on stdin.

**Additional spike items (from architectural review):**

6. **Validate hook error handling** (30 min)
   - Create hook that exits with error, verify session doesn't crash
   - Create hook that times out (>3s), verify session continues
   - Verify hook return value contract (JSON on stdout)

7. **Validate stdio MCP error modes** (30 min)
   - Kill ruvector-mcp process mid-session, verify error message
   - Start with invalid config, verify startup failure detection
   - Send malformed MCP request, verify error handling

8. **Validate file locking behavior** (20 min)
   - Start two Claude Code sessions in same project
   - Trigger writes in both simultaneously
   - Verify queue file doesn't corrupt

9. **Document hook API contract** (1 hour)
   - What data does PostToolUse receive on stdin? (tool_name, tool_input, tool_result?)
   - Can hooks modify session state?
   - What's the exit code contract? (0=success, 2=blocking error, other=non-blocking)
   - Create `docs/hook-api-contract.md` from validated findings

10. **Test ruvector's native hooks** (30 min)
    - Run `ruvector hooks init` and `ruvector hooks install`
    - Evaluate whether ruvector's built-in hook system can complement or replace our custom hooks
    - Document findings

11. **Validate MCP tool naming convention** (20 min) — P1 CRITICAL
    - Configure plugin with `mcp__plugin_yellow-ruvector_ruvector__*` naming
    - Run ToolSearch to verify tools are discoverable with this prefix
    - If naming differs, document actual names and update ALL tool references in plan
    - This blocks every command and agent that references MCP tools

12. **Profile MCP cold start time** (20 min) — P2
    - Measure time from first MCP tool call to response (cold start)
    - If > 1s, document in CLAUDE.md as known limitation
    - Test with `time npx ruvector mcp-server` startup latency

**Acceptance criteria for spike:**
- [ ] Hook API contract documented with validated behavior
- [ ] stdio MCP error modes cataloged
- [ ] Multi-session file locking verified
- [ ] Embedding quality meets threshold (>70% relevant results in top-5)
- [ ] MCP tool names confirmed (match `mcp__plugin_yellow-ruvector_ruvector__*` or documented alternative)
- [ ] MCP cold start time profiled and documented

#### Phase 1: Scaffold & Setup

Create the plugin skeleton and installation command. This is the foundation everything depends on.

**Tasks:**

- [x] Create `plugins/yellow-ruvector/.claude-plugin/plugin.json`
  - Name, version, description, author, license, keywords
  - `mcpServers.ruvector` with `npx ruvector mcp-server` command
  - Permissions: filesystem (`.ruvector/`), shell (`ruvector`, `npx`, `npm`, `jq`, `git`)
  - Entrypoints for all commands, agents, skills, mcpServers
  - `hooks: "./hooks/hooks.json"` (path reference, not inline)
  - `compatibility.claudeCodeMin: "2.0.0"`
  - `repository` and `homepage` fields

- [x] Create `plugins/yellow-ruvector/config/ruvector.mcp.json`
  ```json
  {
    "ruvector": {
      "command": "npx",
      "args": ["ruvector", "mcp-server"],
      "env": {
        "RUVECTOR_STORAGE_PATH": "${PWD}/.ruvector/"
      }
    }
  }
  ```

- [x] Create `plugins/yellow-ruvector/scripts/install.sh`
  - `set -Eeuo pipefail` (strict mode with ERR trap)
  - Dependency checks: `command -v node >/dev/null 2>&1`, `command -v npm >/dev/null 2>&1`, `command -v jq >/dev/null 2>&1`
  - Detect OS/arch for platform-appropriate install
  - Install ruvector CLI via `npm install -g ruvector` (no sudo — use `--prefix` if needed)
  - Verify `npx ruvector --version` works after install
  - Validate npm PATH: `command -v npx >/dev/null 2>&1 || error "npx not in PATH"`
  - curl retry logic: `curl --retry 3 --retry-delay 2`
  - Checksum validation if available
  - Error messages with recovery instructions
  - Cleanup on failure (trap ERR)
  - Follow all shell security patterns from memory (quoting, `--` separator, path validation)
  - **Run `shellcheck -s bash scripts/install.sh` — zero warnings required** (don't defer to Phase 5)

- [x] Create `plugins/yellow-ruvector/commands/ruvector/setup.md`
  - Frontmatter: `name: ruvector:setup`, `description: "Install ruvector and initialize vector storage. Use when user says 'set up ruvector', 'install vector search', 'enable semantic search', or 'initialize ruvector'."`, `allowed-tools: [Bash, Read, AskUserQuestion, Write]`
  - Step 1: Check prerequisites (node >= 18, npm, jq)
  - Step 2: Run `install.sh` via Bash
  - Step 3: Initialize `.ruvector/` directory with `ruvector init`
  - Step 4: Add `.ruvector/` to `.gitignore` (append if not present)
  - Step 5: Verify MCP server connectivity (run `npx ruvector mcp-server` briefly and check response)
  - Step 6: Offer to run initial index (`/ruvector:index`)
  - Error handling: clear messages for each failure mode (npm not found, download failed, disk full, PATH issues)

- [x] Create `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md`
  - `user-invocable: false`
  - Namespace definitions: `code`, `reflexion`, `skills`, `causal`, `sessions`
  - Memory schema for each namespace (required/optional fields)
  - Embedding model: all-MiniLM-L6-v2 (384 dimensions, ONNX WASM)
  - MCP tool naming: `mcp__plugin_yellow-ruvector_ruvector__*`
  - Graceful degradation rules: all agents must work without ruvector
  - Error handling catalog: MCP server down, empty DB, corrupt queue, disk full, timeout
  - `.ruvectorignore` format (same as .gitignore syntax)
  - Queue file format (JSONL with `type`, `file_path`, `timestamp`, `command`, `exit_code` fields)
  - Namespace validation: names must match `[a-z0-9-]` only (reject path traversal)

- [x] Create `plugins/yellow-ruvector/CLAUDE.md`
  - MCP server details (stdio via `npx ruvector mcp-server`, storage path, restart instructions)
  - **MCP server lifecycle:** starts on first MCP tool call (lazy init by Claude Code), shuts down on session end. If crashed mid-session, surface error and suggest `npx ruvector mcp-server` restart. First call after session start may be slow (300-1500ms cold start).
  - Plugin components inventory with descriptions and counts (use section headings: `### Commands (6)`, `### Agents (2)`, `### Skills (2)`, `### Hooks (3)`, `### Scripts (1)`)
  - When to use what (commands vs agents)
  - Conventions (namespace naming, queue format, security patterns)
  - Known limitations (first stdio MCP, hooks cannot call MCP, no offline MCP fallback)
  - **Stop hook delegation:** Stop hook returns `systemMessage` asking Claude to flush queue. This is non-deterministic — Claude may not follow. If flush doesn't happen, SessionStart recovers stale queue on next session.
  - Graceful degradation behavior
  - **Git worktree note:** `.ruvector/` is shared across worktrees. Queue flushing is safe (flock), but concurrent indexing may race.

- [x] Create `.gitattributes` entry: `* text=auto eol=lf` (at plugin root)

- [x] Create `plugins/yellow-ruvector/hooks/hooks.json` (empty hooks config, populated in Phase 4)

**Acceptance criteria:**
- [ ] `/ruvector:setup` installs ruvector + creates `.ruvector/` on Linux/macOS/WSL2
- [ ] MCP server starts and responds to basic tool calls
- [ ] `.ruvector/` is gitignored
- [ ] `pnpm validate:plugins` passes
- [ ] All entrypoint files exist and are referenced correctly

### Research Insights: Phase 1

**install.sh security checklist (from bash-defensive agent):**

1. `set -Eeuo pipefail` (not just `set -eu`)
2. Dependency checks with clear error messages and install URLs
3. npm without sudo — use `--prefix "$HOME/.local"` if global fails
4. OS/arch detection: `uname -s`, `uname -m`
5. curl retry: `--retry 3 --retry-delay 2 --fail --silent --show-error`
6. PATH validation: verify npx is reachable after install
7. Error trap: `trap cleanup ERR` to remove partial installs
8. Checksum validation: `sha256sum --check` if checksums available
9. Version pinning: install specific ruvector version, not latest
10. Idempotent: safe to run multiple times

**Plugin structure validation (from plugin-structure agent):**
- `${CLAUDE_PLUGIN_ROOT}` must be used in all hook commands for portability
- Entrypoints must list every file — validation script checks existence
- permissions array is required (can be empty but must exist)
- `compatibility.claudeCodeMin` is required as valid semver

**MCP configuration (from mcp-integration agent):**
- Use `${PWD}/.ruvector/` for storage path (resolves to project root)
- First stdio MCP in this repo — HTTP precedent exists in yellow-linear
- MCP health check should be part of `/ruvector:status`
- Document MCP server lifecycle (start on first tool call, cleanup on session end)

#### Phase 2: Code Intelligence

Add semantic code search — the primary user-facing value.

**Tasks:**

- [x] Create `plugins/yellow-ruvector/commands/ruvector/index.md`
  - Frontmatter: `name: ruvector:index`, `argument-hint: "[path]"`, `description: "Index codebase for semantic search. Use when user says 'index my code', 'build search index', 'update embeddings', or 're-index project'."`, `allowed-tools: [Bash, Read, ToolSearch, mcp__plugin_yellow-ruvector_ruvector__vector_db_insert, mcp__plugin_yellow-ruvector_ruvector__vector_db_create]`
  - Step 1: Validate `.ruvector/` exists (prompt for setup if not)
  - Step 2: Determine scope — `$ARGUMENTS` path or full repo
  - Step 3: Get file list via `git ls-files` (respects .gitignore) + filter by `.ruvectorignore`
  - Step 4: Skip binary files, minified files, files > 1MB
  - Step 5: Chunk files — prefer tree-sitter semantic boundaries (function/class/method), fall back to ~512-token fixed chunks with 10% overlap
  - Step 6: Generate embeddings via ruvector's ONNX WASM runtime (all-MiniLM-L6-v2, 384 dims)
  - Step 7: Upsert into `code` namespace with metadata (file_path, language, chunk_type, symbols, git_hash, last_indexed)
  - Step 8: Report stats (files indexed, vectors created, time taken)
  - Progress: show file count progress (e.g., "Indexing 142/350 files...")
  - Large repo handling: process in batches of 100 files, allow interruption
  - Track file moves/renames: `git diff --name-status --diff-filter=AMR`

- [x] Create `plugins/yellow-ruvector/commands/ruvector/search.md`
  - Frontmatter: `name: ruvector:search`, `argument-hint: "<query>"`, `description: "Search codebase by meaning using vector similarity. Use when user says 'find code that does X', 'search for implementations of Y', 'semantic search', or 'find similar functions'."`, `allowed-tools: [ToolSearch, mcp__plugin_yellow-ruvector_ruvector__vector_db_search]`
  - Step 1: Validate ruvector is available and DB is non-empty
  - Step 2: If DB empty, suggest running `/ruvector:index` first
  - Step 3: Generate embedding for query text
  - Step 4: Search `code` namespace with top-k=10
  - Step 5: Apply optional filters (file type, directory path) from `$ARGUMENTS`
  - Step 6: Display results: file path, similarity score, code snippet with context
  - Fallback: if MCP unavailable, suggest using Grep as alternative

- [x] Create `plugins/yellow-ruvector/commands/ruvector/status.md`
  - Frontmatter: `name: ruvector:status`, `description: "Show ruvector health, DB stats, and queue status. Use when user says 'ruvector status', 'check vector DB', 'how many vectors', or 'is ruvector working'."`, `allowed-tools: [Bash, ToolSearch, mcp__plugin_yellow-ruvector_ruvector__vector_db_stats]`
  - Show: ruvector CLI version, MCP server status (running/stopped)
  - Show: DB stats per namespace (vector count, approximate size)
  - Show: last index timestamp, pending queue size
  - Show: disk usage of `.ruvector/` directory
  - Show: queue health (entries count, age of oldest entry)
  - Warn: if queue > 5MB or > 1000 entries

- [x] Create `plugins/yellow-ruvector/agents/ruvector/semantic-search.md`
  - Frontmatter: `name: ruvector-semantic-search`, `model: inherit`
  - `allowed-tools: [ToolSearch, Grep, Read, mcp__plugin_yellow-ruvector_ruvector__vector_db_search]`
  - Description: "Use when an agent needs to find code by meaning rather than keyword. Use when searching for implementations of a concept, similar patterns, or related functionality across the codebase. Also use when user says 'find similar code', 'search by concept', 'where is X implemented', or 'find code that does Y'."
  - Workflow: ToolSearch to discover MCP tools → embed query → search code namespace → return file paths + snippets
  - Fallback: if ruvector unavailable, use Grep with extracted keywords
  - Examples: 2-3 realistic scenarios
  - Keep under 120 lines

**Acceptance criteria:**
- [ ] `/ruvector:index` indexes a test project and populates `code` namespace
- [ ] `/ruvector:search "authentication logic"` returns relevant files ranked by similarity
- [ ] `/ruvector:status` shows accurate DB stats
- [ ] semantic-search agent is triggered correctly by other agents
- [ ] Graceful fallback to grep when ruvector is unavailable

### Research Insights: Phase 2

**Tree-sitter semantic chunking (from vector-db-research agent):**
The [cAST framework](https://arxiv.org/html/2506.15655v1) (June 2025) demonstrates tree-sitter-based semantic chunking significantly outperforms fixed-size approaches:
- 40%+ improvement in domain-specific accuracy
- Chunks align with complete AST nodes (functions, classes, methods)
- 1.2-3.3 points improvement in Precision, 1.8-4.3 in Recall on RepoEval

Recommendation: Use semantic boundaries for supported languages (80+ via tree-sitter), fall back to fixed 512-token chunks for unsupported formats.

**Overlap reduction:** A [January 2026 study](https://arxiv.org/abs/2601.14123) found overlap provides no measurable benefit and increases indexing cost. Reduce from 25% (128 tokens) to 10% (51 tokens) or 0%.

**Rich metadata for code vectors:**
```jsonl
{
  "file_path": "src/auth.ts",
  "language": "typescript",
  "chunk_type": "function",
  "symbols": ["authenticate", "User"],
  "imports": ["express", "./db"],
  "docstring": "Handles user authentication...",
  "git_hash": "abc123...",
  "last_modified": "2026-02-11T10:30:00Z"
}
```

**Embedding model validation (from vector-db-research agent):**
No evidence found for "ruvltra" model in 2025-2026 literature. ruvector's default all-MiniLM-L6-v2 (384 dims) is well-proven. If quality is insufficient, consider:
1. Jina-code-embeddings (best for cross-language code similarity)
2. Codestral Embed (best for code retrieval)
3. Qwen3 Embeddings (best for multilingual)

**Soft deletion (from vector-db-research agent):**
- Mark vectors as deleted in metadata (don't remove immediately)
- Filter deleted vectors in search queries
- Run compaction weekly or when deleted > 20% of index
- Enables "undo" capability for accidental deletions

#### Phase 3: Agent Memory

Add reflexion memory, skill tracking, and learning commands.

**Tasks:**

- [x] Create `plugins/yellow-ruvector/commands/ruvector/learn.md`
  - Frontmatter: `name: ruvector:learn`, `argument-hint: "[learning description]"`, `description: "Record a learning, mistake, or pattern for future sessions. Use when user says 'remember this', 'save this pattern', 'record this mistake', 'learn from this', or 'don't forget X'."`, `allowed-tools: [ToolSearch, AskUserQuestion, mcp__plugin_yellow-ruvector_ruvector__vector_db_insert, mcp__plugin_yellow-ruvector_ruvector__vector_db_search]`
  - Step 1: If `$ARGUMENTS` provided, use as learning context
  - Step 2: If no args, use AskUserQuestion to gather: what happened, what went wrong, what's the fix
  - Step 3: Determine namespace: reflexion (mistake+fix), skills (successful pattern), causal (cause-effect)
  - Step 4: Construct structured entry per ruvector-conventions skill schema
  - Step 5: Dedup check: search for similar entries (cosine > 0.85), warn if near-duplicate found
  - Step 6: Generate embedding and store via MCP
  - Step 7: Confirm storage with entry ID

- [x] Create `plugins/yellow-ruvector/commands/ruvector/memory.md`
  - Frontmatter: `name: ruvector:memory`, `argument-hint: "[namespace] [filter]"`, `description: "Browse, search, and manage stored memories and learnings. Use when user says 'show memories', 'what do we know about X', 'list learnings', 'delete memory', or 'browse reflexions'."`, `allowed-tools: [ToolSearch, AskUserQuestion, mcp__plugin_yellow-ruvector_ruvector__vector_db_search, mcp__plugin_yellow-ruvector_ruvector__vector_db_stats]`
  - Step 1: Parse namespace filter from `$ARGUMENTS` (default: all)
  - Step 2: Query entries with optional text filter
  - Step 3: Display paginated results (10 per page) with: namespace, summary, timestamp
  - Step 4: Offer actions: view detail, delete entry, delete all in namespace
  - Step 5: Confirm before bulk delete via AskUserQuestion (M3 pattern)
  - Orphan detection: if `code` namespace, check if file still exists on disk

- [x] Create `plugins/yellow-ruvector/agents/ruvector/memory-manager.md`
  - Frontmatter: `name: ruvector-memory-manager`, `model: inherit`
  - `allowed-tools: [ToolSearch, Read, Write, Bash, mcp__plugin_yellow-ruvector_ruvector__vector_db_insert, mcp__plugin_yellow-ruvector_ruvector__vector_db_search]`
  - Description: "Use when storing or retrieving agent learnings across sessions. Use when an agent needs to record a mistake and its fix, retrieve past learnings for a similar task, or check what patterns have been successful in this project. Also use when user says 'remember this', 'what did we learn about X', 'record this mistake', or 'flush pending updates'."
  - Dual role: storage (reflexion, patterns, decisions) + retrieval (pre-flight advisor). Note: consider splitting into writer + advisor agents in v2 if complexity grows.
  - Queue flushing: when called via Stop hook systemMessage, read `pending-updates.jsonl`, process entries, truncate queue file via Write or Bash
  - Deduplication: before storing, search for similar existing entries (cosine > 0.85 = likely duplicate)
  - Advisory mode: when given a task description, query relevant learnings and format as context
  - Namespace validation: reject names with `..`, `/`, `~`
  - Examples: 2-3 realistic scenarios (recording a mistake, querying past learnings, flushing queue)
  - Keep under 120 lines

- [x] Create `plugins/yellow-ruvector/skills/agent-learning/SKILL.md`
  - `user-invocable: false`
  - When to record learnings (triggers):
    - Reflexion: test failure, lint error, user correction, retry after error
    - Pattern: successful complex operation, user praise, clean first-attempt success
    - Causal: "X caused Y" observations during debugging
    - Skip: trivial operations, file reads, searches
  - Learning entry quality guidelines (good vs bad examples)
  - Quality gates: minimum 20 words, must include context + insight + action
  - Retrieval strategy: use RRF to combine similarity ranking + recency ranking + frequency ranking
  - Context window budget: load max 5 learnings per session start (most relevant)

**Acceptance criteria:**
- [ ] `/ruvector:learn` stores a structured reflexion entry
- [ ] `/ruvector:memory` lists entries with filtering and deletion
- [ ] memory-manager agent stores and retrieves learnings
- [ ] memory-manager agent flushes queue when called via Stop hook systemMessage
- [ ] Duplicate detection prevents storing near-identical entries (cosine > 0.85)
- [ ] Bulk delete requires AskUserQuestion confirmation
- [ ] Namespace validation rejects path traversal characters

### Research Insights: Phase 3

**Ranking strategy — use RRF instead of simple weighted sum (from vector-db-research agent):**
Replace `0.7 * similarity + 0.3 * recency` with Reciprocal Rank Fusion:
```
final_score = sum(1/(rank_i + 60)) for each signal i
```
Signals: semantic similarity, keyword match (BM25 on identifiers), recency (time-decay), file proximity.

RRF avoids score normalization issues and requires no tuning. Standard in OpenSearch 2.19+, Azure AI Search, Elasticsearch.

**Dedup threshold adjustment (from vector-db-research + security agents):**
- 0.9 may be too aggressive for code (similar functions with different variable names differ significantly)
- Recommend 0.85-0.92 range — test with real codebase
- Don't apply hard threshold on search results — always return top-k ranked by similarity, filter results < 0.5

**Agent-native improvements (from agent-native agent):**
- Active learning extraction: don't just passively capture — periodically analyze patterns for promotion to skills
- Quality gates for reflexion entries: minimum context + insight + action
- Skill promotion workflow: when a reflexion pattern appears 3+ times, promote to skill
- Decay scoring: older memories score lower unless frequently retrieved
- Learning export/import for team knowledge sharing

**Security: JSONL injection (from security agent — CRITICAL C2):**
Tool outputs could contain malicious JSON that pollutes the queue. Mitigation:
- Sanitize all values before JSONL append (escape newlines, strip control characters)
- Validate JSONL structure on read: `jq -c '.' 2>/dev/null || continue` to skip malformed lines
- Never use command output directly in file_path — validate against `[a-zA-Z0-9._/-]` pattern

#### Phase 4: Hooks

Add passive learning capture and automatic session management.

**Tasks:**

- [x] Create `plugins/yellow-ruvector/hooks/hooks.json`
  ```json
  {
    "hooks": {
      "SessionStart": [{
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh",
          "timeout": 3
        }]
      }],
      "PostToolUse": [{
        "matcher": "Edit|Write|Bash",
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/post-tool-use.sh",
          "timeout": 1
        }]
      }],
      "Stop": [{
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/stop.sh",
          "timeout": 10
        }]
      }]
    }
  }
  ```

- [ ] Create `plugins/yellow-ruvector/hooks/scripts/session-start.sh`
  - `set -eu` (not pipefail — we want partial success)
  - Read hook input from stdin: `INPUT=$(cat)`
  - Extract `cwd` from JSON: `CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""')`
  - Check if `.ruvector/` exists in CWD — if not, exit 0 silently (don't block non-ruvector projects)
  - Work prioritization with budget tracking:
    1. Flush stale queue (highest priority, cap at 20 entries) via `ruvector insert` CLI
    2. Load top 5 learnings via `ruvector search` CLI (medium priority)
    3. Skip incremental index if over budget (lowest priority, defer to `/ruvector:index`)
  - Cap total work to <3 seconds — check elapsed time after each step
  - Return learnings as `systemMessage` JSON on stdout
  - Log skipped work to stderr (visible in `claude --debug`)

- [ ] Create `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh`
  - `set -eu`
  - Read hook input from stdin: `INPUT=$(cat)`
  - Extract tool_name: `TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')`
  - Filter: only process Edit, Write, Bash events (matcher handles this, but double-check)
  - **Hook input trust boundary:** All fields from stdin JSON are untrusted. Validate every extracted value before use.
  - For Edit/Write: extract `file_path` from tool_input, validate via `validate_file_path()` (realpath + prefix check), then append to queue using `jq -n --arg`:
    ```bash
    jq -n \
      --arg type "file_change" \
      --arg path "$file_path" \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{type: $type, file_path: $path, timestamp: $ts}' \
      >> "${CLAUDE_PROJECT_DIR}/.ruvector/pending-updates.jsonl"
    ```
  - For Bash: extract command (first 200 chars) and exit code, sanitize via `jq -n --arg` (never use printf for JSON construction):
    ```bash
    jq -n \
      --arg type "bash_result" \
      --arg cmd "$(printf '%.200s' "$command")" \
      --argjson exit "$exit_code" \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{type: $type, command: $cmd, exit_code: $exit, timestamp: $ts}' \
      >> "${CLAUDE_PROJECT_DIR}/.ruvector/pending-updates.jsonl"
    ```
  - Append-only writes with `>>` (O_APPEND for multi-session safety)
  - No dedup at write time — dedup happens at flush
  - Must be non-blocking — no MCP calls, no embedding, just file append
  - On error: exit 0 silently (don't block user's work)
  - Output: `printf '{"continue": true}\n'`

- [ ] Create `plugins/yellow-ruvector/hooks/scripts/stop.sh`
  - `set -eu`
  - Read hook input from stdin
  - Check if queue file exists and is non-empty
  - If queue exists: return systemMessage asking Claude to flush via memory-manager agent
  - If queue empty: exit silently
  - Do NOT attempt MCP calls or CLI operations that might slow session exit
  - On failure: leave queue intact for next SessionStart recovery
  - **Delegation failure mode (P2):** This pattern is non-deterministic — Claude may ignore the systemMessage (user Ctrl+C, model decides not to follow). Document in CLAUDE.md that SessionStart always recovers stale queues, so no data is lost — only delayed to next session. If agent doesn't respond within 10s of stop, warn but don't block exit.

- [ ] **Run `shellcheck -s bash hooks/scripts/*.sh` — zero warnings required** (don't defer to Phase 5)
  - Disable SC2016 on separate line above heredocs containing `$` (ShellCheck false positive for JSON templates)

**Acceptance criteria:**
- [ ] SessionStart hook flushes stale queue and loads learnings (< 3s)
- [ ] PostToolUse hook appends to queue without blocking (< 50ms)
- [ ] Stop hook returns systemMessage for queue flushing
- [ ] Crashed session recovery: SessionStart picks up where Stop failed
- [ ] Multi-session safety: two sessions on same project don't corrupt queue
- [ ] Non-ruvector projects: hooks exit silently, no errors
- [ ] Hook errors don't crash Claude Code session

### Research Insights: Phase 4

**Hook input format (from framework-docs agent):**

PostToolUse receives on stdin:
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.txt",
  "cwd": "/current/working/dir",
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "src/auth.ts",
    "old_string": "...",
    "new_string": "..."
  },
  "tool_result": {
    "success": true,
    "message": "File edited successfully"
  }
}
```

**Hook output format:**
```json
{
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Message for Claude"
}
```

**Exit codes:** 0=success, 2=blocking error (stderr fed to Claude), other=non-blocking error

**Security: path traversal in PostToolUse (from security + architecture agents — P1 CRITICAL):**
File paths from tool_input could contain traversal characters (including URL-encoded `%2e%2e`, unicode, or symlink chains). Simple bash pattern matching is insufficient. Use `realpath` normalization + prefix check:
```bash
# Validate file_path is within project root
validate_file_path() {
  local raw_path="$1"
  local project_root="$2"

  # Quick reject: obvious traversal patterns
  case "$raw_path" in
    *..* | /* | *~*) return 1 ;;
  esac

  # Normalize and resolve to absolute path
  local resolved
  resolved="$(realpath -m -- "${project_root}/${raw_path}" 2>/dev/null)" || return 1

  # Verify resolved path is under project root
  case "$resolved" in
    "${project_root}/"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Usage in PostToolUse hook:
file_path=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')
if ! validate_file_path "$file_path" "$CLAUDE_PROJECT_DIR"; then
  printf '{"continue": true}\n'
  exit 0  # Silently skip dangerous paths
fi
```
**Additional safeguards:**
- Allow-list file extensions: `.ts`, `.js`, `.py`, `.rs`, `.go`, `.rb`, `.md`, `.json`, `.yaml`, `.toml`, `.sh`
- Block system directories: `.ssh`, `.git/hooks`, `/etc`, `/usr`
- Re-validate paths at flush time (TOCTOU mitigation)

**Security: ReDoS in .ruvectorignore (from security agent — HIGH H1):**
If `.ruvectorignore` patterns are evaluated as regex, malicious patterns could cause catastrophic backtracking. Use `fnmatch` or `git check-ignore` instead of raw regex matching.

**Performance: PostToolUse O(n) fix (from performance agent):**
Original plan has dedup reading entire JSONL on every PostToolUse (O(n) per tool use). Fix: append-only at write time, dedup at flush time only. This makes PostToolUse O(1) regardless of queue size.

#### Phase 5: Polish & Validation

Finalize the plugin for marketplace release.

**Tasks:**

- [x] Create `plugins/yellow-ruvector/README.md`
  - Plugin description, installation, quick start
  - Command reference table
  - Agent descriptions and trigger conditions
  - Configuration options
  - Troubleshooting common issues

- [x] Register in `.claude-plugin/marketplace.json`
  - Add yellow-ruvector entry to plugins array
  - Category: "developer-tools" or "ai-enhancement"

- [ ] Run validation suite
  - `pnpm validate:plugins` must pass
  - `pnpm validate:marketplace` must pass
  - ShellCheck on all `.sh` files (zero warnings)
  - Verify all entrypoint files exist
  - Verify all `allowed-tools` list every tool used
  - Verify agent .md files are under 120 lines
  - Verify LF line endings on all files
  - Verify component counts in CLAUDE.md match actual files

- [ ] Test on target platforms
  - Linux (primary)
  - macOS
  - WSL2

- [ ] Additional validation (from review agents)
  - Hook error handling tests: hook throws, session doesn't crash
  - Queue overflow tests: queue exceeds 10MB, rotation/cap works
  - Multi-session tests: concurrent sessions don't corrupt data
  - MCP server restart tests: MCP crashes mid-session, graceful recovery

**Acceptance criteria:**
- [ ] All validation passes
- [ ] Plugin installs via marketplace
- [ ] End-to-end flow works: setup -> index -> search -> learn -> memory browse
- [ ] Hooks fire correctly through session lifecycle
- [ ] All edge cases handled gracefully

#### Phase 6: Maintenance Operations (NEW — from spec-flow analysis)

Add lifecycle management features discovered during spec-flow analysis.

**Tasks:**

- [ ] Add uninstall instructions to README.md
  - Remove `.ruvector/` directory
  - Remove `.ruvector/` from `.gitignore`
  - `npm uninstall -g ruvector`
  - Document data loss warning

- [ ] Add upgrade/migration path
  - Check ruvector version on SessionStart
  - If major version bump, warn user
  - Document DB migration strategy (ruvector handles internally)

- [ ] Add team usage guidelines to CLAUDE.md
  - `.ruvector/` should be gitignored (per-developer data)
  - Team learnings can be exported via `/ruvector:memory` and shared manually
  - No multi-user conflict issues (per-project, per-user storage)

**Edge cases to document (from spec-flow analysis):**
- Empty repo: `/ruvector:index` reports "no files to index"
- Huge repo (>10K files): batch processing, progress reporting, timeout handling
- Binary-only repo: skip all files, report "no indexable files found"
- Monorepo: index from current directory, not repo root
- No git: fall back to `find` for file listing (slower, no .gitignore respect)
- Disk full: clear error message, suggest cleanup
- MCP crash mid-session: detect via tool error, surface restart instructions
- Corrupt queue: skip malformed JSONL lines, log warnings
- Missing embedding model: clear error in setup, download instructions
- Permission errors: check file permissions before operations

## Alternative Approaches Considered

1. **HTTP MCP server** — Run ruvector as an HTTP server instead of stdio. Rejected: requires persistent process management, port conflicts, more setup complexity. Stdio is simpler and follows MCP best practices for local tools.

2. **Direct CLI integration** (no MCP) — Shell out to `ruvector` CLI for all operations. Rejected: slower per-operation latency, no streaming, agents can't use MCP tool discovery. CLI is kept for hook operations only (where MCP is unavailable).

3. **Cloud-hosted vector DB** (Pinecone, etc.) — Store embeddings in a cloud service. Rejected: requires API keys, has costs, doesn't work offline, sends code to third party.

4. **Claude-generated embeddings** — Use Claude API to generate embeddings. Rejected: uses API tokens, only works during active sessions, adds latency to every embedding operation.

5. **Global storage** (`~/.ruvector/`) — Store all data globally. Rejected: cross-project contamination, harder to reason about context, can't gitignore project-specific data.

6. **JavaScript hooks** — Use .js files directly as hooks. Rejected after spike validation: Claude Code hooks must be bash scripts configured via `hooks/hooks.json`, not JavaScript files.

## Acceptance Criteria

### Functional Requirements

- [ ] `/ruvector:setup` installs ruvector and initializes `.ruvector/` on Linux/macOS/WSL2
- [ ] `/ruvector:index` indexes codebase respecting .gitignore and .ruvectorignore
- [ ] `/ruvector:search` returns semantically relevant code results
- [ ] `/ruvector:learn` stores structured learning entries
- [ ] `/ruvector:memory` browses and manages stored memories
- [ ] `/ruvector:status` shows DB health and stats
- [ ] semantic-search agent finds code by meaning
- [ ] memory-manager agent stores/retrieves/advises on learnings
- [ ] memory-manager agent flushes queue when called via Stop hook
- [ ] SessionStart hook loads learnings and flushes stale queue
- [ ] PostToolUse hook captures file changes and bash outcomes
- [ ] Stop hook delegates queue flushing to agent

### Non-Functional Requirements

- [ ] SessionStart hook completes in < 3 seconds
- [ ] PostToolUse hook completes in < 50ms (append-only, O(1))
- [ ] Semantic search returns results in < 500ms
- [ ] All agents gracefully degrade when ruvector is unavailable
- [ ] No data loss on session crash (queue persists for recovery)
- [ ] Multi-session safety (atomic appends, flock on flush)
- [ ] Hook errors never crash Claude Code session

### Quality Gates

- [ ] `pnpm validate:plugins` passes
- [ ] `pnpm validate:marketplace` passes
- [ ] ShellCheck passes on all shell scripts
- [ ] Agent files under 120 lines
- [ ] All allowed-tools lists are complete
- [ ] LF line endings on all files
- [ ] Component counts in CLAUDE.md match actual files
- [ ] MCP tool references use full `mcp__plugin_yellow-ruvector_ruvector__*` naming

### Security Requirements (NEW — from security review)

- [ ] Namespace names validated against `[a-z0-9-]` pattern (no path traversal)
- [ ] Queue file paths validated before append (no `..`, `/`, `~`)
- [ ] JSONL entries sanitized (escape newlines, strip control characters)
- [ ] `.ruvectorignore` patterns use fnmatch, not raw regex (prevent ReDoS)
- [ ] npm install uses `--ignore-scripts` flag (prevent package hijacking)
- [ ] Bulk delete operations require AskUserQuestion confirmation

## Dependencies & Prerequisites

**External:**
- ruvector CLI (`npm install -g ruvector`)
- Embedding model: all-MiniLM-L6-v2 (downloaded automatically by ruvector, 384 dims, ONNX WASM)
- Node.js 18+ (for npm install)
- jq (for JSON processing in hook scripts)

**Internal:**
- No dependencies on other yellow-plugins
- Uses same plugin structure conventions as yellow-linear, yellow-review

**Blocked by:**
- Spike validation: ruvector MCP server must work with Claude Code (stdio transport)
- Spike validation: all-MiniLM-L6-v2 must produce usable code embeddings
- Spike validation: hook bash scripts must fire and receive expected stdin data
- Spike validation: hook API contract must be documented

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ruvector MCP stdio doesn't work with Claude Code | Medium | Critical | Spike test before building. Fallback: use HTTP transport with local server |
| Embedding quality is poor for code search | Medium | High | Test with sample codebase in spike. Fallback: use Jina-code-embeddings or Codestral Embed |
| Hook API contract differs from expectations | Medium | High | Expanded spike validation (items 6-9). Document validated contract before Phase 1 |
| Hooks cannot call MCP tools (CONFIRMED) | N/A | High | Use CLI in SessionStart, delegate to agent in Stop hook |
| ruvector install fails on user's OS | Medium | High | npm install is cross-platform. Provide Docker fallback |
| SessionStart hook blocks startup (>3s) | Medium | Medium | Strict budget, work prioritization, skip lowest-priority items |
| pending-updates.jsonl grows unbounded | Low | Medium | Cap at 10MB, warn in status, prune oldest on flush |
| ruvector MCP server crashes mid-session | Low | High | Graceful degradation, error messages, restart instructions |
| DB corruption from power loss | Low | High | Code namespace can be re-indexed. Learnings at risk — document backup strategy |
| npm package hijacking (C1) | Low | Critical | Pin ruvector version, use `--ignore-scripts`, verify checksum |
| JSONL injection via tool outputs (C2) | Medium | High | Sanitize values, validate structure, skip malformed lines |
| ReDoS in .ruvectorignore patterns (H1) | Low | High | Use fnmatch/git check-ignore, not raw regex |
| Queue path traversal TOCTOU (H2) | Low | High | realpath + prefix check in PostToolUse, re-validate at flush (P1 fix applied) |
| Multi-session queue corruption | Low | High | Atomic O_APPEND writes, flock on flush operations |
| MCP tool naming mismatch | Medium | High | Phase 0 spike item #11 validates before implementation (P1 fix applied) |
| MCP cold start blows SessionStart budget | Medium | Medium | Hooks use CLI only; MCP lazy-init on first command/agent call (P1 fix applied) |
| Queue unbounded growth | Medium | Medium | Rotation at 10MB, stale cleanup at 7 days, warn at 5MB (P2 fix applied) |
| Stop hook delegation ignored by Claude | Medium | Low | SessionStart recovers stale queue; documented as known limitation (P2 fix applied) |

## Spike: Validate Assumptions (Pre-Phase 1)

Before committing to implementation, validate these blockers:

1. **Install ruvector** — `npm install -g ruvector`. Verify binary works on WSL2.
2. **Test MCP stdio** — Run `npx ruvector mcp-server`, send a basic tool call, verify response.
3. **Test Claude Code MCP integration** — Configure a minimal plugin.json with ruvector MCP, verify Claude Code discovers tools via ToolSearch.
4. **Test embeddings quality** — Index a small codebase (~50 files), run search queries, evaluate result relevance using all-MiniLM-L6-v2.
5. **Test hook execution** — Create a minimal plugin with a SessionStart hook (bash script in `hooks/hooks.json`), verify it fires and receives expected stdin data.
6. **Validate hook error handling** — Test exception, timeout, and return value behavior.
7. **Validate stdio MCP error modes** — Test crash, invalid config, and malformed request handling.
8. **Validate file locking** — Test concurrent sessions on same project don't corrupt queue.
9. **Document hook API contract** — Create `docs/hook-api-contract.md` with validated stdin/stdout/exit-code behavior.
10. **Test ruvector native hooks** — Evaluate `ruvector hooks init/install` for complementary integration.

**Expected spike duration:** 5-7 hours (12 items). If any blocker fails, revisit the brainstorm for alternative approaches.

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-11-yellow-ruvector-plugin-brainstorm.md`
- Plugin patterns: `plugins/yellow-linear/.claude-plugin/plugin.json`
- Agent format: `plugins/yellow-linear/agents/workflow/linear-issue-loader.md`
- Command format: `plugins/yellow-linear/commands/linear/create.md`
- Skill format: `plugins/yellow-linear/skills/linear-workflows/SKILL.md`
- Shell security: `docs/solutions/security-issues/claude-code-plugin-review-fixes.md`
- GraphQL patterns: `docs/solutions/code-quality/github-graphql-shell-script-patterns.md`
- Agent security: `docs/solutions/security-issues/agent-workflow-security-patterns.md`
- Review patterns: `docs/solutions/code-quality/plugin-authoring-review-patterns.md`
- Plugin validation: `docs/plugin-validation-guide.md`
- Architecture review: `docs/solutions/architecture-reviews/2026-02-11-yellow-ruvector-plugin-architecture-review.md`
- Framework research: `docs/research/2026-02-11-yellow-ruvector-plugin-research.md`
- Conventions guide: `docs/conventions-guide-for-ruvector.md`

### External References

- ruvector GitHub: https://github.com/ruvnet/ruvector
- ruvector npm: https://www.npmjs.com/package/ruvector
- Claude Code hooks API: Plugin hook development skill (plugin-dev:hook-development)
- MCP specification: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- Transformers.js (embedding fallback): https://huggingface.co/docs/transformers.js

### Research Sources (from deepening)

- [cAST: Semantic code chunking via AST](https://arxiv.org/html/2506.15655v1) — 40%+ accuracy improvement
- [RRF: Reciprocal Rank Fusion](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) — Hybrid ranking standard
- [Jina code embeddings](https://jina.ai/news/elevate-your-code-search-with-new-jina-code-embeddings/) — Alternative embedding model
- [GitHub embedding model](https://www.infoq.com/news/2025/10/github-embedding-model/) — Matryoshka representation
- [Codestral Embed](https://mistral.ai/news/codestral-embed) — Code retrieval specialist
- [CocoIndex incremental indexing](https://medium.com/@cocoindex.io/building-a-real-time-data-substrate-for-ai-agents-the-architecture-behind-cocoindex-729981f0f3a4) — 99% cost reduction pattern
- [Best chunking strategies 2025](https://www.firecrawl.dev/blog/best-chunking-strategies-rag-2025) — 256-512 token optimal range
- [Overlap study 2026](https://arxiv.org/abs/2601.14123) — Overlap provides no measurable benefit
