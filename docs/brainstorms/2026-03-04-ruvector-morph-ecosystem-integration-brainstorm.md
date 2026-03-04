# Brainstorm: Ruvector + Morph Ecosystem Integration

**Date:** 2026-03-04
**Status:** Brainstorm
**Approach:** Shared Skill + Phased Plugin Cascade

---

## What We're Building

A systematic enhancement of the yellow-plugins ecosystem to deeply and
consistently integrate ruvector (memory recall/remember) and morph
(WarpGrep/Fast Apply) across all plugins and workflows. Today these tools exist
in the ecosystem but are underutilized: ruvector recall appears in only 3
commands (`workflows:work`, `review:pr`, `review:all`), ruvector remember
appears in none (compound writes to docs/solutions + MEMORY.md instead), and
morph is relegated to "Optional Enhancement" footnotes in CLAUDE.md files with
zero presence in any command's allowed-tools or workflow steps.

The plan is to define canonical integration patterns in a shared skill, then
cascade those patterns through every plugin in priority order so that:

1. Every workflow that acts on code recalls relevant past learnings before
   starting (hybrid scoping: broad semantic search with plugin-specific domain
   hints).
2. High-signal outcomes are automatically remembered to ruvector; medium-signal
   outcomes prompt the user; low-signal outcomes are silently skipped (tiered
   remember).
3. Morph tools (edit_file, warpgrep_codebase_search) are discovered at runtime
   via ToolSearch and preferred when available, with silent fallback to built-in
   Edit/Grep when not (no setup steps, no hard dependencies).

### Current State Audit

| Plugin | Recall | Remember | Morph | Gap |
|---|---|---|---|---|
| yellow-core (`workflows:work`) | Yes (Step 2b) | No | No | Missing remember, missing morph |
| yellow-core (`workflows:brainstorm`) | No | No | No | CLAUDE.md says recall; command does not implement |
| yellow-core (`workflows:plan`) | No | No | No | CLAUDE.md says recall; command does not implement |
| yellow-core (`workflows:compound`) | No | No | No | Writes docs/solutions + MEMORY.md; no hooks_remember |
| yellow-review (`review:pr`) | Yes (Step 3b) | No (delegates to compound) | No | Missing remember, morph is footnote only |
| yellow-review (`review:all`) | Yes (via review:pr) | No (delegates to compound) | No | Same as review:pr |
| yellow-ci | No | No | No | Footnote mentions morph for freeform only |
| yellow-debt | No | No | No | Footnote mentions morph for freeform only |
| yellow-research | No | No | No | Footnote mentions morph WarpGrep as optional source |
| yellow-linear | No | No | No | Zero integration |
| yellow-chatprd | No | No | No | Zero integration |
| yellow-devin | No | No | No | Zero integration |
| yellow-browser-test | No | No | No | Zero integration |
| gt-workflow | No | No | No | Zero integration |

---

## Why This Approach

**Shared Skill + Phased Plugin Cascade** was chosen over two alternatives:

- **Core-Only Deep Integration** would give quick wins in the 4 core workflows
  but leave 10+ other plugins without integration indefinitely, and the pattern
  would need to be re-derived later for each plugin.
- **Plugin Hooks Layer** would be the most elegant long-term but requires
  framework-level changes (plugin.json schema, hook runner), offers less
  granular control over domain hints and signal classification, and is harder to
  debug.

The shared skill approach gives us:

1. **Single source of truth.** All plugins reference the same patterns. When we
   improve the recall strategy or add a new morph tool, we update one skill and
   every plugin benefits.
2. **Mechanical updates.** Each plugin update follows the same recipe: add
   ToolSearch + hooks_recall to allowed-tools, add the skill load, insert the
   recall-before-act and remember-after-act steps per the skill's templates.
3. **Natural extension.** The existing `ruvector-conventions` skill in
   yellow-ruvector already covers conventions; we extend it (or create a
   sibling `mcp-integration-patterns` skill in yellow-core) to codify the three
   canonical patterns.
4. **Graceful degradation by construction.** ToolSearch-based discovery means
   plugins work fine without ruvector or morph installed -- they simply skip
   those steps.

---

## Key Decisions

### 1. Recall scoping: Hybrid with domain hints

Every recall call uses broad semantic search (full memory, RRF-ranked) but
plugins pass a `domain_hint` that biases results toward relevant categories.

**Pattern:**

