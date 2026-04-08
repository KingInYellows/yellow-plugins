# MemPalace vs RuVector: Deep Research & Integration Analysis

**Date**: 2026-04-07
**Sources**: GitHub API, WebFetch (repo README, MCP server source, hooks docs), ruvector plugin exploration
**Repo**: [milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace) — 14.2k stars, 1.6k forks, MIT license, created 2026-04-05

---

## Executive Summary

**MemPalace** and **RuVector** solve overlapping but fundamentally different problems. MemPalace is a **structured long-term memory system** using the Method of Loci metaphor (wings/rooms/halls) with verbatim storage and a temporal knowledge graph. RuVector is a **session-to-session learning system** using vector embeddings, reflexion patterns, and passive hook-based capture.

**Verdict: Companion, not replacement.** They complement each other. MemPalace excels at cross-session, cross-project knowledge persistence and recall (the "what did we decide 3 months ago?" problem). RuVector excels at real-time coding intelligence — passive capture, semantic code search, and per-prompt context injection.

---

## 1. What Is MemPalace?

### Core Concept
Applies the ancient **Method of Loci** to AI memory. Rather than summarizing conversations (lossy), it stores **verbatim content** in a navigable palace structure.

### Architecture: The Palace Structure

| Layer | Description | Analogy |
|-------|-------------|---------|
| **Wings** | Top-level containers (projects, people, topics) | Departments |
| **Rooms** | Specific subjects within wings (e.g., "auth-migration") | Meeting rooms |
| **Halls** | Memory type connectors (facts, events, discoveries, preferences, advice) | Filing cabinets |
| **Tunnels** | Cross-wing connections when same room appears in multiple wings | Corridors |
| **Closets** | Summaries pointing to original content | Index cards |
| **Drawers** | Original verbatim files (never summarized) | Source documents |

### Memory Stack (4 Layers)
- **L0**: Identity (~50 tokens, always loaded)
- **L1**: Critical facts (~120 tokens AAAK, always loaded)
- **L2**: Room recall (on-demand semantic search within a room)
- **L3**: Deep semantic search (cross-palace, on-demand)

### Storage Backend
- **ChromaDB**: Vector embeddings for semantic search over verbatim text
- **SQLite**: Temporal knowledge graph (entity-relationship triples with validity windows)
- **All local** — no cloud dependency, no data leaving user's machine

### Key Features
- **Mining modes**: Projects (code/docs), Convos (Claude/ChatGPT/Slack exports), General (auto-classify)
- **Knowledge graph**: Temporal triples with validity windows ("Kai works_on Orion (valid_from: 2025-06-01)")
- **Contradiction detection**: `fact_checker.py` validates assertions against KG (not yet auto-wired)
- **Specialist agents**: Separate wings/diaries per agent (code reviewer, architect, ops)
- **AAAK compression**: Lossy abbreviation dialect (experimental, currently regresses benchmark performance)

### Benchmark Results (LongMemEval)
- **96.6% R@5** in raw verbatim mode (500 questions)
- **+34% retrieval boost** from palace structure filtering (wing + room)
- Zero API calls required

---

## 2. MCP Server — 19 Tools

MemPalace ships with a built-in MCP server:
```bash
claude mcp add mempalace -- python -m mempalace.mcp_server
```

### Tool Inventory

| Category | Tools | Purpose |
|----------|-------|---------|
| **Read** | `status`, `list_wings`, `list_rooms`, `get_taxonomy`, `get_aaak_spec` | Palace navigation |
| **Search** | `search`, `search_wing`, `search_hall`, `search_room`, `check_duplicate` | Semantic retrieval with filters |
| **Knowledge Graph** | `kg_query`, `kg_add`, `kg_invalidate`, `kg_timeline`, `kg_stats` | Temporal facts |
| **Graph Navigation** | `traverse`, `find_tunnels`, `graph_stats` | Cross-wing discovery |
| **Write** | `add_drawer`, `delete_drawer` | Memory storage |
| **Agent Diaries** | `diary_write`, `diary_read` | Per-agent persistent journal |

