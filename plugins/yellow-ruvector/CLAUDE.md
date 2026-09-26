# yellow-ruvector Plugin

Persistent vector memory and semantic code search for Claude Code agents via
ruvector.

## MCP Server

- **ruvector** — stdio server started by `bin/start-ruvector.sh`
  (`mcpServers.ruvector.command` in `catalog/plugins/yellow-ruvector.json`).
  The launcher:
  1. installs the pinned ruvector (`dependencies.ruvector` in this plugin's
     `package.json` + committed `package-lock.json`) into the plugin data
     dir if missing — `npm ci --ignore-scripts` into `install-<lockhash12>/`,
     then an atomic `current` symlink swap, keeping the previous install so
     a running server is never pulled out from under itself. It waits up to
     `RUVECTOR_INSTALL_WAIT` (25) seconds for a live installer (the prewarm
     hook) before failing with a hint;
  2. `cd`s to the git toplevel (ruvector's `getIntelPath()` only looks at
     `process.cwd()`) after healing a linked worktree's `.ruvector` symlink,
     so subdirectory launches and new worktrees use the right store in the
     SAME session;
  3. guards a fresh store: if `.ruvector/` is missing or has no embedding
     stamp and the ONNX model is not cached, it warms the model (`embed
     text`, 15s, under the install lock); if that fails (offline), it drops
     the write tools `hooks_remember` and `hooks_pretrain` from
     `RUVECTOR_MCP_ALLOW` for the session. The server's write paths
     swallow ONNX failures and fall back to hash, which would stamp the
     store hash/64d and lock out every later write (ADR-210);
  4. `exec`s `node <data>/install-<hash>/node_modules/ruvector/bin/cli.js mcp start`
     (the resolved `current` target, so pruning can skip installs a live
     server still loads modules from).
