---
name: composio-patterns
description: "Composio MCP tool patterns, Workbench batch processing, Multi-Execute, usage tracking, and graceful degradation conventions. Use when commands or agents need Composio integration context."
user-invokable: false
---

# Composio Integration Patterns

Reference conventions for yellow-composio plugin -- tool patterns, batch
processing, usage tracking, graceful degradation, and security rules.

## Overview

Composio is a managed tool integration platform providing 1,000+ toolkits and
11,000+ actions via a single MCP server. In yellow-plugins, Composio is an
**optional accelerator** -- all workflows must function without it. Tools are
provided by the user's MCP connector (prefix varies by configuration, e.g.,
`mcp__claude_ai_composio__*` or `mcp__composio-server__*`), not bundled by
this plugin.

## Tool Reference

### Meta Tools (Always Available in Composio Session)

| Tool | Slug | Purpose |
|------|------|---------|
| Search Tools | `COMPOSIO_SEARCH_TOOLS` | Discover tools, get schemas, check connection status |
| Get Schemas | `COMPOSIO_GET_TOOL_SCHEMAS` | Full parameter schemas for specific tools |
| Multi-Execute | `COMPOSIO_MULTI_EXECUTE_TOOL` | Run up to 50 tools in parallel |
| Manage Connections | `COMPOSIO_MANAGE_CONNECTIONS` | OAuth flow, API key auth for apps |
| Remote Workbench | `COMPOSIO_REMOTE_WORKBENCH` | Persistent Python sandbox (Jupyter-style) |
| Remote Bash | `COMPOSIO_REMOTE_BASH_TOOL` | Bash commands in the sandbox |

### Additional Meta Tools

| Tool | Purpose |
|------|---------|
| `COMPOSIO_CREATE_PLAN` | Generate execution plans for complex tasks |
| `COMPOSIO_WAIT_FOR_CONNECTIONS` | Pause for user auth completion |
| `COMPOSIO_LIST_TOOLKITS` | List all available toolkits with filters |
| `COMPOSIO_EXECUTE_AGENT` | Execute complex multi-step workflows |
| `COMPOSIO_GET_TOOL_DEPENDENCY_GRAPH` | Related/parent tool discovery |

### App-Specific Tools

Follow `{TOOLKIT}_{ACTION}` naming (e.g., `GMAIL_SEND_EMAIL`,
`GITHUB_CREATE_ISSUE`). Discovered at runtime via `COMPOSIO_SEARCH_TOOLS` --
never hardcode app-specific tool slugs.

## Workbench Batch Processing Pattern

Use `COMPOSIO_REMOTE_WORKBENCH` when processing 10+ items, handling large API
responses, or performing data transformation that would consume excessive
context tokens.

### When to Use

- Fetching and classifying 10+ items (Linear issues, semgrep findings, etc.)
- Aggregating results from multiple API calls
- Data transformation, filtering, and summarization
- Any operation where raw response data would overwhelm context

### Session Lifecycle

1. **Get session_id** from `COMPOSIO_SEARCH_TOOLS` response (`session.id`)
2. **Execute code** via `COMPOSIO_REMOTE_WORKBENCH` with `session_id`
3. **State persists** across calls within the same session
4. **Each operation creates its own session** (no reuse across workflow steps
   in v1 -- avoids state leakage)

### Built-in Helpers

Available inside `COMPOSIO_REMOTE_WORKBENCH` code:

| Helper | Purpose |
|--------|---------|
| `run_composio_tool(slug, args)` | Execute any Composio tool; returns `(response, error)` |
| `invoke_llm(query)` | Call LLM for classification/summarization (max 200K chars) |
| `upload_local_file(*paths)` | Upload files to cloud storage; returns download URL |
| `proxy_execute(method, endpoint, toolkit)` | Direct API calls when no tool exists |
| `web_search` | Search the web for data enrichment |
| `smart_file_extract` | Extract text from PDFs, images, documents |

### Parallelism Pattern

```python
from concurrent.futures import ThreadPoolExecutor

items = [...]  # list of items to process
results = []

def process_item(item):
    response, error = run_composio_tool("TOOL_SLUG", {"arg": item})
    return {"item": item, "result": response, "error": error}

with ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(process_item, items))
```

### Context Window Management

Use `sync_response_to_workbench=true` on `COMPOSIO_MULTI_EXECUTE_TOOL` to save
large responses to the remote sandbox instead of returning them inline. Then
process via `COMPOSIO_REMOTE_WORKBENCH` or `COMPOSIO_REMOTE_BASH_TOOL`.

### Chunked Execution for Large Batches

Workbench has a **hard 4-minute timeout** per execution. For batches exceeding
this:

1. Split work into chunks of N items (start with N=20, adjust based on
   per-item processing time)
2. Execute each chunk in a separate Workbench call
3. State persists across calls within the same session_id
4. Aggregate results across chunks after all complete

### Remote File Path Warning

Paths returned from Workbench (e.g., `/home/user/.code_out/response.json`) are
**REMOTE** -- they exist only in the sandbox. Never use them as local file
paths. To get data out of the sandbox, return it inline from the Python code or
use `upload_local_file()` for large artifacts.

## Multi-Execute Pattern

`COMPOSIO_MULTI_EXECUTE_TOOL` runs up to 50 independent tool calls in parallel.