### Notable Design Choices
- **Duplicate checking** built into `add_drawer` (similarity threshold)
- **Temporal invalidation** — facts can expire, enabling "what was true in January?" queries
- **Graph traversal** across wings via rooms that appear in multiple contexts
- **Palace Protocol** — server instructs LLM to call `status` on wake-up, verify before asserting

---

## 3. Hooks System

Two Claude Code hooks (bash scripts, 30s timeout):

| Hook | Trigger | Purpose |
|------|---------|---------|
| **Save Hook** | Every 15 human messages (configurable) | Instructs AI to file important conversation elements into palace |
| **PreCompact Hook** | Before context compaction | Forces comprehensive memory archival before information loss |

Configuration via `.claude/settings.local.json`:
- `SAVE_INTERVAL` — checkpoint frequency (default: 15)
- `STATE_DIR` — hook state storage
- `MEMPAL_DIR` — optional auto-mine directory

**Key difference from ruvector hooks**: MemPalace hooks trigger the LLM to actively organize and file memories (AI-directed). RuVector hooks passively capture file edits and bash outcomes in the background (system-directed).

---

## 4. Head-to-Head: MemPalace vs RuVector

### Architecture Comparison

| Dimension | MemPalace | RuVector |
|-----------|-----------|----------|
| **Philosophy** | Structured long-term memory (Method of Loci) | Real-time coding intelligence |
| **Storage** | ChromaDB + SQLite | rvlite (embedded RDF/property graph) |
| **Embedding** | ChromaDB default model | all-MiniLM-L6-v2 (384d, ONNX WASM) |
| **Language** | Python 3.9+ | Node.js (npx ruvector) |
| **Organization** | Hierarchical (wings/rooms/halls) | Flat (type labels: context/decision/project/code) |
| **Content** | Verbatim (never summarized) | Structured learnings (context + insight + action) |
| **Knowledge Graph** | Yes (temporal SQLite triples) | Yes (rvlite property graph) |
| **MCP Tools** | 22 tools | 80+ tools |
| **Hook Count** | 2 (Save, PreCompact) | 5 (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) |
| **Hook Style** | AI-directed (LLM organizes) | System-directed (passive capture) |
| **Retrieval** | Filtered semantic search (wing/room/hall) | RRF (semantic + recency + frequency) |
| **Dedup** | Similarity threshold on add | Cosine > 0.82 = reject |
| **Quality Gates** | Duplicate check | 20+ words, context/insight/action structure |
| **Agent Support** | Per-agent wings + diaries | Per-session trajectory tracking |
| **Maturity** | 2 days old (created 2026-04-05), 14.2k stars | Established in this plugin ecosystem |
| **Install** | `pip install mempalace` | `npx ruvector` / global binary |

### Where Each Excels

**MemPalace wins at:**
- Long-term verbatim recall ("what did we decide about auth 3 months ago?")
- Cross-project knowledge connections (tunnels between wings)
- Temporal fact tracking with invalidation
- Mining existing conversation exports (Claude, ChatGPT, Slack)
- Structured navigation (browsing wings → rooms → drawers)
- Benchmark-validated retrieval accuracy (96.6% R@5)

**RuVector wins at:**
- Real-time passive capture (every file edit, every bash command)
- Per-prompt context injection (UserPromptSubmit hook)
- Semantic code search (find similar implementations)
- Session-to-session learning continuity (reflexion/skill learnings)
- Sub-second hook execution (1s budget, hash embeddings)
- Deep Claude Code integration (5 lifecycle hooks, 80+ MCP tools)
- Graceful degradation (works without binary, falls back to Grep)

### Overlap (Both Do)
- Semantic search over stored content
- Vector-based retrieval
- Knowledge graph / property graph
- MCP server integration
- Local-only storage (privacy-first)
- Duplicate detection

---

## 5. Integration Strategy: Using Both

### Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│                 Claude Code Session              │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐         ┌──────────────────┐   │
│  │  RuVector    │         │   MemPalace      │   │
│  │  (Real-time) │         │   (Long-term)    │   │
│  ├─────────────┤         ├──────────────────┤   │
│  │ • Hook:      │         │ • Hook:          │   │
│  │   SessionStart│        │   Save (15 msgs) │   │
│  │   PromptSubmit│        │   PreCompact     │   │
│  │   PreToolUse  │        │                  │   │
│  │   PostToolUse │        │ • MCP:           │   │
│  │   Stop        │        │   22 tools       │   │
│  │              │         │   (search, KG,   │   │
│  │ • MCP:       │         │    navigate,     │   │
│  │   80+ tools  │         │    diary)        │   │
│  │   (recall,   │         │                  │   │
│  │    remember, │         │ • Mining:        │   │
│  │    search,   │         │   Convos, code,  │   │
│  │    index)    │         │   general        │   │
│  └──────┬──────┘         └────────┬─────────┘   │
│         │                         │              │
│         ▼                         ▼              │
│  .ruvector/              .mempalace/             │
│  (per-session learning)  (cross-session memory)  │
└─────────────────────────────────────────────────┘
```

### Division of Responsibility

| Concern | Owner | Why |
|---------|-------|-----|
| "What did I just learn coding?" | RuVector | Passive hook capture, real-time |
| "What did we decide about auth last month?" | MemPalace | Verbatim storage, temporal KG |
| "Find similar code patterns" | RuVector | Code-optimized semantic search |
| "What did the team discuss on Slack?" | MemPalace | Conversation mining |
| "Don't repeat this mistake" | RuVector | Reflexion learnings, auto-injected |
| "How has this project evolved?" | MemPalace | Timeline, wing traversal |
| "Context for this prompt" | RuVector | UserPromptSubmit hook (<1s) |
| "Deep background research" | MemPalace | Wing/room filtered search |

### No Hook Conflicts

The hooks are complementary with no overlap:
- RuVector: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop
- MemPalace: Save (Stop event, every 15 messages), PreCompact (context compaction)

MemPalace's Save hook fires at a much lower frequency (every 15 messages vs every tool use) and triggers AI-directed organization rather than passive capture. They can coexist without timing conflicts.

---

## 6. Plugin Integration Blueprint

### Option A: Standalone Plugin (`yellow-mempalace`)

```
plugins/yellow-mempalace/
├── .claude-plugin/plugin.json
├── CLAUDE.md
├── commands/mempalace/
│   ├── setup.md          # pip install mempalace, init palace
│   ├── mine.md           # Mine projects/convos/general
│   ├── search.md         # Search palace with filters
│   ├── status.md         # Palace overview
│   ├── kg.md             # Knowledge graph queries
│   └── navigate.md       # Browse wings/rooms
├── agents/mempalace/
│   ├── palace-navigator.md   # Browse and traverse palace
│   └── memory-archivist.md   # Organize and file memories
├── skills/
│   ├── mempalace-conventions/SKILL.md
│   └── palace-protocol/SKILL.md
├── hooks/
│   └── scripts/
│       ├── save-hook.sh       # Every N messages
│       └── precompact-hook.sh # Before compaction
└── scripts/
    └── install-mempalace.sh   # pip/pipx install
