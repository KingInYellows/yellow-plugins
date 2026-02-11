---
title: "Yellow-Devin Plugin Security Audit: Pre-Implementation Threat Analysis"
category: security-issues
tags:
  - security-audit
  - devin-integration
  - api-security
  - shell-injection
  - input-validation
  - token-security
  - rate-limiting
  - toctou
severity: high
module: plugins/yellow-devin
date: 2026-02-10
status: audit
---

# Yellow-Devin Plugin Security Audit

## Executive Summary

**OVERALL RISK LEVEL: MEDIUM-HIGH**

Pre-implementation security audit of the `yellow-devin` plugin plan identified **21 security concerns** across 6 categories. The plan demonstrates strong awareness of shell injection risks via `jq` safety patterns, but has critical gaps in session ID validation, token leakage vectors, orchestrator race conditions, and MCP trust boundaries.

**Critical Findings (P1):** 6 issues requiring immediate design changes
**Important Findings (P2):** 9 issues requiring hardening before implementation
**Advisory Findings (P3):** 6 issues for defense-in-depth

The plan's use of `jq` for JSON construction is exemplary and eliminates the primary shell injection vector seen in previous plugins. However, API integration security patterns (session ID injection, error message sanitization, TOCTOU in orchestrator) need significant strengthening.

---

## Risk Matrix

| ID | Severity | Category | Finding | Exploitability | Impact |
|----|----------|----------|---------|----------------|--------|
| **C1** | **Critical** | Auth | Token leakage via curl verbose output | High | Full account compromise |
| **C2** | **Critical** | Injection | Session ID injection in URL construction | High | API endpoint enumeration |
| **C3** | **Critical** | TOCTOU | Orchestrator check-then-act race condition | Medium | Infinite retry loop, cost overrun |
| **C4** | **Critical** | Input Val | Missing session ID format validation | High | Malicious API requests |
| **C5** | **Critical** | Auth | Error messages may echo DEVIN_API_TOKEN | Medium | Token exposure in logs |
| **C6** | **Critical** | Rate Limit | Single retry allows 429 abuse | Medium | Cost overrun, rate limit ban |
| **H1** | High | Input Val | Playbook name validation too permissive | Medium | Path traversal if API vulnerable |
| **H2** | High | TOCTOU | Cancel command TOCTOU window | Medium | Cancel ineffective session |
| **H3** | High | Data Leak | Session URLs may contain sensitive data | Low | Info disclosure via URL sharing |
| **H4** | High | Input Val | No max length on session IDs | Low | Buffer overflow in downstream systems |
| **H5** | High | TOCTOU | Message command TOCTOU (session end race) | Medium | Message sent to wrong session |
| **H6** | High | Auth | No validation that DEVIN_API_TOKEN is non-empty | High | Empty auth header, unclear errors |
| **H7** | High | Injection | Repo URL injection in wiki command | Medium | SSRF via malicious git remotes |
| **H8** | High | MCP Trust | No validation of MCP server responses | Medium | Malicious MCP server compromise |
| **H9** | High | Error Handling | curl exit codes not checked | Medium | Silent failures, incorrect status |
| **M1** | Medium | Input Val | HTML/script stripping not specified | Low | XSS if Devin reflects input |
| **M2** | Medium | Rate Limit | No global rate limit tracking | Low | Burst API abuse |
| **M3** | Medium | Timeout | 30s timeout may be too long for mutations | Low | Resource exhaustion |
| **M4** | Medium | Auth | No token rotation guidance | Low | Long-lived credential risk |
| **M5** | Medium | IDOR | No verification of session ownership | Medium | Access other users' sessions |
| **M6** | Medium | Logging | No guidance on what NOT to log | Medium | Sensitive data in debug logs |

---

## Detailed Findings

### Category 1: Authentication & Token Security

#### **C1: Token Leakage via curl Verbose Output** (CRITICAL)

**Finding:** Plan doesn't explicitly forbid `-v` or `--trace` flags in curl commands. LLM may add verbose flags for debugging, exposing `Authorization: Bearer $DEVIN_API_TOKEN` in stderr.

**Attack Vector:**
```bash
# If LLM adds -v for debugging:
curl -v -H "Authorization: Bearer apk_abc123..." https://api.devin.ai/v1/sessions
# Output includes:
# > Authorization: Bearer apk_abc123...
```

**Impact:** Token appears in Claude Code's tool output logs, visible to user and potentially saved in session history.

**Remediation:**
1. Add explicit rule to `devin-workflows` skill: "NEVER use `-v`, `--trace`, `--trace-ascii`, or `-i` flags with curl"
2. Add example of correct invocation with `-s` (silent) flag
3. Document in CLAUDE.md: "Token security: all curl calls must use `-s` flag, never verbose flags"

**Severity Justification:** High exploitability (LLM commonly adds `-v` for debugging), high impact (full account access).