```
query = "<task-specific context, max 300 chars>"
domain_hint = "<plugin-domain>"  # e.g., "ci-failures", "pr-review", "debt-analysis"
top_k = 5
score_threshold = 0.5
max_results = 3
max_combined_chars = 800
```

Domain hints per plugin:

| Plugin | Domain Hint |
|---|---|
| yellow-core (brainstorm) | `"brainstorm-design"` |
| yellow-core (plan) | `"implementation-planning"` |
| yellow-core (work) | `"implementation"` (already exists) |
| yellow-core (compound) | `"knowledge-capture"` |
| yellow-review | `"code-review"` |
| yellow-ci | `"ci-failures"` |
| yellow-debt | `"technical-debt"` |
| yellow-research | `"research"` |
| yellow-browser-test | `"browser-testing"` |
| yellow-linear | `"project-management"` |
| yellow-chatprd | `"product-requirements"` |
| yellow-devin | `"delegation"` |

### 2. Remember signal tiers

| Tier | Signal Strength | Behavior | Examples |
|---|---|---|---|
| **Auto** | High | Record without asking | P1 review findings, CI failure root cause identified, browser test critical bug, security vulnerability found |
| **Prompted** | Medium | Ask user via AskUserQuestion | P2 review findings, CI diagnosis with workaround, debt hotspot identified, brainstorm decision rationale |
| **Skip** | Low | Silent no-op | P3 style suggestions, routine status checks, simple searches, informational queries |

The skill defines a `classify_signal(event_type, severity)` decision table that
each plugin consults. Plugins pass their event type and the skill returns the
tier.

### 3. Morph discovery via ToolSearch

Every command/agent that edits code or searches the codebase adds this pattern:

**For editing (files > 200 lines):**

```
1. ToolSearch("morph edit_file")
2. If found: prefer mcp__plugin_yellow-morph_morph__edit_file over built-in Edit
3. If not found: use built-in Edit (no warning, no degradation message)
```

**For intent-based code search:**

```
1. ToolSearch("morph warpgrep")
2. If found: prefer mcp__plugin_yellow-morph_morph__warpgrep_codebase_search
3. If not found: use built-in Grep (no warning)
```

The skill provides the exact ToolSearch queries and fallback logic so each
plugin does not need to re-derive them.

### 4. Compound workflow becomes ruvector-aware

The `knowledge-compounder` agent currently writes to `docs/solutions/` and
`MEMORY.md`. With this enhancement it also calls `hooks_remember` to persist
learnings in ruvector's vector store. The routing decision expands:

| Route | Current | New |
|---|---|---|
| DOC_ONLY | docs/solutions/ | docs/solutions/ + hooks_remember |
| MEMORY_ONLY | MEMORY.md | MEMORY.md + hooks_remember |
| BOTH | docs/solutions/ + MEMORY.md | docs/solutions/ + MEMORY.md + hooks_remember |

This means ruvector recall will surface compounded knowledge in future sessions
without requiring the user to have the exact MEMORY.md path loaded.

### 5. Shared skill location

Two options considered:

- **Extend `plugins/yellow-ruvector/skills/ruvector-conventions/`** -- Natural
  home for recall/remember patterns, but morph patterns do not belong in a
  ruvector skill.
- **Create `plugins/yellow-core/skills/mcp-integration-patterns/`** -- Lives in
  core (always installed), covers both ruvector and morph, can be loaded by any
  plugin.

**Decision:** Create the new skill in yellow-core. It references ruvector and
morph tool names but does not depend on either being installed (the entire point
is graceful degradation). The existing `ruvector-conventions` skill remains
focused on ruvector-specific conventions (quality gates, dedup thresholds, RRF
parameters).

### 6. Rollout priority order

Phase 1 (highest traffic, biggest gaps):

1. `plugins/yellow-core/skills/mcp-integration-patterns/` -- Create the skill
2. `plugins/yellow-core/commands/workflows/brainstorm.md` -- Add recall
3. `plugins/yellow-core/commands/workflows/plan.md` -- Add recall
4. `plugins/yellow-core/commands/workflows/compound.md` -- Add hooks_remember
5. `plugins/yellow-core/commands/workflows/work.md` -- Add morph discovery, add
   tiered remember

Phase 2 (review ecosystem):

6. `plugins/yellow-review/commands/review/review-pr.md` -- Add morph, add
   tiered remember
7. `plugins/yellow-review/commands/review/review-all.md` -- Inherits from
   review-pr changes
8. Update review agents' allowed-tools for morph

