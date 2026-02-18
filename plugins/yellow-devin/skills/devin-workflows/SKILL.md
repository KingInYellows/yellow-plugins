---
name: devin-workflows
description: Devin V3 API workflow patterns and conventions. Use when commands or agents need Devin API context, session management, or error handling.
user-invokable: false
---

# Devin V3 Workflow Patterns

## What It Does

Reference patterns and conventions for Devin V3 API integration workflows.
Loaded by commands and agents for consistent behavior.

## When to Use

Use when yellow-devin plugin commands or agents need shared Devin workflow
context, including API patterns, session management, or error handling.

## Usage

This skill is not user-invokable. It provides shared context for the
yellow-devin plugin's commands and agents.

## API Base

All REST API calls target `https://api.devin.ai/v3beta1/`. Two scopes:

- **Organization:** `https://api.devin.ai/v3beta1/organizations/{org_id}/...`
- **Enterprise:** `https://api.devin.ai/v3beta1/enterprise/...`

Authentication via Bearer token from `DEVIN_SERVICE_USER_TOKEN` env var (service
user credential, `cog_` prefix). Organization ID from `DEVIN_ORG_ID` env var.

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"
ENTERPRISE_URL="${DEVIN_API_BASE}/enterprise"
```

## Token Validation

Validate before every API call:

```bash
validate_token() {
  local token="$1"
  if [ -z "$token" ]; then
    printf 'ERROR: DEVIN_SERVICE_USER_TOKEN not set\n' >&2
    printf 'Create a service user: Enterprise Settings > Service Users\n' >&2
    printf 'Then: export DEVIN_SERVICE_USER_TOKEN='\''cog_...'\''\n' >&2
    return 1
  fi
  if printf '%s' "$token" | grep -qE '^apk_'; then
    printf 'ERROR: V1 API key detected (apk_ prefix)\n' >&2
    printf 'V3 requires a service user token (cog_ prefix)\n' >&2
    printf 'Create one: Enterprise Settings > Service Users\n' >&2
    printf 'Docs: https://docs.devin.ai/api-reference/v3/overview\n' >&2
    return 1
  fi
  if ! printf '%s' "$token" | grep -qE '^cog_[a-zA-Z0-9_-]{20,128}$'; then
    printf 'ERROR: DEVIN_SERVICE_USER_TOKEN has invalid format\n' >&2
    printf 'Expected: cog_... (service user credential)\n' >&2
    return 1
  fi
}
```

## Org ID Validation

Validate before every API call:

```bash
validate_org_id() {
  local org_id="$1"
  if [ -z "$org_id" ]; then
    printf 'ERROR: DEVIN_ORG_ID not set\n' >&2
    printf 'Find your org ID: Enterprise Settings > Organizations\n' >&2
    printf 'Then: export DEVIN_ORG_ID='\''your-org-id'\''\n' >&2
    return 1
  fi
  if ! printf '%s' "$org_id" | grep -qE '^[a-zA-Z0-9_-]{4,64}$'; then
    printf 'ERROR: DEVIN_ORG_ID has invalid format\n' >&2
    return 1
  fi
}
```

## Session ID Validation

Validate before use in URL paths:

```bash
validate_session_id() {
  local sid="$1"
  if [ -z "$sid" ]; then
    printf 'ERROR: Session ID required\n' >&2
    return 1
  fi
  if ! printf '%s' "$sid" | grep -qE '^[a-zA-Z0-9_-]{8,64}$'; then
    printf 'ERROR: Invalid session ID format: %s\n' "$sid" >&2
    return 1
  fi
}
```

## JSON Construction (Shell Injection Prevention)

**Always use `jq`** to construct JSON payloads. Never interpolate user input
into curl data strings.

```bash
jq -n --arg prompt "$USER_INPUT" '{prompt: $prompt}' | \
  curl -s -X POST "${ORG_URL}/sessions" \
    -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```

## jq Dependency Check

Every command should verify `jq` is available:

```bash
command -v jq >/dev/null 2>&1 || {
  printf 'ERROR: jq required. Install: https://jqlang.github.io/jq/download/\n' >&2
  exit 1
}
```

## curl Pattern

Standard curl pattern with exit code, HTTP status, and timeout. **Never use
`-v`, `--trace`, `--trace-ascii`, or `-i` flags** — they leak auth headers.

```bash
response=$(curl -s --connect-timeout 5 --max-time 60 \
  -w "\n%{http_code}" \
  -X POST "${ORG_URL}/sessions" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
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
5. Sanitize error output: `sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'`

## Session Status Values

| Status | Meaning | Terminal? | Messageable? | Cancellable? |
|-----------|---------|-----------|--------------|--------------|
| `new` | Created, waiting to start | No | No | Yes |
| `claimed` | Initializing | No | No | Yes |
| `running` | Actively working | No | Yes | Yes |
| `suspended` | Paused (cost saving) | No | Yes (auto-resumes) | Yes |
| `resuming` | Waking from suspended | No | No (wait) | Yes |
| `exit` | Completed successfully | Yes | No | No |
| `error` | Failed | Yes | No | No |

## Input Validation

| Input | Max Length | Format |
|------------|-----------|---------------------------------------|
| Task prompts | 8000 chars | Free text |
| Messages | 2000 chars | Free text |
| Session IDs | — | `^[a-zA-Z0-9_-]{8,64}$` |
| Tokens | — | `^cog_[a-zA-Z0-9_-]{20,128}$` |
| Org IDs | — | `^[a-zA-Z0-9_-]{4,64}$` |
| Tags | 32 chars each | Alphanumeric + dashes, max 10 per session |
| Titles | 80 chars | Free text |

**On validation failure:** Report the actual value/count vs expected format.
Never silently truncate.

## Write Safety Tiers

| Operation | Tier | Behavior |
|------------------------|---------|------------------------------------------------|
| Create session | Medium | Proceed (costs money but user explicitly asked) |
| Send message | Low | Proceed without confirmation |
| Cancel/Terminate | High | Confirm before executing (M3) |
| Archive session | Low | Proceed (soft operation, reversible) |
| Tag update | Low | Proceed without confirmation |
| Orchestrator auto-retry | Guarded | Max 3 iterations, then escalate |

## Security Patterns

### Token Security

- Never log, echo, or include `DEVIN_SERVICE_USER_TOKEN` in error messages
- Never use `curl -v` (verbose mode prints auth headers to stderr)
- Never pass token via `$ARGUMENTS`
- Sanitize all error output: `sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'`

### Forbidden V3 Fields

- Never use `create_as_user_id` — impersonation risk
- Never use `session_secrets` — use `secret_ids` instead (inline secrets leak)
- Never use `message_as_user_id` — same impersonation risk

### C1: Validate Before Write

Before any write operation, validate that the target resource exists (e.g.,
fetch session status before sending a message).

### M3: Confirm Destructive Ops

Operations that terminate sessions require explicit user confirmation via
AskUserQuestion.

### Enterprise Scope Safety

When listing sessions via enterprise endpoints, always filter by `org_ids`
matching `DEVIN_ORG_ID` to prevent cross-org data access.

## Reference

- [API Reference](./api-reference.md) — Full endpoint docs
- [Error Codes](./error-codes.md) — Error catalog with remediation
