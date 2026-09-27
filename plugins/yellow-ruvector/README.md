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

| Command                         | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| `/ruvector:setup`               | Verify/install the plugin-managed ruvector and initialize `.ruvector/` |
| `/ruvector:index [path]`        | Index codebase for semantic search (always repo-wide; `path` only narrows the preview) |
| `/ruvector:search <query>`      | Search codebase by meaning using vector similarity     |
| `/ruvector:status`              | Show health, DB stats, queue, and embedder provenance  |
| `/ruvector:learn [description]` | Record a learning, mistake, or pattern                 |
| `/ruvector:memory [filter]`     | Browse and search stored memories                      |
| `/ruvector:seed-solutions`      | Seed ERROR-FIX memory from `track: bug` solution docs  |

## Embedder provenance (`/ruvector:status`)

Step 6 compares the store's `embeddingProvenance` stamp against the active
embedder reported by `hooks reembed --dry-run`. Verdicts:

- **`FRESH`** — No store file, or no stamp and no vectors yet
- **`UNSTAMPED`** — Vectors exist but no stamp; writes are refused
- **`OK`** — The five enforced fields match (`embedderKind`, `modelId`,
  `dimension`, `normalize`, `prefixPolicy`); extra stamp keys are ignored
- **`MISMATCH`** — At least one enforced field differs; run the printed
  `hooks reembed` + restart steps
- **`UNKNOWN`** — Cannot compare safely (no GNU-compatible `timeout`/`gtimeout`
  on PATH, dry-run timeout/SIGKILL/nonzero exit, older CLI without object
  `targetProvenance`, or jq compare failure). Exit 137 is reported as SIGKILL
  without assuming the 90 s deadline elapsed.

When `hooks_remember` is refused (ADR-210) but recall still works, start
here — `PROVENANCE: MISMATCH` / `UNSTAMPED` prints the remediation block.

## Agents

| Agent                      | Trigger                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `ruvector-semantic-search` | "Find similar code", "search by concept", "where is X implemented"    |
| `ruvector-memory-manager`  | "Remember this", "what did we learn about X", "flush pending updates" |

## How It Works

- **Semantic search:** Code is chunked and embedded using all-MiniLM-L6-v2 (384
  dims). Search queries are embedded and compared via vector similarity.
- **Agent memory:** Learnings are stored through `hooks_remember(content, type)`
  and retrieved with `hooks_recall(query, top_k)`.
- **Passive capture:** `PostToolUse` records a successful edit and a Bash
  result that carries a host `tool_response`. `PostToolUseFailure` records
  a Bash `Exit code N`. A missing status, an interrupt, or a failed recall
  is not treated as saved. Recalled text is untrusted reference context.
- **Error→fix memory:** `/ruvector:seed-solutions` imports a repo's
  `track: bug` solution docs as `ERROR-FIX:` entries so debugging and
  review flows can recall past fixes semantically. Seeding is manual —
  re-run it after new solution docs land.
- **Session recall:** at session start, one semantic `hooks recall` injects
  past learnings as untrusted reference context.
- **MCP integration:** ruvector runs as a stdio MCP server, discovered via
  ToolSearch. `bin/start-ruvector.sh` starts it from the git toplevel, so
  sessions launched from a subdirectory or a new worktree use the project
  store.
- **Plugin-managed install:** the plugin pins ruvector in its own
  `package.json`/`package-lock.json` and installs it into the plugin data
  dir on first use (a SessionStart hook does this in the background). The MCP
  server and every hook run that one copy — no global `npm install -g`, and
  no version skew between them.

## Requirements

- Node.js 20 or later (ruvector 0.3.3)
- npm (for the first install) and network access for the first install and
  the first ONNX model download (~90MB)
- jq

## Configuration

Storage is in `.ruvector/` at the project root (automatically gitignored). No
external services or API keys required.

## Troubleshooting

| Issue                | Solution                                                 |
| -------------------- | -------------------------------------------------------- |
| "ruvector not found" / hooks do nothing | Run `/ruvector:setup` (installs into the plugin data dir; Node 20+) |
| "ONNX model unavailable or unverified (offline?): starting without hooks_recall, hooks_remember and hooks_pretrain" | The ONNX model could not download; the next session with network restores recall and writes |
| Old memories missing after upgrading | A store in a subdirectory from older sessions — `/ruvector:status` lists it as `nested store:` |
| Empty search results | Run `/ruvector:index` first                              |
| Slow first search    | Normal — MCP cold start takes 300-1500ms                 |
| Queue growing large  | Check `/ruvector:status`; ask the `ruvector-memory-manager` agent to flush it (no hook drains the queue) |
| Cursor blocks Shell / edits | Re-run `/ruvector:setup`, then start a new Cursor session |
| `hooks_remember` refused / "store is hash-embedded" at session start | Run `/ruvector:status` — `PROVENANCE: MISMATCH` / `UNSTAMPED` prints the `hooks reembed` + restart steps (status diagnoses; the reembed + restart is the fix) |

`ruvector hooks init` writes empty-stdout PreToolUse commands into
`~/.claude/settings.json`. Cursor treats that as invalid JSON and blocks
Shell and file edits. `/ruvector:setup` wraps those commands with dual-client
allow JSON. Do not re-run `ruvector hooks init` afterward. Its other entries
(`hooks post-edit`, `post-command`, `session-start`, …) run the global binary
and can stamp a fresh store hash; `/ruvector:setup` lists them and, after
asking, removes them (a `settings.json.bak-<time>` backup is kept).

## License

MIT
