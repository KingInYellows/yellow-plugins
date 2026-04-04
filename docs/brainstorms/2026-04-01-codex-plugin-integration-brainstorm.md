# Codex Plugin Integration Brainstorm

**Date:** 2026-04-01
**Status:** Complete
**Approach:** B (Workflow-Integrated Wrapper) -- commands + agents + skills, CLI-based

## What We're Building

A new plugin (`yellow-codex`) that wraps the OpenAI Codex CLI (`codex`) as a
first-class participant in the yellow-plugins workflow ecosystem. Codex runs as a
secondary AI agent invoked through CLI commands, providing supplementary code
review, debugging/rescue capabilities, and codebase research/analysis.

The plugin follows the same wrapper pattern as `yellow-composio` and
`yellow-devin`: it does not bundle the underlying tool but provides setup
validation, structured invocation commands, spawnable agents for cross-plugin
integration, and a shared skill documenting CLI patterns and output parsing.

### Core Principle

Codex is an **enhancement, never a dependency**. All existing workflows
(`review:pr`, `workflows:work`, `research:code`) function identically without
`yellow-codex` installed. When present, Codex provides a second opinion on
reviews, a rescue path for stuck tasks, and an alternative research lens.

## Why This Approach

**Approach B (Workflow-Integrated Wrapper)** was selected over:

- **Approach A (Standalone Commands Only):** Too isolated -- Codex would only be
  usable via explicit `/codex:*` commands, with no integration into existing
  review or work loops.
- **Approach C (Deep Integration / Patch Existing Plugins):** Too invasive --
  modifying `yellow-review` and `yellow-core` directly creates tight coupling,
  version coordination headaches, and breaks the "optional enhancement" principle.

Approach B provides full workflow integration through the existing cross-plugin
agent spawning mechanism (Task tool with subagent_type) while keeping all Codex
logic contained within `yellow-codex`. This matches the proven pattern used by
`yellow-review` (cross-plugin agents from `yellow-core`) and `yellow-devin`
(orchestrator agent delegating to external service).

## Key Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Integration model | Wrapper plugin | Self-contained, no patching of existing plugins |
| 2 | Auto-install | Marketplace entry | Standard `plugin marketplace add` flow |
| 3 | Binary install | Setup command with auth verification | Follows `yellow-semgrep`, `yellow-research` convention |
| 4 | Workflow integration | All, phased | Review first, then execution rescue, then research |
| 5 | Process lifecycle | Hybrid (CLI + optional daemon) | CLI for review/analysis, daemon mode for long execution tasks |
| 6 | Plugin coexistence | Selective override | Workflow commands only, not wholesale replacement |
| 7 | Architecture | Workflow-Integrated Wrapper | Commands + agents + skills, CLI invocation |

---

## Plugin Structure

### File Tree

```text
plugins/yellow-codex/
  .claude-plugin/
    plugin.json
  .gitattributes
  package.json
  CHANGELOG.md
  CLAUDE.md
  commands/
    codex/
      setup.md          # /codex:setup -- detect, auth, install
      review.md         # /codex:review -- invoke Codex review on diff/PR
      rescue.md         # /codex:rescue -- delegate debugging task to Codex
      status.md         # /codex:status -- check Codex process/job state
  agents/
    review/
      codex-reviewer.md       # Spawnable from review:pr as supplementary reviewer
    workflow/
      codex-executor.md       # Spawnable from workflows:work for rescue/debug
    research/
      codex-analyst.md        # Spawnable for codebase research/analysis
  skills/
    codex-patterns/
      SKILL.md                # CLI invocation, output parsing, context injection
  scripts/
    install-codex.sh          # Binary installer (NVM-aware Node install)
```

### plugin.json

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

### Component Inventory

