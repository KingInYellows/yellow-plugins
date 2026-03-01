---
name: research:setup
description: "Check which research API keys are configured and which providers are active. Use when first installing the plugin, after adding API keys, or to understand why a research command degraded to fewer sources."
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Set Up yellow-research

Check which API keys are configured, validate their format, and optionally test
live connectivity. All three API keys are optional — the plugin degrades
gracefully and continues with whichever sources are available.

## Workflow

### Step 1: Check Prerequisites and API Keys

Run a single Bash call to check tools and all three env vars:

```bash
printf '=== Prerequisites ===\n'
command -v curl >/dev/null 2>&1 && printf 'curl: ok\n' || printf 'curl: NOT FOUND\n'
command -v jq   >/dev/null 2>&1 && printf 'jq:   ok\n' || printf 'jq:   NOT FOUND\n'

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
    printf 'EXA_API_KEY: format ok\n'
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
    printf 'TAVILY_API_KEY: format ok\n'
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
    printf 'PERPLEXITY_API_KEY: format ok\n'
  fi
fi
```

Per-key status after this step: `ABSENT` / `FORMAT VALID` / `FORMAT INVALID`

Step 3 assigns final live-test status: `ACTIVE` / `INVALID` / `RATE LIMITED` /
`UNREACHABLE` / `PRESENT (untested)` (when user skips testing).

### Step 3: Optional Live API Testing

If any keys are present and format-valid, and `curl` is available, ask:

> "Test live API connectivity? This will make 1 small call per present key and
> **may consume a small amount of API quota** (1 search credit or 1 token per
> provider). Skip if you're on a paid plan and quota is a concern."
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
  provider_status="UNKNOWN"
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

### Step 4: Report Results

Display a unified status table:

```
yellow-research Setup Check
===========================

API Keys (all optional — plugin degrades gracefully)
  Provider       Key         Format    Live Test    Status
  -----------    --------    ------    ---------    ------
  EXA            SET         VALID     PASS         ACTIVE
  Tavily         SET         VALID     SKIP         PRESENT
  Perplexity     NOT SET     N/A       N/A          INACTIVE

Parallel Task server (OAuth)
  No key required — authenticates via Claude Code browser OAuth automatically.
  You'll be prompted to authorize in your browser on first /research:deep use.

Capability summary:
  /research:deep    FULL (3/3 sources)
  /research:code    FULL (3/3 sources)
```

Adjust the capability summary based on how many keys are active:
- 3 active: `FULL (3/3 sources)`
- 1-2 active: `PARTIAL (N/3 sources)`
- 0 active: `MINIMAL (Parallel Task OAuth only — no API key sources)`

### Step 5: Setup Instructions (for absent or invalid keys)

If any keys are `ABSENT` or `INVALID`, show this block:

```
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

### Step 6: Next Steps

Ask via AskUserQuestion: "What would you like to do next?" with options:
`/research:code` (inline code research), `/research:deep` (multi-source deep
research), `Done`.

## Error Handling

| Error | Message | Action |
|---|---|---|
| `curl` not found | "curl not found — live testing unavailable. Install via system package manager." | Warn, skip Step 3 |
| `jq` not found | "jq not found — some research commands may be limited." | Warn, continue |
| All 3 keys absent | Show all INACTIVE in table + full setup instructions block | Complete normally |
| Key format invalid | "FORMAT INVALID — [description of expected format]. Key not echoed." | Record, continue |
| Non-zero curl exit | "UNREACHABLE — API unreachable (timeout or network error)." | Record per-provider |
| HTTP 401/403 | "INVALID — key rejected. Regenerate at provider dashboard." | Record per-provider |
| HTTP 429 | "RATE LIMITED — key may be valid; service is busy. Try again later." | Record per-provider |
| HTTP 5xx | "UNREACHABLE — API server error." | Record per-provider |

Never stop on a per-provider error — report it and continue to the next
provider. The overall command always completes.