---

#### **C5: Error Messages May Echo Token** (CRITICAL)

**Finding:** No sanitization rule for error messages. curl errors may include full request headers.

**Attack Vector:**
```bash
# Invalid URL with token in request
curl: (6) Could not resolve host: api.devin.ai
# Some curl errors echo the full request, including Authorization header
```

**Impact:** Token leakage via error output displayed to user.

**Remediation:**
1. Add error sanitization step to all commands: filter output through `sed` to strip `Bearer.*` patterns
2. Example:
```bash
response=$(curl ... 2>&1) || {
    echo "$response" | sed 's/Bearer [^ ]*/Bearer <REDACTED>/g' >&2
    exit 1
}
```

**Severity Justification:** Medium exploitability (depends on error type), high impact (token exposure).

---

#### **H6: No Validation that DEVIN_API_TOKEN Format Is Correct** (HIGH)

**Finding:** Commands check `[ -z "$DEVIN_API_TOKEN" ]` but don't validate format (e.g., starts with `apk_` or `apk_user_`).

**Attack Vector:**
```bash
# User accidentally sets empty token
export DEVIN_API_TOKEN=""
# Commands pass validation but fail with:
# HTTP 401: Unauthorized
# Unclear error message doesn't indicate token is empty
```

**Impact:** Poor user experience, unclear error messages.

**Remediation:**
```bash
if [ -z "$DEVIN_API_TOKEN" ] || [ "$DEVIN_API_TOKEN" = "" ]; then
    error "DEVIN_API_TOKEN not set or empty. Get token at https://app.devin.ai/settings/api"
fi
# Optional: validate format
if ! printf '%s' "$DEVIN_API_TOKEN" | grep -qE '^apk_(user_)?[a-zA-Z0-9_-]{20,128}$'; then
    error "DEVIN_API_TOKEN format invalid (expected: apk_... or apk_user_...)"
fi
```

**Severity Justification:** High exploitability (common user error), low impact (confusion only).

---

#### **M4: No Token Rotation Guidance** (MEDIUM)

**Finding:** CLAUDE.md doesn't mention token rotation best practices.

**Remediation:** Add to CLAUDE.md security section:
```markdown
## Token Management

- Rotate `DEVIN_API_TOKEN` every 90 days
- Use separate tokens for development/production
- Revoke tokens at https://app.devin.ai/settings/api if compromised
- Never commit tokens to git (add to `.gitignore`)
```

---

### Category 2: Injection & Input Validation

#### **C2: Session ID Injection in URL Construction** (CRITICAL)

**Finding:** Plan uses session IDs directly in URLs without validation: `"https://api.devin.ai/v1/sessions/${SESSION_ID}"`. Malicious ID could cause API abuse.

**Attack Vector:**
```bash
# User provides malicious session ID
SESSION_ID="abc123/../../admin/users"
# Constructed URL becomes:
# https://api.devin.ai/v1/sessions/abc123/../../admin/users
# OR:
SESSION_ID="abc?delete=true"
# URL becomes:
# https://api.devin.ai/v1/sessions/abc?delete=true
```

**Impact:**
- Path traversal to unintended API endpoints
- Query parameter injection
- Potential access to admin endpoints if API routing vulnerable

**Remediation:**
```bash
validate_session_id() {
    id="$1"
    if [ -z "$id" ]; then
        error "Session ID required"
    fi
    # Session IDs are UUIDs or alphanumeric strings (verify with Devin API docs)
    if ! printf '%s' "$id" | grep -qE '^[a-zA-Z0-9_-]{8,64}$'; then
        error "Invalid session ID format: $id"
    fi
    # Reject path traversal characters
    case "$id" in
        *..* | */* | *\\* | *\?* | *\&* | *\#*)
            error "Session ID contains forbidden characters: $id"
            ;;
    esac
}

# Use before every curl call
validate_session_id "$SESSION_ID"
curl -s "https://api.devin.ai/v1/sessions/${SESSION_ID}"
```

Add to `devin-workflows` skill under "Input Validation":
```markdown
### Session ID Validation

Session IDs must match pattern: `^[a-zA-Z0-9_-]{8,64}$`

Reject IDs containing: `/`, `\`, `..`, `?`, `&`, `#`, `%`, `=`
```

**Severity Justification:** High exploitability (user-controlled input), high impact (API abuse, potential admin access).

---

#### **C4: Missing Session ID Format Validation** (CRITICAL)

**Finding:** Status command accepts any string as session ID. No format documentation in plan.

**Impact:** Malformed requests, unclear errors, potential API abuse.

**Remediation:** Same as C2 — add `validate_session_id()` to all commands that accept session IDs (status, message, cancel).

---

#### **H1: Playbook Name Validation Too Permissive** (HIGH)

**Finding:** Plan specifies "alphanumeric, dash, underscore only" but doesn't enforce max length or reject reserved names.

**Attack Vector:**
```bash
# User creates playbook with 10,000 character name
PLAYBOOK_NAME="A"*10000

