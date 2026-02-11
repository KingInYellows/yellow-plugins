---
name: devin-workflows
description: >
  Devin workflow patterns and conventions reference. Use when commands or agents
  need Devin API context, session management patterns, or error handling guidance.
user-invocable: false
---

# Devin Workflow Patterns

## What It Does

Reference patterns and conventions for Devin.AI integration workflows. Loaded by commands and agents for consistent behavior.

## When to Use

Use when yellow-devin plugin commands or agents need shared Devin workflow context, including API patterns, session management conventions, input validation, or error handling.

## Usage

This skill is not user-invocable. It provides shared context for the yellow-devin plugin's commands and agents.

## API Base

All REST API calls target `https://api.devin.ai/v1/`. Authentication via Bearer token from `DEVIN_API_TOKEN` env var.

## Token Validation

Validate before every API call:

```bash
validate_token() {
  local token="$1"
  if [ -z "$token" ]; then
    printf 'ERROR: DEVIN_API_TOKEN not set\n'
    printf 'Get your API key: https://devin.ai/settings/api\n'
    printf 'Then: export DEVIN_API_TOKEN='\''apk_...'\''\n'
    return 1
  fi
  if ! printf '%s' "$token" | grep -qE '^apk_(user_)?[a-zA-Z0-9_-]{20,128}$'; then
    printf 'ERROR: DEVIN_API_TOKEN has invalid format\n'
    printf 'Expected: apk_... or apk_user_...\n'
    return 1
  fi
}
```

## Session ID Validation

Validate before use in URL paths:

```bash
validate_session_id() {
  local sid="$1"
  if ! printf '%s' "$sid" | grep -qE '^ses_[a-zA-Z0-9]{20,64}$'; then
    printf 'ERROR: Invalid session ID format: %s\n' "$sid"
    printf 'Session IDs start with '\''ses_'\'' followed by alphanumeric characters\n'
    return 1
  fi
}
```

## JSON Construction (Shell Injection Prevention)

**Always use `jq`** to construct JSON payloads. Never interpolate user input into curl data strings.

Safe pattern:
```bash
jq -n --arg prompt "$USER_INPUT" '{prompt: $prompt, idempotent: true}' | \
  curl -s -X POST "https://api.devin.ai/v1/sessions" \
    -H "Authorization: Bearer $DEVIN_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```

## jq Dependency Check

Every command should verify `jq` is available:
```bash
command -v jq >/dev/null 2>&1 || {
  printf 'ERROR: jq required. Install: https://jqlang.github.io/jq/download/\n'
  exit 1
}
```

## curl Pattern

Standard curl pattern with exit code, HTTP status, and timeout:

```bash
response=$(curl -s --connect-timeout 5 --max-time 60 \
  -w "\n%{http_code}" \
  -X POST "https://api.devin.ai/v1/sessions" \
  -H "Authorization: Bearer $DEVIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @-)
curl_exit=$?
http_status=${response##*$'\n'}
body=${response%$'\n'*}
```

**Timeouts by operation:**
| Operation | --max-time | --connect-timeout |
|-----------|-----------|-------------------|
| Session creation | 60 | 5 |
| Other mutations | 30 | 5 |
| Status polls | 10 | 5 |

## Error Handling

See [error-codes.md](./error-codes.md) for the complete error handling patterns.

Quick reference:
1. Check `curl_exit` — non-zero means network failure
2. Extract HTTP status from `curl -w` output
3. Check jq exit code when parsing response
4. Never silently swallow errors

## Session Status Values

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `queued` | Session created, waiting to start | No |
| `started` | Session initializing | No |
| `running` | Session actively working | No |
| `blocked` | Session needs input or hit an issue | No |
| `finished` | Session completed successfully | Yes |
| `stopped` | Session was cancelled | Yes |
| `failed` | Session encountered an error | Yes |

## Input Validation

| Input | Max Length | Format |
|-------|-----------|--------|
| Task prompts | 8000 chars | Free text |
| Messages | 2000 chars | Free text |
| Session IDs | — | `^ses_[a-zA-Z0-9]{20,64}$` |
| Tokens | — | `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$` |

**On validation failure:** Report the actual count vs maximum. Never silently truncate.

## Write Safety Tiers

| Operation | Tier | Behavior |
|-----------|------|----------|
| Create session | Medium | Proceed (costs money but user explicitly asked) |
| Send message | Low | Proceed without confirmation |
| Cancel session | High | Confirm before executing (M3) |
| Orchestrator auto-retry | Guarded | Max 3 iterations, then escalate |

## Security Patterns

### C1: Validate Before Write
Before any write operation, validate that the target resource exists (e.g., fetch session status before sending a message).

### M3: Confirm Destructive Ops
Operations that terminate sessions or consume significant resources require explicit user confirmation via AskUserQuestion.

### Token Security
- Never log, echo, or include `DEVIN_API_TOKEN` in error messages
- Never use `curl -v` (verbose mode prints auth headers to stderr)
- Never pass token via `$ARGUMENTS`

### Context Dump Sanitization
Before dumping orchestrator context on failure, strip secrets:
```bash
context=$(printf '%s' "$context" | sed -E 's/apk_(user_)?[a-zA-Z0-9_-]{20,128}/***REDACTED***/g')
```

## Reference

- [API Reference](./api-reference.md) — Full endpoint docs
- [Error Codes](./error-codes.md) — Error catalog with remediation