| Type | Name | Purpose | Phase |
|------|------|---------|-------|
| Command | `/codex:setup` | Binary detection, auth verification, install | 1 |
| Command | `/codex:review` | Invoke Codex review on current diff/PR | 1 |
| Command | `/codex:rescue` | Delegate debugging/investigation to Codex | 2 |
| Command | `/codex:status` | Check running Codex jobs/processes | 2 |
| Agent | `codex-reviewer` | Supplementary reviewer for review:pr | 1 |
| Agent | `codex-executor` | Rescue/debug agent for workflows:work | 2 |
| Agent | `codex-analyst` | Codebase research and analysis | 3 |
| Skill | `codex-patterns` | Shared CLI patterns, output parsing, context injection | 1 |
| Script | `install-codex.sh` | Binary installer following repo convention | 1 |

---

## Component Details

### `/codex:setup` -- Setup Command

**Purpose:** Detect Codex CLI binary, verify OpenAI authentication, and
optionally install if missing.

**Frontmatter:**

```yaml
---
name: codex:setup
description: "Detect Codex CLI, verify OpenAI API authentication, and install if needed. Run after first install or when codex commands fail."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---
```

**Workflow:**

1. **Check prerequisites:**
   - `jq` installed (soft prereq -- warn and continue if missing)
   - `node` installed with version >= 22 (hard prereq for Codex CLI)

2. **Detect binary:**
   ```bash
   if command -v codex >/dev/null 2>&1; then
     codex_version=$(codex --version 2>/dev/null || echo "unknown")
     printf '[yellow-codex] codex: ok (%s)\n' "$codex_version"
   else
     printf '[yellow-codex] codex: not found\n'
   fi
   ```

3. **Install if missing:**
   - AskUserQuestion: "Codex CLI not found. Install it?" [Yes / No]
   - If yes: run `scripts/install-codex.sh`
   - Install method: `npm install -g @openai/codex` (NVM-aware, with
     `--prefix ~/.local` fallback when NVM is not detected)

4. **Verify authentication:**
   ```bash
   # Check OPENAI_API_KEY is set
   if [ -z "${OPENAI_API_KEY:-}" ]; then
     printf '[yellow-codex] Warning: OPENAI_API_KEY not set\n'
     printf '  Set in ~/.zshrc: export OPENAI_API_KEY="sk-..."\n'
   else
     # Verify key works with a minimal API call
     http_status=$(curl -s -o /dev/null -w '%{http_code}' \
       -H "Authorization: Bearer ${OPENAI_API_KEY}" \
       https://api.openai.com/v1/models)
     if [ "$http_status" = "200" ]; then
       printf '[yellow-codex] OpenAI auth: ok\n'
     else
       printf '[yellow-codex] OpenAI auth: failed (HTTP %s)\n' "$http_status"
     fi
   fi
   ```

5. **Check Codex configuration:**
   - Detect `~/.codex/config.toml` if Codex uses a config file
   - Report model preference, approval mode, and any custom settings

6. **Report results:**
   ```text
   yellow-codex Setup Results
   ==============================
   Prerequisites:  node [ok v22.x] | jq [ok|missing (degraded)]
   Codex CLI:      installed (v1.x.x) | not installed
   OpenAI Auth:    ok | failed | not configured
   Config:         default | custom (~/.codex/config.toml)
   ==============================
   Setup complete. Run /codex:review to test.
   ```

### `/codex:review` -- Review Command

**Purpose:** Invoke Codex CLI to review the current diff or a specific PR,
producing structured findings compatible with the yellow-review output format.

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
---
```

**Workflow:**

1. **Resolve target:**
   - `--staged`: Review staged changes (`git diff --cached`)
   - PR number: Fetch diff via `gh pr diff <PR#>`
   - Branch: Diff against base (`git diff main...<branch>`)
   - Empty: Diff current branch against base

2. **Prepare context:**
   - Read CLAUDE.md from project root
   - Read plan file if referenced in PR body
   - Collect changed file list and gross line count
   - Build Codex prompt with review instructions and diff

3. **Invoke Codex CLI:**
   ```bash
   # Write diff to temp file for context injection
   DIFF_FILE=$(mktemp)
   git diff "${BASE}...HEAD" > "$DIFF_FILE"

   # Invoke Codex in non-interactive mode
   codex exec review \
     --full-auto \
     --sandbox workspace-write \
     --model gpt-5.4-mini \
     "Review the following code diff for bugs, security issues, and quality problems. \
      Report each finding as: **[P1|P2|P3] category -- file:line** \
      Finding: <issue> Fix: <suggestion>. \
      Project conventions: $(head -c 2000 CLAUDE.md 2>/dev/null || echo 'none'). \
      Diff: $(cat "$DIFF_FILE")"

   rm -f "$DIFF_FILE"
   ```