### Rules

- Use valid tool slugs from `COMPOSIO_SEARCH_TOOLS` -- never invent slugs
- Ensure ACTIVE connections for all toolkits being called
- Only batch logically independent operations (no ordering dependencies)
- Do not pass dummy or placeholder values

### Workflow

```text
COMPOSIO_SEARCH_TOOLS -> COMPOSIO_MANAGE_CONNECTIONS (if needed) -> COMPOSIO_MULTI_EXECUTE_TOOL
```

## Usage Tracking Convention

### Schema

`.claude/composio-usage.json`:

```json
{
  "version": 1,
  "created": "ISO8601",
  "updated": "ISO8601",
  "thresholds": {
    "daily_warn": 200,
    "monthly_warn": 8000
  },
  "periods": {
    "YYYY-MM": {
      "total": 0,
      "by_tool": { "TOOL_SLUG": 0 },
      "by_day": { "YYYY-MM-DD": 0 }
    }
  }
}
```

### Counter Increment

Consuming commands should increment the counter after each Composio tool
execution using this pattern:

```bash
USAGE_FILE=".claude/composio-usage.json"
LOCK_FILE="${USAGE_FILE}.lock"
# Caller must set TOOL_SLUG before sourcing (e.g., TOOL_SLUG="COMPOSIO_REMOTE_WORKBENCH")
: "${TOOL_SLUG:?TOOL_SLUG is required}"
TODAY=$(date -u +%Y-%m-%d)
MONTH=$(date -u +%Y-%m)

do_increment() {
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
}

if [ -f "$USAGE_FILE" ]; then
  if command -v flock >/dev/null 2>&1; then
    touch "$LOCK_FILE"
    ( flock -x 200; do_increment ) 200>"$LOCK_FILE"
  else
    do_increment
  fi
fi
```

Increment **post-execution** (after confirmed success), not pre-execution.

### Threshold Checking

- Warn at 80% of `monthly_warn` (approaching threshold)
- Warn when projected monthly usage exceeds `monthly_warn`
- Display prominent warning when actual usage reaches `monthly_warn`
- Check daily count against `daily_warn` threshold
- Never hard-block -- the user owns their budget

## Graceful Degradation Pattern

All consuming plugins must detect Composio availability at runtime and fall back
silently when absent.

### Detection (Pattern A -- ToolSearch Probe)

```text
1. ToolSearch("COMPOSIO_REMOTE_WORKBENCH")
2. If not found: skip Composio path, use existing local approach
3. If found: proceed with Composio-accelerated path
4. If Composio call fails at runtime: fall back to local approach,
   note degradation briefly
```

This matches the pattern used by `review:pr` for ruvector/morph detection and
by debt scanners for ast-grep detection.

### Consumer Integration Pattern

Consuming plugins embed Composio detection inline in their command markdown
(not via cross-plugin `skills:` preloading -- no such mechanism exists).
Pattern:

```markdown
### Step N: Composio acceleration (optional)

1. Call ToolSearch("COMPOSIO_REMOTE_WORKBENCH"). If not found, skip to Step N+1.
2. [Composio-accelerated operation here]
3. Increment usage counter (see composio-patterns skill for bash snippet)
4. If Composio call fails: fall back to [existing local approach], note
   degradation briefly.
```

## Error Handling Catalog

| Error | Recovery |
|-------|----------|
| ToolSearch: no Composio tools | Silent skip, use local codepath |
| Tool call: network timeout | Retry once after 2s, then fallback to local |
| Tool call: 401 Unauthorized | Log warning, fallback to local, suggest `/composio:setup` |
| Tool call: 429 Rate Limited | Wait `Retry-After` header seconds, retry once, then fallback |
| Workbench: 4-minute timeout | Log warning, reduce batch size, fallback to local |
| Connection not ACTIVE | Log warning, suggest `COMPOSIO_MANAGE_CONNECTIONS` |
| MCP server not configured | Run `/composio:setup` |
| Usage counter missing | Run `/composio:setup` |
| Usage counter corrupted | Run `/composio:setup` to reset |

## Security Notes

- **Remote execution**: Workbench executes Python code on Composio's remote
  infrastructure. Do not send sensitive file contents, credentials, private
  keys, or proprietary algorithms. Use Workbench for data processing and API
  orchestration, not as a trusted execution environment.
- **No API keys stored**: This plugin does not store or manage Composio API
  keys. The native MCP connector handles credential management.
- **Content fencing**: Wrap all Composio responses in `--- begin/end ---`
  delimiters per repository convention.
- **Data transmission**: Tool call parameters and Workbench code are sent to
  Composio's cloud servers. Review what data is included before execution.
- **Sandbox isolation**: Composio's sandbox isolation details (containerization,
  tenant separation) are not publicly documented. Enterprise tier offers
  VPC/on-prem deployment for stricter requirements.

## Composio Pricing Reference

| Plan | Executions/Month | Price |
|------|-----------------|-------|
| Free / Hobby | 10,000 | $0 |
| Starter | 100,000 | $119/month |
| Growth | 2,000,000 | $229/month |
| Enterprise | Custom | Custom |

Overage: $0.249 per 1,000 additional calls. Premium tools cost ~3x standard.
