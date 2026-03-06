---
name: research:setup
description: "Check which research API keys and MCP sources are configured and active. Use when first installing the plugin, after adding API keys, or to understand why a research command degraded to fewer sources."
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-core_context7__resolve-library-id
  - mcp__grep__searchGitHub
  - mcp__plugin_yellow-morph_morph__warpgrep_codebase_search
  - mcp__filesystem-with-morph__warpgrep_codebase_search
  - mcp__plugin_yellow-devin_deepwiki__read_wiki_structure
  - mcp__plugin_yellow-research_ast-grep__find_code
  - mcp__plugin_yellow-research_parallel__createDeepResearch
---

# Set Up yellow-research

Check which API keys are configured, validate their format, optionally test live
connectivity, and health-check MCP sources. All API keys are optional and MCP
sources are always available if their plugin is installed — the plugin degrades
gracefully and continues with whichever sources are available.

## Workflow

### Step 1: Check Prerequisites and API Keys

Run a single Bash call to check tools and all three env vars:

```bash
printf '=== Prerequisites ===\n'
command -v curl     >/dev/null 2>&1 && printf 'curl:      ok\n' || printf 'curl:      NOT FOUND\n'
command -v jq       >/dev/null 2>&1 && printf 'jq:        ok\n' || printf 'jq:        NOT FOUND\n'
command -v ast-grep >/dev/null 2>&1 && printf 'ast-grep:  ok\n' || printf 'ast-grep:  NOT FOUND (needed for ast-grep MCP)\n'
command -v uv       >/dev/null 2>&1 && printf 'uv:        ok\n' || printf 'uv:        NOT FOUND (needed for ast-grep MCP)\n'
python3 --version 2>/dev/null | grep -qE '3\.(1[3-9]|[2-9][0-9])' && printf 'python:    ok (>=3.13)\n' || printf 'python:    NEEDS >=3.13 (needed for ast-grep MCP)\n'

printf '\n=== API Keys ===\n'
[ -n "${EXA_API_KEY:-}" ]          && printf 'EXA_API_KEY:          set\n' || printf 'EXA_API_KEY:          NOT SET\n'
[ -n "${TAVILY_API_KEY:-}" ]       && printf 'TAVILY_API_KEY:       set\n' || printf 'TAVILY_API_KEY:       NOT SET\n'
[ -n "${PERPLEXITY_API_KEY:-}" ]   && printf 'PERPLEXITY_API_KEY:   set\n' || printf 'PERPLEXITY_API_KEY:   NOT SET\n'
```

`curl` and `jq` missing are informational warnings — they affect live testing
only. Do not stop if they are absent. All three API keys are optional; if 0 are
set, the command still completes successfully (showing all INACTIVE).

### Step 2: Validate Format of Present Keys

For each key that is set, run a format check. Never echo the key value —
only describe format mismatches.

**EXA** (no public prefix documented — length/charset only):

```bash
key="${EXA_API_KEY:-}"
if [ -n "$key" ]; then
  if ! printf '%s' "$key" | grep -qE '^[a-zA-Z0-9_-]{20,}$'; then
    printf 'EXA_API_KEY: FORMAT INVALID (expected 20+ alphanumeric/dash/underscore chars, no whitespace)\n'
  else
    printf 'EXA_API_KEY: FORMAT VALID\n'
  fi
fi
```

**Tavily** (known `tvly-` prefix):

```bash
key="${TAVILY_API_KEY:-}"
if [ -n "$key" ]; then
  if ! printf '%s' "$key" | grep -qE '^tvly-[a-zA-Z0-9_-]{20,}$'; then
    printf 'TAVILY_API_KEY: FORMAT INVALID (expected tvly- prefix + 20+ chars)\n'
  else
    printf 'TAVILY_API_KEY: FORMAT VALID\n'
  fi
fi
```

**Perplexity** (known `pplx-` prefix):

```bash
key="${PERPLEXITY_API_KEY:-}"
if [ -n "$key" ]; then
  if ! printf '%s' "$key" | grep -qE '^pplx-[a-zA-Z0-9_-]{40,}$'; then
    printf 'PERPLEXITY_API_KEY: FORMAT INVALID (expected pplx- prefix + 40+ alphanumeric/dash/underscore chars)\n'
  else
    printf 'PERPLEXITY_API_KEY: FORMAT VALID\n'
  fi
fi
```

Per-key status after this step: `ABSENT` / `FORMAT VALID` / `FORMAT INVALID`