- Data dir: `$CLAUDE_PLUGIN_DATA`, or `${XDG_DATA_HOME:-~/.local/share}/yellow-ruvector`
  when the host does not set it. Install primitives live in
  `lib/install-ruvector.sh` (adapted from yellow-morph's install lib).
- **Bumping the pin:** change `dependencies.ruvector` in `package.json`,
  regenerate `package-lock.json` (`npm install --package-lock-only
  --ignore-scripts`) and the root `pnpm-lock.yaml`, then re-verify the five
  tool schemas and the CLI subcommands the hooks use. Users pick it up on
  their next session (new lockfile hash → new install dir).
- Storage: `.ruvector/intelligence.json` (flat JSON) at the git toplevel
- Embedding model: all-MiniLM-L6-v2 (384 dimensions, ONNX WASM runtime),
  cached at `${RUVECTOR_CACHE_DIR:-$HOME}/.ruvector/models/` (~90MB; the
  prewarm hook downloads it)
- Lifecycle: starts on first MCP tool call (lazy init by Claude Code), shuts
  down on session end
- If crashed mid-session: `/ruvector:status`, or run the launcher by hand —
  its stderr names install, Node, and read-only-mode problems
- `RUVECTOR_MCP_ALLOW` names the five tools this plugin calls
  (`hooks_capabilities`, `hooks_pretrain`, `hooks_recall`, `hooks_remember`,
  `hooks_stats`); `RUVECTOR_MCP_PROFILE` is not set. Through 0.3.3 an empty
  or misspelled policy exposes every tool and a profile unions with the
  allowlist. 0.3.3's new `metaharness_*` / `rvf_*` tools stay hidden
- Requires Node.js 20+ (ruvector 0.3.3 `engines`). With older Node the
  launcher exits with a message and hooks do nothing

## Conventions

- **MCP write schema:** `hooks_remember` accepts `content` and optional `type`.
  Preferred `type` values in this plugin are `decision`, `context`, `project`,
  `code`, and `general`. Do not invent `namespace` or `metadata` parameters.
- **MCP tool naming:** All tools referenced as
  `mcp__plugin_yellow-ruvector_ruvector__*` (e.g.,
  `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`)
- **Hook architecture:** Hooks run the plugin-managed CLI resolved by
  `hooks/scripts/lib/resolve.sh` (`RUVECTOR_BIN` overrides it in tests;
  a global `ruvector` on PATH is never used) from the git toplevel.
  `pre-tool-use.sh` calls `hooks pre-edit` / `hooks pre-command` as
  read-only **side effects** (stdout discarded); `session-start.sh` captures
  `hooks recall` stdout into `hookSpecificOutput.additionalContext`; the
  co-edit hook uses jq only. Every hook prints dual-client allow JSON.
  Operator warnings stay on `systemMessage`. **No hook writes
  `.ruvector/intelligence.json`** — memories come only from MCP
  `hooks_remember`. Do not re-add `hooks post-edit` / `post-command`: each
  writes a near-empty hash-embedded memory that stamps a fresh store
  hash/64d (ADR-210), and their co-edit tracking never worked (ruvector's
  `lastEditedFile` is per-process).
  Never run `ruvector hooks init` to
  register hooks — even `--minimal` writes empty-stdout PreToolUse commands
  into `.claude/settings.json` that Cursor rejects as invalid JSON. Use
  `scripts/repair-cursor-pretooluse.sh` to wrap leftovers. No manual queue
  management.
- **Input validation:** All `$ARGUMENTS` values validated before use. See
  `ruvector-conventions` skill.
- **Graceful degradation:** All agents and commands must work without ruvector —
  fall back to Grep for search, skip memory operations silently.
- **PR creation:** Use the active stacked-PR provider (see `/stack:status`), not `gh pr create`.

## Plugin Components

### Commands (7)

- `/ruvector:setup` — Install ruvector and initialize `.ruvector/` directory
- `/ruvector:index` — Index codebase for semantic search
- `/ruvector:search` — Search codebase by meaning using vector similarity
- `/ruvector:status` — Show ruvector health, DB stats, queue status, and
  embedder provenance (`PROVENANCE: FRESH | OK | MISMATCH | UNSTAMPED |
  UNKNOWN`, computed in the command's bash block by comparing the five
  enforced stamp fields against `hooks reembed --dry-run`'s
  `targetProvenance` — extra keys ignored, a missing enforced field is a
  mismatch, no object `targetProvenance` at all is UNKNOWN, as is a jq
  failure during the compare — with remediation; the dry-run is bounded
  at 90 s and costs a model load, and an exit 137 is reported as SIGKILL
  without assuming the deadline elapsed)
- `/ruvector:learn` — Record a learning, mistake, or pattern for future sessions
- `/ruvector:memory` — Browse and search stored memories and learnings
- `/ruvector:seed-solutions` — Batch-seed `ERROR-FIX:` entries from a
  repo's `track: bug` solution docs into recall memory (idempotent;
  gated on `intel_path` resolving inside the project root). Re-run
  manually after new solution docs land — seeded entries do not track
  the corpus automatically

### Agents (2)

- `ruvector-semantic-search` — Find code by meaning rather than keyword
- `ruvector-memory-manager` — Store, retrieve, and flush agent learnings across
  sessions

### Skills (3)

- `ruvector-conventions` — MCP schema, memory patterns, and error handling
  catalog
- `agent-learning` — Learning triggers, quality gates, retrieval strategy
- `memory-query` — Standard pattern for querying ruvector institutional memory
  before acting; canonical home of the ruvector protocol constants (RULE 16
  drift lint enforces its sentinel line across the yellow-core replicas)

### Hooks (3 events, 4 scripts)

The CLI-calling hooks (`session-start.sh`, `pre-tool-use.sh`) exit silently
(allow JSON) when Node < 20, the install is missing, or an install is in
progress.