# OR: reserved names that might have special meaning
PLAYBOOK_NAME="__system__"
PLAYBOOK_NAME="default"
```

**Impact:**
- If Devin API stores playbooks in filesystem, long names could cause path issues
- Reserved names might overwrite system playbooks

**Remediation:**
```bash
validate_playbook_name() {
    name="$1"
    if [ -z "$name" ]; then
        error "Playbook name required"
    fi
    # Max 64 characters
    if [ ${#name} -gt 64 ]; then
        error "Playbook name too long (max 64 chars): $name"
    fi
    # Alphanumeric, dash, underscore only
    if ! printf '%s' "$name" | grep -qE '^[a-zA-Z0-9_-]+$'; then
        error "Playbook name must be alphanumeric with dashes/underscores: $name"
    fi
    # Reject reserved prefixes
    case "$name" in
        __*|system*|default|admin*)
            error "Playbook name uses reserved prefix: $name"
            ;;
    esac
}
```

---

#### **H4: No Max Length on Session IDs** (HIGH)

**Finding:** Session ID validation (C2) doesn't specify max length. Unbounded input could cause issues.

**Remediation:** Enforce max 64 characters in `validate_session_id()` (included in C2 fix).

---

#### **H7: Repo URL Injection in Wiki Command** (HIGH)

**Finding:** Wiki command detects repo from `git remote` without validation. Malicious `.git/config` could cause SSRF.

**Attack Vector:**
```bash
# Malicious git remote in .git/config
[remote "origin"]
    url = https://internal-api.company.local/admin

# Wiki command detects and uses this URL
# May cause SSRF if MCP server follows the URL
```

**Impact:** SSRF to internal network, potential data exfiltration.

**Remediation:**
```bash
# In wiki.md command
detected_repo=$(git remote get-url origin 2>/dev/null || echo "")

# Validate URL format before use
validate_repo_url() {
    url="$1"
    # Only allow github.com, gitlab.com, bitbucket.org
    if ! printf '%s' "$url" | grep -qE '^https://(github\.com|gitlab\.com|bitbucket\.org)/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+'; then
        error "Unsupported repository URL (only GitHub/GitLab/Bitbucket supported): $url"
    fi
}

validate_repo_url "$detected_repo"
```

Add to CLAUDE.md:
```markdown
## Security: Repository URL Validation

Wiki commands auto-detect repository from `git remote origin`. Only GitHub, GitLab,
and Bitbucket URLs are supported. Reject all other URLs to prevent SSRF.
```

---

#### **M1: HTML/Script Stripping Not Specified** (MEDIUM)

**Finding:** Plan mentions "max 8000 chars" for prompts but doesn't specify HTML stripping.

**Remediation:** Add to `devin-workflows` skill:
```markdown
### Input Sanitization

- Strip HTML tags: `sed 's/<[^>]*>//g'`
- Strip script tags: `sed '/<script/,/<\/script>/d'`
- Normalize whitespace: `tr -s '[:space:]' ' '`
```

**Note:** Only needed if Devin UI reflects input unsanitized. Verify during implementation.

---

### Category 3: TOCTOU & Race Conditions

#### **C3: Orchestrator Check-Then-Act Race Condition** (CRITICAL)

**Finding:** Orchestrator workflow has TOCTOU vulnerability:
1. Poll session until complete
2. Review output
3. If bad, send fix message
4. Go to step 1

**Attack Vector:**
```
Time    Orchestrator Action             External Actor
T0      Poll: session "complete"
T1      Review: PR has bug
T2      Decide: send fix message        User cancels session via web UI
T3      Send message to session         Session already cancelled
T4      Poll: session "cancelled"
T5      Review: no new output
T6      Decide: send fix message
T7      Send message                    Devin API rejects (session ended)
T8      Orchestrator confused
        BUT: iteration count++
T9      Retry 3 times, burn credits
```

**Impact:**
- Orchestrator confused by state changes
- Wasted API calls
- Potential infinite loop if iteration logic broken

**Remediation:**

Add explicit state validation before each action in orchestrator:

```markdown
## Orchestrator Workflow (TOCTOU-Safe)

1. Create session, record session ID and initial state hash
2. Poll until complete OR max timeout (5 min)
3. **STATE VALIDATION:** Fetch session status
   - If state != "complete": log error, exit workflow
   - If state hash changed unexpectedly: prompt user, exit
4. Review output for quality
5. **If issues found AND iteration < 3:**
   a. **STATE VALIDATION:** Re-fetch session status
   b. If state != "complete": log "Session changed state during review", exit
   c. Send fix message
   d. **VERIFY MESSAGE SENT:** Check API response for success
   e. increment iteration++
   f. Set new state hash
   g. Go to step 2
6. If iteration >= 3: escalate to user
7. Present results

**Hard Limits:**
- Max 3 review-fix cycles
- Max 5 minutes per poll cycle
- Max 15 minutes total workflow time
```

Add to `devin-workflows` skill:
```markdown
## TOCTOU Mitigation (H1 Pattern)

For all stateful operations (orchestrator, cancel, message):

1. **Fetch current state** before action
2. **Compare state** against expected/last-known state
3. **Prompt user** if state changed unexpectedly
4. **Re-fetch state** after action to verify
5. **Abort** if state transitions impossible (e.g., message to cancelled session)
```

**Severity Justification:** Medium exploitability (requires concurrent user action), high impact (cost overrun, infinite loops).

---

#### **H2: Cancel Command TOCTOU Window** (HIGH)

**Finding:** Cancel command does:
1. Fetch status (C1 validation)
2. Ask user to confirm
3. Send termination request

Window between step 1 and 3 allows session to complete naturally.

**Impact:** User confirms cancel, but session already completed. Wasted confirmation interaction.

**Remediation:**
```markdown
## Cancel Workflow (TOCTOU-Mitigated)

1. Fetch session status (C1 validation)
2. If status != "running": error "Session not running (current: $STATUS)"
3. Ask user to confirm: "Cancel session $ID? (current status: running)"
4. **Re-fetch status** after confirmation
5. If status changed: warn "Session status changed to $NEW_STATUS during confirmation. Still cancel? (y/n)"
6. Send termination request
7. **Verify cancellation:** Re-fetch status, expect "cancelled"
```

---

#### **H5: Message Command TOCTOU** (HIGH)

**Finding:** Message command validates session is "running" before sending message, but session could end between validation and send.

**Remediation:**
```bash
# In message.md
status=$(curl -s "https://api.devin.ai/v1/sessions/${SESSION_ID}" | jq -r '.status')

if [ "$status" != "running" ]; then
    error "Session not running (current: $status). Cannot send message."
fi

# Send message
response=$(jq -n --arg msg "$MESSAGE" '{message: $msg}' | \
    curl -s -X POST "https://api.devin.ai/v1/sessions/${SESSION_ID}/messages" \
        -H "Authorization: Bearer $DEVIN_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d @-)

# Verify message sent
if ! echo "$response" | jq -e '.id' >/dev/null 2>&1; then
    # Extract error
    error_msg=$(echo "$response" | jq -r '.error // "Unknown error"')
    error "Failed to send message: $error_msg"
fi
```

---

### Category 4: Rate Limiting & Resource Abuse

#### **C6: Single Retry Allows 429 Abuse** (CRITICAL)

**Finding:** Plan says "retry once" on 429. No backoff, no total retry limit. User could script rapid `/devin:delegate` calls.

**Attack Vector:**
```bash
# User scripts 100 delegate calls
for i in {1..100}; do
    /devin:delegate "Task $i"
done

# Each call gets 2 attempts (original + 1 retry)
# = 200 API calls if all hit rate limit
# Devin API may ban account for abuse
```

**Impact:**
- Account ban from Devin API
- Excessive cost (each session creation costs money)
- Poor user experience (slow, confusing errors)

**Remediation:**

Replace "retry once" with exponential backoff:

```bash
# Add to devin-workflows skill

## Rate Limit Handling

When API returns 429:

1. Extract `Retry-After` header (seconds)
2. If no header, use exponential backoff: 1s, 2s, 4s, 8s, 16s (max 5 retries)
3. Sleep for backoff duration
4. Retry request
5. If still 429 after 5 retries: error "Rate limited. Try again in a few minutes."

**Global rate limit:** Track API calls per minute. If >30 calls/min, inject 2s delay before next call.
```

Implementation:
```bash
api_call_with_retry() {
    local url="$1"
    local method="${2:-GET}"
    local data="${3:-}"
    local retry=0
    local max_retries=5
    local backoff=1

    while [ $retry -le $max_retries ]; do
        if [ -n "$data" ]; then
            response=$(echo "$data" | curl -s -w "\n%{http_code}" -X "$method" "$url" \
                -H "Authorization: Bearer $DEVIN_API_TOKEN" \
                -H "Content-Type: application/json" \
                -d @-)
        else
            response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
                -H "Authorization: Bearer $DEVIN_API_TOKEN")
        fi

        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | sed '$d')

        if [ "$http_code" = "429" ]; then
            retry_after=$(echo "$body" | jq -r '.retry_after // 0')
            if [ "$retry_after" -gt 0 ]; then
                sleep "$retry_after"
            else
                sleep "$backoff"
                backoff=$((backoff * 2))
            fi
            retry=$((retry + 1))
        else
            echo "$body"
            return 0
        fi
    done

    error "Rate limited after $max_retries retries. Try again later."
}
```

**Severity Justification:** High exploitability (user can script), high impact (account ban, cost overrun).

---

#### **M2: No Global Rate Limit Tracking** (MEDIUM)

**Finding:** Each command independently retries. No global state tracking total API calls.

**Remediation:** Add to CLAUDE.md:
```markdown
## Rate Limiting Best Practices