Step 3 assigns final live-test status: `ACTIVE` / `INVALID` / `RATE LIMITED` /
`UNREACHABLE` / `PRESENT (untested)` (when user skips testing).

### Step 3: Optional Live API Testing

If any keys are present and format-valid, and `curl` is available, ask:

> "Test live API connectivity? MCP sources are always checked (no quota cost).
> This option controls whether API key sources are also probed — **1 small call
> per present key, consuming a small amount of API quota** (1 search credit or
> 1 token per provider). Skip if quota is a concern."
>
> Options: "Yes, test all" / "No, skip testing"

If user opts in, run a probe for each format-valid key with a 5-second timeout.
If user skips, proceed to Step 4 with all format-valid keys marked
`PRESENT (untested)`.

**EXA:**

```bash
response=$(curl -s --connect-timeout 5 --max-time 5 \
  -w "\n%{http_code}" \
  -X POST "https://api.exa.ai/search" \
  -H "x-api-key: ${EXA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"test","numResults":1}')
curl_exit=$?
http_status=$(printf '%s' "$response" | tail -n1)
```

**Tavily:**

```bash
# Build body safely — key format already validated as [a-zA-Z0-9_-]+
if command -v jq >/dev/null 2>&1; then
  tavily_body=$(jq -n --arg k "${TAVILY_API_KEY}" '{"api_key":$k,"query":"test","max_results":1}')
else
  tavily_body=$(printf '{"api_key":"%s","query":"test","max_results":1}' "${TAVILY_API_KEY}")
fi
response=$(curl -s --connect-timeout 5 --max-time 5 \
  -w "\n%{http_code}" \
  -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d "$tavily_body")
curl_exit=$?
http_status=$(printf '%s' "$response" | tail -n1)
```

**Perplexity:**

```bash
response=$(curl -s --connect-timeout 5 --max-time 5 \
  -w "\n%{http_code}" \
  -X POST "https://api.perplexity.ai/chat/completions" \
  -H "Authorization: Bearer ${PERPLEXITY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"sonar","messages":[{"role":"user","content":"hi"}],"max_tokens":1}')
curl_exit=$?
http_status=$(printf '%s' "$response" | tail -n1)
```

After each probe, evaluate `$curl_exit` first, then `$http_status`. Apply this
explicit decision tree for each provider:

```bash
if [ "$curl_exit" -ne 0 ]; then
  provider_status="UNREACHABLE"
  provider_detail="API unreachable (curl exit $curl_exit — timeout or network error)"
elif [ "$http_status" = "200" ]; then
  provider_status="ACTIVE"
  provider_detail="Live test passed"
elif [ "$http_status" = "401" ] || [ "$http_status" = "403" ]; then
  provider_status="INVALID"
  provider_detail="Key rejected by API (HTTP $http_status)"
elif [ "$http_status" = "429" ]; then
  provider_status="RATE LIMITED"
  provider_detail="Key may be valid; service is busy. Try again later."
elif printf '%s' "$http_status" | grep -qE '^5[0-9][0-9]$'; then
  provider_status="UNREACHABLE"
  provider_detail="API server error (HTTP $http_status)"
else
  provider_status="UNREACHABLE"
  provider_detail="Unexpected HTTP $http_status"
fi
```

Never display raw API response bodies for any provider — only `provider_status`
and `provider_detail` are used in the results table. If body content must ever
be shown for error context, redact key patterns first:

```bash
sed 's/tvly-[a-zA-Z0-9_-]*/***REDACTED***/g; s/pplx-[a-zA-Z0-9_-]*/***REDACTED***/g'
```

Never display EXA response bodies at all — EXA keys have no known prefix
and cannot be reliably redacted. Show only the HTTP status code and derived
status label.

Never use `curl -v`, `--trace`, or `--trace-ascii` — they leak auth headers in
request/response dumps.

If user skips testing: all format-valid keys show `PRESENT (untested)`.

### Step 3.5: MCP Source Health Checks

This step runs unconditionally — MCP calls have no quota cost and require no
user opt-in. Check each of the six MCP sources using a ToolSearch probe
followed by a lightweight test call (except Parallel Task which uses
ToolSearch-only).

For each source below, follow this pattern:

1. Call ToolSearch with the keyword shown. If the exact tool name is absent from
   the results, record status as `UNAVAILABLE` and move to the next source.