4. **Parse output:**
   - Extract structured findings from Codex response
   - Normalize to P1/P2/P3 format matching yellow-review convention
   - Wrap Codex output in injection fence for safety

5. **Report findings:**
   - Summary count: "Codex found X P1, Y P2, Z P3 issues"
   - Each finding in standard format
   - Note: "These findings are from Codex (OpenAI). Cross-reference with
     review:pr findings for convergence analysis."

### `/codex:rescue` -- Rescue Command

**Purpose:** Delegate a stuck debugging or investigation task to Codex, which
can independently explore the codebase and propose fixes.

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
---
```

**Workflow:**

1. **Validate task description:**
   - $ARGUMENTS must be non-empty (at least 10 chars)
   - If empty, AskUserQuestion: "What task should Codex investigate?"

2. **Gather context:**
   - Current branch and recent commits
   - Error logs or test output if referenced
   - Relevant file paths mentioned in the task

3. **Invoke Codex in sandbox mode:**

   ```bash
   codex exec \
     -a suggest \
     -s read-only \
     -m gpt-5.4-mini \
     "$TASK_DESCRIPTION"
   ```

   - `suggest` approval mode: Codex proposes changes but does not apply them
   - Capture all proposed file edits and explanations

4. **Present results:**
   - Show Codex's analysis and proposed changes
   - AskUserQuestion: "Apply these changes?" [Apply all / Review each / Discard]
   - If apply: apply changes via Edit tool (not Codex direct write)

5. **Safety guardrails:**
   - Never run Codex with `full-auto` approval mode for rescue tasks
   - Time-box: 5 minute max wall-clock for Codex execution
   - Token budget: Log estimated token usage

### `/codex:status` -- Status Command

**Purpose:** Check the state of any running or recent Codex processes/jobs.

**Frontmatter:**

```yaml
---
name: codex:status
description: "Check running Codex processes and recent job history. Use to monitor long-running Codex tasks or debug hung processes."
argument-hint: ''
allowed-tools:
  - Bash
---
```

**Workflow:**

1. **Check for running Codex processes:**
   ```bash
   pgrep -af codex 2>/dev/null || echo "No Codex processes running"
   ```

2. **Check Codex logs** (if log directory exists):
   ```bash
   CODEX_LOG_DIR="${HOME}/.codex/logs"
   if [ -d "$CODEX_LOG_DIR" ]; then
     ls -lt "$CODEX_LOG_DIR" | head -5
   fi
   ```

3. **Report summary:**
   ```text
   yellow-codex Status
   ==============================
   Running processes: N
   Recent logs:       [list]
   CLI version:       vX.X.X
   ==============================
   ```

---

### `codex-reviewer` Agent

**Purpose:** Spawnable agent that `review:pr` can invoke as a supplementary
reviewer via Task tool, providing a second AI perspective on code changes.

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
---
```

**Behavior:**

- Receives PR diff, title, body, and CLAUDE.md as context from spawning command
- Invokes `codex` CLI in full-auto quiet mode with review prompt
- Parses output into structured P1/P2/P3 findings
- Returns findings to spawning command for aggregation
- Does NOT edit files -- report only (matches yellow-review agent convention)
- Wraps all Codex CLI output in injection fences before returning

**Integration with review:pr:**

The `review:pr` command explicitly includes `codex-reviewer` as an optional
supplementary reviewer during Step 4 (Adaptive Agent Selection) via the
Task-based subagent selection mechanism. It runs in parallel with other
selected agents in Step 5 (Pass 1). Its findings are merged into the
aggregated results in Step 6 alongside findings from built-in agents.

### `codex-executor` Agent

**Purpose:** Spawnable agent for debugging and rescue tasks, invoked from
`workflows:work` when implementation hits a blocker.

