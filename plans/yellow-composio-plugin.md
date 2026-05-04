# Feature: yellow-composio Plugin

> **Status: Implemented (PR #237, merged)** — v1.0 shipped at `plugins/yellow-composio/`. Cross-plugin consumer integration (yellow-review, yellow-semgrep, yellow-linear) and rate-limit header forwarding remain deferred to v1.1+/v2 per Open Questions.

## Problem Statement

Composio is configured at the user level as a Claude.ai MCP connector
(`mcp__claude_ai_composio__*` tools), providing access to 1,000+ toolkits and
11,000+ actions. However, existing yellow-plugin workflows have no awareness of
Composio's capabilities -- particularly the Remote Workbench for batch
processing and Multi-Execute for parallel tool calls. Several batch-heavy
workflows (review:all, semgrep:fix-batch, Linear batch ops) suffer from context
window pressure that Composio could alleviate by offloading data-heavy
operations to a remote sandbox.

Additionally, Composio has no billing/usage API -- local tracking is the only way
to monitor execution budget consumption across sessions.

### Who Benefits

- Plugin users running batch-heavy workflows who hit context limits
- The existing review, semgrep, and Linear plugins (optional acceleration)
- Future workflows that need cross-service orchestration

## Current State

- Composio MCP tools are available via Claude's native connector (`mcp__claude_ai_composio__*`)
- No plugin in yellow-plugins references or documents Composio
- No local usage tracking exists
- Consuming plugins have no instructions for Composio-assisted batch processing
- Cross-plugin detection patterns exist (ToolSearch probe, graceful degradation)
  and are well-established across yellow-review, yellow-debt, and yellow-morph

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: `mcp__claude_ai_composio__*` tools ARE discoverable
> via ToolSearch. Query `"COMPOSIO_REMOTE_WORKBENCH"` returns
> `mcp__claude_ai_composio__COMPOSIO_REMOTE_WORKBENCH` with full schema.
> Query `"COMPOSIO_SEARCH_TOOLS"` also finds Composio tools. This validates the
> core assumption that user-level MCP tools work with the existing ToolSearch
> probe pattern used by yellow-review and yellow-debt.
<!-- /deepen-plan -->

## Proposed Solution

Create a thin `yellow-composio` plugin with:
1. A `/composio:setup` command validating MCP server availability and
   initializing local usage tracking
2. A `/composio:status` command displaying execution counts and threshold
   warnings
3. A `composio-patterns` skill documenting Workbench, Multi-Execute, and
   connection management patterns for consuming plugins to reference

<!-- deepen-plan: codebase -->
> **Codebase:** CRITICAL: No cross-plugin `skills:` preloading mechanism exists
> in this codebase. All `skills:` frontmatter references are intra-plugin only
> (e.g., `semgrep-conventions` is only used by yellow-semgrep agents). Consuming
> plugins (yellow-review, yellow-semgrep, yellow-linear) cannot preload
> `composio-patterns` via frontmatter. Instead, consuming plugin commands must
> embed the relevant Composio patterns inline -- the same way `review:pr`
> embeds ruvector recall patterns inline (lines 69-114) rather than loading
> `mcp-integration-patterns` from yellow-core via `skills:`.
<!-- /deepen-plan -->

The plugin does NOT bundle an MCP server (tools come from Claude's native
connector). It does NOT create new workflows -- it teaches existing agents how to
optionally use Composio tools when available. No agents in v1.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: `plugin.json` can omit `mcpServers` entirely.
> `yellow-debt` and `yellow-browser-test` both have no `mcpServers` field.
> The `schemas/plugin.schema.json` requires only `name`, `version`,
> `description`, `author` -- `mcpServers` is optional.
<!-- /deepen-plan -->

### Key Design Decisions

1. **Optional accelerator** -- Every workflow must work without Composio. Detection
   via ToolSearch; silent fallback when absent.
2. **Hybrid execution** -- Semgrep/Linear batch ops run remote (Workbench);
   cross-PR finding aggregation stays local with structured output.
3. **Local usage tracking** -- `.claude/composio-usage.json` tracks cumulative
   execution counts since Composio has no billing API. Best-effort (parallel
   sessions may drift slightly).
4. **No agents in v1** -- Batch patterns are not yet stable enough to abstract
   into a generic orchestration agent. Ship the skill first, extract agents in
   v2 if warranted.

## Implementation Plan

### Phase 1: Plugin Scaffold

- [x] 1.1: Create directory structure
  ```
  plugins/yellow-composio/
    .claude-plugin/plugin.json
    .gitattributes
    package.json
    CLAUDE.md
    README.md
    CHANGELOG.md
    commands/composio/
      setup.md
      status.md
    skills/composio-patterns/
      SKILL.md
  ```

- [x] 1.2: Create `package.json` (version source of truth)
  ```json
  {
    "name": "yellow-composio",
    "version": "1.0.0",
    "private": true,
    "description": "Optional Composio accelerator for batch workflows with usage tracking"
  }
  ```

- [x] 1.3: Create `.claude-plugin/plugin.json` -- No `mcpServers` field (tools
  come from Claude's native connector). Fields: name, version, description,
  author, homepage, repository, license, keywords.

- [x] 1.4: Create `.gitattributes` (standard boilerplate)

- [x] 1.5: Register in `.claude-plugin/marketplace.json`
  ```json
  {
    "name": "yellow-composio",
    "description": "Optional Composio accelerator for batch workflows with usage tracking",
    "version": "1.0.0",
    "author": { "name": "KingInYellows" },
    "source": "./plugins/yellow-composio",
    "category": "productivity"
  }
  ```

### Phase 2: Setup Command

- [x] 2.1: Create `/composio:setup` command at `commands/composio/setup.md`

  Frontmatter:
  ```yaml
  ---
  name: composio:setup
  description: Validate Composio MCP availability, check connections, and initialize local usage tracking. Use when first installing the plugin, after MCP config changes, or when composio tools stop working.
  argument-hint: ''
  allowed-tools:
    - Bash
    - AskUserQuestion
    - ToolSearch
    - Read
    - Write
  ---
  ```

  Workflow steps:
  1. **Check prerequisites** -- Verify `jq` is installed (`command -v jq`). If
     missing, warn that usage tracking will be degraded (soft prereq, not fatal).
  2. **Check Composio MCP tools** -- `ToolSearch("COMPOSIO_SEARCH_TOOLS")`. If
     not found, report that Composio MCP server is not configured and provide
     setup instructions (link to composio.dev/docs, `claude mcp add` command).
     Stop.
  3. **Probe MCP connectivity** -- Call `COMPOSIO_SEARCH_TOOLS` with a simple
     test query (e.g., `queries: [{"use_case": "list available toolkits"}]`).
     If error, report connectivity issue. Stop. This probe implicitly validates
     the API key -- no separate key validation needed since the native MCP
     connector manages credentials.
  4. **Check connected apps** -- Parse the `toolkit_connection_statuses` from the
     search response. Report which apps have ACTIVE connections vs missing.

<!-- deepen-plan: codebase -->
> **Codebase:** The COMPOSIO_SEARCH_TOOLS response includes a
> `toolkit_connection_statuses` array with `has_active_connection`, `status`,
> `connected_account_id`, and `current_user_info` per toolkit. This is
> sufficient to enumerate connected apps without a separate API call --
> confirmed by direct probe in this session. The response also includes a
> `session.id` field that must be passed to subsequent tool calls.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Composio API key format is not publicly documented with a
> prefix pattern (unlike Semgrep's `sgp_` prefix). The key is passed via
> `X-API-Key` header by the native MCP connector -- the plugin should NOT
> attempt to read or validate the key directly. The probe call is the
> authoritative auth check. If the probe returns `401`, report "API key
> expired or invalid -- reconfigure your Composio MCP server."
<!-- /deepen-plan -->
  5. **Initialize usage counter** -- Check if `.claude/composio-usage.json`
     exists. If not, create it with the schema below. If it exists, validate
     structure (check `version` field, valid JSON). If corrupted, offer to
     reset via AskUserQuestion.

<!-- deepen-plan: codebase -->
> **Codebase:** The `.claude/` directory at project root is gitignored (used
> for local plugin state). Usage tracking file should live at project-level
> `.claude/composio-usage.json` (not `$HOME/.claude/`) to match existing
> conventions. Note: Composio billing is per-account, so a single user working
> across repos will have separate counters per project. This is acceptable for
> v1 -- cross-repo aggregation can be a v2 feature if needed.
<!-- /deepen-plan -->
  6. **Report results** -- Summary table:
     ```
     yellow-composio Setup Results
     ==============================
     MCP Server:     connected (N tools discoverable)
     Connected Apps: github, slack, linear, ... (N active)
     Usage Tracking: initialized at .claude/composio-usage.json
     ==============================
     Setup complete. Run /composio:status to see usage dashboard.
     ```

### Phase 3: Status Command

- [x] 3.1: Create `/composio:status` command at `commands/composio/status.md`

  Frontmatter:
  ```yaml
  ---
  name: composio:status
  description: Show Composio usage dashboard with execution counts and threshold warnings. Use when checking budget, verifying connectivity, or monitoring usage across sessions.
  argument-hint: ''
  allowed-tools:
    - Bash
    - Read
    - ToolSearch
  ---
  ```

  Workflow steps:
  1. **Read usage counter** -- Read `.claude/composio-usage.json`. If missing,
     report "Run `/composio:setup` first" and stop.
  2. **Calculate current period stats** -- Sum executions for current month.
     Calculate daily average. Project monthly total.
  3. **Check thresholds** -- Two tiers: warn at 80% of `monthly_warn`, soft-block
     (display prominent warning) at 100%. Never hard-block -- user owns their
     budget. Default `monthly_warn`: 10,000 (matches free tier).
  4. **Probe MCP health** -- Quick ToolSearch for `COMPOSIO_SEARCH_TOOLS` to
     confirm connectivity (do NOT execute a search -- just check tool exists).
  5. **Display dashboard**:
     ```
     Composio Usage Dashboard
     ========================
     MCP Server:        connected
     Current Month:     March 2026
     Executions:        142 / 10,000 (1.4%)
     Daily Average:     5.3 calls/day
     Projected Monthly: ~160 calls
     Threshold:         8,000 (warning) -- OK

     Top Tools (this month):
       COMPOSIO_REMOTE_WORKBENCH:   87
       COMPOSIO_MULTI_EXECUTE_TOOL: 43
       COMPOSIO_SEARCH_TOOLS:       12

     Last 7 Days:
       Mar 21: 8  Mar 22: 12  Mar 23: 0  ...
     ========================
     ```

### Phase 4: Composio Patterns Skill

- [x] 4.1: Create `composio-patterns` skill at
  `skills/composio-patterns/SKILL.md`

  Frontmatter:
  ```yaml
  ---
  name: composio-patterns
  description: Composio MCP tool patterns, Workbench batch processing, Multi-Execute, usage tracking, and graceful degradation conventions. Use when commands or agents need Composio integration context.
  user-invokable: false
  ---
  ```

  Content sections:
  1. **Overview** -- What Composio provides, how it integrates with Claude Code
  2. **Tool Reference** -- Quick reference for the 6 meta tools
     (COMPOSIO_SEARCH_TOOLS, COMPOSIO_GET_TOOL_SCHEMAS,
     COMPOSIO_MULTI_EXECUTE_TOOL, COMPOSIO_MANAGE_CONNECTIONS,
     COMPOSIO_REMOTE_WORKBENCH, COMPOSIO_REMOTE_BASH_TOOL)
  3. **Workbench Batch Processing Pattern** -- Step-by-step pattern for
     offloading batch operations:
     - When to use: processing 10+ items, large API responses, data
       transformation
     - Session lifecycle: each operation creates its own session (no reuse
       across workflow steps in v1 -- simpler, avoids state leakage)
     - Built-in helpers: `run_composio_tool()`, `invoke_llm()`,
       `upload_local_file()`, `proxy_execute()`
     - Parallelism: `ThreadPoolExecutor` pattern with max_workers guidance
     - `sync_response_to_workbench=true` for context window management
     - Remote file path warning: paths returned from Workbench (e.g.,
       `/home/user/...`) are REMOTE -- never use as local file paths

<!-- deepen-plan: external -->
> **Research:** The Workbench `session_id` is returned in the
> `COMPOSIO_SEARCH_TOOLS` response under `session.id`. This same session_id
> must be passed to `COMPOSIO_REMOTE_WORKBENCH` and `COMPOSIO_REMOTE_BASH_TOOL`
> calls. The Workbench has a hard 4-minute timeout per execution. For bulk
> operations exceeding this, the skill should document a "chunked execution"
> pattern: split work into batches of N items, execute each batch in a separate
> Workbench call, aggregate results across calls. State persists across calls
> within the same session_id.
<!-- /deepen-plan -->
  4. **Multi-Execute Pattern** -- Batching up to 50 independent tool calls
  5. **Usage Tracking Convention** -- JSON schema, how consuming commands should
     increment counters (bash snippet), threshold checking
  6. **Graceful Degradation Pattern** -- ToolSearch probe -> fallback:
     ```
     1. ToolSearch("COMPOSIO_REMOTE_WORKBENCH")
     2. If not found: skip Composio path, use existing local approach
     3. If found: proceed with Composio-accelerated path
     4. If Composio call fails at runtime: fall back to local approach,
        note degradation briefly
     ```

<!-- deepen-plan: codebase -->
> **Codebase:** The ToolSearch query should use `"COMPOSIO_REMOTE_WORKBENCH"`
> (not `"COMPOSIO_SEARCH_TOOLS"`) for consumer detection. Reason: consumers
> care about Workbench availability specifically. The existing cross-plugin
> pattern in `review:pr` (lines 69-114) uses a specific tool name for probe
> (e.g., `"hooks_recall"` for ruvector, `"morph warpgrep"` for morph), not a
> generic service name. Three detection patterns exist in the codebase:
> Pattern A (ToolSearch probe -- used by review:pr for ruvector/morph),
> Pattern B (ToolSearch in agent body -- used by debt scanners for ast-grep),
> Pattern C (direct call -- used by debt:sync for Linear). This plugin should
> use Pattern A since Composio is an optional enhancement.
<!-- /deepen-plan -->
  7. **Error Handling Catalog** -- Common errors and recovery:
     | Error | Recovery |
     |-------|----------|
     | MCP server not configured | Run /composio:setup |
     | 401 Unauthorized | API key expired, re-configure |
     | 429 Rate Limited | Wait for Retry-After header value |
     | Workbench timeout (4min) | Reduce batch size, add checkpoints |
     | Connection not ACTIVE | Run COMPOSIO_MANAGE_CONNECTIONS |
  8. **Security Notes** -- Data sent to Composio cloud, remote execution trust
     model, don't send secrets via Workbench

### Phase 5: Plugin Documentation

- [x] 5.1: Create `CLAUDE.md` (agent-facing)
  Sections: Plugin description, Composio MCP tools (not bundled -- native
  connector), Tool reference, Graceful degradation, Plugin components, Usage
  tracking, Security notes, Known limitations.

- [x] 5.2: Create `README.md` (human-facing)
  Sections: Installation, Quick Start, Commands table, Prerequisites
  (Composio account + MCP server configured), How It Works (optional
  accelerator model), License.

- [x] 5.3: Create `CHANGELOG.md`
  ```markdown
  # Changelog

  ## 1.0.0 - 2026-03-27

  ### Added
  - `/composio:setup` command for MCP validation and usage tracking init
  - `/composio:status` command for usage dashboard and threshold warnings
  - `composio-patterns` skill for consuming plugin integration
  ```

### Phase 6: Validation and Release Prep

- [x] 6.1: Run `pnpm validate:schemas` to validate plugin.json and marketplace
- [x] 6.2: Run `node scripts/validate-agent-authoring.js` (should pass -- no
  agents in v1)
- [x] 6.3: Create changeset via `pnpm changeset` (minor -- new plugin)

## Technical Specifications

### Files to Create

| File | Purpose |
|------|---------|
| `plugins/yellow-composio/.claude-plugin/plugin.json` | Plugin manifest (no mcpServers) |
| `plugins/yellow-composio/package.json` | Version source of truth |
| `plugins/yellow-composio/.gitattributes` | LF line endings |
| `plugins/yellow-composio/CLAUDE.md` | Agent-facing documentation |
| `plugins/yellow-composio/README.md` | Human-facing documentation |
| `plugins/yellow-composio/CHANGELOG.md` | Version history |
| `plugins/yellow-composio/commands/composio/setup.md` | Setup command |
| `plugins/yellow-composio/commands/composio/status.md` | Status command |
| `plugins/yellow-composio/skills/composio-patterns/SKILL.md` | Patterns skill |

### Files to Modify

| File | Change |
|------|--------|
| `.claude-plugin/marketplace.json` | Add yellow-composio entry |

### No Files Modified in Consuming Plugins (v1)

Consuming plugin changes (yellow-review, yellow-semgrep, yellow-linear) are
**deferred to v1.1+**. The v1.0 release establishes the plugin, skill, and usage
tracking infrastructure. Consuming plugins will add Composio-awareness in
follow-up PRs after the skill is available for preloading.

### Usage Tracking Schema

`.claude/composio-usage.json`:
```json
{
  "version": 1,
  "created": "2026-03-27T00:00:00.000Z",
  "updated": "2026-03-27T00:00:00.000Z",
  "thresholds": {
    "daily_warn": 200,
    "monthly_warn": 10000
  },
  "periods": {
    "2026-03": {
      "total": 0,
      "by_tool": {
        "COMPOSIO_REMOTE_WORKBENCH": 0,
        "COMPOSIO_MULTI_EXECUTE_TOOL": 0,
        "COMPOSIO_SEARCH_TOOLS": 0,
        "COMPOSIO_REMOTE_BASH_TOOL": 0,
        "COMPOSIO_MANAGE_CONNECTIONS": 0,
        "COMPOSIO_GET_TOOL_SCHEMAS": 0
      },
      "by_day": {
        "2026-03-27": 0
      }
    }
  }
}
```

Counter increment snippet (for composio-patterns skill):
```bash
USAGE_FILE=".claude/composio-usage.json"
LOCK_FILE="${USAGE_FILE}.lock"
TOOL_SLUG="$1"
TODAY=$(date -u +%Y-%m-%d)
MONTH=$(date -u +%Y-%m)

if [ -f "$USAGE_FILE" ]; then
  mkdir -p "$(dirname "$USAGE_FILE")"
  # Atomic increment: flock if available, raw jq+tmp+mv otherwise
  if command -v flock >/dev/null 2>&1; then
    touch "$LOCK_FILE"
    (
      flock -x 200
      if jq --arg tool "$TOOL_SLUG" --arg day "$TODAY" --arg month "$MONTH" '
        .updated = (now | todate) |
        .periods[$month] //= {"total": 0, "by_tool": {}, "by_day": {}} |
        .periods[$month].total += 1 |
        .periods[$month].by_tool[$tool] = ((.periods[$month].by_tool[$tool] // 0) + 1) |
        .periods[$month].by_day[$day] = ((.periods[$month].by_day[$day] // 0) + 1)
      ' "$USAGE_FILE" > "${USAGE_FILE}.tmp"; then
        mv "${USAGE_FILE}.tmp" "$USAGE_FILE"
      else
        rm -f "${USAGE_FILE}.tmp"
      fi
    ) 200>"$LOCK_FILE"
  else
    if jq --arg tool "$TOOL_SLUG" --arg day "$TODAY" --arg month "$MONTH" '
      .updated = (now | todate) |
      .periods[$month] //= {"total": 0, "by_tool": {}, "by_day": {}} |
      .periods[$month].total += 1 |
      .periods[$month].by_tool[$tool] = ((.periods[$month].by_tool[$tool] // 0) + 1) |
      .periods[$month].by_day[$day] = ((.periods[$month].by_day[$day] // 0) + 1)
    ' "$USAGE_FILE" > "${USAGE_FILE}.tmp"; then
      mv "${USAGE_FILE}.tmp" "$USAGE_FILE"
    else
      rm -f "${USAGE_FILE}.tmp"
    fi
  fi
fi
```

<!-- deepen-plan: external -->
> **Research:** `jq + tmp + mv` provides atomic file replacement but the
> read-modify-write cycle is NOT atomic -- two processes can read the same value
> and one update is lost. Use `flock -x` (Linux `util-linux`) when available
> for exclusive locking. On macOS, `flock` requires Homebrew install. The
> snippet above uses `flock` if available, falls back to raw `jq+tmp+mv`
> otherwise. For a usage counter, occasional lost increments are low-severity.
> Also added `//= {}` for intermediate period object creation to prevent `null`
> entries when auto-vivifying new month keys.
<!-- /deepen-plan -->

## Acceptance Criteria

1. `pnpm validate:schemas` passes with yellow-composio included
2. `/composio:setup` detects whether Composio MCP tools are available and
   reports connected apps
3. `/composio:setup` creates `.claude/composio-usage.json` with correct schema
4. `/composio:status` reads and displays usage data with threshold warnings
5. `/composio:status` reports "Run /composio:setup first" when counter missing
6. `composio-patterns` skill is loadable within yellow-composio and serves as
   reference documentation for consuming plugin authors
7. Plugin works when Composio MCP server is NOT configured (setup reports
   missing, status reports missing, skill is still loadable)
8. Marketplace entry is valid and plugin appears in catalog

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Composio MCP server not configured | setup: report missing + instructions; status: report offline |
| API key expired/invalid | setup: probe fails, report auth error with re-config link |
| Usage counter file corrupted | setup: detect invalid JSON, offer reset via AskUserQuestion |
| Usage counter file missing | status: "Run /composio:setup first"; setup: create fresh |
| Parallel sessions incrementing counter | Best-effort -- jq atomic write via tmp+mv, slight drift acceptable |
| No `jq` installed | setup: check for jq as soft prereq, warn that usage tracking is degraded |
| Threshold exceeded | status: display warning with projected monthly total |
| New month rolls over | Counter auto-creates new period key on first increment |
| Setup re-run (idempotency) | Preserve existing usage data; only reset if user explicitly requests via AskUserQuestion |
| `.claude/` dir missing | setup: create `.claude/` directory before writing usage file |
| Workbench partial failure | Consuming plugin: log warning, return partial results, fall back to local for remaining items |

<!-- deepen-plan: codebase -->
> **Codebase:** The jq atomic write pattern (`tmp+mv`) used in the counter
> increment snippet provides last-writer-wins semantics. This is consistent
> with how other plugins handle concurrent state -- yellow-ruvector's vector DB
> uses similar file-level atomicity. For approximate usage tracking, this is
> sufficient. File locking (`flock`) is unnecessary overhead for v1.
<!-- /deepen-plan -->

## Security Considerations

- **No API keys stored** -- Plugin does not store Composio API key. The native
  MCP connector handles credential management.
- **Remote execution trust** -- Workbench executes code on Composio's cloud.
  The skill documents this clearly and warns against sending secrets.
- **Usage counter is local** -- `.claude/composio-usage.json` contains only
  execution counts, no credentials or sensitive data.
- **No data exfiltration** -- Plugin never sends local file contents to Composio.
  Consuming plugins decide what to send based on their own security policies.
- **Content fencing** -- All Composio responses should be wrapped in
  `--- begin/end ---` delimiters per repository convention (defensive authoring
  pattern from PR #202).

<!-- deepen-plan: external -->
> **Research:** Composio Workbench sandbox isolation details are not publicly
> documented (containerization, network policies, tenant separation). The
> `composio-patterns` skill should include a prominent warning: "Workbench
> executes Python code on Composio's remote infrastructure. Do not send
> sensitive file contents, credentials, private keys, or proprietary algorithms.
> Use Workbench for data processing and API orchestration, not as a trusted
> execution environment." This aligns with the Composio enterprise page which
> offers VPC/on-prem deployment for stricter security requirements.
<!-- /deepen-plan -->

## Open Design Decisions (Resolved by Enrichment)

These were flagged as open questions in the brainstorm and are now resolved:

| Question | Resolution | Source |
|----------|-----------|--------|
| Usage tracking schema | Defined in Technical Specifications section | Plan Phase 4 |
| Threshold configuration | Stored in usage JSON `thresholds` field; warn at 80%, prominent warning at 100%, never hard-block | Spec flow analysis |
| Workbench session lifecycle | Per-operation sessions in v1 (no reuse); v2 may optimize | Spec flow analysis |
| MCP server version pinning | Presence-only validation via ToolSearch + probe call; no version check for remote HTTP service | Spec flow analysis |
| Skill preloading mechanics | No cross-plugin `skills:` mechanism exists; consuming plugins embed patterns inline (Pattern A from review:pr) | Codebase research |
| Rate limit header forwarding | Deferred to v2; v1 tracks cumulative local counts only | Brainstorm Q6 |

## References

- Brainstorm: `docs/brainstorms/2026-03-27-composio-integration-thin-plugin-brainstorm.md`
- Research: `docs/research/composio-claude-code-integration-capabil.md`
- Scaffold reference: `plugins/yellow-morph/` (simplest existing plugin)
- Setup pattern: `plugins/yellow-semgrep/commands/semgrep/setup.md`
- Status pattern: `plugins/yellow-morph/commands/morph/status.md`
- Skill pattern: `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md`
- Cross-plugin detection: `plugins/yellow-review/commands/review/review-pr.md` (lines 69-114)
- Marketplace: `.claude-plugin/marketplace.json`
- Plugin schema: `schemas/plugin.schema.json` (confirms mcpServers is optional)
- 64-char tool name limit: MCP tool names have a hard 64-char API limit
  (`mcp__` prefix + server name + `__` + tool name). Current user's Composio
  server name (`claude_ai_composio`) produces names like
  `mcp__claude_ai_composio__COMPOSIO_REMOTE_WORKBENCH` (51 chars) -- within
  limit but tight. The ToolSearch keyword query approach avoids hardcoding
  full names.
- Additional Composio meta tools (beyond the 6 in the plan):
  `COMPOSIO_CREATE_PLAN`, `COMPOSIO_WAIT_FOR_CONNECTIONS`,
  `COMPOSIO_LIST_TOOLKITS`, `COMPOSIO_EXECUTE_AGENT`,
  `COMPOSIO_GET_TOOL_DEPENDENCY_GRAPH`. Consider documenting these in the
  skill for completeness.

<!-- deepen-plan: external -->
> **Research:** Composio's official Claude Code integration docs recommend
> `claude mcp add --transport http composio-server "YOUR_MCP_URL"` with
> `--headers "X-API-Key:YOUR_COMPOSIO_API_KEY"`. The setup command should
> include this exact command in its "not configured" instructions. Alternative
> npx setup: `npx @composio/mcp@latest setup "<customer_id>" "<app_id>"
> --client claude`. See: https://composio.dev/toolkits/composio/framework/claude-code
<!-- /deepen-plan -->