- Use `api_call_with_retry()` from `devin-workflows` skill for all API calls
- Commands should self-throttle: if making >5 API calls in a loop, add 200ms delay between calls
- Orchestrator should track total API calls per workflow, abort if >50 calls
```

---

#### **M3: 30s Timeout May Be Too Long** (MEDIUM)

**Finding:** Plan uses `--max-time 30` for mutations. Long timeout could cause resource exhaustion if many requests stall.

**Remediation:** Differentiate timeouts by operation:
```markdown
## Timeout Values

- Session creation: `--max-time 30` (can be slow)
- Status check: `--max-time 10` (should be fast)
- Message send: `--max-time 15` (medium)
- Cancel: `--max-time 10` (should be fast)
- Playbook list: `--max-time 10` (should be fast)
- All operations: `--connect-timeout 5` (consistent)
```

---

### Category 5: MCP Security & Trust Boundaries

#### **H8: No Validation of MCP Server Responses** (HIGH)

**Finding:** Plan assumes MCP servers return well-formed data. Malicious or compromised MCP server could return XSS, shell injection, or malformed data.

**Attack Vector:**
```bash
# Malicious MCP server returns:
{
    "result": {
        "title": "$(rm -rf /)",
        "content": "<script>alert('xss')</script>"
    }
}