**Frontmatter:**

```yaml
---
name: codex-executor
description: "Debugging and rescue agent using OpenAI Codex CLI. Independently explores codebase and proposes fixes for stuck tasks. Spawned by workflows:work or manually via /codex:rescue."
model: inherit
tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---
```

**Behavior:**

- Receives task description, error context, and relevant file paths
- Invokes Codex in `suggest` mode for investigation
- Presents proposed changes to the spawning command
- Can apply changes only after explicit confirmation
- Time-boxed to 5 minutes wall-clock per invocation
- Reports token/cost estimate for the Codex invocation

### `codex-analyst` Agent

**Purpose:** Codebase research and analysis agent using Codex's understanding
of code semantics.

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
---
```

**Behavior:**

- Receives research query and optional file scope
- Invokes Codex with analysis-focused prompt
- Returns structured analysis (not file edits)
- Useful for: "How does module X interact with module Y?", "What pattern does
  this codebase use for error handling?", "Trace the data flow from input to
  output in feature Z"

---

### `codex-patterns` Skill

**Purpose:** Shared reference for Codex CLI invocation patterns, output parsing,
context injection, and error handling. Loaded by commands and agents.

**Frontmatter:**

```yaml
---
name: codex-patterns
description: "Codex CLI invocation patterns, output parsing, context injection, approval modes, error handling, and cost estimation conventions. Use when commands or agents need Codex integration context."
user-invokable: false
---
```

**Contents:**

#### CLI Invocation Patterns

```bash
# Review mode (read-only analysis)
codex exec review \
  --full-auto \
  --sandbox workspace-write \
  --model gpt-5.4-mini \
  "<prompt>"

# Suggest mode (proposes changes, does not apply)
codex exec review \
  --sandbox workspace-write \
  --model gpt-5.4-mini \
  "<prompt>"

# Full-auto mode (applies changes -- use only with guardrails)
codex exec review \
  --full-auto \
  --sandbox workspace-write \
  --model gpt-5.4-mini \
  "<prompt>"
```

#### Approval Modes

| Mode | Behavior | When to Use |
|------|----------|-------------|
| `suggest` | Proposes changes, does not apply | Rescue/debug tasks, first-time analysis |
| `auto-edit` | Applies file edits, asks before commands | Trusted review fix application |
| `full-auto` | Applies all changes autonomously | Review-only prompts (no edits expected) |

#### Model Selection

| Model | Speed | Cost | When to Use |
|-------|-------|------|-------------|
| `codex-mini` | Fast | Low | Standard review, quick analysis |
| `o4-mini` | Medium | Medium | Complex debugging, deeper analysis |
| `o3` | Slow | High | Architecture-level research (Phase 3) |

Default to `codex-mini` for all Phase 1 operations. Escalate model selection
based on task complexity in Phase 2+.

#### Output Parsing

Codex CLI outputs to stdout. Key patterns:

- **Finding extraction:** Parse lines matching `**[P1|P2|P3]` pattern
- **Proposed edits:** Look for file path + diff-like output blocks
- **Error conditions:** Non-zero exit code, stderr output, timeout

```bash
# Capture Codex output with timeout
CODEX_OUTPUT=$(timeout 300 codex exec \
  -a full-auto \
  --quiet \
  -m gpt-5.4-mini \
  "$PROMPT" 2>&1) || {
  codex_exit=$?
  if [ "$codex_exit" -eq 124 ]; then
    printf '[yellow-codex] Error: Codex timed out after 5 minutes\n'
  else
    printf '[yellow-codex] Error: Codex exited with code %d\n' "$codex_exit"
  fi
}
```

#### Context Injection Pattern

When passing context to Codex, follow this structure:

```text
Project conventions (from CLAUDE.md):
<first 2000 chars of CLAUDE.md>

PR metadata:
Title: <title>
Files changed: <count>

Code diff:
<diff content, truncated to 50000 chars>