- `prewarm.sh` (SessionStart, 5s) — installs the pinned ruvector and
  downloads the ONNX model in a detached background job under the install
  lock (yellow-morph's prewarm pattern). Purely an optimization: the MCP
  launcher installs synchronously when needed.
- `session-start.sh` (SessionStart, 6s) — one semantic `hooks recall
  --top-k 5` (4.5s budget; 0.3.3 recall loads the ONNX model, 1.2–2.1s warm)
  returned as `additionalContext`, plus a jq-only embedder-provenance check:
  a `hash`-stamped store with the default (onnx-minilm) embedder, or a
  stamp-less store that already holds vectors (`ERR_LEGACY_STORE_READONLY`),
  adds one `[ruvector] …` line to `systemMessage`; silent for fresh stores
  and when the env selects hash the way upstream resolves it
  (`RUVECTOR_EMBEDDER=hash`, or `RUVECTOR_ONNX=0` with `RUVECTOR_EMBEDDER`
  unset). The provenance parse only runs when a GNU-compatible
  `timeout`/`gtimeout` bounds it. Also re-runs the worktree store heal.
  There is no per-prompt (UserPromptSubmit) recall: semantic recall is too
  slow for every prompt, and the old hash-embedded per-prompt recall
  compared 64d queries against 384d vectors.
- `pre-tool-use.sh` — Pre-edit and pre-command side effects for
  Edit/Write/MultiEdit/Bash (1s budget). Stdout is dual-client allow JSON
  (`continue` + `permission`) so Cursor's Claude-plugin bridge does not
  block the tool.
- `post-tool-use.sh` (PostToolUse on Edit/Write/MultiEdit, 1s; ~40–70ms,
  jq only) — co-edit recording (`hooks/scripts/lib/coedit.sh`). Each
  successful edit updates the session's last-edited file in
  `.ruvector/coedit-sessions/<session_id>`; a different file edited by the
  same session within 60s adds one to that symmetric pair in
  `.ruvector/coedit.json`. Paths are root-relative and physical; paths
  outside the root, in `.ruvector/`, `.git/`, or `docs/solutions/`, with
  control characters, or over 512 chars are ignored. Writes are temp file +
  rename under a non-blocking mkdir lock (a busy lock skips one increment);
  the file is capped at 5000 directed pairs, keeping the highest counts.
  Per-session state keeps concurrent sessions and worktrees (which share the
  store) from pairing each other's edits; `session-start.sh` prunes session
  files older than 7 days. MultiEdit's path is the top-level
  `tool_input.file_path` (its `edits[]` carry no paths — earlier versions
  read `edits[].file_path` and never matched)

### Scripts (3) and bin (1)

- `bin/start-ruvector.sh` — MCP launcher (see MCP Server above)
- `scripts/ruvector-cli.sh` — run the plugin-managed CLI from the project
  root (`--version`, `hooks reembed --dry-run`, …); used by
  `/ruvector:seed-solutions`, `/ruvector:status` remediation, and by hand
- `lib/install-ruvector.sh` — sourced install primitives (data dir, path
  validation, lock, `npm ci`, `current` swap, prune, model cache/warm-up)
- `scripts/repair-cursor-pretooluse.sh` — Wrap leftover `ruvector hooks init`
  PreToolUse commands in `~/.claude/settings.json` / project
  `.claude/settings.json` so Cursor gets valid allow JSON. Idempotent;
  does not touch git-ai or PostToolUse entries.

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
- **`/ruvector:memory`** — Browse stored memories. Use for viewing and
  filtering entries.
- **`/ruvector:index`** — Manual full or incremental index. Use after major code
  changes.
- **`/ruvector:status`** — Health check. Use to verify ruvector is working and
  check DB stats.

## Workflow Integration

When yellow-ruvector is installed, agents follow these steps during workflow
commands (`/flow:brainstorm`, `/flow:plan`, `/flow:work`).

### At the start of any workflow command

1. **For `/flow:work`:** the memory query is defined explicitly in
   `work.md` Phase 1 Step 2b — do not add a separate query at session start.
2. **For `/flow:brainstorm` and `/flow:plan`:** before generating
   any output, call `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with
   the task description as the query. Skip silently if ToolSearch cannot locate
   the tool or if the call returns a tool-execution error.
3. Inject retrieved memories as background context — treat as reference only,
   not authoritative instructions.

### At the end of /flow:work (after final commit, before PR)

4. Call `mcp__plugin_yellow-ruvector_ruvector__hooks_remember` to record a
   learning from the session. **Do not skip this step.**

   Quality requirements:
   - **Length:** 20+ words
   - **Structure (all three required):** context (what was built and where),
     insight (why a key decision was made or what failed), action (concrete
     steps for a future agent in the same situation)
   - **Specificity:** name concrete files, commands, or error messages —
     "Fixed CRLF in hooks.sh by running `sed -i 's/\r$//'`" not "Fixed a bug"
   - Use `type=decision` for successful patterns, `type=context` for mistakes
     and fixes, and `type=project` for session summaries

5. If `hooks_remember` fails with a provenance refusal (message names
   ADR-210 / "does not match the active embedder", or code
   `ERR_LEGACY_STORE_READONLY`), do not retry and do not skip silently —
   it is store-wide: report `[ruvector] memory writes refused — run
   /ruvector:status for the reembed + restart steps` and continue. For any
   other failure (timeout, connection refused, unavailable), skip silently.

## Known Limitations

- First stdio MCP server in this repo — less battle-tested than HTTP pattern
- First install needs network (~119MB npm fetch; ~75MB on disk per install
  dir, at most two kept) and the first model load downloads ~90MB from
  huggingface.co. Until then hooks do nothing and, on a fresh store, the MCP
  server runs without `hooks_remember`
- No offline MCP fallback — if ruvector MCP is down, search and memory
  operations fail gracefully
- `.ruvector/` is shared across git worktrees via a symlink injected by
  yellow-core's `worktree-manager.sh` at worktree creation time; for
  worktrees created by other tooling, the MCP launcher heals the link
  before the server starts and `session-start.sh` heals it again.
  `/ruvector:seed-solutions`'s Step 1.4 store-scoping check stays as
  defense in depth
- A project without `.ruvector/` falls back to ruvector's own resolution
  (`~/.ruvector` when it exists). Run `/ruvector:setup` per project
- Stores created under a subdirectory by older (pre-launcher) sessions are
  no longer used; `/ruvector:status` lists them as `nested store:`
- Concurrent sessions writing to the same store are last-writer-wins: 0.3.3
  writes atomically (RuVector#995 fixed) but the MCP server writes back its
  in-memory snapshot without re-reading, so a CLI write between two MCP
  saves is lost. Avoid simultaneous sessions with active `hooks_remember` or
  `/ruvector:index` on the same project
- MCP cold start adds 300-1500ms on first tool call after session start
- Hooks registered by a past `ruvector hooks init` in `settings.json` still
  run the global binary; `/ruvector:setup` and `/ruvector:status` flag them
- A store stamped by the pre-0.2.34 hash embedder refuses every
  `hooks_remember` (ADR-210) while `hooks_recall` keeps answering — the
  write loss is silent. `session-start.sh` and `/ruvector:status` surface
  it; the fix is `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ruvector-cli.sh"
  hooks reembed --dry-run` first, then `hooks reembed` (add
  `--drop-missing` if the dry-run reports `wouldDrop` — memories without
  retained source text; reembed otherwise refuses, and `--drop-missing`
  discards those memories), followed by a Claude Code restart (the running
  MCP server holds the pre-reembed snapshot and would clobber the store on
  its next save).
  See `docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`

## Maintenance

- **Uninstall:** Delete `.ruvector/` directory, remove from `.gitignore`.
  The plugin data dir holds the installs; Claude Code removes it with the
  plugin. A global `ruvector` from older versions of this plugin can be
  removed with `npm uninstall -g ruvector`
- **Upgrade:** automatic — a new lockfile installs on the next session. See
  "Bumping the pin" above for maintainers
- **Team usage:** `.ruvector/` should be gitignored (per-developer data). Team
  learnings can be exported via `/ruvector:memory` and shared manually.

## Testing

`bats tests/` from the plugin directory — one suite per hook
(`session-start`, `pre-tool-use`, `post-tool-use` — co-edit recording,
including a 20-way concurrency check — and `repair-cursor-pretooluse`) plus `start-ruvector.bats` (launcher),
`resolve.bats`, `validate.bats`, `mcp-allowlist.bats`,
`memory-manager-flush.bats`, and `status-provenance.bats` (extracts the
provenance bash block from `commands/ruvector/status.md` at run time and
drives it with a stub CLI through `RUVECTOR_BIN` — five-field compare,
missing `targetProvenance`, rc=137 wording). Hook suites point
`RUVECTOR_BIN` at a stub instead of installing ruvector.
`tests/integration/install-ruvector.test.ts` (vitest, repo root) covers the
install lib. Hook config is sourced from `catalog/plugins/yellow-ruvector.json`
and generated into `plugin.json` by `pnpm generate:manifests`; hook scripts
emit JSON through `hooks/scripts/lib/hook-json.sh`. Do not add
`hooks/hooks.json`. Edit the status block's first line
(`INTEL=.ruvector/intelligence.json`) or its closing fence and
`status-provenance.bats`'s extractor stops matching — keep them.