# If wiki command displays this without sanitization:
echo "Result: $title"  # Shell injection
```

**Impact:**
- Shell command injection if data used in bash without quoting
- XSS if data displayed in web UI (unlikely in terminal, but possible in Claude Code UI)
- Data corruption if malformed JSON

**Remediation:**

Add MCP response validation to all agents using MCP tools:

```markdown
## MCP Security (Trust Boundary)

**Assumption:** MCP servers at `mcp.deepwiki.com` and `mcp.devin.ai` are
controlled by Devin.AI and are trusted.

**Validation:** Even trusted MCP servers can be compromised. Sanitize all responses:

1. **JSON validation:** Parse with `jq` and verify expected fields exist
2. **XSS prevention:** Strip HTML tags from all string fields before display
3. **Shell safety:** Quote all variables when used in bash: `"$var"` not `$var`
4. **Length limits:** Reject responses >1MB
5. **Schema validation:** Verify response structure matches expected schema

**Example:**
```bash
mcp_result=$(mcp_tool "search_wiki" "{\"query\": \"$QUERY\"}")

# Validate response
if ! echo "$mcp_result" | jq -e '.results' >/dev/null 2>&1; then
    error "Invalid MCP response (missing .results field)"
fi

# Extract and sanitize
title=$(echo "$mcp_result" | jq -r '.results[0].title // "Unknown"' | sed 's/<[^>]*>//g')
```

Add to CLAUDE.md:
```markdown
## MCP Server Trust Model

- **DeepWiki MCP:** Public server, treat responses as untrusted input
- **Devin MCP:** Private server (user's API key), slightly more trusted but still validate
- **Validation:** All MCP responses sanitized before use (XSS strip, JSON validate, quote vars)
```

**Severity Justification:** Medium exploitability (requires MCP server compromise), high impact (RCE if shell injection).

---

### Category 6: Information Disclosure

#### **H3: Session URLs May Contain Sensitive Data** (HIGH)

**Finding:** Plan displays session URLs from Devin API. URLs might contain auth tokens or sensitive IDs in query params.

**Attack Vector:**
```bash
# Devin API returns:
{
    "session_url": "https://app.devin.ai/session/abc123?token=apk_xyz&user=admin"
}

# Command displays:
echo "View session: https://app.devin.ai/session/abc123?token=apk_xyz&user=admin"

# User copies URL to Slack/email, leaking token
```

**Impact:** Token/credential leakage via URL sharing.

**Remediation:**
```bash
# Sanitize URLs before display
sanitize_url() {
    url="$1"
    # Strip query params that look like tokens
    echo "$url" | sed 's/[?&]token=[^&]*//g; s/[?&]api_key=[^&]*//g; s/[?&]secret=[^&]*//g'
}

session_url=$(echo "$response" | jq -r '.session_url')
safe_url=$(sanitize_url "$session_url")
echo "View session: $safe_url"
```

Add to CLAUDE.md:
```markdown
## URL Sanitization

Session URLs from Devin API may contain sensitive query parameters.
Sanitize before display: strip `?token=`, `?api_key=`, `?secret=` params.
```

---

#### **M6: No Guidance on What NOT to Log** (MEDIUM)

