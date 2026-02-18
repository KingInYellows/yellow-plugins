# yellow-ruvector Plugin

Persistent vector memory and semantic code search for Claude Code agents via
ruvector.

## MCP Server

- **ruvector** — Stdio transport via `npx ruvector mcp start`
- Storage: `.ruvector/intelligence/memory.rvdb` (rvlite format) in project root
- Embedding model: all-MiniLM-L6-v2 (384 dimensions, ONNX WASM runtime)
- Lifecycle: starts on first MCP tool call (lazy init by Claude Code), shuts
  down on session end
- If crashed mid-session: surface error and suggest running
  `npx ruvector mcp start` to verify
- First call after session start may be slow (300-1500ms cold start)

## Conventions

- **Namespace naming:** `[a-z0-9-]` only — `code`, `reflexion`, `skills`,
  `causal`, `sessions`. Reject path traversal characters (`..`, `/`, `~`).
- **MCP tool naming:** All tools referenced as
  `mcp__plugin_yellow-ruvector_ruvector__*` (e.g.,
  `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`)
- **Hook architecture:** All hooks delegate to ruvector's built-in CLI hooks
  (`hooks session-start`, `hooks session-end`, `hooks post-edit`,
  `hooks post-command`, `hooks recall`). No manual queue management.
- **Input validation:** All `$ARGUMENTS` values validated before use. See
  `ruvector-conventions` skill.
- **Graceful degradation:** All agents and commands must work without ruvector —
  fall back to Grep for search, skip memory operations silently.
- **PR creation:** Use Graphite (`gt submit`), not `gh pr create`.

## Plugin Components

### Commands (6)

- `/ruvector:setup` — Install ruvector and initialize `.ruvector/` directory
- `/ruvector:index` — Index codebase for semantic search
- `/ruvector:search` — Search codebase by meaning using vector similarity
- `/ruvector:status` — Show ruvector health, DB stats, and queue status
- `/ruvector:learn` — Record a learning, mistake, or pattern for future sessions
- `/ruvector:memory` — Browse, search, and manage stored memories and learnings

### Agents (2)

- `ruvector-semantic-search` — Find code by meaning rather than keyword
- `ruvector-memory-manager` — Store, retrieve, and flush agent learnings across
  sessions

### Skills (2)

- `ruvector-conventions` — Namespace definitions, memory schema, error handling
  catalog
- `agent-learning` — Learning triggers, quality gates, retrieval strategy

### Hooks (3)

- `session-start.sh` — Run ruvector's session-start hook and load top learnings
  via `hooks recall` (3s budget)
- `post-tool-use.sh` — Record file edits and bash outcomes via ruvector's
  `hooks post-edit` and `hooks post-command` (<50ms)
- `stop.sh` — Run ruvector's session-end hook for cleanup and metrics export

### Scripts (1)

- `install.sh` — Install ruvector CLI via npm with dependency checks and error
  handling

## When to Use What

- **`/ruvector:search`** — Manual semantic search. Use when you want to find
  code by meaning.
- **`ruvector-semantic-search` agent** — Auto-triggers when other agents need to
  find code by concept. Also responds to "find similar code", "search by
  concept".
- **`/ruvector:learn`** — Manually record a learning. Use when you want to save
  a mistake, pattern, or insight.
- **`ruvector-memory-manager` agent** — Auto-triggers for storing/retrieving
  learnings. Handles bulk memory operations and memory curation.
- **`/ruvector:memory`** — Browse and manage all stored memories. Use for
  viewing, filtering, or deleting entries.
- **`/ruvector:index`** — Manual full or incremental index. Use after major code
  changes.
- **`/ruvector:status`** — Health check. Use to verify ruvector is working and
  check DB stats.

## Known Limitations

- First stdio MCP server in this repo — less battle-tested than HTTP pattern
- Hooks use ruvector CLI directly (not MCP tools) — if `npx` or ruvector is
  unavailable, hooks exit silently without error
- No offline MCP fallback — if ruvector MCP is down, search and memory
  operations fail gracefully
- `.ruvector/` is shared across git worktrees — concurrent indexing may race
- MCP cold start adds 300-1500ms on first tool call after session start

## Maintenance

- **Uninstall:** Delete `.ruvector/` directory, remove from `.gitignore`, run
  `npm uninstall -g ruvector`
- **Upgrade:** `npm update -g ruvector` — ruvector handles DB migration
  internally
- **Team usage:** `.ruvector/` should be gitignored (per-developer data). Team
  learnings can be exported via `/ruvector:memory` and shared manually.