Phase 3 (remaining plugins):

9. `plugins/yellow-ci/` -- Add recall (CI failure history), remember (diagnosed
   failures), morph (applying fixes)
10. `plugins/yellow-debt/` -- Add recall (past debt analysis), remember
    (hotspot findings), morph (refactoring)
11. `plugins/yellow-browser-test/` -- Add recall (past test failures), remember
    (critical bugs found)
12. `plugins/yellow-research/` -- Add recall (past research on same topics),
    morph (WarpGrep as primary not optional)
13. `plugins/yellow-chatprd/` -- Add recall (past PRD decisions)
14. `plugins/yellow-linear/` -- Add recall (past issue patterns)
15. `plugins/yellow-devin/` -- Add recall (past delegation outcomes)
16. `plugins/gt-workflow/` -- Add recall (past stack/rebase issues)

### 7. allowed-tools updates

Every command that gains ruvector integration needs these in its frontmatter
`allowed-tools`:

```yaml
allowed-tools:
  - ToolSearch
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
```

Commands that gain morph integration need `ToolSearch` (already covers morph
discovery at runtime -- no static morph tool names in allowed-tools).

### 8. CLAUDE.md updates

Each plugin's CLAUDE.md "Optional Enhancement: yellow-morph" section should be
replaced with a "MCP Tool Integration" section that describes the actual
runtime behavior rather than being a passive footnote:

```markdown
## MCP Tool Integration

- **ruvector** -- Recall past learnings at workflow start; tiered remember at
  workflow end. Graceful skip if yellow-ruvector not installed.
- **morph** -- Preferred for file edits (>200 lines) and intent-based code
  search. Discovered via ToolSearch at runtime; falls back to built-in tools
  silently.
```

---

## Hooks Strategy and Opt-In Configuration

### Current Hook Landscape

The yellow-plugins ecosystem has two parallel hook systems that both fire for
ruvector, creating overlap and redundancy:

**Layer 1: Plugin hooks (plugin.json)**

yellow-ruvector's `plugin.json` defines 4 hooks:

| Hook Type | Matcher | Script | Budget | What It Does |
|---|---|---|---|---|
| `UserPromptSubmit` | `*` | `user-prompt-submit.sh` | 1s | Recall memories before each user prompt (semantic match on prompt text) |
| `SessionStart` | `*` | `session-start.sh` | 3s | Initialize ruvector session + load top 5 learnings (reflexion + skills) |
| `PostToolUse` | `Edit\|Write\|Bash` | `post-tool-use.sh` | 1s | Record file edits (post-edit) and bash outcomes (post-command) |
| `Stop` | `*` | `stop.sh` | 10s | Run session-end hook for cleanup and metrics export |

**Layer 2: Project-level hooks (.claude/settings.json)**

The project's `.claude/settings.json` defines a much broader set of ruvector
hooks that overlap with and extend the plugin hooks:

| Hook Type | Matcher | What It Does |
|---|---|---|
| `PreToolUse` | `Edit\|Write\|MultiEdit` | pre-edit + coedit-suggest before each file edit |
| `PreToolUse` | `Bash` | pre-command before each bash execution |
| `PreToolUse` | `Read` | remember file access events |
| `PreToolUse` | `Glob\|Grep` | remember search patterns |
| `PreToolUse` | `Task` | remember agent spawn events |
| `PostToolUse` | `Edit\|Write\|MultiEdit` | post-edit after each file write |
| `PostToolUse` | `Bash` | post-command after each bash execution |
| `SessionStart` | `*` | session-start + trajectory-begin |
| `Stop` | `*` | trajectory-end + session-end |

**The overlap problem:** Both layers fire simultaneously. The plugin's
`PostToolUse` on `Edit|Write|Bash` AND the project's `PostToolUse` on the same
matchers both call `hooks post-edit` / `hooks post-command`. The plugin's
`SessionStart` AND the project's `SessionStart` both call
`hooks session-start`. This means ruvector processes duplicate signals for every
edit, write, and bash command.

**What the project-level hooks add beyond the plugin:**
- `PreToolUse` hooks (pre-edit, coedit-suggest, pre-command) -- the plugin has
  none of these
- Activity tracking on `Read`, `Glob|Grep`, `Task` -- the plugin does not
  track these
- Trajectory tracking (`trajectory-begin`, `trajectory-end`) -- the plugin does
  not do this

### Proposed Hook Architecture