**Finding:** Plan doesn't specify what data should never be logged (tokens, full API responses, user messages).

**Remediation:** Add to CLAUDE.md:
```markdown
## Logging Security

**Never log:**
- `DEVIN_API_TOKEN` value
- Full API responses (may contain sensitive data)
- User task prompts (may contain credentials/keys)
- Session URLs with query params
- `Authorization` headers

**Safe to log:**
- Session IDs (alphanumeric only)
- Session status (running/complete/failed)
- Error codes (401, 429, 500)
- Sanitized error messages
```

---

#### **M5: No Verification of Session Ownership** (MEDIUM)

**Finding:** Plan assumes all sessions belong to the user. No check that `SESSION_ID` is owned by `DEVIN_API_TOKEN`.

**Attack Vector:**
```bash
# User guesses/brute-forces another user's session ID
/devin:status "other-user-session-123"

# If Devin API doesn't enforce ownership:
# User sees other user's session status, PR links, artifacts
```

**Impact:** Horizontal privilege escalation, info disclosure.

**Remediation:**

Add to status, message, cancel commands:

```bash
# After fetching session
owner_check=$(echo "$response" | jq -r '.user_id // .owner // "unknown"')

# Compare against current user (fetch once, cache)
if [ -z "$CURRENT_USER_ID" ]; then
    CURRENT_USER_ID=$(curl -s "https://api.devin.ai/v1/me" \
        -H "Authorization: Bearer $DEVIN_API_TOKEN" | jq -r '.id')
fi

if [ "$owner_check" != "$CURRENT_USER_ID" ] && [ "$owner_check" != "unknown" ]; then
    error "Session $SESSION_ID does not belong to you"
fi
```

**Note:** This assumes Devin API has a `/v1/me` endpoint and sessions have an `owner` field. Verify during implementation. If Devin API enforces ownership at the API level, this check is redundant (defense-in-depth).

---

### Category 7: Error Handling & Resilience

#### **H9: curl Exit Codes Not Checked** (HIGH)

**Finding:** Plan examples use `curl -s` but don't show exit code checking. Silent failures possible.

**Attack Vector:**
```bash
# Network timeout
response=$(curl -s --max-time 10 "https://api.devin.ai/v1/sessions")
# curl exits with code 28 (timeout), but script continues
# $response is empty, jq fails with unclear error

session_id=$(echo "$response" | jq -r '.id')
# session_id is now "null", used in subsequent calls
curl "https://api.devin.ai/v1/sessions/null"
# Produces confusing error
```

**Impact:** Silent failures, unclear error messages, wasted API calls.

**Remediation:**

```bash
# Wrapper for all API calls
api_call() {
    local method="$1"
    local url="$2"
    local data="${3:-}"

    if [ -n "$data" ]; then
        response=$(echo "$data" | curl -s --connect-timeout 5 --max-time 30 \
            -w "\n%{http_code}" -X "$method" "$url" \
            -H "Authorization: Bearer $DEVIN_API_TOKEN" \
            -H "Content-Type: application/json" \
            -d @-)
        curl_exit=$?
    else
        response=$(curl -s --connect-timeout 5 --max-time 30 \
            -w "\n%{http_code}" -X "$method" "$url" \
            -H "Authorization: Bearer $DEVIN_API_TOKEN")
        curl_exit=$?
    fi

    # Check curl exit code
    if [ $curl_exit -ne 0 ]; then
        case $curl_exit in
            6) error "Network error: could not resolve host" ;;
            7) error "Network error: failed to connect" ;;
            28) error "Request timeout" ;;
            *) error "curl failed with exit code $curl_exit" ;;
        esac
    fi

    # Parse HTTP code and body
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    # Check HTTP status
    case "$http_code" in
        200|201) echo "$body" ;;
        401) error "Authentication failed. Check DEVIN_API_TOKEN." ;;
        403) error "Permission denied. Check API token permissions." ;;
        404) error "Resource not found." ;;
        429) error "Rate limited. Try again later." ;;
        5*) error "Devin API error (HTTP $http_code). Try again later." ;;
        *) error "Unexpected HTTP status: $http_code" ;;
    esac
}
```

Add to `devin-workflows` skill as reusable pattern.

---

## Security Patterns Applied (vs. Gaps)

### ✅ Strong Security Practices in Plan

1. **Shell injection prevention via `jq`:** Exemplary. All JSON construction uses `jq -n --arg`, never string interpolation.
2. **Input length limits:** Prompts (8000 chars), messages (2000 chars) documented.
3. **Timeout configuration:** Connect and max-time timeouts specified.
4. **Write safety tiers:** M3 (destructive ops) correctly identified for cancel.
5. **Rate limit awareness:** 429 detection mentioned (though implementation weak).

### ❌ Missing Security Patterns (vs. yellow-linear)