2. If the tool is found, invoke it with the minimal test arguments shown.
3. If the call succeeds and returns a structured payload (object or array),
   record status as `ACTIVE` — even if the results array is empty.
4. If the call throws an exception, returns an explicit error object, `null`,
   or a non-structured response, record status as `FAIL`.

**Context7** (yellow-core plugin — library docs and code examples):

```text
ToolSearch keyword: "resolve-library-id"
Tool name: mcp__plugin_yellow-core_context7__resolve-library-id
Test call: mcp__plugin_yellow-core_context7__resolve-library-id with libraryName: "react"
```

**Grep MCP** (global — GitHub code pattern search):

```text
ToolSearch keyword: "searchGitHub"
Tool name: mcp__grep__searchGitHub
Test call: mcp__grep__searchGitHub with query: "test", maxResults: 1
```

**WarpGrep** (yellow-morph plugin preferred, global MCP fallback):

```text
ToolSearch keyword: "warpgrep_codebase_search"
Preferred tool name: mcp__plugin_yellow-morph_morph__warpgrep_codebase_search
Fallback tool name: mcp__filesystem-with-morph__warpgrep_codebase_search
Test call: <matched tool> with query: "README"
```

Check for the plugin-namespaced tool first. If not found, fall back to the
global MCP tool name. Report which variant is active.

**DeepWiki** (yellow-devin plugin — AI-powered repo documentation):

```text
ToolSearch keyword: "read_wiki_structure"
Tool name: mcp__plugin_yellow-devin_deepwiki__read_wiki_structure
Test call: mcp__plugin_yellow-devin_deepwiki__read_wiki_structure with repoName: "facebook/react"
```

**ast-grep MCP** (bundled stdio — AST structural code search):

```text
ToolSearch keyword: "find_code"
Tool name: mcp__plugin_yellow-research_ast-grep__find_code
Test call: mcp__plugin_yellow-research_ast-grep__find_code with pattern: "function $NAME() {}", lang: "javascript"
```

Note: The ast-grep MCP server starts even without the `ast-grep` binary
installed (lazy check). ToolSearch finding the tool does NOT confirm the binary
is available. If the test call fails with "Command 'ast-grep' not found", record
status as `FAIL` with a note to install the `ast-grep` binary.

**Parallel Task MCP** (bundled HTTP — async research orchestration):

```text
ToolSearch keyword: "createDeepResearch"
Tool name: mcp__plugin_yellow-research_parallel__createDeepResearch
Test: ToolSearch probe only (do not create actual tasks — they have compute cost)
```

For Parallel Task, a ToolSearch-only check is used instead of the test-call
pattern. Creating tasks has real compute cost and `getStatus` requires a valid
task ID. If the tool appears in ToolSearch results, record status as `ACTIVE`.

Run all six ToolSearch probes. For sources that are found, run their test calls
(except Parallel Task which uses ToolSearch-only).
Record each source's status for the Step 4 report table.

Never stop on a per-source error — record the status and continue to the next
source. A failing MCP source does not affect API key checks or overall command
completion.

Note: ToolSearch results reflect the session-start state. If a plugin was
installed mid-session, a Claude Code restart may be needed for the tool to
appear.

### Step 4: Report Results

Display a unified status table:

```text
yellow-research Setup Check
===========================

API Keys (all optional — plugin degrades gracefully)
  Provider       Key         Format    Live Test      Status
  -----------    --------    ------    -----------    ------
  EXA            SET         VALID     ACTIVE         ACTIVE
  Tavily         SET         VALID     ACTIVE         ACTIVE
  Perplexity     NOT SET     N/A       N/A            INACTIVE

Parallel Task server (OAuth)
  No key required — authenticates via Claude Code browser OAuth automatically.
  You'll be prompted to authorize in your browser on first /research:deep use.

MCP Sources (no API key required — always available if plugin installed)
  Source         Plugin             Status
  -----------    ---------------    --------
  Context7       yellow-core        ACTIVE
  Grep MCP       (global)           ACTIVE
  WarpGrep       (global)           UNAVAILABLE
  DeepWiki       yellow-devin       ACTIVE
  ast-grep       (bundled)          ACTIVE
  Parallel Task  (bundled)          ACTIVE

Capability summary:
  /research:deep    PARTIAL (2/3 API sources — Perplexity inactive)
  /research:code    PARTIAL (2/3 API sources — Perplexity inactive)
  MCP sources:      5/6 available
```

Adjust the capability summary based on how many keys are active:

- 3 active: `FULL (3/3 API sources)`
- 1-2 active: `PARTIAL (N/3 API sources)`
- 0 active: `MINIMAL (Parallel Task OAuth only — no API key sources)`

Adjust the MCP sources line based on how many MCP sources are ACTIVE:

- 6 active: `MCP sources: 6/6 available`
- 1-5 active: `MCP sources: N/6 available`
- 0 active: `MCP sources: 0/6 available — install plugins or configure MCPs`

### Step 5: Setup Instructions (for absent or invalid keys)

If any keys are `ABSENT`, `FORMAT INVALID`, or `INVALID`, show this block:

```sh
To enable missing providers, add to your shell profile (~/.zshrc or ~/.bashrc):

  export EXA_API_KEY="..."          # Get key: https://exa.ai/
  export TAVILY_API_KEY="..."       # Get key: https://tavily.com/
  export PERPLEXITY_API_KEY="..."   # Get key: https://www.perplexity.ai/settings/api

Then:
  source ~/.zshrc   (or ~/.bashrc)
  Restart Claude Code for MCP servers to pick up the new keys.

Note: Keys are passed to MCP servers at startup — a Claude Code restart is
required after adding new keys. Never commit API keys to version control.
```

Only show the lines for keys that are absent or invalid (not all three if some
are already working).

If ast-grep prerequisites are missing (`ast-grep`, `uv`, or Python < 3.13),
show this block:

```text
To enable ast-grep MCP (AST structural code search):

  ast-grep:  brew install ast-grep  (or: cargo install ast-grep --locked, or: pip install ast-grep-cli)
  uv:        curl -LsSf https://astral.sh/uv/install.sh | sh
  python:    Requires >= 3.13 (check with: python3 --version)

All three are needed for the ast-grep MCP server. Other MCP servers are unaffected.
```

Only show this block if at least one ast-grep prerequisite is missing.

If any MCP sources are `UNAVAILABLE` or `FAIL`, show this block:

```text
To enable missing MCP sources:

  Context7:   Install yellow-core — /plugin marketplace add KingInYellows/yellow-plugins (select yellow-core)
  Grep MCP:   Configure grep MCP globally in Claude Code MCP settings
  WarpGrep:   Install yellow-morph — /plugin marketplace add KingInYellows/yellow-plugins (select yellow-morph)
              Or configure filesystem-with-morph MCP globally in Claude Code MCP settings
  DeepWiki:   Install yellow-devin — /plugin marketplace add KingInYellows/yellow-plugins (select yellow-devin)
  ast-grep:   Bundled — install prerequisites: ast-grep binary, uv, Python >= 3.13 (see above)
  Parallel:   Bundled — OAuth auto-managed; if FAIL, restart Claude Code

If a source shows FAIL (installed but test failed), try restarting Claude Code.
ToolSearch results reflect session-start state — restart after installing new plugins.
```

Only show the lines for MCP sources that are UNAVAILABLE or FAIL (not all six
if some are already working).

### Step 6: Next Steps

Ask via AskUserQuestion: "What would you like to do next?" with options:
`/research:code` (inline code research), `/research:deep` (multi-source deep
research), `Done`.

## Error Handling

| Error | Message | Action |
|---|---|---|
| `curl` not found | "curl not found — live testing unavailable. Install via system package manager." | Warn, skip Step 3 |
| `jq` not found | "jq not found — Tavily live test will use printf fallback for JSON body." | Warn, continue |
| All 3 keys absent | Show all INACTIVE in table + full setup instructions block | Complete normally |
| Key format invalid | "FORMAT INVALID — [description of expected format]. Key not echoed." | Record, continue |
| Non-zero curl exit | "UNREACHABLE — API unreachable (timeout or network error)." | Record per-provider |
| HTTP 401/403 | "INVALID — key rejected. Regenerate at provider dashboard." | Record per-provider |
| HTTP 429 | "RATE LIMITED — key may be valid; service is busy. Try again later." | Record per-provider |
| HTTP 5xx | "UNREACHABLE — API server error." | Record per-provider |
| ToolSearch returns no match for MCP tool | "[source] UNAVAILABLE — plugin not installed or MCP not configured." | Record, continue |
| MCP test call throws exception | "[source] FAIL — tool found but test call errored." | Record, continue |
| MCP test call returns empty result set | "[source] ACTIVE — tool reachable, probe returned no matches." | Record, continue |

Never stop on a per-provider or per-source error — report it and continue to
the next provider/source. The overall command always completes.
