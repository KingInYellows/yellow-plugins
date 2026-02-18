# yellow-ruvector

Persistent vector memory and semantic code search for Claude Code agents via
[ruvector](https://github.com/ruvnet/ruvector).

## Installation

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-ruvector@yellow-plugins
```

## Quick Start

```bash
# Set up ruvector in your project
/ruvector:setup

# Index your codebase for semantic search
/ruvector:index

# Search by meaning, not just keywords
/ruvector:search "authentication logic"

# Record a learning for future sessions
/ruvector:learn "Always mock JWT tokens with future expiry in tests"

# Check ruvector health
/ruvector:status
```

## Commands

| Command                                 | Description                                            |
| --------------------------------------- | ------------------------------------------------------ |
| `/ruvector:setup`                       | Install ruvector and initialize `.ruvector/` directory |
| `/ruvector:index [path]`                | Index codebase (or specific path) for semantic search  |
| `/ruvector:search <query>`              | Search codebase by meaning using vector similarity     |
| `/ruvector:status`                      | Show ruvector health, DB stats, and queue status       |
| `/ruvector:learn [description]`         | Record a learning, mistake, or pattern                 |
| `/ruvector:memory [namespace] [filter]` | Browse, search, and manage stored memories             |

## Agents

| Agent                      | Trigger                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `ruvector-semantic-search` | "Find similar code", "search by concept", "where is X implemented"    |
| `ruvector-memory-manager`  | "Remember this", "what did we learn about X", "flush pending updates" |

## How It Works

- **Semantic search:** Code is chunked and embedded using all-MiniLM-L6-v2 (384
  dims). Search queries are embedded and compared via vector similarity.
- **Agent memory:** Learnings are stored in namespaces (reflexion, skills,
  causal) and retrieved via RRF ranking.
- **Passive capture:** Hooks automatically track file changes and bash outcomes
  in a local queue. The queue is flushed to ruvector on session end or next
  session start.
- **MCP integration:** ruvector runs as a stdio MCP server, discovered via
  ToolSearch.

## Requirements

- Node.js 18+
- npm
- jq

## Configuration

Storage is in `.ruvector/` at the project root (automatically gitignored). No
external services or API keys required.

## Troubleshooting

| Issue                | Solution                                                 |
| -------------------- | -------------------------------------------------------- |
| "ruvector not found" | Run `/ruvector:setup`                                    |
| Empty search results | Run `/ruvector:index` first                              |
| Slow first search    | Normal — MCP cold start takes 300-1500ms                 |
| Queue growing large  | Check `/ruvector:status`, queue flushes on session start |

## License

MIT
