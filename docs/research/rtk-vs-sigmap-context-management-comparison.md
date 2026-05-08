# RTK vs sigmap: Context Management Tool Comparison for yellow-plugins

**Date:** 2026-05-08
**Complexity classification:** Moderate (two known artifacts, direct comparison)

---

## TL;DR

RTK and sigmap solve **different problems**. RTK (Rust Token Killer) compresses the *output of shell commands* before they enter the LLM context window — it is a CLI proxy, not a code retrieval or context-ranking tool. sigmap ranks and summarizes which *source files* are relevant to a given query. Neither tool addresses the user's specific pain (targeted-fix over-reading + cold-start on unfamiliar codebases) as well as a combined ruvector + RTK stack would. **Adopt RTK as a complement to ruvector; sigmap remains skip-with-door-open.** RTK solves a real, measurable problem your stack currently has zero coverage for; sigmap overlaps with what ruvector already provides.

---

## What RTK Is

**RTK** stands for [Rust Token Killer](https://github.com/rtk-ai/rtk). The name is not an acronym for a category — it is a product name. This is not a retrieval toolkit, a knowledge graph, or a context-ranking engine. It is a high-performance CLI proxy written in Rust that intercepts shell commands executed by an LLM agent and compresses their output before the output enters the context window.

### Mechanism

RTK operates at the tool-call layer, not the file-retrieval layer. When Claude Code runs `git status`, a PreToolUse hook silently rewrites the command to `rtk git status`. RTK executes the underlying command, captures stdout, runs it through an 8-stage filter pipeline (strip ANSI, apply regex replacements, match/strip/keep lines, truncate, tail, apply `on_empty`), and returns the compressed result. The agent receives correct output — just much smaller. The agent never knows RTK is involved.

Filter logic is implemented in two tiers:

- **Rust modules** for commands with structured output (JSON, NDJSON), multi-phase state machines, or flag-injection needs (e.g., `go test -json` is injected automatically). These live in `src/cmds/`.
- **TOML filter files** for simpler line-by-line text output where regex stripping achieves 60%+ savings. These are compiled into the binary at build time via `build.rs`.

The rewrite registry (`src/discover/registry.rs`) classifies commands on the hot path at sub-10ms latency. Compound commands (`cargo build && cargo test 2>&1 | tail -20`) are split on operators, each segment classified independently.

### Install/Runtime Model

- **Single Rust binary** — `brew install rtk` (Homebrew formula published), `cargo install`, or direct download with SHA-256 verification.
- **`rtk init`** installs a PreToolUse hook into Claude Code's `settings.json` and optionally patches `CLAUDE.md` with a 134-line RTK awareness block. Supports 7 agents: Claude Code, Copilot, Cursor, Cline, Windsurf, Codex, OpenCode.
- **No daemon**, no server, no database, no external service. Sub-10ms overhead per command.
- **Telemetry:** opt-out; usage data sent to `rtk-ai.app` by default. Disable with `RTK_TELEMETRY=0`.

### Supported Command Surface

100+ commands across:

| Category | Examples | Reported Savings |
|---|---|---|
| Test runners | vitest, pytest, cargo test, go test, playwright | 90–99% |
| Build tools | cargo build, npm, pnpm, dotnet, make | 70–90% |
| VCS | git status/log/diff/show | 70–80% |
| Language servers | tsc, mypy | 80–83% |
| Linters | eslint, ruff, golangci-lint, biome | 80–85% |
| Package managers | pip, cargo install, pnpm list | 75–80% |
| File operations | ls, find, grep, cat, head, tail | 60–75% |

From the README's 30-minute session model: `cat`/`read` called 20x generates 40,000 tokens standard vs. 12,000 through RTK (70% reduction). `ls`/`tree` called 10x: 2,000 → 400 (80%).

### Dependencies and MCP Support

Zero runtime dependencies beyond the binary. No Python, no Node.js, no embedding model, no database. **No MCP server** — confirmed by source scan; `model_context_protocol` appears nowhere in the codebase. RTK integrates via Claude Code's native PreToolUse hook mechanism, not via MCP.

### Maturity Signals

- **Language:** Rust (primary), with shell hooks and a TypeScript plugin for OpenClaw
- **License:** MIT (binary/hooks) / Apache-2.0 (source — dual-licensed)
- **Version:** 0.38.0 (Cargo.toml confirmed); self-describes as `0.28.2` minimum in hook version guard (hook was authored at an earlier point)
- **Named contributors:** Patrick Szymkowiak (primary), Florian Bruniaux, Adrien Eppling — at least 3 named contributors, not a single-maintainer project
- **Homebrew:** Formula published at `brew install rtk` (badge present in README)
- **Discord:** Active community server linked from README
- **Stars:** Not directly readable via GitHub search tool, but the Homebrew publication + Discord + website + multi-contributor structure suggest materially higher community investment than sigmap
- **Token savings database:** SQLite tracking via `rtk gain` / `rtk cc-economics` dashboards — RTK records actual savings per session for self-auditing

---

## What sigmap Is

*(The user has a full evaluation at `docs/research/sigmap-evaluation-for-yellow-plugins.md` — this is a condensed recap for comparison purposes.)*

[sigmap](https://github.com/manojmallick/sigmap) is a code-signature file ranker. It scans a codebase, extracts function/class/type signatures across 21 languages, and uses hybrid TF-IDF scoring + 2-hop graph boosts to rank which files are most relevant to a given query. Output is a compact context summary written to `CLAUDE.md` or `.cursorrules`. Claims 40–98% token reduction; 80.0% hit@5 on a 405-repo self-reported benchmark. 9 MCP tools via `sigmap --mcp`. 181 stars, single maintainer (manojmallick), MIT license, version 6.10.0, actively maintained as of May 2026.

---

## Head-to-Head Feature Comparison

| Dimension | RTK | sigmap |
|---|---|---|
| **What it does** | Compresses CLI command output before it enters context | Ranks source files by relevance to a query; writes compact signature summary |
| **Retrieval algorithm** | No retrieval — pipeline interception + regex/parser filters | TF-IDF + 2-hop graph boost + hub suppression + intent detection |
| **Language coverage** | Language-agnostic (command output); toolchain-specific filters | 21 programming languages for signature extraction |
| **MCP server support** | None — integrates via PreToolUse hook | Yes — `sigmap --mcp` exposes 9 tools (read_context, search_signatures, get_map, query_context, get_impact, etc.) |
| **Hook/automation surface** | PreToolUse hook (transparent rewrite) for 7 agents | Watch mode + MCP tools; no hook injection into Claude's tool call pipeline |
| **Output format** | Compressed stdout (in-stream, no files written) | File generation: writes to `CLAUDE.md`, `.cursorrules`, or similar |
| **Token reduction claims** | 60–99% depending on command; measured per-session via SQLite | 40–98% depending on codebase; self-reported benchmark |
| **Supported task types** | Any task that runs CLI commands (test, build, lint, read, git) | Pre-task context loading for planning and targeted-fix |
| **Index update model** | Passive — fires on every command automatically via hook | Active — requires `sigmap ask` or watch mode trigger |
| **Problem being solved** | Command output bloat in running context | Wrong/too many files loaded at task start |
| **Maintenance health** | 3+ named contributors, Homebrew, Discord, website, v0.38.0 | 1 maintainer, 181 stars, v6.10.0, no independent benchmarks |
| **Install friction** | `brew install rtk && rtk init` | `npx sigmap --mcp` or binary install; `.gitignore` discipline required |
| **Runtime dependencies** | Single binary, nothing else | Node.js 18+ (or standalone binary) |
| **Writes to your repo** | Optional `CLAUDE.md` patch (134-line block); hook in `settings.json` | Writes context summary files to `CLAUDE.md`, `.cursorrules` |
| **Lock-in** | Low — remove hook from `settings.json`, delete binary | Low — plain text output files, single config entry |
| **Supply chain surface** | Binary with SHA-256 verification; opt-out telemetry | `npx` (remote execution) or binary; no telemetry mentioned |

---

## For the User's Specific Pain

The user has two active pain points, with yellow-ruvector already deployed:

### Pain B: Targeted-fix tasks where Claude reads too many adjacent files

**Root cause:** When Claude Code runs a targeted fix, it often reads 5–15 adjacent files to "understand context," even when the fix is local. This is a **file-loading** problem, not a command-output problem.

- **RTK:** Does not help here. RTK fires *after* a file is opened (the `cat`/`read` output is compressed), not *before* the decision to open it. RTK will reduce the token cost of each file read by 60–75%, which is real, but it does not prevent Claude from deciding to open adjacent files in the first place.
- **sigmap:** More directly relevant. `query_context` or `get_map` can be invoked before a targeted-fix task to produce a ranked file list, steering Claude toward only the relevant files. However, ruvector's `hooks_recall --semantic` already fires on every prompt and injects relevant code memories. The marginal gain from sigmap over ruvector for this pain depends on whether ruvector's injection is actually steering file selection or just adding context.
- **ruvector (existing):** Fires pre-prompt and injects relevant memories. But ruvector stores *past decisions and learnings*, not current file-structure rankings. On a repo with no prior ruvector history (cold start), injection is thin.

**Verdict for Pain B:** RTK reduces the *cost per file read* but not the *number of files read*. sigmap addresses the number directly. Neither is transformative alone: the right fix for over-reading is a disciplined task prompt or ruvector-trained memories telling Claude which files matter for which type of task. That said, RTK gives an immediate, measurable win on every targeted fix (every `cat` call is 70% smaller) — it is not solving the wrong problem, just a different layer of the same problem.

### Pain D: Cold-start on unfamiliar codebases

**Root cause:** On first encounter with a large unfamiliar repo, Claude has no ruvector history and will issue many exploratory `ls`, `cat`, `grep`, `git log` calls to orient itself. Each of these is large.

- **RTK:** Directly attacks this. Every `ls` is 80% smaller, every `cat` is 70% smaller, every `git log --stat` is 87% smaller. Cold-start token spend drops substantially. The exploration still happens — but it costs far less. This is meaningful on repos with 50K+ lines where orientation requires reading dozens of files.
- **sigmap:** Also relevant. `get_map` can give Claude a codebase overview without reading individual files. But this requires Claude to *use* the MCP tool proactively, which means it must appear in system context or be prompted. It does not fire automatically.
- **ruvector (existing):** On cold-start, ruvector has no stored memories. The hook fires but injects nothing useful until the first session has run.

**Verdict for Pain D:** RTK is the better match for cold-start because it activates automatically (the hook fires regardless of whether ruvector has memories) and reduces the token cost of every exploratory command. sigmap requires either a standing `CLAUDE.md` context section or explicit MCP tool invocation — neither is guaranteed to activate on cold-start without a command or agent wrapper.

### Combined verdict for ruvector + [?]

For the user's stack with ruvector already active:

- **RTK complements ruvector orthogonally.** ruvector handles "what did we learn before?" RTK handles "make every command output smaller right now." These are different layers with zero interaction risk.
- **sigmap partially overlaps with ruvector** on file-relevance ranking. ruvector's semantic hook recall is already doing a version of "which code is relevant to this prompt." sigmap's file-ranking is a different algorithm (TF-IDF vs. embeddings) that could add signal — but the overlap means the marginal gain is harder to measure and the complexity cost is higher.

**For the user's two named pains in this stack: RTK > sigmap.**

---

## Integration Cost into yellow-plugins

### RTK

**Lightest shape:** A single hook entry in a plugin's `plugin.json` pointing to the RTK hook script installed by `rtk init`. Since `rtk init` modifies `settings.json` and `CLAUDE.md` directly, a plugin could expose this as a setup command:

```markdown
## Setup

Run `rtk init` once per machine. RTK installs a PreToolUse hook that activates automatically in all Claude Code sessions.
```

No MCP server entry needed — RTK integrates via the hook system, not MCP. A `yellow-rtk` plugin could provide:
- A `/rtk:setup` command that runs `rtk init` with appropriate flags
- A `/rtk:gain` command that shows savings dashboard
- An `/rtk:discover` command that analyzes past sessions for missed savings opportunities
- A `SessionStart` hook to check RTK is installed and warn if not

**Hook collision with ruvector:** None. **Both RTK and ruvector register PreToolUse hooks** (verified in `plugins/yellow-ruvector/.claude-plugin/plugin.json` — ruvector's PreToolUse matcher is `Edit|Write|MultiEdit|Bash`), but they perform different operations on different data: RTK rewrites the command's `stdout` after execution to compress output; ruvector injects relevant context before execution. The "no collision" conclusion holds operationally — different operations, different data — but it is **not** because the hook types differ as an earlier draft of this doc incorrectly claimed. ruvector additionally runs PostToolUse (memory writeback) and UserPromptSubmit (recall injection) hooks; none of these surface conflict with RTK's command-rewrite path.

**File-write conflicts:** RTK's `rtk init` patches `CLAUDE.md` with a 134-line RTK awareness block. This is the one friction point: yellow-core auto-memory and sigmap also write to `CLAUDE.md`. The RTK block is append-only (it does not replace), but any plugin that manages `CLAUDE.md` as curated content needs to account for this. Mitigation: use `rtk init --hook-only` in the plugin setup command, and expose the CLAUDE.md patch as a separate opt-in step.

**Plugin requirements:** A minimal `yellow-rtk` plugin with 2–3 commands and no agents would be sufficient. The value is in the hook, not in complex agent orchestration.

**Install friction:** `brew install rtk` is a single-step prerequisite. The plugin's setup command can check `command -v rtk` and fail clearly if not installed. No API keys, no accounts, no cloud configuration.

### sigmap

**Lightest shape:** A single `mcpServers` entry in yellow-ruvector or yellow-core's `plugin.json`, pointing to `npx sigmap --mcp`. No new plugin required. The 9 MCP tools become available to Claude without any additional orchestration.

**Hook collision with ruvector:** No collision (sigmap has no hooks). The interaction risk is at the `CLAUDE.md` file level: sigmap writes context summaries to `CLAUDE.md` sections, and ruvector's hook-recall injects similar context pre-prompt. If both are active, Claude may receive redundant context from two different sources — not a crash, but noise.

**File-write conflicts:** sigmap's generated context files and yellow-core auto-memory both target `CLAUDE.md`. Explicit `.gitignore` entries for sigmap's output sections are required. This is an operational discipline requirement, not a technical blocker.

**Plugin requirements:** No full plugin needed. A `mcpServers` entry is the right shape. A `yellow-sigmap` plugin with elaborate agents is overkill given what sigmap does.

---

## Risks Specific to Each

### RTK

- **Opt-out telemetry:** RTK sends usage data to `rtk-ai.app` by default. Enterprise environments or privacy-conscious users must set `RTK_TELEMETRY=0`. A yellow-rtk plugin setup command should set this by default or surface the choice explicitly.
- **CLAUDE.md write on init:** `rtk init` (without `--hook-only`) patches `CLAUDE.md` with a 134-line block. This is fine for standalone use but conflicts with curated `CLAUDE.md` management in yellow-core auto-memory. Mitigate by defaulting to `--hook-only` in the plugin.
- **Filter drift:** RTK's compression is opaque to Claude — Claude receives compressed output and cannot tell it is compressed. If a filter has a bug (strips lines it shouldn't), Claude acts on incomplete information without warning. The `[RTK:DEGRADED]` and `[RTK:PASSTHROUGH]` markers in verbose mode help, but are not surfaced in normal operation.
- **Supply chain:** Homebrew formula reduces `npx`-style supply chain risk. SHA-256 files are published for direct downloads. Lower risk than sigmap's `npx` default.
- **Performance (negative):** Sub-10ms overhead per command is claimed. On very high-frequency command loops (e.g., watch mode), cumulative overhead could be measurable. The Rust binary minimizes this risk.
- **Version pinning:** The Claude Code hook (`rtk-rewrite.sh`) has a minimum version guard of 0.23.0. At v0.38.0, the project moves fast — breaking changes to hook formats are possible between minor versions. Pin the version in the plugin's prerequisite check.

### sigmap

- **Bus-factor 1:** Single maintainer. If manojmallick goes quiet, the tool stagnates. 181 stars is modest for a tool making aggressive token-reduction claims. RTK has at least 3 named contributors, a website, Homebrew, and Discord — structurally less fragile.
- **Unverified performance claims:** The 40–98% token reduction and 80.0% hit@5 figures are self-reported against the maintainer's own benchmark. No independent replication found. RTK's claims are also self-reported, but RTK's per-command savings are measurable per-session via `rtk gain` — falsifiable in a way sigmap's benchmark-suite claims are not.
- **Context file collision:** Any tool that writes to `CLAUDE.md` automatically creates an operational risk with yellow-core auto-memory. This is manageable but requires discipline.
- **`npx` supply chain:** Running `npx sigmap` fetches and executes remote code on each invocation unless pinned. Use the standalone binary with checksum verification for any production use.
- **Complexity tax on the stack:** ruvector + mempalace + auto-memory + research is already a dense context layer. sigmap adds a fourth file-based context source with overlapping concerns. The marginal value must justify the added mental model.

---

## Recommendation

**Adopt RTK. sigmap remains skip-with-door-open (unchanged from prior evaluation).**

### Why RTK over sigmap for this stack

1. **It solves a problem the stack has zero coverage for.** sigmap overlaps with ruvector's semantic recall. RTK does not overlap with anything — no tool in the yellow-plugins stack currently compresses CLI command output. Every `git log`, `cat`, `ls`, and test run in a Claude Code session is currently full-size. RTK changes that immediately.

2. **It activates automatically on both target pains.** For cold-start (Pain D), RTK fires on every exploratory command from the first session, regardless of ruvector history. For targeted-fix (Pain B), RTK reduces the token cost of every file read Claude makes, even if Claude still reads too many files.

3. **Zero interaction with ruvector.** Both register PreToolUse hooks, but on different operations and different data — RTK rewrites Bash command output, ruvector's `Edit|Write|MultiEdit|Bash` matcher gates memory-injection. The hooks operate orthogonally on disjoint payloads, so the no-collision conclusion holds operationally, not because of hook-type difference.

4. **Lower bus-factor than sigmap.** Three named contributors, Homebrew formula, Discord, external website — materially more organizational surface than a solo-maintainer npm package at 181 stars.

5. **Measurable ROI.** `rtk gain` and `rtk cc-economics` produce per-session savings dashboards from a local SQLite DB. You can verify the value after 7 days of use, not just trust the benchmark.

### Concrete next step

Build a `yellow-rtk` plugin as a thin wrapper:

- **Prerequisite check:** `command -v rtk` + version >= 0.38.0; fail clearly if not met
- **Setup command (`/rtk:setup`):** Runs `rtk init --hook-only` (skip the CLAUDE.md patch to avoid file conflicts), then verifies the hook appears in Claude Code's settings
- **Dashboard command (`/rtk:gain`):** Runs `rtk gain` to display token savings dashboard
- **Discover command (`/rtk:discover`):** Runs `rtk discover` to show which commands in past sessions could have been captured
- **Plugin `plugin.json`:** No `mcpServers` entry needed (RTK is not an MCP server). No agents needed. Three commands + a `SessionStart` hook that checks `rtk` is installed and warns if not.
- **Telemetry:** Default to `RTK_TELEMETRY=0` in the hook's environment, or surface the opt-in/opt-out choice explicitly in `/rtk:setup`.

### What changes vs. the prior sigmap-only brainstorm

The prior sigmap evaluation left the door open for a single `mcpServers` entry if token pressure on large codebases became concretely painful. That assessment stands for sigmap. But RTK addresses a different — and more immediate — token budget problem. Rather than "pilot sigmap if pain intensifies," the updated recommendation is: "adopt RTK now for command-output compression; revisit sigmap only if file-selection over-reading remains painful after RTK is deployed and ruvector has accumulated session history." These are sequential, not simultaneous decisions. RTK is the right first move.

---

## Sources Consulted

- [rtk-ai/rtk — README.md](https://github.com/rtk-ai/rtk/blob/master/README.md) — project identity, mechanism, token savings table, install modes
- [rtk-ai/rtk — Cargo.toml](https://github.com/rtk-ai/rtk/blob/master/Cargo.toml) — version (0.38.0), author (Patrick Szymkowiak), license (MIT), runtime dependencies
- [rtk-ai/rtk — hooks/README.md](https://github.com/rtk-ai/rtk/blob/master/hooks/README.md) — Claude Code PreToolUse hook mechanism, agent support list, command category savings table
- [rtk-ai/rtk — hooks/claude/README.md](https://github.com/rtk-ai/rtk/blob/master/hooks/claude/README.md) — Claude-specific hook details, version guard, test suite
- [rtk-ai/rtk — src/hooks/README.md](https://github.com/rtk-ai/rtk/blob/master/src/hooks/README.md) — `rtk init` installation modes, hook lifecycle
- [rtk-ai/rtk — src/discover/README.md](https://github.com/rtk-ai/rtk/blob/master/src/discover/README.md) — command rewrite engine, compound splitting, session analysis
- [rtk-ai/rtk — src/cmds/README.md](https://github.com/rtk-ai/rtk/blob/master/src/cmds/README.md) — command module architecture, Rust vs. TOML filter decision
- [rtk-ai/rtk — src/filters/README.md](https://github.com/rtk-ai/rtk/blob/master/src/filters/README.md) — TOML filter pipeline, build-time embedding
- [rtk-ai/rtk — src/core/README.md](https://github.com/rtk-ai/rtk/blob/master/src/core/README.md) — 8-stage filter pipeline stages
- [rtk-ai/rtk — openclaw/README.md](https://github.com/rtk-ai/rtk/blob/master/openclaw/README.md) — OpenClaw plugin, measured savings per command
- [rtk-ai/rtk — openclaw/package.json](https://github.com/rtk-ai/rtk/blob/master/openclaw/package.json) — `@rtk-ai/rtk-rewrite` package name, confirms plugin structure
- [manojmallick/sigmap — full prior evaluation](https://github.com/manojmallick/sigmap) — mechanism, MCP tools, maturity signals, integration cost (via prior research stored at `docs/research/sigmap-evaluation-for-yellow-plugins.md`)
- `docs/research/sigmap-evaluation-for-yellow-plugins.md` (repo-relative) — prior sigmap evaluation (read directly)
- Ceramic search (`rtk-ai RTK retrieval toolkit context management LLM MCP`) — 1 unrelated result, no prior team discussion found
- Ceramic search (`sigmap TF-IDF graph context management Claude Code MCP token reduction`) — 0 results
- [research-conductor] EXA — skipped (400 errors on all calls)
- [research-conductor] Tavily — skipped (TAVILY_API_KEY not configured)
- [research-conductor] Perplexity — unavailable as deferred tool in this session