```

### Plugin.json MCP Configuration

```json
{
  "name": "yellow-mempalace",
  "mcpServers": {
    "mempalace": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "mempalace.mcp_server"],
      "env": {
        "MEMPALACE_DIR": "${PROJECT_DIR}/.mempalace"
      }
    }
  },
  "hooks": [
    {
      "event": "Stop",
      "matcher": "*",
      "script": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/save-hook.sh",
      "timeout": 30000
    },
    {
      "event": "PreCompact",
      "matcher": "*",
      "script": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/precompact-hook.sh",
      "timeout": 30000
    }
  ]
}
```

### Option B: RuVector Bridge (Cross-Plugin Integration)

Rather than a standalone plugin, add a bridge agent to `yellow-ruvector` that delegates long-term storage to MemPalace when installed:

```yaml
# In ruvector's memory-manager agent
# If mempalace MCP is available, also file to palace
# If not, degrade gracefully (ruvector-only)
```

This follows the existing cross-plugin composition pattern (Skill tool delegation).

### Recommended: Option A (Standalone Plugin)

Reasons:
- MemPalace has enough surface area (22 MCP tools, 2 hooks, CLI, KG) to justify its own plugin
- Independent release cycle — mempalace is 2 days old and will evolve rapidly
- Users can install either or both without coupling
- Optional cross-plugin bridge can be added later via skills

---

## 7. Risks & Concerns

### Maturity
- **Created 2 days ago** (2026-04-05). 14.2k stars is impressive velocity but the project is extremely young.
- 99 open issues, including a shell injection in hooks (#110) and macOS ARM64 segfault (#74)
- AAAK compression is experimental and currently regresses benchmark performance
- Contradiction detection exists but isn't auto-wired

### Honest Limitations (Author-Acknowledged)
The authors published an April 2026 correction:
- AAAK token savings were overstated (66 vs 73 tokens, not 30x savings)
- +34% palace boost is standard ChromaDB metadata filtering, not novel retrieval
- 100% with Haiku rerank not in public benchmark scripts

### Runtime Considerations
- **Python 3.10+ effective minimum**: README says 3.9+ but onnxruntime and
  PyTorch transitive deps dropped 3.9 wheels. Python 3.11+ recommended.
- **ChromaDB startup**: ~2-5 seconds cold start (vs ruvector's 300-1500ms)
- **First-run model download**: ~80MB all-MiniLM-L6-v2 embedding model
  downloaded on first use via sentence-transformers. Setup should pre-warm.
- **stdio stdout contamination**: ChromaDB/sentence-transformers may emit log
  messages to stdout, corrupting JSON-RPC stream. Well-implemented MCP SDK
  should handle this, but library code may bypass it.
- **Global palace only**: Palace is at `~/.mempalace/`, no MEMPALACE_DIR env
  var documented for per-project palaces.
- **Hook timeout**: 30s (vs ruvector's 1-3s) — heavier operations
- **Storage size**: ChromaDB + SQLite will be larger than rvlite for equivalent content

### Security
- Shell injection in hooks (#110) — **still OPEN/UNFIXED** as of 2026-04-07
- SESSION_ID from untrusted JSON used unsanitized in hook file paths — path
  traversal vector
- Hook scripts execute bash with 30s timeout — review attack surface

---

## 8. Recommendations

### Short-Term (Now)
1. **Do not replace ruvector** — it provides real-time coding intelligence that mempalace doesn't attempt
2. **Monitor mempalace** for 2-4 weeks — let the project stabilize, shell injection fix ship, and community shake out bugs
3. **Test locally** — `pip install mempalace && mempalace init . && mempalace mine .` to evaluate on your own codebases

### Medium-Term (2-4 weeks)
4. **Build `yellow-mempalace` plugin** following Option A blueprint above
5. **Start with MCP + setup command** — minimal viable plugin with just the MCP server and setup
6. **Add hooks last** — after verifying the save/precompact hooks are stable and the shell injection is fixed

### Long-Term (1-2 months)
7. **Cross-plugin bridge** — ruvector's `hooks_remember` could optionally also file to mempalace for long-term persistence
8. **Mine ruvector learnings** — `mempalace mine .ruvector/` to create a palace from accumulated learnings
9. **Conversation export pipeline** — mine Claude Code conversation exports into mempalace wings

### Integration Priority
1. MCP server (biggest value, 22 tools, native Claude Code support)
2. Setup command (pip install, init, verify)
3. Search/navigate commands (palace-specific UX)
4. Mining commands (import existing data)
5. Hooks (save/precompact — last, after security audit)

---

## 9. Cost Analysis

| Approach | Annual Cost |
|----------|------------|
| MemPalace wake-up (L0+L1) | ~$0.70/yr |
| MemPalace + 5 searches/session | ~$10/yr |
| RuVector (all local, no API) | $0/yr |
| Both together | ~$10/yr |

MemPalace's cost comes from ChromaDB embedding computation, not API calls. Both systems are local-only.

---

## Sources

- [GitHub: milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace) — README, MCP server source, hooks docs
- GitHub API — repo metadata (14,239 stars, 1,596 forks, created 2026-04-05)
- RuVector plugin exploration — `plugins/yellow-ruvector/` (plugin.json, CLAUDE.md, all commands/agents/skills/hooks)