Instructions:
<task-specific prompt>
```

Truncation limits:
- CLAUDE.md: 2000 chars
- Diff: 50000 chars (Codex has its own context limits)
- Plan files: 5000 chars
- Error logs: 3000 chars

#### Error Handling Catalog

| Error | Recovery |
|-------|----------|
| `codex` not found | Run `/codex:setup` |
| OPENAI_API_KEY not set | Report, suggest setup |
| 401 Unauthorized | API key expired or invalid |
| 429 Rate Limited | Wait and retry once, then report |
| Timeout (exit 124) | Report, suggest smaller scope |
| Non-zero exit | Log stderr, report to user |
| Empty output | Retry once, then report |

#### Cost Estimation

Codex CLI does not report token usage directly. Estimate based on:

- Input: ~4 chars per token, so diff size / 4 = approx input tokens
- Output: typically 500-2000 tokens per review
- Cost: varies by model (see OpenAI pricing)

Log estimated costs but never hard-block -- the user owns their budget.

---

## Integration Touchpoints

### How review:pr Spawns codex-reviewer

The integration follows the existing cross-plugin agent pattern used by
`review:pr` for `yellow-core` agents (security-sentinel, architecture-strategist,
etc.):

1. **Selection (Step 4 -- Adaptive Agent Selection):**
   ```text
   Task(subagent_type="yellow-codex:review:codex-reviewer")
   ```
   If plugin not installed: skip Codex review path silently (graceful degradation).

2. **Selection (Step 4):**
   Add `codex-reviewer` to the agent pool as an optional supplementary reviewer.
   Selection heuristic:
   - Always include when available (provides independent second opinion)
   - OR: include only for PRs with 100+ lines changed (to avoid cost on trivial PRs)
   - User-configurable via AskUserQuestion on first use: "Always include Codex
     review, or only for large PRs?" (preference persisted in `.claude/codex-config.json`)

3. **Execution (Step 5):**
   Spawn via Task tool with `subagent_type: "yellow-codex:review:codex-reviewer"`.
   Pass: diff, title, body, CLAUDE.md, file list.
   Runs in parallel with all other selected agents.

4. **Aggregation (Step 6):**
   Codex findings merged into the unified finding list. Findings tagged with
   `[codex]` source marker. Multi-agent convergence analysis: when Codex and a
   yellow-review agent both flag the same issue, confidence increases (convergence
   signal per MEMORY.md pattern).

### How workflows:work Delegates to codex-executor

The integration is triggered when the work loop encounters a failure:

1. **Failure detection:** Test fails, build breaks, or task is explicitly
   marked stuck by the user.

2. **Rescue offer:**
   AskUserQuestion: "Task N is stuck. Delegate to Codex for investigation?"
   [Yes / No / Skip task]

3. **Delegation:** If yes, spawn `codex-executor` via Task tool with:
   - Task description (from plan)
   - Error output (test failure, build log)
   - Relevant file paths
   - Recent git log (last 5 commits)

4. **Result integration:** Codex proposes fixes. User reviews. If approved,
   changes are applied via Edit tool and the work loop continues.

### How Research Workflows Invoke codex-analyst

1. **From `/research:code`:** When yellow-codex is installed,
   `research:code` can delegate to `codex-analyst` as an alternative to
   `code-researcher` for questions about the local codebase (Codex excels at
   code understanding with full repo context).

2. **From `/workflows:brainstorm`:** When codebase research is selected in
   Phase 2, `codex-analyst` can supplement `repo-research-analyst` with
   deeper code analysis.

3. **Direct invocation:** Users can ask Codex to analyze any aspect of the
   codebase via the agent's Task interface.

### Context Injection Protocol

All Codex invocations follow a standard context injection protocol:

```text
[CLAUDE.md] -> truncated to 2000 chars
[Plan file] -> if referenced, truncated to 5000 chars
[PR metadata] -> title, body, file list, line count
[Diff/Code] -> truncated to 50000 chars
[Error context] -> if rescue, truncated to 3000 chars
[Injection fence] -> wrap all above in --- begin/end ---
[Task prompt] -> specific instructions for this invocation
```

This ensures Codex has sufficient context without exceeding its own limits,
and all injected content is fenced for safety.

---

## Setup Command Details

### install-codex.sh Script

Follows the repository convention from `install-ast-grep.sh` and
`install-semgrep.sh`:

```bash
#!/bin/bash
set -Eeuo pipefail