| Pattern | yellow-linear | yellow-devin Plan | Gap |
|---------|---------------|-------------------|-----|
| **C1 validation** (ownership before write) | ✅ All update_issue calls | ❌ No session ownership check | **M5** |
| **Input format validation** | ✅ Issue ID regex `[A-Z]{2,5}-[0-9]{1,6}` | ❌ No session ID format | **C2, C4** |
| **TOCTOU mitigation (H1)** | ✅ Fetch-compare-prompt-update | ❌ Orchestrator has race | **C3, H2, H5** |
| **allowed-tools frontmatter** | ✅ All agents | ✅ All agents (in plan) | ✅ |
| **"Use when..." trigger clauses** | ✅ All commands/agents | ✅ All (in plan) | ✅ |
| **LF line endings** | ✅ `.gitattributes` | ✅ `.gitattributes` in plan | ✅ |
| **Token security** | ✅ (Linear uses MCP, no direct token) | ⚠️ Token in shell, weak validation | **C1, C5, H6** |
| **Error sanitization** | ⚠️ Not documented | ❌ Not mentioned | **C5, M6** |
| **MCP response validation** | ⚠️ Assumed trusted | ❌ Not mentioned | **H8** |

---

## Recommendations by Priority

### P1: Must Fix Before Implementation (Critical)

1. **C1 - Token leakage via curl verbose:** Add explicit rule forbidding `-v` flag in `devin-workflows` skill
2. **C2 - Session ID injection:** Implement `validate_session_id()` function, use before all API calls
3. **C3 - Orchestrator TOCTOU:** Redesign workflow with state validation before each action (see remediation)
4. **C4 - Missing session ID validation:** Same as C2
5. **C5 - Error message token echo:** Add error sanitization step to all commands
6. **C6 - Rate limit abuse:** Replace "retry once" with exponential backoff (5 retries max)

### P2: Harden Before Production (High)

1. **H1 - Playbook name validation:** Add max length (64 chars), reject reserved prefixes
2. **H2 - Cancel TOCTOU:** Add state re-validation after user confirmation
3. **H3 - Session URL sanitization:** Strip sensitive query params from URLs before display
4. **H4 - Session ID max length:** Enforce 64-char max in validation function
5. **H5 - Message TOCTOU:** Add state check after message send, verify success
6. **H6 - Token empty validation:** Check token is non-empty and matches format
7. **H7 - Repo URL injection:** Validate git remote URLs, whitelist GitHub/GitLab/Bitbucket
8. **H8 - MCP response validation:** Sanitize all MCP responses (XSS strip, JSON validate)
9. **H9 - curl exit code checking:** Wrap all curl calls in `api_call()` helper with exit code handling

### P3: Defense-in-Depth (Medium)