The goal is to consolidate into the plugin layer (plugin.json) so that
installing yellow-ruvector gives you the full hook suite without needing manual
`.claude/settings.json` edits. The project-level hooks in settings.json should
become unnecessary once the plugin hooks are complete.

#### New hooks to add to yellow-ruvector's plugin.json

| Hook Type | Matcher | Script | Budget | Purpose |
|---|---|---|---|---|
| `PreToolUse` | `Edit\|Write\|MultiEdit` | `pre-tool-use.sh` | 1s | Run pre-edit context injection + coedit-suggest |
| `PreToolUse` | `Bash` | `pre-tool-use.sh` | 1s | Run pre-command context injection |
| `PreToolUse` | `Read` | `pre-tool-use.sh` | 500ms | Track file access for activity graph |
| `PreToolUse` | `Glob\|Grep` | `pre-tool-use.sh` | 500ms | Track search patterns |
| `PreToolUse` | `Task` | `pre-tool-use.sh` | 500ms | Track agent spawns |

The existing `PostToolUse`, `UserPromptSubmit`, `SessionStart`, and `Stop`
hooks remain. The `SessionStart` hook gains trajectory-begin. The `Stop` hook
gains trajectory-end.

**Single script, multiple matchers:** Use one `pre-tool-use.sh` script that
reads the tool name from stdin JSON and dispatches internally (same pattern as
the existing `post-tool-use.sh` which handles Edit, Write, and Bash in one
script via a `case` statement).

#### Morph-related hooks

Morph does not need hooks in the traditional sense. The ToolSearch-based
discovery pattern proposed in Key Decision 3 is sufficient. However, one hook
optimization is worth considering:

**SessionStart morph discovery cache:** Add a lightweight check to the
yellow-ruvector (or yellow-core) `SessionStart` hook that probes for morph tool
availability and sets a systemMessage flag:

```bash
# In session-start.sh, after ruvector init:
if npx --no @morphllm/morphmcp@0.8.110 --version >/dev/null 2>&1; then
  MORPH_AVAILABLE="true"
fi
```

This avoids repeated ToolSearch calls per command. The systemMessage can include
`"morph_available: true"` so commands know to prefer morph tools without
discovering them each time.

**Trade-off:** This couples the session-start hook to morph's package name and
version. If morph updates, the hook needs updating. Given that ToolSearch is
fast (sub-100ms), the simpler approach may be to skip this optimization and let
each command discover morph at runtime.

### Opt-In Configuration

Currently all ruvector hooks fire unconditionally (gated only by `.ruvector/`
directory existence). For a personal-use ecosystem this is fine, but as the hook
surface area grows (PreToolUse on every Read, Glob, Grep, Task), users may want
granular control. Three configuration approaches were evaluated:

#### Option A: .claude/yellow-ruvector.local.md (Recommended)

Use the established `.claude/<plugin-name>.local.md` convention already used by
yellow-ci (runner config) and yellow-browser-test (dev server config).

```yaml
---
schema: 1
hooks:
  recall:
    enabled: true
    user_prompt_submit: true    # recall on every user prompt
    session_start: true         # load learnings at session start
  remember:
    enabled: true
    auto_tier: true             # auto-record high-signal events
    prompt_tier: true           # ask for medium-signal events
  tracking:
    enabled: true
    file_access: true           # track Read events
    search_patterns: true       # track Glob/Grep patterns
    agent_spawns: true          # track Task spawns
    trajectory: true            # trajectory-begin/end
  pre_edit:
    enabled: true
    coedit_suggest: true        # co-edit suggestions before writes
morph:
  discovery: auto               # auto | disabled | always
---
# Notes
# Set any hook category to false to disable it.
# Defaults (when file is missing): all enabled.
```

**Pros:**
- Follows the established pattern (yellow-ci, yellow-browser-test already do
  this)
- Per-project granularity (different projects can have different settings)
- Gitignored by `.local.md` convention (personal preferences stay local)
- Human-readable YAML with markdown notes section

**Cons:**
- Hook scripts must parse YAML frontmatter on every invocation (adds ~20ms via
  `sed` + `grep` extraction; avoidable by caching parsed config in
  `.ruvector/config-cache.json`)
- Another config file for users to discover

#### Option B: .ruvector/config.json

Place configuration inside the existing `.ruvector/` directory.

```json
{
  "schema": 1,
  "hooks": {
    "recall": { "enabled": true, "user_prompt_submit": true },
    "remember": { "enabled": true, "auto_tier": true },
    "tracking": { "enabled": true, "file_access": false }
  }
}
```