# install-codex.sh -- Install OpenAI Codex CLI for yellow-codex plugin
# Usage: bash install-codex.sh

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly NC='\033[0m'

# ... (standard error/warning/success/cleanup functions per convention)

# --- Check if already installed ---
if command -v codex >/dev/null 2>&1; then
  installed_version=$(codex --version 2>/dev/null || true)
  success "codex already installed: ${installed_version:-unknown version}"
  exit 0
fi

# --- Check Node.js version (>= 22 required) ---
if ! command -v node >/dev/null 2>&1; then
  error "Node.js is required but not installed. Install Node.js >= 22."
fi

node_major=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$node_major" -lt 22 ]; then
  error "Node.js >= 22 required (found v${node_major}). Upgrade Node.js."
fi

# --- NVM-aware install ---
install_path="global"
if [ -n "${NVM_DIR:-}" ] || command -v nvm >/dev/null 2>&1; then
  # NVM detected -- install globally (NVM manages prefix)
  npm install -g @openai/codex
else
  # No NVM -- use --prefix ~/.local fallback
  install_path="local"
  npm install -g @openai/codex --prefix ~/.local
fi

# --- Verify installation ---
if command -v codex >/dev/null 2>&1; then
  success "codex installed: $(codex --version 2>/dev/null || echo 'unknown')"
else
  if [ "$install_path" = "local" ]; then
    warning "codex installed to ~/.local but not in PATH"
    warning "Add to ~/.zshrc: export PATH=\"\$HOME/.local/bin:\$PATH\""
  else
    error "Installation completed but codex not found in PATH"
  fi
