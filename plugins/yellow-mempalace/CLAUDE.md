# yellow-mempalace Plugin

Structured long-term memory with temporal knowledge graph via MemPalace.
Stores verbatim content in a navigable palace structure (wings/rooms/halls)
with semantic search and a temporal knowledge graph for entity relationships.

## MCP Server

- **mempalace** — Stdio transport via `mempalace mcp`
- Storage: ChromaDB (vector embeddings) + SQLite (temporal KG) in `.mempalace/`
- Lifecycle: starts on first MCP tool call, shuts down on session end
- Cold start: 2-5 seconds on first call (ChromaDB initialization)
- 19 MCP tools: search, navigation, knowledge graph, write, diary

## Conventions

- **MCP tool naming:** All tools referenced as
  `mcp__plugin_yellow-mempalace_mempalace__mempalace_*`
- **Verbatim storage:** Always store content verbatim — never summarize or
  compress before filing into drawers
- **Search narrowing:** Use wing/room/hall filters for better retrieval
  (up to +34% precision over unfiltered search)
- **Temporal facts:** Use `kg_invalidate` to end validity, never delete facts
- **Duplicate checking:** Call `check_duplicate` before `add_drawer`
- **Graceful degradation:** All commands report clearly when MCP tools are
  unavailable and suggest `/mempalace:setup`
- **Git workflow:** Use Graphite (`gt submit`), not `git push`

## Plugin Components

### Commands (6)

- `/mempalace:setup` — Install CLI, initialize palace, verify MCP
- `/mempalace:status` — Palace overview (wings, rooms, drawers, KG stats)
- `/mempalace:search` — Semantic search with wing/room/hall filters
- `/mempalace:mine` — Mine projects, conversations, or general content
- `/mempalace:kg` — Knowledge graph: query, add, invalidate, timeline
- `/mempalace:navigate` — Browse palace structure, find tunnels

### Agents (2)

- `palace-navigator` — Browse and traverse palace structure
- `memory-archivist` — File memories, manage KG triples, write diary entries

### Skills (2)

- `mempalace-conventions` — MCP schemas, palace terminology, error handling
- `palace-protocol` — Wake-up sequence, query-before-assert, memory stack

## When to Use What

| Task | Tool | When |
|------|------|------|
| First install | `/mempalace:setup` | After installing plugin or on MCP errors |
| Check palace health | `/mempalace:status` | Verify initialization, see overview |
| Find past decisions | `/mempalace:search` | Recall verbatim content by meaning |
| Import content | `/mempalace:mine` | First-time indexing or new content |
| Entity relationships | `/mempalace:kg` | "Who works on what?", "What changed?" |
| Browse structure | `/mempalace:navigate` | Explore wings, rooms, tunnels |
| File a memory | `memory-archivist` agent | Save decisions, facts, discoveries |
| Explore connections | `palace-navigator` agent | Find cross-wing relationships |

## Cross-Plugin Notes

- **Complements yellow-ruvector**: ruvector handles real-time coding intelligence
  (passive capture, per-prompt injection, semantic code search). mempalace
  handles long-term verbatim recall ("what did we decide 3 months ago?").
  No hook conflicts — different lifecycle events.
- **No hooks in v1.0.0**: Hooks deferred pending upstream security fixes
  (#110, SESSION_ID injection). All integration is MCP-only.

## Known Limitations

- **No hooks** — save and pre-compact hooks deferred to future release
- **ChromaDB cold start** — first MCP call takes 2-5 seconds
- **Python dependency** — requires Python 3.9+ and ChromaDB
- **Local-only** — palace data is per-developer (`.mempalace/` is gitignored)
- **No AAAK compression** — the experimental lossy format is not used;
  all content stored verbatim

## Maintenance

- **Install:** `pipx install mempalace` or `/mempalace:setup`
- **Upgrade:** `pipx upgrade mempalace`
- **Uninstall:** `pipx uninstall mempalace`, delete `.mempalace/` directory
