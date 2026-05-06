# Feature: yellow-codex Plugin — OpenAI Codex CLI Wrapper

> **Status: Implemented (PR #239, merged)** — Plugin shipped at
> `plugins/yellow-codex/`. Subsequent fixes: PEM-block redaction
> (`723b777d`), bot review comments (`a674bf2e`), `background: true`
> frontmatter (`525ccf12`).

## Problem Statement

### Current Pain Points

Claude Code's review and work execution workflows are single-model. There is no
mechanism for a second AI to independently review Claude's output or provide an
alternative perspective on stuck tasks. When `review:pr` runs, all agents use
Claude — a single-model blind spot means systematic issues go undetected.

### User Impact

Users who also have OpenAI Codex CLI installed have no way to leverage it within
their yellow-plugins workflows. They must manually invoke `codex` in a separate
terminal, copy context back and forth, and mentally merge findings. This is
high-friction and error-prone.

### Business Value

Adding Codex as a supplementary reviewer provides genuine multi-model diversity
in code review. The "multi-bot convergence" signal (documented in MEMORY.md as
0% false positive rate when 3+ bots agree) becomes achievable when Codex joins
the existing Claude-based review agents. For rescue tasks, Codex's sandbox model
(full repo access, can run tests) provides an independent debugging path.

## Proposed Solution

### High-Level Architecture

A new `yellow-codex` marketplace plugin that:

1. **Wraps the Codex CLI** (`codex exec`, `codex exec review`) — no app-server
   or MCP server dependency
2. **Provides spawnable agents** that existing workflows (`review:pr`,
   `workflows:work`) can invoke via Task tool
3. **Ships phased**: review first (Phase 1), rescue/execution (Phase 2),
   research/analysis (Phase 3)
4. **Degrades gracefully** — all existing workflows work identically without it

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI interface | `codex exec` + `codex exec review` | Stable public API, no TTY needed, `--json` for structured output |
| Agent discovery | Patch `yellow-review` to add conditional codex-reviewer | Matches existing cross-plugin pattern; ToolSearch does not discover agents |

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — `review-pr.md` Step 4 ("Adaptive Agent Selection")
> lists cross-plugin agents directly: `security-sentinel`,
> `architecture-strategist`, `performance-oracle`,
> `pattern-recognition-specialist`, `code-simplicity-reviewer`. These are
> spawned "via Task tool" when conditions match. No dynamic discovery via
> ToolSearch. Adding `codex-reviewer` requires adding it to this explicit list.
> Step 3c already has "Discover enhanced tools (optional)" for morph/warpgrep —
> a similar Step 3d could be added for codex availability detection, or it can
> be folded into Step 4's selection logic directly.
<!-- /deepen-plan -->
| Auth detection | `OPENAI_API_KEY` env var OR `codex login` OAuth | CLI supports both; no `CODEX_API_KEY` exists |
| Review invocation | `codex exec review --base <branch>` native subcommand | Built-in diff extraction, better quality than manual prompt injection |
| Output parsing | `--json` JSONL events + `-o <file>` for final message | Robust structured output, no fragile regex parsing |

<!-- deepen-plan: external -->
> **Research:** Codex has a **built-in review output schema** (`codex-rs/core/review_prompt.md`)
> with `findings[].priority` (0=highest/P1, 3=nit), `confidence_score` (0.0-1.0),
> `code_location.absolute_file_path` + `line_range`, `overall_correctness`,
> and `overall_explanation`. Consider using this built-in schema instead of a
> custom one, and mapping `priority` 0→P1, 1→P2, 2→P3, 3→nit. The JSONL event
> stream uses `method`/`params` format — final review text lives in the
> `exitedReviewMode` item's `review` field within `item/completed` event. An
> older format variant uses `type` instead of `method` — wrapper should handle
> both. See: [Codex CLI Reference](https://developers.openai.com/codex/cli/reference)
<!-- /deepen-plan -->
| Sandbox mode | `read-only` for review, `workspace-write` for rescue only | Principle of least privilege |
| Default model | `gpt-5.4` (user-configurable) | Current recommended default per OpenAI docs |
| Session persistence | `--ephemeral` for review/analysis, non-ephemeral for rescue | Prevent session file accumulation; rescue may want resume |
| Config format | Plugin config at `.claude/codex-config.json`; Codex native config at `~/.codex/config.toml` | TOML for Codex, JSON for plugin preferences |

### Trade-offs Considered

- **CLI vs App-Server**: App-server gives richer streaming/session management
  but adds process lifecycle complexity. CLI is simpler and sufficient for
  fire-and-forget review/rescue.
- **CLI vs MCP Server**: `codex mcp-server` would give structured tool calls
  but is experimental. Can revisit in Phase 3 if CLI parsing proves fragile.
- **Patch yellow-review vs new discovery mechanism**: Patching is simpler and
  matches the existing `yellow-core` agent pattern. A new discovery protocol
  would be over-engineering for one agent.

## Implementation Plan

### Phase 1: Foundation — Plugin Scaffold + Setup

#### Task 1.1: Create plugin directory structure

Create `plugins/yellow-codex/` with all required files:

```text
plugins/yellow-codex/
  .claude-plugin/
    plugin.json
  package.json
  CHANGELOG.md
  CLAUDE.md
  commands/
    codex/
      setup.md
  skills/
    codex-patterns/
      SKILL.md
  scripts/
    install-codex.sh
```

**Files to create:**

- `plugins/yellow-codex/.claude-plugin/plugin.json` — Manifest:
  ```json
  {
    "name": "yellow-codex",
    "version": "0.1.0",
    "description": "OpenAI Codex CLI wrapper with review, rescue, and analysis agents for workflow integration",
    "author": {
      "name": "KingInYellows",
      "url": "https://github.com/KingInYellows"
    },
    "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-codex",
    "repository": "https://github.com/KingInYellows/yellow-plugins",
    "license": "MIT",
    "keywords": ["codex", "openai", "code-review", "ai-agent", "rescue", "analysis"]
  }
  ```
- `plugins/yellow-codex/package.json` — Version source of truth (0.1.0)
- `plugins/yellow-codex/CHANGELOG.md` — Empty initial changelog
- `plugins/yellow-codex/CLAUDE.md` — Plugin documentation (model after
  yellow-semgrep/yellow-devin CLAUDE.md structure)

<!-- deepen-plan: codebase -->
> **Codebase:** `package.json` convention is minimal: `{"name": "yellow-codex",
> "version": "0.1.0", "private": true, "description": "..."}`. Only 4 fields.
> See `plugins/yellow-composio/package.json` for reference. `schemas/` directory
> is valid — `plugins/yellow-ci/schemas/runner-targets.schema.json` is the
> existing precedent.
<!-- /deepen-plan -->

#### Task 1.2: Create install-codex.sh

Follow `install-ast-grep.sh` convention:

- `set -Eeuo pipefail`, color helpers, cleanup trap
- Detect existing install: `command -v codex && codex --version`
- Check Node >= 22 (hard prerequisite for npm install)
- NVM/fnm-aware install: detect version manager, use appropriate prefix
- Install: `npm install -g @openai/codex`
- macOS: detect `brew` and offer `brew install --cask codex` as alternative
- Verify installation: `command -v codex && codex --version`
- Pin minimum version check (v0.118.0+ for stable `codex exec review`)

<!-- deepen-plan: codebase -->
> **Codebase:** Follow `install-ast-grep.sh` pattern exactly: `set -Eeuo pipefail`,
> color helpers (`RED/GREEN/YELLOW/NC`), `cleanup()` trap, detect existing
> install first, NVM/fnm-aware detection checks if npm prefix matches version
> manager dir (not just NVM_DIR existence). On permission errors only, fall back
> to `--prefix ~/.local`. Version manager detection uses `npm prefix -g` + grep
> against `$NVM_DIR` or `.nvm` path. See `plugins/yellow-research/scripts/install-ast-grep.sh`
> lines 98-115 for the exact pattern.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Codex CLI also offers **standalone binaries on GitHub Releases**
> (no Node dependency). On macOS, `brew install --cask codex` is an alternative.
> The install script should detect macOS + brew available and offer the cask path
> as primary, npm as fallback. Standalone binaries avoid the Node 22 requirement
> entirely.
<!-- /deepen-plan -->

#### Task 1.3: Create /codex:setup command

**Frontmatter:**

```yaml
---
name: codex:setup
description: "Detect Codex CLI, verify OpenAI authentication, and install if needed. Run after first install or when codex commands fail."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---
```

**Workflow:**

1. Check prerequisites: `node` >= 22 (hard), `jq` (soft)
2. Detect Codex binary: `command -v codex` + version check against minimum
3. If missing: AskUserQuestion to install, run `install-codex.sh`
4. Verify authentication (three methods):
   - Check `OPENAI_API_KEY` env var (format: `sk-` or `sk-proj-` prefix)
   - Check `codex login status` for ChatGPT OAuth auth
   - If neither: warn with instructions for both methods
5. Detect Codex config: check `~/.codex/config.toml` (NOT json/yaml)
6. Test invocation: `codex exec --ephemeral -a never -s read-only -m gpt-5.4 "echo test" 2>&1 | head -5`
7. Report summary table

#### Task 1.4: Create codex-patterns skill

**Frontmatter:**

```yaml
---
name: codex-patterns
description: "Codex CLI invocation patterns, output parsing, context injection, approval modes, error handling, and cost estimation conventions. Use when commands or agents need Codex integration context."
user-invokable: false
---
```

**Key sections:**

- **CLI invocation patterns** — Correct flags:
  - Review: `codex exec review --base <branch> -a never -s read-only --json --ephemeral -m <model>`
  - Rescue: `codex exec -a never -s workspace-write --json -m <model> -o <output-file> "<prompt>"`
  - Analysis: `codex exec -a never -s read-only --json --ephemeral -m <model> -o <output-file> "<prompt>"`
- **Approval modes** — `never` (non-interactive), `on-request` (interactive), `untrusted` (prompt before all)
- **Sandbox modes** — `read-only` (review/analysis), `workspace-write` (rescue), `danger-full-access` (never use)
- **Model selection** — `gpt-5.4` (default), `gpt-5.4-mini` (fast/cheap), `gpt-5.3-codex` (1M context)
- **Output parsing** — JSONL event parsing (`--json`), `item.completed` events with `type: "agent_message"`, `-o <file>` for final message capture
- **`--output-schema`** — JSON Schema enforcement for structured responses (e.g., review findings schema)
- **Error handling catalog** — exit codes, timeout (124), rate limit (429), auth errors
- **Context injection protocol** — CLAUDE.md truncation, diff limits, injection fencing
- **Cost estimation** — ~4 chars/token heuristic, per-model pricing notes
- **Auth methods** — `OPENAI_API_KEY` env var, `codex login` OAuth, `~/.codex/auth.json`

### Phase 2: Review Integration

#### Task 2.1: Create /codex:review command

**Frontmatter:**

```yaml
---
name: codex:review
description: "Invoke Codex CLI to review current diff or a PR. Produces structured findings in P1/P2/P3 format. Use as standalone review or to get a second opinion alongside review:pr."
argument-hint: '[PR# | branch | --staged]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
skills:
  - codex-patterns
---
```

**Workflow:**

1. Resolve target: `--staged` (git diff --cached), PR# (gh pr diff), branch
   (git diff main...), empty (current branch vs base)
2. Determine base branch for `codex exec review --base <ref>`
3. Create output schema file for structured findings:
   ```json
   {
     "type": "object",
     "properties": {
       "findings": {
         "type": "array",
         "items": {
           "type": "object",
           "properties": {
             "severity": { "enum": ["P1", "P2", "P3"] },
             "category": { "type": "string" },
             "file": { "type": "string" },
             "line": { "type": "integer" },
             "finding": { "type": "string" },
             "fix": { "type": "string" }
           },
           "required": ["severity", "category", "file", "finding"]
         }
       },
       "summary": { "type": "string" }
     },
     "required": ["findings", "summary"]
   }
   ```

<!-- deepen-plan: external -->
> **Research:** Codex has a **built-in review schema** in
> `codex-rs/core/review_prompt.md` that returns: `findings[].title` (80 chars,
> imperative), `findings[].body` (markdown), `findings[].confidence_score`
> (0.0-1.0), `findings[].priority` (0-3, where 0=highest), and
> `findings[].code_location.absolute_file_path` + `line_range.start/end`.
> Also includes `overall_correctness` ("patch is correct"|"patch is incorrect")
> and `overall_confidence_score`. **Consider using the built-in schema** (no
> `--output-schema` needed) and mapping: priority 0→P1, priority 1→P2,
> priority 2-3→P3. This avoids the **known bug** where `--output-schema` is
> reportedly ignored with some model variants. If custom schema is needed,
> explicitly use `gpt-5.4` model.
<!-- /deepen-plan -->
4. Invoke Codex with native review subcommand:
   ```bash
   codex exec review \
     --base "$BASE_REF" \
     -a never \
     -s read-only \
     --ephemeral \
     --json \
     -m "${CODEX_MODEL:-gpt-5.4}" \
     --output-schema "$SCHEMA_FILE" \
     -o "$OUTPUT_FILE" \
     --title "Review for $TARGET"
   ```
5. Parse output file (JSON conforming to schema)
6. Format as P1/P2/P3 findings matching yellow-review convention
7. Report with source tag: `[codex]`

#### Task 2.2: Create review findings JSON schema

Create `plugins/yellow-codex/schemas/review-findings.json` with the structured
output schema for Codex review responses. This schema is passed to
`--output-schema` to enforce consistent response structure.

#### Task 2.3: Create codex-reviewer agent

**Frontmatter:**

```yaml
---
name: codex-reviewer
description: "Supplementary code reviewer using OpenAI Codex CLI. Provides independent second-opinion review findings in P1/P2/P3 format. Spawned by review:pr when yellow-codex is installed."
model: inherit
tools:
  - Bash
  - Read
  - Grep
  - Glob
skills:
  - codex-patterns
---
```

**Behavior:**

- Receives: diff content, PR title, base branch, CLAUDE.md excerpt
- Invokes `codex exec review --base <branch>` with `--output-schema` and `-o`
- Parses structured JSON output
- Returns P1/P2/P3 findings to spawning command
- Report-only: never edits files, never calls AskUserQuestion
- Wraps all Codex output in injection fences before returning

**Spawning pattern** (from review:pr):

```text
Task(subagent_type="yellow-codex:review:codex-reviewer",
     prompt="Review this PR for bugs, security issues, and quality...")
```

#### Task 2.4: Patch yellow-review for codex-reviewer discovery

**Files to modify:**

- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — Add
  `codex-reviewer` to cross-plugin agent references section
- `plugins/yellow-review/commands/review/review-pr.md` — Add conditional
  codex-reviewer spawning in the agent selection step (Step 4/5):
  - Condition: large PR (>100 lines) AND user preference allows
  - Spawn via `Task(subagent_type="yellow-codex:review:codex-reviewer")`
  - Graceful degradation: if agent not found (yellow-codex not installed), skip
  - Run in parallel with other review agents

**Change scope:** Minimal — add ~10-15 lines to each file. Does not change
existing agent selection logic, only adds a new optional agent.

<!-- deepen-plan: codebase -->
> **Codebase:** Verified insertion point: `review-pr.md` Step 4 lines list
> cross-plugin agents after the always-included `code-reviewer` +
> `code-simplifier`. The list is: `pr-test-analyzer`, `comment-analyzer`,
> `type-design-analyzer`, `silent-failure-hunter` (conditional), then
> `security-sentinel`, `architecture-strategist`, `performance-oracle`,
> `pattern-recognition-specialist`, `code-simplicity-reviewer` (cross-plugin via
> Task tool). Add `codex-reviewer` as a new cross-plugin entry with condition:
> "when yellow-codex is installed AND PR > 100 lines changed". Step 5 already
> launches "all selected agents... in parallel via Task tool" — no change needed
> there. The `pr-review-workflow/SKILL.md` cross-plugin section (lines 189-196)
> shows the Task spawning pattern: `Task(subagent_type="yellow-core:security-sentinel")`.
> For codex: `Task(subagent_type="yellow-codex:review:codex-reviewer")`.
<!-- /deepen-plan -->

#### Task 2.5: Register in marketplace

**Files to modify:**

- `.claude-plugin/marketplace.json` — Add yellow-codex entry:
  ```json
  {
    "name": "yellow-codex",
    "description": "OpenAI Codex CLI wrapper with review, rescue, and analysis agents for workflow integration",
    "version": "0.1.0",
    "author": { "name": "KingInYellows" },
    "source": "./plugins/yellow-codex",
    "category": "development"
  }
  ```

#### Task 2.6: Validate and test

- Run `pnpm validate:schemas` to verify plugin.json and agent frontmatter
- Run `node scripts/validate-plugin.js plugins/yellow-codex`
- Test `/codex:setup` end-to-end
- Test `/codex:review --staged` on a real diff
- Test `codex-reviewer` agent spawning via Task tool
- Verify graceful degradation: run `review:pr` without yellow-codex installed

### Phase 3: Rescue / Execution

#### Task 3.1: Create /codex:rescue command

**Frontmatter:**

```yaml
---
name: codex:rescue
description: "Delegate a debugging or investigation task to Codex for independent exploration and fix proposal. Use when stuck on a bug, need a fresh perspective, or want parallel investigation."
argument-hint: '<task description>'
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - Glob
  - AskUserQuestion
skills:
  - codex-patterns
---
```

**Workflow:**

1. Validate task description ($ARGUMENTS non-empty, >= 10 chars)
2. Gather context: current branch, recent commits, error logs
3. Invoke Codex with workspace-write sandbox (NOT ephemeral — user may want
   to resume):
   ```bash
   codex exec \
     -a never \
     -s workspace-write \
     --json \
     -m "${CODEX_MODEL:-gpt-5.4}" \
     -o "$OUTPUT_FILE" \
     "$TASK_PROMPT"
   ```
4. Parse output for proposed changes
5. Present to user via AskUserQuestion: "Apply / Review each / Discard"
6. If apply: use Edit tool (not Codex direct write) for controlled application
7. Safety: 5-minute timeout via `timeout 300`

<!-- deepen-plan: external -->
> **Research:** Timeout handling caveat: Codex CLI handles SIGTERM with
> `process.on("SIGTERM", exit)` which triggers graceful shutdown with
> `process.exit(0)`. This means `timeout 300` may report exit 0 instead of a
> distinct timeout code. Use `timeout --signal=TERM --kill-after=10 300 codex
> exec ...` and check for exit 124 (timeout's own signal) or 137 (SIGKILL).
> Exit codes: 0=success, 1=general error (includes 429 rate limits), 2=auth
> failure, 3=config error, 4=model/API error. For rate limits, parse stderr
> for "rate_limit_exceeded" string to distinguish from other exit-1 failures.
<!-- /deepen-plan -->

#### Task 3.2: Create /codex:status command

**Frontmatter:**

```yaml
---
name: codex:status
description: "Check running Codex processes and recent session history. Use to monitor long-running Codex tasks or debug hung processes."
argument-hint: ''
allowed-tools:
  - Bash
---
```

**Workflow:**

1. Check running processes: `pgrep -af codex`
2. Check session files: `ls -lt ~/.codex/sessions/ 2>/dev/null | head -5`
3. Check Codex version: `codex --version`
4. Report summary

#### Task 3.3: Create codex-executor agent

**Frontmatter:**

```yaml
---
name: codex-executor
description: "Debugging and rescue agent using OpenAI Codex CLI. Independently explores codebase and proposes fixes for stuck tasks. Spawned by workflows:work or manually via /codex:rescue."
model: inherit
tools:
  - Bash
  - Read
  - Grep
  - Glob
skills:
  - codex-patterns
---
```

**Critical design choice:** NO `AskUserQuestion` in tools. The executor is
report-only — it returns proposed changes to the spawning command, which handles
user approval. This avoids the `workflows:work` delegation paradox documented
in MEMORY.md.

**Behavior:**

- Receives: task description, error context, relevant file paths
- Invokes Codex in `workspace-write` sandbox mode with `--json` + `-o`
- Parses proposed changes from output
- Returns structured report: analysis + proposed diffs + confidence assessment
- Time-boxed: `timeout 300` (5 minutes)
- Does NOT apply changes — returns them for the caller to apply

#### Task 3.4: Integration with workflows:work

**Files to modify:**

- `plugins/yellow-core/commands/workflows/work.md` — Add optional rescue
  delegation offer when a task fails:
  - After test failure or build break, check if codex-executor is available
  - AskUserQuestion: "Task stuck. Delegate to Codex for investigation?"
  - If yes: spawn `codex-executor` via Task tool
  - Present Codex's proposed fixes
  - AskUserQuestion: "Apply Codex's fixes?"
  - If yes: apply via Edit tool, re-run test

<!-- deepen-plan: codebase -->
> **Codebase:** Verified insertion point: `workflows/work.md` has a test
> failure handler in the implementation loop (around "Run tests scoped to
> changed files. If tests fail:"). For linear topology it stops and asks user;
> for parallel topology it offers "Skip to next item or fix and retry?". The
> rescue offer should be added as a third option in this AskUserQuestion:
> "Skip / Fix and retry / Delegate to Codex". The command already follows a
> graceful degradation pattern for optional plugins (e.g., yellow-linear sync,
> yellow-review) — using "If Skill invocation fails... skip silently" pattern.
> Apply the same pattern: attempt `Task(subagent_type=
> "yellow-codex:workflow:codex-executor")`, if agent not found, skip the option.
<!-- /deepen-plan -->

### Phase 4: Research / Analysis

#### Task 4.1: Create codex-analyst agent

**Frontmatter:**

```yaml
---
name: codex-analyst
description: "Codebase research and analysis agent using OpenAI Codex CLI. Answers questions about code architecture, patterns, and behavior. Spawned by research workflows or invoked directly."
model: inherit
tools:
  - Bash
  - Read
  - Grep
  - Glob
skills:
  - codex-patterns
---
```

**Behavior:**

- Receives: research query, optional file scope
- Invokes Codex in `read-only` sandbox with `--ephemeral`
- Returns structured analysis (not file edits)
- Use cases: architecture questions, pattern analysis, data flow tracing

#### Task 4.2: Optional research integration

- `research:code` can delegate to `codex-analyst` for local codebase questions
- `workflows:brainstorm` can use `codex-analyst` in Phase 2 codebase research
- Both are optional — detection via ToolSearch, graceful skip if not found

### Phase 5: Quality + Documentation

#### Task 5.1: Create CLAUDE.md

Model after `yellow-semgrep/CLAUDE.md` and `yellow-devin/CLAUDE.md`:

- Required environment variables (`OPENAI_API_KEY` or `codex login`)
- CLI prerequisites (Node 22+, `codex` binary)
- Plugin components table
- Conventions (auth handling, sandbox modes, injection fencing)
- Cross-plugin dependencies
- Known limitations
- When-to-use-what table

#### Task 5.2: Create changeset

```bash
pnpm changeset
```

- `yellow-codex`: minor (new plugin)
- `yellow-review`: patch (add optional codex-reviewer spawning)
- `yellow-core`: patch (add optional codex-executor rescue offer)

#### Task 5.3: Version sync and validation

```bash
pnpm validate:schemas
node scripts/validate-plugin.js plugins/yellow-codex
node scripts/validate-agent-authoring.js
```

## Technical Specifications

### Files to Create

| File | Purpose |
|------|---------|
| `plugins/yellow-codex/.claude-plugin/plugin.json` | Plugin manifest |
| `plugins/yellow-codex/package.json` | Version source of truth |
| `plugins/yellow-codex/CHANGELOG.md` | Changelog |
| `plugins/yellow-codex/CLAUDE.md` | Plugin documentation |
| `plugins/yellow-codex/commands/codex/setup.md` | Setup command |
| `plugins/yellow-codex/commands/codex/review.md` | Review command |
| `plugins/yellow-codex/commands/codex/rescue.md` | Rescue command |
| `plugins/yellow-codex/commands/codex/status.md` | Status command |
| `plugins/yellow-codex/agents/review/codex-reviewer.md` | Review agent |
| `plugins/yellow-codex/agents/workflow/codex-executor.md` | Executor agent |
| `plugins/yellow-codex/agents/research/codex-analyst.md` | Analysis agent |
| `plugins/yellow-codex/skills/codex-patterns/SKILL.md` | Shared skill |
| `plugins/yellow-codex/schemas/review-findings.json` | Output schema |
| `plugins/yellow-codex/scripts/install-codex.sh` | Binary installer |

### Files to Modify

| File | Change |
|------|--------|
| `.claude-plugin/marketplace.json` | Add yellow-codex entry |
| `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` | Add codex-reviewer to cross-plugin refs |
| `plugins/yellow-review/commands/review/review-pr.md` | Add conditional codex-reviewer spawning |
| `plugins/yellow-core/commands/workflows/work.md` | Add optional codex-executor rescue offer |

### Correct CLI Invocations (Verified)

**Review (read-only):**
```bash
codex exec review \
  --base "$BASE_REF" \
  -a never \
  -s read-only \
  --ephemeral \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  --output-schema "$SCHEMA_FILE" \
  -o "$OUTPUT_FILE"
```

**Rescue (write-capable):**
```bash
timeout 300 codex exec \
  -a never \
  -s workspace-write \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  -o "$OUTPUT_FILE" \
  "$TASK_PROMPT"
```

**Analysis (read-only):**
```bash
codex exec \
  -a never \
  -s read-only \
  --ephemeral \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  -o "$OUTPUT_FILE" \
  "$ANALYSIS_PROMPT"
```

### Dependencies

- `@openai/codex` CLI (v0.118.0+) — installed via setup command
- Node.js 22+ — required for CLI npm install
- `OPENAI_API_KEY` env var or `codex login` OAuth — authentication

## Testing Strategy

- **Setup command**: Verify detection of existing install, auth validation
  (API key, OAuth, missing), install script on clean machine
- **Review command**: Test on staged changes, PR number, branch diff, empty diff
- **Agent spawning**: Verify `codex-reviewer` spawns from `review:pr` and
  returns structured findings; verify graceful skip when not installed
- **Rescue command**: Test with real error context, verify suggest mode,
  verify timeout
- **Validation**: `pnpm validate:schemas` passes with all new files

## Acceptance Criteria

1. `/codex:setup` detects binary, validates auth (API key + OAuth), installs if
   needed
2. `/codex:review` produces P1/P2/P3 findings via `codex exec review`
3. `codex-reviewer` agent spawns from `review:pr` in parallel with other agents
4. `review:pr` works identically without `yellow-codex` installed (graceful
   degradation)
5. `/codex:rescue` delegates tasks with 5-minute timeout and user approval gate
6. `codex-executor` returns proposed fixes without blocking on AskUserQuestion
7. All validation passes: `pnpm validate:schemas`
8. Marketplace entry registered and version-synced

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Codex CLI not installed | `/codex:setup` offers install; other commands report and suggest setup |
| No auth (neither API key nor OAuth) | Setup warns; commands fail with clear message |
| ChatGPT OAuth expired | Suggest `codex login` to re-authenticate |
| `codex exec review` on empty diff | Detect empty diff before invoking, report "No changes to review" |
| Codex timeout (5 min) | `timeout 300` may return exit 0 (Codex handles SIGTERM gracefully), 124 (child ignored SIGTERM), or 137 (killed by SIGKILL after `--kill-after`); see detailed guidance in Phase 3 Task 3.1 timeout handling section |
| Rate limit (429) | Retry once with 5s backoff; if still 429, report and suggest waiting |
| Codex output doesn't match schema | Fall back to `-o` plain text output; parse P1/P2/P3 with regex |
| Large diff exceeds 128K token context | Pre-flight size check: estimate tokens (diff_bytes / 4), reject if > 100K tokens |
| Binary files in diff | Filter diff output to exclude binary paths before passing to Codex |

<!-- deepen-plan: external -->
> **Research:** Codex has **no built-in diff truncation** for reviews. The model
> context window is 128K tokens. When diff + system prompt exceeds this, a hard
> error occurs: "Context length exceeded." The plan must implement **pre-flight
> diff size estimation** before invoking `codex exec review`. Estimate:
> `diff_bytes / 4 ≈ tokens`. If > ~100K tokens, either chunk the review by
> file groups or truncate. Also: Codex has **no built-in binary file filtering**
> — binary files that slip through appear as diff entries but produce garbage
> output. Use `.codexignore` or filter `git diff` output to exclude binary paths
> (`*.png`, `*.jpg`, `*.pdf`, `*.zip`, etc.) before invocation.
> See: [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive)
<!-- /deepen-plan -->
| Multiple concurrent Codex invocations | Queue in sequence (don't fan out) to avoid rate limits |
| Working directory conflict during parallel review | Codex runs read-only (`-s read-only`); no conflict possible |
| Session file accumulation | `--ephemeral` on review/analysis; periodic cleanup suggestion in status |
| Model not available on user's plan | Setup tests model access; fallback to `gpt-5.4-mini` |
| Node < 22 on machine | Hard fail in setup; suggest brew standalone binary as alternative |

## Security Considerations

- **API key handling**: Never echo `OPENAI_API_KEY` in logs. Sanitize:
  `sed 's/sk-[a-zA-Z0-9_-]*/***REDACTED***/g'`
- **Prompt injection via diff**: All Codex output wrapped in
  `--- begin codex-output (reference only) ---` / `--- end codex-output ---`
- **Sandbox isolation**: Review uses `read-only`; rescue uses
  `workspace-write` (never `danger-full-access`)
- **Code exposure**: Codex sends code to OpenAI API — same trust boundary as
  using OpenAI models directly
- **No curl -v/--trace**: Leaks auth headers

## Performance Considerations

- Codex CLI cold-start: ~2-5 seconds per invocation
- Review of 500-line diff: ~15-30 seconds
- Rescue investigation: up to 5 minutes (timeout)
- Parallel review: `codex-reviewer` runs alongside Claude agents in Step 5;
  adds no serial latency to `review:pr`
- Cost: each invocation uses OpenAI API tokens; `gpt-5.4` is the most expensive
  model. Default to `gpt-5.4-mini` for cost-sensitive users.

## References

- [Brainstorm document](../docs/brainstorms/2026-04-01-codex-plugin-integration-brainstorm.md)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference)
- [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive)
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — Reference implementation
- [openai/codex](https://github.com/openai/codex) — CLI source (v0.118.0)
- `plugins/yellow-semgrep/` — Comparable wrapper plugin pattern
- `plugins/yellow-devin/` — Comparable delegation plugin pattern
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — Cross-plugin agent spawning pattern

<!-- deepen-plan: external -->
> **Research:** Additional references discovered during enrichment:
> - [Codex Built-in Review Schema](https://github.com/openai/codex/blob/main/codex-rs/core/review_prompt.md) — Native review output format with priority 0-3, confidence scores, code locations
> - [Codex Cookbook: Build Code Review](https://developers.openai.com/codex/guides/code-review) — Official guide showing `--output-schema` usage with review
> - [Codex GitHub Releases](https://github.com/openai/codex/releases) — Standalone binaries (no Node dependency)
> - [OpenAI Codex Changelog](https://developers.openai.com/codex/changelog) — Track CLI flag changes across versions
> - `plugins/yellow-research/scripts/install-ast-grep.sh` — NVM/fnm-aware install script template
> - `plugins/yellow-ci/schemas/runner-targets.schema.json` — Precedent for `schemas/` directory in plugins
<!-- /deepen-plan -->