1. **M1 - HTML stripping:** Add to input sanitization if Devin reflects input
2. **M2 - Global rate limit tracking:** Document self-throttling pattern for loops
3. **M3 - Timeout tuning:** Differentiate timeouts by operation type
4. **M4 - Token rotation:** Document best practices in CLAUDE.md
5. **M5 - Session ownership:** Verify session belongs to user (if API doesn't enforce)
6. **M6 - Logging security:** Document what never to log

---

## Implementation Checklist

Before starting Phase 1:

- [ ] Add `validate_session_id()` to `devin-workflows` skill (C2, C4)
- [ ] Add `api_call_with_retry()` with exponential backoff to skill (C6, H9)
- [ ] Add "Token Security" section to CLAUDE.md (C1, C5, H6)
- [ ] Add "TOCTOU Mitigation" section to skill (C3, H2, H5)
- [ ] Add "Input Validation" section to skill with all patterns (H1, H4, H7, M1)
- [ ] Add "MCP Security" section to CLAUDE.md (H8)
- [ ] Add "URL Sanitization" section to skill (H3)
- [ ] Add "Logging Security" section to CLAUDE.md (M6)
- [ ] Review all command examples, ensure no `-v` flags in curl (C1)
- [ ] Add error sanitization to all command templates (C5)

During implementation:

- [ ] Verify Devin API session ID format (UUID? alphanumeric? length?)
- [ ] Check if Devin API enforces session ownership (impacts M5)
- [ ] Verify MCP server response schemas (impacts H8 validation)
- [ ] Test rate limit behavior, measure `Retry-After` header format
- [ ] Verify token format (starts with `apk_` or `apk_user_`?)

Before Phase 3 (orchestrator):

- [ ] Write orchestrator state machine with explicit TOCTOU guards (C3)
- [ ] Add hard limits: max 3 iterations, max 15 min total time
- [ ] Add state hash tracking for change detection
- [ ] Test orchestrator with concurrent session modifications (manual cancel during workflow)

---

## Open Questions (Security-Focused)

1. **Session ID format:** What is the exact format? UUID v4? Alphanumeric? Affects C2/C4 regex.
2. **Session ownership:** Does Devin API enforce per-token session isolation? Or can tokens access all sessions? Affects M5 severity.
3. **MCP auth:** How does Devin MCP authenticate? Same `DEVIN_API_TOKEN` or OAuth? Affects token security model.
4. **Playbook storage:** Are playbooks user-scoped or global? Can users overwrite system playbooks? Affects H1 severity.
5. **Rate limits:** What are the actual rate limits? Calls/min, calls/hour, cost-based? Affects C6 remediation.
6. **Session URLs:** Do they contain sensitive data in query params? Affects H3 severity.
7. **API error messages:** Do they echo request data? Affects C5 severity.

---

## Comparison to OWASP Top 10 (API Security 2023)

| OWASP Category | yellow-devin Risk | Mitigation |
|----------------|-------------------|------------|
| **API1: Broken Object Level Authorization** | Medium (M5 - no session ownership check) | Verify session owner matches token |
| **API2: Broken Authentication** | High (C1, C5, H6 - token security gaps) | Validate token format, sanitize errors, forbid verbose curl |
| **API3: Broken Object Property Level Authorization** | Low (Devin API responsible) | N/A - trust Devin API |
| **API4: Unrestricted Resource Consumption** | High (C6 - weak rate limiting) | Exponential backoff, global call tracking |
| **API5: Broken Function Level Authorization** | Low (Devin API responsible) | N/A - trust Devin API |
| **API6: Unrestricted Access to Sensitive Business Flows** | Medium (C3 - orchestrator abuse) | Hard limits: 3 iterations, 15 min timeout |
| **API7: Server Side Request Forgery** | High (H7 - repo URL injection) | Validate git remote URLs, whitelist domains |
| **API8: Security Misconfiguration** | Medium (H9 - no curl error handling) | Wrap curl in error-checking helper |
| **API9: Improper Inventory Management** | Low (only 1 API integrated) | N/A |
| **API10: Unsafe Consumption of APIs** | High (H8 - no MCP validation) | Sanitize all MCP responses |

---

## Post-Audit Action Items

### For Plugin Author

1. **Review all 21 findings** in detail
2. **Implement P1 fixes** before writing any code
3. **Update plan document** with security sections from this audit
4. **Create security test cases** for each P1/P2 finding
5. **Schedule follow-up review** after Phase 1 implementation

### For Reviewers (Future PR)

Use this audit as a checklist:

- [ ] Verify `validate_session_id()` present and used everywhere
- [ ] Check all curl commands use `api_call_with_retry()` helper
- [ ] Verify no `-v` or `--trace` flags in any curl call
- [ ] Check error messages don't echo tokens
- [ ] Verify orchestrator has TOCTOU guards
- [ ] Test rate limiting with rapid-fire commands
- [ ] Verify MCP responses sanitized
- [ ] Check session ownership validation
- [ ] Verify all TOCTOU mitigations from H2, H5

---

## Key Takeaways

1. **`jq` safety is excellent:** Plan's use of `jq` for JSON construction eliminates primary shell injection risk. This pattern should be template for all future plugins.

2. **API integration != MCP integration:** Security patterns from yellow-linear (C1, TOCTOU) apply, but new risks emerge (token in shell, session ID injection, orchestrator races).

3. **Orchestrator is highest risk:** State machine complexity + cost implications + TOCTOU makes orchestrator the most critical component for security review.

4. **Token security critical:** Unlike MCP-only plugins, this plugin handles raw API tokens in shell. Leakage via curl verbose, errors, or logs is high risk.

5. **Input validation gaps:** Plan documents length limits but lacks format validation (session IDs, playbook names, repo URLs). Regex patterns needed.

6. **Error handling underspecified:** curl exit codes, HTTP status codes, error message sanitization not covered in plan.

7. **MCP trust boundary unclear:** Plan doesn't address MCP server compromise scenario. Defense-in-depth: sanitize even "trusted" responses.

---

## Conclusion

The yellow-devin plugin plan demonstrates strong awareness of shell injection risks but has critical gaps in API integration security. **21 findings** require remediation, with **6 critical** issues blocking implementation.

**Primary concerns:**
- Token leakage via verbose curl or error messages
- Session ID injection enabling API abuse
- Orchestrator TOCTOU race conditions
- Weak rate limiting allowing cost overruns

**Recommended path forward:**
1. Address all P1 findings before implementation
2. Update plan document with security sections from this audit
3. Implement P2 findings during Phase 1-3
4. Schedule multi-agent code review after Phase 1 (similar to yellow-linear)
5. Add P3 findings during polish phase

With proper remediation, this plugin can achieve security posture equal to or better than yellow-linear.

---

**Audit Date:** 2026-02-10
**Auditor Role:** security-sentinel agent
**Plan Version:** Initial (pre-implementation)
**Next Review:** After Phase 1 implementation (delegate/status/cancel commands)