fi
```

### Auth Verification

The setup command verifies OpenAI API authentication by checking:

1. `OPENAI_API_KEY` environment variable is set
2. Key is valid format (`sk-` prefix or `sk-proj-` prefix)
3. Key works against the OpenAI API (`/v1/models` endpoint)

No keys are stored by the plugin -- the user manages keys in their shell profile.

---

## Phased Implementation Plan

### Phase 1: Review (Weeks 1-2)

**Scope:** Codex as a supplementary code reviewer.

**Deliverables:**

| Component | Description |
|-----------|-------------|
| `plugin.json` | Plugin manifest |
| `CLAUDE.md` | Plugin documentation |
| `package.json` | Package manifest |
| `/codex:setup` | Binary detection, auth verification, install |
| `/codex:review` | Standalone Codex review command |
| `codex-reviewer` agent | Spawnable reviewer for cross-plugin integration |
| `codex-patterns` skill | CLI patterns, output parsing, error handling |
| `install-codex.sh` | Binary installer script |

**Milestones:**

1. Setup command works end-to-end (detect, install, verify auth)
2. `/codex:review` produces structured P1/P2/P3 findings on a test PR
3. `codex-reviewer` agent can be spawned by `review:pr` and returns findings
4. Graceful degradation confirmed: `review:pr` works identically without
   `yellow-codex` installed

**Acceptance criteria:**

- `codex --version` detected and reported by setup
- Review findings match the P1/P2/P3 format from `yellow-review`
- Cross-plugin agent spawning works via Task tool
- All commands are idempotent (re-running setup is safe)

### Phase 2: Execution / Rescue (Weeks 3-4)

**Scope:** Codex as a debugging and rescue tool for stuck tasks.

**Deliverables:**

| Component | Description |
|-----------|-------------|
| `/codex:rescue` | Delegate debugging task to Codex |
| `/codex:status` | Check running Codex processes |
| `codex-executor` agent | Rescue agent for workflows:work |

**Milestones:**

1. `/codex:rescue` accepts a task, invokes Codex in suggest mode, presents
   proposed fixes
2. `codex-executor` can be triggered from `workflows:work` on task failure
3. `/codex:status` reports running processes and recent logs
4. Time-boxing works: Codex invocations terminate after 5 minutes

**Acceptance criteria:**

- Rescue workflow: stuck task -> Codex investigation -> proposed fix -> user
  approval -> applied fix
- Status command accurately reports Codex process state
- suggest mode confirmed: Codex never writes files without user approval in
  rescue path

### Phase 3: Research / Analysis (Weeks 5-6)

**Scope:** Codex as a codebase research and analysis tool.

**Deliverables:**

| Component | Description |
|-----------|-------------|
| `codex-analyst` agent | Codebase analysis agent |
| Integration hooks | Optional spawning from research:code and brainstorm |

**Milestones:**

1. `codex-analyst` answers architecture and pattern questions
2. Integration with `/research:code` as an optional analysis source
3. Integration with `/workflows:brainstorm` codebase research phase

**Acceptance criteria:**

- Analyst returns structured analysis (not file edits)
- Research workflows detect and use codex-analyst when available
- Graceful degradation: research workflows unchanged without yellow-codex

---

## Open Questions

### CLI Stability

- **Codex CLI output format:** Is the output structured (JSON) or free-text? If
  free-text, parsing will be fragile and may break across versions. Need to
  investigate `--output-format` or `--json` flags.
- **Approval mode behavior:** Does `full-auto` with a read-only prompt truly
  prevent file writes, or does Codex still attempt edits? Need to verify.
- **Version compatibility:** What is the minimum Codex CLI version we support?
  Pin in setup command.

### Cost and Token Considerations

- **Per-invocation cost:** Each Codex call uses OpenAI API tokens. A typical
  review of a 500-line diff with `codex-mini` costs approximately $X (need to
  benchmark).
- **Budget awareness:** Should we implement usage tracking similar to
  `yellow-composio`'s `.claude/composio-usage.json`? Or is the OpenAI dashboard
  sufficient?
- **Model selection impact:** `codex-mini` vs `o4-mini` vs `o3` have very
  different cost profiles. Default to cheapest and escalate only when needed.

### Rate Limiting

- **OpenAI API rate limits:** Codex CLI calls hit the OpenAI API. Concurrent
  agent execution (review:pr spawning codex-reviewer in parallel with other
  agents) could trigger rate limits.
- **Retry strategy:** Implement exponential backoff with max 2 retries on 429
  responses.
- **Parallel execution cap:** When multiple Codex agents are requested
  simultaneously, queue rather than fan out.

### Error Handling Patterns

- **Network failures:** Codex CLI requires internet. Handle offline gracefully.
- **Partial output:** If Codex times out mid-response, is partial output usable
  or should it be discarded?
- **Process management:** For long-running rescue tasks, how do we handle
  Claude Code session timeouts? Codex may outlive the session.

### Codex Daemon Mode

- **When needed:** Phase 2 rescue tasks may benefit from Codex running as a
  background daemon for faster subsequent invocations.
- **Implementation:** Investigate `codex --daemon` or similar persistent mode.
- **Lifecycle:** Who starts/stops the daemon? How does it interact with
  `/codex:status`?

### Security Considerations

- **Code exposure:** Codex CLI sends code to OpenAI's API. The same trust
  boundary applies as using OpenAI models directly, but users should be aware.
- **Prompt injection via diff:** Malicious PRs could contain prompt injection
  in code comments. All Codex output must be wrapped in injection fences before
  being consumed by other agents.
- **API key security:** Never echo OPENAI_API_KEY in logs, error messages, or
  debug output. Sanitize with: `sed 's/sk-[a-zA-Z0-9_-]*/***REDACTED***/g'`

### Cross-Plugin Coordination

- **Agent discovery mechanism:** `review:pr` includes `codex-reviewer` via the
  Task-based subagent selection mechanism during Step 4 (Adaptive Agent Selection),
  consistent with existing cross-plugin patterns (yellow-core agents in review:pr).
- **Finding deduplication:** When Codex and another agent flag the same issue,
  how do we deduplicate? Current plan: tag with source and use convergence
  analysis, but need concrete implementation.
- **Configuration persistence:** Where does per-user Codex preference live?
  Proposed: `.claude/codex-config.json` with fields like
  `{ "review_threshold": 100, "default_model": "codex-mini" }`.