**Pros:**
- Co-located with ruvector's data (`.ruvector/` already exists and is
  gitignored)
- Native JSON -- no YAML parsing needed in bash hooks
- Fast to parse with `jq` (already a dependency)

**Cons:**
- Breaks the `.claude/<plugin-name>.local.md` convention that other plugins use
- Not discoverable via the standard plugin config pattern
- `.ruvector/` is ruvector's data directory -- config is a different concern

#### Option C: Plugin.json feature flags

Add an optional `config` section to the plugin.json schema that declares
feature flags with defaults:

```json
{
  "name": "yellow-ruvector",
  "config": {
    "hooks.tracking.file_access": { "default": true, "type": "boolean" },
    "hooks.tracking.search_patterns": { "default": true, "type": "boolean" }
  }
}
```

**Pros:**
- Declarative -- plugins advertise their configurable features
- Could enable a `/ruvector:configure` command or future UI

**Cons:**
- Requires plugin framework changes (plugin.json schema extension)
- No established pattern -- would be the first plugin to use this
- Overengineered for the current scope

#### Recommendation: Option A (.claude/yellow-ruvector.local.md)

Option A follows the established convention, requires no framework changes, and
gives per-project granularity. Hook scripts check for the config file at
startup and cache the parsed result in `.ruvector/hook-config-cache.json` to
avoid re-parsing YAML on every hook invocation. The cache is invalidated when
the config file's mtime changes.

**Defaults when config file is absent:** All features enabled. This preserves
the current behavior (everything fires if `.ruvector/` exists) while giving
power users an opt-out mechanism.

**Config parsing pattern for hook scripts:**

```bash
CONFIG_FILE="${PROJECT_DIR}/.claude/yellow-ruvector.local.md"
CACHE_FILE="${RUVECTOR_DIR}/hook-config-cache.json"

# Fast path: use cached config if fresh
if [ -f "$CACHE_FILE" ] && [ -f "$CONFIG_FILE" ]; then
  cache_mtime=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null)
  config_mtime=$(stat -c %Y "$CONFIG_FILE" 2>/dev/null || stat -f %m "$CONFIG_FILE" 2>/dev/null)
  if [ "$cache_mtime" -gt "$config_mtime" ] 2>/dev/null; then
    # Cache is newer than config -- use it
    CONFIG_JSON=$(cat "$CACHE_FILE")
  fi
fi

# Slow path: parse YAML frontmatter and cache
if [ -z "${CONFIG_JSON:-}" ]; then
  if [ -f "$CONFIG_FILE" ]; then
    # Extract YAML between --- delimiters, convert to JSON
    YAML_BLOCK=$(sed -n '/^---$/,/^---$/p' "$CONFIG_FILE" | sed '1d;$d')
    # Use python3 or yq for YAML->JSON (both commonly available)
    CONFIG_JSON=$(printf '%s' "$YAML_BLOCK" | python3 -c 'import sys,json,yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))' 2>/dev/null) || CONFIG_JSON='{}'
    printf '%s' "$CONFIG_JSON" > "$CACHE_FILE" 2>/dev/null || true
  else
    CONFIG_JSON='{}'
  fi
fi

# Check a specific flag (default true if absent)
is_enabled() {
  local path="$1"
  printf '%s' "$CONFIG_JSON" | jq -r "$path // true" 2>/dev/null
}

# Example usage:
if [ "$(is_enabled '.hooks.tracking.file_access')" = "true" ]; then
  # Track file access
fi
```

### Hook Consolidation Plan

Once the plugin hooks are complete, the project-level `.claude/settings.json`
ruvector hooks become redundant. The migration path:

1. **Phase 1:** Add PreToolUse hooks to yellow-ruvector's plugin.json
   (trajectory tracking, pre-edit, coedit-suggest, activity tracking)
2. **Phase 2:** Add opt-in config support via
   `.claude/yellow-ruvector.local.md`
3. **Phase 3:** Add a `/ruvector:setup` step that detects overlapping
   project-level hooks in `.claude/settings.json` and offers to remove them
   (with user confirmation via AskUserQuestion)
4. **Phase 4:** Update documentation to recommend plugin-only hooks, deprecate
   manual settings.json hook configuration

### Integration with Plugin Cascade

The hooks strategy intersects with the shared skill + plugin cascade approach:

