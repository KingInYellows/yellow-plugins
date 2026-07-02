# yellow-mempalace

> **Status: deprecated pending removal** (maintainer decision
> 2026-07-01, recorded in `docs/memory-routing-protocol.md`).
> yellow-ruvector is the standard memory system — generic memory
> capture and recall route there. Explicit `/mempalace:*` commands keep
> working until the removal follow-up lands.

Structured long-term memory with temporal knowledge graph via
[MemPalace](https://github.com/milla-jovovich/mempalace).

## Prerequisites

- Python 3.10+ (3.11+ recommended)
- Claude Code with plugin support

## Quick Start

```bash
# Install the plugin
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-mempalace

# Set up (installs CLI, initializes palace, verifies MCP)
/mempalace:setup

# Mine your project
/mempalace:mine .

# Search your memories
/mempalace:search "why did we switch to GraphQL"

# Check palace overview
/mempalace:status
```

## Commands

| Command | Description |
|---------|-------------|
| `/mempalace:setup` | Install CLI, initialize palace, verify MCP |
| `/mempalace:status` | Palace overview (wings, rooms, drawers, KG) |
| `/mempalace:search <query>` | Semantic search with optional filters |
| `/mempalace:mine <path>` | Mine projects, conversations, or general content |
| `/mempalace:kg <action>` | Knowledge graph: query, add, invalidate, timeline |
| `/mempalace:navigate [wing]` | Browse palace structure, find tunnels |

## MCP Tools

The plugin exposes the following MCP tools from the mempalace server. The
upstream `mempalace_search` tool accepts optional `wing` and `room` filter
parameters; there are no separate `search_wing`/`search_room`/`search_hall`
tools.

- **Read**: status, list_wings, list_rooms, get_taxonomy, get_aaak_spec
- **Search**: search, check_duplicate
- **Knowledge Graph**: kg_query, kg_add, kg_invalidate, kg_timeline, kg_stats
- **Graph**: traverse, find_tunnels, graph_stats, create_tunnel,
  list_tunnels, delete_tunnel, follow_tunnels
- **Write**: add_drawer, delete_drawer, get_drawer, list_drawers,
  update_drawer
- **Diary**: diary_write, diary_read

This plugin's commands and agents reference a curated subset of these
tools. The full registry is defined upstream in
[mempalace/mcp_server.py](https://pypi.org/project/mempalace/).

## How It Works

MemPalace uses the Method of Loci to organize AI memory:

- **Wings** — top-level containers (projects, people, topics)
- **Rooms** — specific subjects within wings
- **Halls** — memory type classifiers (facts, events, discoveries, preferences, advice)
- **Tunnels** — cross-wing connections for related topics
- **Drawers** — verbatim original content (never summarized)

All content is stored locally using ChromaDB (vector search) and SQLite
(temporal knowledge graph). No cloud services or API keys required.
