# Feature: Ruvector + Morph Ecosystem Integration

> **Status: Implemented (PR #124, merged)** — Cross-plugin recall/remember + morph discovery integration shipped (`0a7f87ec`).

## Overview

Systematically integrate ruvector (memory recall/remember) and morph
(WarpGrep/Fast Apply) across all 14 yellow-plugins, closing the gap between
what CLAUDE.md files promise and what commands actually implement. Today,
ruvector recall appears in only 3 commands, remember in zero, and morph is
relegated to CLAUDE.md footnotes with zero command integration.

This plan defines a shared skill with canonical patterns, then cascades those
patterns through every plugin in 4 phases.

## Problem Statement

- **Recall gap:** CLAUDE.md says brainstorm and plan should call `hooks_recall`,
  but neither command includes ruvector tools in `allowed-tools` or has a recall
  step.
- **Remember gap:** No command calls `hooks_remember`. The compound workflow
  writes docs/solutions + MEMORY.md but not ruvector memory.
- **Morph gap:** All 4 CLAUDE.md morph sections say "available in freeform
  conversations; structured commands use built-in Edit and Grep." Morph is never
  discoverable or preferred in any command.
- **Hook duplication:** Both `plugin.json` and `.claude/settings.json` fire
  ruvector hooks simultaneously, doubling signals for every Edit/Write/Bash.
- **Missing PreToolUse hooks:** Plugin hooks lack pre-edit, coedit-suggest,
  activity tracking (Read/Glob/Grep/Task), and trajectory tracking.

## Resolved Design Decisions

From the brainstorm (docs/brainstorms/2026-03-04-ruvector-morph-ecosystem-integration-brainstorm.md):

| Decision | Resolution |
|---|---|
| Recall scoping | Hybrid — embed domain keywords as query prefix (e.g., `"[ci-failures] build failed on..."`) since `hooks_recall` has no `domain_hint` parameter |
| Remember tiers | Tiered — Auto (high-signal), Prompted (medium), Skip (low) |
| Morph discovery | ToolSearch at runtime, silent fallback to built-in tools |
| Morph preference | Files > 200 lines OR 3+ non-contiguous edit regions |
| Shared skill location | `plugins/yellow-core/skills/mcp-integration-patterns/` |
| Opt-in config | `.claude/yellow-ruvector.local.md` with YAML frontmatter |
| Config parsing | Node.js-based (guaranteed available; no PyYAML dependency) |
| Hook dedup migration | Immediate — remove overlapping settings.json hooks when adding plugin.json hooks |
| PreToolUse budgets | 1s for Edit/Write (actionable context), 500ms for Read/Glob/Grep/Task (informational) |
| Session morph cache | Rejected — per-command ToolSearch is fast enough, avoids coupling |
| Compound remember tier | Auto (user already opted in by running the command) |
| PostToolUse matcher | Update from `Edit|Write|Bash` to `Edit|Write|MultiEdit|Bash` |

## Signal Classification Table

| Plugin | Event Type | Tier | Examples |
|---|---|---|---|
| yellow-review | P1 security/correctness finding | Auto | SQL injection, auth bypass, data loss |
| yellow-review | P2 design/performance finding | Prompted | Missing error handling, N+1 query |
| yellow-review | P3 style/nit | Skip | Naming preference, formatting |
| yellow-ci | Root cause identified | Auto | "build failed because X dependency was unpinned" |
| yellow-ci | Workaround found | Prompted | "restarting runner fixed flaky test" |
| yellow-ci | Status check only | Skip | `/ci:status` output |
| yellow-debt | Security debt pattern | Auto | Hardcoded secret, deprecated crypto |
| yellow-debt | Complexity/duplication hotspot | Prompted | God function, copy-paste cluster |
| yellow-debt | Low-severity style debt | Skip | Minor naming inconsistency |
| yellow-browser-test | Critical bug found | Auto | Crash, data corruption, broken flow |
| yellow-browser-test | UI issue | Prompted | Layout break, missing validation |
| yellow-browser-test | Passing test summary | Skip | "All 12 routes passed" |
| yellow-core (work) | Implementation insight | Auto | "Had to use X pattern because Y" |
| yellow-core (compound) | Compounded knowledge | Auto | Already user-initiated |
| yellow-core (brainstorm) | Decision rationale | Prompted | "Chose approach A over B because..." |
| yellow-core (plan) | Plan context | Skip | Plan is already in a file |
| yellow-research | Novel finding | Prompted | "Library X deprecated in favor of Y" |
| yellow-linear | Issue pattern | Skip | Informational only |
| yellow-chatprd | PRD decision | Skip | Document already exists |
| yellow-devin | Delegation outcome | Prompted | "Devin failed on X, needed Y context" |
| gt-workflow | Stack issue | Skip | Informational only |

## Sensitive File Exclusion List

PreToolUse Read/Glob tracking hooks must skip these patterns:

```
.env*, *.pem, *.key, *.cert, *credentials*, *secret*,
*.p12, *.pfx, *.keystore, id_rsa*, id_ed25519*,
.netrc, .npmrc (if contains authToken), .pypirc
```

## Implementation Plan

### Phase 1: Foundation — Shared Skill + Core Workflows

#### Task 1.1: Create `mcp-integration-patterns` skill

**File:** `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md`

Create a non-user-invokable skill that codifies three canonical patterns. This
is a reference document (like `memory-query` and `ruvector-conventions`), not
executable code.

**Content sections:**

1. **Recall-Before-Act Pattern**
   - Fast-path presence check: `test -d .ruvector || skip`
   - ToolSearch discovery: `ToolSearch("hooks_recall")` — if not found, skip
   - Query construction with domain prefix:
     `"[domain-hint] <task-specific context, max 300 chars>"`
   - Domain prefixes per plugin (table from brainstorm Key Decision 1)
   - Result filtering: top_k=5, discard < 0.5, take top 3, truncate 800 chars
   - XML injection format (from memory-query skill)
   - Error handler: MCP execution error → skip silently

2. **Tiered-Remember-After-Act Pattern**
   - Signal classification table (from this plan)
   - Auto tier: call `hooks_remember` directly, no user prompt
   - Prompted tier: use AskUserQuestion — "Save this learning to memory?"
   - Skip tier: no-op
   - Quality requirements: 20+ words, context/insight/action structure,
     name concrete files/commands
   - Dedup check: recall with query=content, top_k=1; if score > 0.82, skip
   - Namespace guidance: `skills` for patterns, `reflexion` for mistakes,
     `sessions` for summaries

3. **Morph-Discovery Pattern**
   - For editing: `ToolSearch("morph edit")` — if found and file > 200 lines
     OR 3+ non-contiguous regions, prefer morph's `edit_file`; else use
     built-in Edit
   - For search: `ToolSearch("morph warpgrep")` — if found, prefer for
     intent-based queries ("what calls this function?"); else use Grep
   - No warning on fallback, no degradation message
   - Keyword-based ToolSearch (not `select:`) for resilience to tool renames

**Frontmatter:**

```yaml
---
name: mcp-integration-patterns
description: "Canonical patterns for ruvector recall/remember and morph discovery integration. Use when authoring commands or agents that should leverage institutional memory and advanced editing tools."
user-invokable: false
---
```

#### Task 1.2: Add recall to `workflows:brainstorm`

**File:** `plugins/yellow-core/commands/workflows/brainstorm.md`

Changes:
- Add to `allowed-tools`: `ToolSearch`,
  `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`
- Add a "Recall" step between Pre-Flight and Delegate:

```markdown
## Recall (optional)

If `.ruvector/` exists in project root:
1. Call ToolSearch with query "hooks_recall". If not found, skip to Delegate.
2. Build query: `"[brainstorm-design] " + first 300 chars of $ARGUMENTS`
3. Call hooks_recall(query, top_k=5). If error, skip to Delegate.
4. Discard results with score < 0.5. Take top 3. Truncate combined to 800 chars.
5. Include as advisory context when delegating to brainstorm-orchestrator:
   prefix the agent prompt with the reflexion_context XML block.
```

#### Task 1.3: Add recall to `workflows:plan`

**File:** `plugins/yellow-core/commands/workflows/plan.md`

Changes:
- Add to `allowed-tools`: `ToolSearch`,
  `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`
- Add recall step in Phase 1 (Idea Refinement), after reading brainstorm docs
  but before complexity assessment:

```markdown
### Step 1.5: Recall Past Learnings (optional)

If `.ruvector/` exists:
1. ToolSearch for "hooks_recall". Skip if not found.
2. Query: `"[implementation-planning] " + feature description (first 300 chars)`
3. Call hooks_recall(query, top_k=5). Skip on error.
4. Filter: score >= 0.5, top 3, max 800 chars combined.
5. Note findings as advisory context for plan writing.
```

#### Task 1.4: Add `hooks_remember` to `workflows:compound`

**File:** `plugins/yellow-core/commands/workflows/compound.md`

Changes:
- Add to `allowed-tools`: `ToolSearch`,
  `mcp__plugin_yellow-ruvector_ruvector__hooks_remember`
- The compound command delegates to `knowledge-compounder` agent. Add a step
  AFTER agent completion (not inside the agent):

```markdown
## Persist to Vector Memory (optional)

After the knowledge-compounder agent completes:
1. If `.ruvector/` does not exist, skip.
2. Call ToolSearch with query "hooks_remember". If not found, skip.
3. Read the solution doc the agent just wrote (from agent output).
4. Extract the "Key Insight" or summary section (first 500 chars).
5. Call hooks_remember with the extracted content. Auto tier — no user prompt.
6. If error, skip silently.
```

#### Task 1.5: Add morph discovery + tiered remember to `workflows:work`

**File:** `plugins/yellow-core/commands/workflows/work.md`

Changes:
- `allowed-tools` already includes `ToolSearch`, `hooks_recall`,
  `hooks_remember` — no frontmatter changes needed
- Add morph discovery step in Phase 2 (Implementation), before the first file
  edit:

```markdown
### Step 2.5: Discover Enhanced Tools (optional)

1. Call ToolSearch("morph edit"). If found, note availability.
2. Call ToolSearch("morph warpgrep"). If found, note availability.
3. When editing files > 200 lines or with 3+ non-contiguous changes, prefer
   morph edit_file. Otherwise use built-in Edit.
4. When searching by intent ("what calls this?", "find similar patterns"),
   prefer morph warpgrep. Otherwise use Grep.
```

- Add tiered remember step in Phase 4 (Post-Implementation), after the existing
  remember step. The existing step (CLAUDE.md "At the end of /workflows:work")
  already does a remember. Enhance it with signal tier classification:

```markdown
### Step 4.x: Classify and Record Learning

The learning from this session is Auto tier (implementation insight).
Record it via hooks_remember following the quality requirements in the
mcp-integration-patterns skill. Namespace: `skills` for successful patterns,
`reflexion` for mistakes encountered.
```

### Phase 2: Review Ecosystem

#### Task 2.1: Add morph + tiered remember to `review:review-pr`

**File:** `plugins/yellow-review/commands/review/review-pr.md`

Changes:
- Add to `allowed-tools`: `mcp__plugin_yellow-ruvector_ruvector__hooks_remember`
  (recall already present)
- Add morph discovery in Step 4 (Launch Review Agents), for agents that edit
  code (code-reviewer when it suggests fixes):

```markdown
### Step 3.5: Discover Enhanced Tools

ToolSearch("morph warpgrep"). If found, include tool availability note
in code-reviewer and security-sentinel agent prompts so they can use
WarpGrep for blast-radius analysis.
```

- Add tiered remember after Step 6 (Synthesize):

```markdown
### Step 6.5: Record High-Signal Findings

If any P1 finding was identified (security, correctness, data loss):
  Auto-record via hooks_remember. No user prompt.
If P2 findings exist but no P1:
  Ask user: "Save review learnings to memory?"
If P3 only:
  Skip.
```

#### Task 2.2: Update `review:review-all` for consistency

**File:** `plugins/yellow-review/commands/review/review-all.md`

Changes:
- Add `mcp__plugin_yellow-ruvector_ruvector__hooks_remember` to allowed-tools
  (it delegates to review-pr, which now handles morph + remember)

#### Task 2.3: Add recall + morph to `review:resolve-pr`

**File:** `plugins/yellow-review/commands/review/resolve-pr.md`

Changes:
- Add to `allowed-tools`: `ToolSearch`,
  `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`
- Add recall before spawning resolver agents (context: past resolutions)
- Add morph discovery for resolver agents that edit files

### Phase 3: Hook Architecture

#### Task 3.1: Add PreToolUse hooks to yellow-ruvector's plugin.json

**File:** `plugins/yellow-ruvector/.claude-plugin/plugin.json`

Add 5 new PreToolUse hook entries. Create a single `pre-tool-use.sh` script
with internal dispatch (same pattern as existing `post-tool-use.sh`).

```json
"PreToolUse": [
  {
    "matcher": "Edit|Write|MultiEdit",
    "hooks": [{
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/pre-tool-use.sh",
      "timeout": 1
    }]
  },
  {
    "matcher": "Bash",
    "hooks": [{
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/pre-tool-use.sh",
      "timeout": 1
    }]
  },
  {
    "matcher": "Read",
    "hooks": [{
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/pre-tool-use.sh",
      "timeout": 0.5
    }]
  },
  {
    "matcher": "Glob|Grep",
    "hooks": [{
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/pre-tool-use.sh",
      "timeout": 0.5
    }]
  },
  {
    "matcher": "Task",
    "hooks": [{
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/pre-tool-use.sh",
      "timeout": 0.5
    }]
  }
]
```

#### Task 3.2: Create `pre-tool-use.sh` hook script

**File:** `plugins/yellow-ruvector/hooks/scripts/pre-tool-use.sh`

Follow the established patterns from `post-tool-use.sh`:
- `set -uo pipefail` (no `-e`)
- `json_exit()` helper
- Parse stdin JSON with jq
- Check `.ruvector/` exists
- Resolve ruvector binary

Internal dispatch by tool name:

```bash
case "$TOOL" in
  Edit|Write|MultiEdit)
    # pre-edit context + coedit-suggest
    "$RUVECTOR_CMD" hooks pre-edit "$file_path" 2>/dev/null || true
    "$RUVECTOR_CMD" hooks coedit-suggest --file "$file_path" 2>/dev/null || true
    ;;
  Bash)
    # pre-command context
    "$RUVECTOR_CMD" hooks pre-command "$command_text" 2>/dev/null || true
    ;;
  Read)
    # file access tracking (skip sensitive files)
    case "$file_path" in
      *.env*|*.pem|*.key|*.cert|*credentials*|*secret*|*.p12|*.pfx|*.keystore|*id_rsa*|*id_ed25519*|*.netrc|*.npmrc|*.pypirc)
        ;;  # Skip sensitive files
      *)
        "$RUVECTOR_CMD" hooks remember "Reading: $file_path" -t file_access 2>/dev/null || true
        ;;
    esac
    ;;
  Glob|Grep)
    "$RUVECTOR_CMD" hooks remember "Search: $pattern" -t search_pattern 2>/dev/null || true
    ;;
  Task)
    "$RUVECTOR_CMD" hooks remember "Agent: $subagent_type" -t agent_spawn 2>/dev/null || true
    ;;
esac
```

**Config check:** Before dispatching, check `.claude/yellow-ruvector.local.md`
config to see if the feature is enabled. Use the config cache pattern (see
Task 3.4).

#### Task 3.3: Update existing PostToolUse matcher

**File:** `plugins/yellow-ruvector/.claude-plugin/plugin.json`

Change PostToolUse matcher from `"Edit|Write|Bash"` to
`"Edit|Write|MultiEdit|Bash"`.

#### Task 3.4: Add trajectory tracking to existing hooks

**File:** `plugins/yellow-ruvector/hooks/scripts/session-start.sh`

Add after `hooks session-start --resume`:

```bash
"${RUVECTOR_CMD[@]}" hooks trajectory-begin -c "claude-session" -a "claude" 2>/dev/null || true
```

**File:** `plugins/yellow-ruvector/hooks/scripts/stop.sh`

Add before `hooks session-end`:

```bash
"${RUVECTOR_CMD[@]}" hooks trajectory-end --success --quality 0.8 2>/dev/null || true
```

#### Task 3.5: Create opt-in config support

**New file:** `plugins/yellow-ruvector/hooks/scripts/lib/config.sh`

Shared config parsing library sourced by all hook scripts.

```bash
# config.sh — Parse .claude/yellow-ruvector.local.md config
# Uses Node.js for YAML parsing (guaranteed available — ruvector requires it)

RUVECTOR_CONFIG_FILE="${PROJECT_DIR}/.claude/yellow-ruvector.local.md"
RUVECTOR_CONFIG_CACHE="${RUVECTOR_DIR}/hook-config-cache.json"

load_config() {
  # Fast path: use cached config if fresher than source
  if [ -f "$RUVECTOR_CONFIG_CACHE" ] && [ -f "$RUVECTOR_CONFIG_FILE" ]; then
    if [ "$RUVECTOR_CONFIG_CACHE" -nt "$RUVECTOR_CONFIG_FILE" ]; then
      CONFIG_JSON=$(cat "$RUVECTOR_CONFIG_CACHE")
      return 0
    fi
  fi

  # Slow path: parse YAML frontmatter with Node.js
  if [ -f "$RUVECTOR_CONFIG_FILE" ]; then
    CONFIG_JSON=$(node -e "
      const fs = require('fs');
      const content = fs.readFileSync('$RUVECTOR_CONFIG_FILE', 'utf8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) { console.log('{}'); process.exit(0); }
      // Simple YAML key-value parser (no external deps)
      const yaml = match[1];
      const result = {};
      // ... minimal YAML parser for flat/nested booleans
      console.log(JSON.stringify(result));
    " 2>/dev/null) || CONFIG_JSON='{}'
    printf '%s' "$CONFIG_JSON" > "$RUVECTOR_CONFIG_CACHE" 2>/dev/null || true
  else
    CONFIG_JSON='{}'
  fi
}

is_enabled() {
  local path="$1"
  printf '%s' "${CONFIG_JSON:-{}}" | jq -r "$path // true" 2>/dev/null
}
```

**Default behavior when config file is absent:** All features enabled. This
preserves current behavior.

#### Task 3.6: Remove overlapping settings.json hooks

**File:** `.claude/settings.json`

Remove ALL ruvector hooks from settings.json since they will now be handled by
plugin.json hooks. The file becomes:

```json
{
  "hooks": {}
}
```

Or remove the file entirely if hooks were its only content.

**Why immediate, not phased:** settings.json is gitignored (local-only).
Plugin.json hooks are the canonical source. Keeping both causes duplicate
signals. Since this is a personal-use ecosystem, there is no migration risk.

### Phase 4: Remaining Plugins + CLAUDE.md Updates

#### Task 4.1: yellow-ci integration

**Files to modify:**

- `plugins/yellow-ci/commands/ci/diagnose.md` — Add recall:
  `"[ci-failures] " + error summary`. Add tiered remember (Auto for root
  cause identified, Prompted for workaround).
- `plugins/yellow-ci/commands/ci/status.md` — Skip (informational, no recall
  needed).
- `plugins/yellow-ci/CLAUDE.md` — Replace "Optional Enhancement: yellow-morph"
  with "MCP Tool Integration" section.

**allowed-tools additions:** `ToolSearch`,
`mcp__plugin_yellow-ruvector_ruvector__hooks_recall`,
`mcp__plugin_yellow-ruvector_ruvector__hooks_remember`

#### Task 4.2: yellow-debt integration

**Files to modify:**

- `plugins/yellow-debt/commands/debt/audit.md` — Add recall:
  `"[technical-debt] " + scan scope`. Add tiered remember (Auto for security
  debt, Prompted for complexity hotspot).
- `plugins/yellow-debt/commands/debt/fix.md` — Add recall + morph discovery
  (morph preferred for large file refactoring). Add Auto remember.
- `plugins/yellow-debt/CLAUDE.md` — Replace morph section.

#### Task 4.3: yellow-browser-test integration

**Files to modify:**

- `plugins/yellow-browser-test/commands/browser-test/test.md` — Add recall:
  `"[browser-testing] " + test scope`. Add tiered remember (Auto for critical
  bugs, Prompted for UI issues).
- `plugins/yellow-browser-test/commands/browser-test/explore.md` — Same
  pattern.
- `plugins/yellow-browser-test/CLAUDE.md` — Add new "MCP Tool Integration"
  section (none currently exists).

#### Task 4.4: yellow-research integration

**Files to modify:**

- `plugins/yellow-research/commands/research/deep.md` — Add recall:
  `"[research] " + topic`. Prompted remember for novel findings.
- `plugins/yellow-research/commands/research/code.md` — Add recall for past
  research on same library/topic.
- `plugins/yellow-research/CLAUDE.md` — Update morph reference from
  "optional source" to "MCP Tool Integration" section.

#### Task 4.5: yellow-chatprd integration

**Files to modify:**

- `plugins/yellow-chatprd/commands/chatprd/create.md` — Add recall:
  `"[product-requirements] " + doc topic`. Skip tier remember.
- `plugins/yellow-chatprd/CLAUDE.md` — Add "MCP Tool Integration" section.

#### Task 4.6: yellow-linear integration

**Files to modify:**

- `plugins/yellow-linear/commands/linear/create.md` — Add recall:
  `"[project-management] " + issue description` (find similar past issues).
  Skip tier remember.
- `plugins/yellow-linear/CLAUDE.md` — Add "MCP Tool Integration" section.

#### Task 4.7: yellow-devin integration

**Files to modify:**

- `plugins/yellow-devin/commands/devin/delegate.md` — Add recall:
  `"[delegation] " + task description` (past delegation outcomes). Prompted
  remember for delegation failures.
- `plugins/yellow-devin/CLAUDE.md` — Add "MCP Tool Integration" section.

#### Task 4.8: gt-workflow integration

**Files to modify:**

- `plugins/gt-workflow/commands/gt-workflow/smart-submit.md` — Add recall:
  `"[git-workflow] " + branch context`. Skip tier remember.
- `plugins/gt-workflow/CLAUDE.md` — Add "MCP Tool Integration" section.

#### Task 4.9: Update all CLAUDE.md files

Replace the "Optional Enhancement: yellow-morph" section in yellow-core,
yellow-review, yellow-ci, and yellow-debt with:

```markdown
## MCP Tool Integration

- **ruvector** — Recall past learnings at workflow start; tiered remember at
  workflow end. Graceful skip if yellow-ruvector not installed.
- **morph** — Preferred for file edits (>200 lines or 3+ non-contiguous
  regions) and intent-based code search. Discovered via ToolSearch at runtime;
  falls back to built-in tools silently.
```

Add the same section to plugins that currently have no morph section:
yellow-linear, yellow-chatprd, yellow-devin, yellow-browser-test, gt-workflow.

## Technical Details

### Files to Create

| File | Purpose |
|---|---|
| `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md` | Shared skill with 3 canonical patterns |
| `plugins/yellow-ruvector/hooks/scripts/pre-tool-use.sh` | New PreToolUse hook with dispatch |
| `plugins/yellow-ruvector/hooks/scripts/lib/config.sh` | Shared config parser library |

### Files to Modify (Summary)

| Category | Files | Change |
|---|---|---|
| yellow-core commands | `brainstorm.md`, `plan.md`, `compound.md`, `work.md` | Add recall/remember/morph steps + allowed-tools |
| yellow-review commands | `review-pr.md`, `review-all.md`, `resolve-pr.md` | Add remember/morph + allowed-tools |
| yellow-ruvector plugin.json | `plugin.json` | Add PreToolUse hooks, update PostToolUse matcher |
| yellow-ruvector hooks | `session-start.sh`, `stop.sh` | Add trajectory tracking |
| Project settings | `.claude/settings.json` | Remove all ruvector hooks (replaced by plugin.json) |
| 8 remaining plugins | Various command .md + CLAUDE.md files | Add recall/remember steps + MCP Tool Integration section |
| 4 CLAUDE.md files | yellow-core, yellow-review, yellow-ci, yellow-debt | Replace morph footnote with MCP Tool Integration section |
| 5 CLAUDE.md files | yellow-linear, yellow-chatprd, yellow-devin, yellow-browser-test, gt-workflow | Add new MCP Tool Integration section |

### Dependencies

No new npm packages. All tools (ruvector, morph) are already installed or
discovered at runtime via ToolSearch.

## Testing Strategy

### Manual Verification Checklist

For each modified command:

- [x] Run with `.ruvector/` present — recall step fires, results injected
- [x] Run with `.ruvector/` absent — recall step silently skipped
- [x] Run with ruvector not installed (rename binary) — ToolSearch returns
  nothing, command works normally
- [x] Run with morph installed — ToolSearch finds morph tools, prefers them
  for large files
- [x] Run with morph not installed — ToolSearch returns nothing, built-in
  tools used silently

### Hook Verification

- [x] `npx ruvector hooks verify` passes after plugin.json updates
- [x] PreToolUse hooks fire on Edit/Write/Read/Glob/Grep/Bash/Task
- [x] Sensitive file paths (`.env`, `*.key`) are NOT tracked by Read hook
- [x] PostToolUse now catches MultiEdit in addition to Edit/Write/Bash
- [x] No duplicate signals after settings.json hooks removed
- [x] Trajectory tracking recorded in session-start and stop

### Config Verification

- [x] With no `.claude/yellow-ruvector.local.md` — all features enabled
- [x] With config file disabling tracking — Read/Glob/Grep tracking skipped
- [x] With invalid YAML in config — falls back to all-enabled, stderr warning

## Acceptance Criteria

1. Every workflow command that acts on code recalls relevant past learnings
   before starting (with graceful degradation)
2. High-signal outcomes are automatically remembered; medium-signal prompted;
   low-signal skipped
3. Morph tools are discovered and preferred at runtime when available
4. All ruvector hooks consolidated into plugin.json (settings.json clean)
5. PreToolUse hooks provide pre-edit, coedit-suggest, and activity tracking
6. Opt-in config file allows disabling individual hook features
7. No command breaks when ruvector and/or morph are not installed
8. CLAUDE.md files accurately describe runtime behavior (not passive footnotes)

## Edge Cases

- **Ruvector installed but not initialized (no `.ruvector/`):** All hooks and
  commands silently skip. The fast-path `test -d .ruvector` check handles this.
- **MCP server crashes mid-session:** Commands catch MCP execution errors and
  skip silently. Hooks use `2>/dev/null || true` pattern.
- **Morph credits exhausted mid-session:** ToolSearch still finds morph, but
  MCP call fails. Command should catch the error and fall back to built-in Edit.
  Add error handling to the morph discovery pattern.
- **Config file has invalid YAML:** Falls back to "all enabled". Single stderr
  warning, cache the empty config to avoid re-parsing.
- **Concurrent rapid edits:** Hook scripts are stateless. ruvector CLI handles
  concurrent writes internally via rvlite's WAL.
- **Worktrees with different configs:** Config cache key should include a hash
  of `PROJECT_DIR` to avoid cross-worktree cache pollution.

## Rollback Plan

- **Phase 1-2 (skill + commands):** Revert the allowed-tools and step additions
  in command .md files. Commands return to their current behavior.
- **Phase 3 (hooks):** Remove PreToolUse entries from plugin.json. Restore
  settings.json from git. Run `npx ruvector hooks verify`.
- **Phase 4 (CLAUDE.md):** Revert CLAUDE.md changes. Documentation-only, no
  runtime impact.

Each phase is independently revertible.

## References

- Brainstorm: `docs/brainstorms/2026-03-04-ruvector-morph-ecosystem-integration-brainstorm.md`
- Memory query pattern: `plugins/yellow-ruvector/skills/memory-query/SKILL.md`
- Ruvector conventions: `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md`
- Existing recall in work.md: `plugins/yellow-core/commands/workflows/work.md` lines 60-84
- Existing recall in review-pr.md: `plugins/yellow-review/commands/review/review-pr.md` lines 68-93
- Plugin hook format: `plugins/yellow-ruvector/.claude-plugin/plugin.json`
- Settings.json hooks: `.claude/settings.json`
- Post-tool-use template: `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh`