- **The shared skill** (`mcp-integration-patterns` in yellow-core) defines WHEN
  to recall/remember (command-level integration in workflow steps)
- **The plugin hooks** (`plugin.json` in yellow-ruvector) define HOW to
  recall/remember (automatic, transparent, on every tool use)
- **The config file** (`.claude/yellow-ruvector.local.md`) controls WHICH hooks
  are active (opt-in/opt-out per feature)

These three layers are complementary, not competing:

| Layer | Scope | Granularity | Example |
|---|---|---|---|
| Shared skill | Command workflow steps | Per-command, explicit | "Before planning, recall past implementation learnings" |
| Plugin hooks | Every tool invocation | Per-tool-use, transparent | "After every Edit, record file change in activity graph" |
| Config file | Per-project settings | Per-feature toggle | "Disable search pattern tracking in this project" |

---

## Open Questions

1. **hooks_recall domain_hint parameter.** Does the current ruvector
   hooks_recall MCP tool accept a domain_hint or tags parameter for biasing
   results? If not, the hybrid scoping strategy requires either: (a) extending
   hooks_recall to accept optional filter hints, or (b) embedding domain
   keywords in the query string itself (less precise but zero API changes).

2. **Signal classification granularity.** The tiered remember system needs a
   concrete decision table mapping (plugin, event_type, severity) to signal
   tier. Should this live in the shared skill as a static table, or should each
   plugin declare its own tier mappings in its CLAUDE.md?

3. **Morph tool name stability.** The morph MCP tool names
   (`mcp__plugin_yellow-morph_morph__edit_file`,
   `mcp__plugin_yellow-morph_morph__warpgrep_codebase_search`) are derived from
   the plugin namespace. If yellow-morph is renamed or restructured, all
   ToolSearch queries break. Should the skill use keyword-based ToolSearch
   (`"morph edit"`) rather than exact tool name selection to be resilient to
   renames?

4. **Remember dedup across routes.** When compound writes to docs/solutions +
   MEMORY.md + hooks_remember, the same knowledge exists in three places. Is
   this intentional redundancy (different access patterns: file search vs.
   memory load vs. semantic recall), or should we consolidate toward ruvector as
   the primary store with docs/solutions as the human-readable archive?

5. **Session-level vs. command-level morph discovery.** ToolSearch for morph
   tools on every command invocation adds latency. Should we cache the discovery
   result for the session (e.g., in a session-start hook that sets a flag), or
   is per-command discovery acceptable given ToolSearch is fast?

6. **Hook deduplication during migration.** During the transition period where
   both plugin hooks (plugin.json) and project-level hooks
   (.claude/settings.json) coexist, ruvector will receive duplicate signals
   (e.g., two post-edit calls per file write). Should ruvector's CLI deduplicate
   internally (idempotent within a time window), or should we provide a migration
   tool that removes the project-level hooks as soon as plugin hooks are
   complete?

7. **YAML parsing dependency.** The proposed config parsing in hook scripts
   requires either `python3` with PyYAML or `yq` for YAML-to-JSON conversion.
   PyYAML is not in Python's stdlib. If neither is available, should the config
   file use JSON frontmatter instead of YAML (breaking the `.local.md`
   convention), or should the hooks fall back to "all enabled" when YAML parsing
   is unavailable?

8. **Config cache invalidation in worktrees.** The `.ruvector/` directory is
   shared across git worktrees. If `.claude/yellow-ruvector.local.md` differs
   between worktrees (different projects), the config cache in
   `.ruvector/hook-config-cache.json` could serve stale config. Should the
   cache key include the project directory path, or should each worktree get
   its own cache file?

9. **PreToolUse budget constraints.** Claude Code imposes strict timeout
   budgets on hooks. The proposed PreToolUse hooks for Read (500ms), Glob/Grep
   (500ms), and Task (500ms) add latency to every tool invocation. The current
   project-level hooks use 2000ms timeouts which is generous. What is the
   right budget for plugin-level PreToolUse hooks that balances tracking
   fidelity against user-perceived latency? Should low-value tracking (Read,
   Glob/Grep) use fire-and-forget with a 100ms budget instead?

10. **Scope of opt-in: per-project vs. global.** The `.local.md` convention
    is per-project. Some users may want a global default (e.g., "disable
    search pattern tracking everywhere"). Should there be a global config at
    `~/.claude/yellow-ruvector.config.md` that per-project configs override,
    or is per-project sufficient?
