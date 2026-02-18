---
status: complete
priority: p1
issue_id: "070"
tags: [code-review, yellow-ci, security, performance]
dependencies: []
---

# Fix JWT Regex ReDoS Vulnerability in redact.sh

## Problem Statement

The JWT redaction pattern in `plugins/yellow-ci/hooks/scripts/lib/redact.sh:24` uses unbounded quantifiers `\{10,\}` three times in a single regex. This creates a catastrophic backtracking vulnerability (ReDoS) when processing crafted input. Since CI logs are untrusted input (user-controlled commands, API responses, etc.), this is a security risk that can cause denial-of-service through CPU exhaustion.

## Findings

**Location:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh:24`

**Current Code:**
```bash
-e 's/\bey[A-Za-z0-9_-]\{10,\}\.[A-Za-z0-9_-]\{10,\}\.[A-Za-z0-9_-]\{10,\}/[REDACTED:jwt]/g'
```

**Vulnerability Analysis:**
- Pattern uses three unbounded quantifiers: `\{10,\}`
- No upper bounds on token length
- Crafted input like `eyXXXXX.YYYYY.ZZZZZ` with many non-matching characters can cause exponential backtracking
- Attacker-controlled CI logs (via malicious commands or API responses) can trigger this

**Attack Vector:**
1. Malicious user submits PR with command that outputs crafted near-JWT strings
2. CI runner executes command, captures output to logs
3. Log sanitization calls `redact_secrets()` with crafted input
4. sed regex engine enters catastrophic backtracking
5. CI runner CPU spikes, job times out or hangs

**Real-World Context:**
- JWT tokens are typically 100-500 characters per segment
- Real JWTs won't trigger this, but crafted attack strings will
- This is a classic ReDoS pattern (multiple unbounded quantifiers)

## Proposed Solutions

### Option 1: Add Upper Bounds to Quantifiers (Recommended)
**Change line 24:**
```bash
-e 's/\bey[A-Za-z0-9_-]\{10,500\}\.[A-Za-z0-9_-]\{10,500\}\.[A-Za-z0-9_-]\{10,500\}/[REDACTED:jwt]/g'
```

**Pros:**
- Prevents catastrophic backtracking
- Still matches all real-world JWTs (segments rarely exceed 500 chars)
- Minimal change to existing pattern

**Cons:**
- Theoretical edge case: JWTs with segments >500 chars won't be redacted (extremely rare)

### Option 2: Add Input Size Limit + Upper Bounds (Defense in Depth)
**Before calling redact_secrets(), limit input size:**
```bash
sanitize_log_content() {
    local content="$1"

    # Limit input size to prevent ReDoS (1MB max)
    content="$(printf '%s' "$content" | head -c 1048576)"

    redact_secrets "$content"
}
```

**Update line 24 with bounds:**
```bash
-e 's/\bey[A-Za-z0-9_-]\{10,500\}\.[A-Za-z0-9_-]\{10,500\}\.[A-Za-z0-9_-]\{10,500\}/[REDACTED:jwt]/g'
```

**Pros:**
- Defense in depth: prevents both ReDoS and other resource exhaustion attacks
- Protects against maliciously large log outputs
- Standard practice for untrusted input processing

**Cons:**
- Truncates logs >1MB (acceptable for CI workflow display)
- Slightly more complex

### Option 3: Use POSIX Character Classes (Simplified)
Replace with simpler pattern:
```bash
-e 's/\bey[[:alnum:]_-]\{10,500\}\.[[:alnum:]_-]\{10,500\}\.[[:alnum:]_-]\{10,500\}/[REDACTED:jwt]/g'
```

**Pros:**
- More portable (POSIX character classes)
- Easier to read

**Cons:**
- Still needs upper bounds
- `[[:alnum:]]` may behave differently with locale settings

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh`
**Function:** `redact_secrets()`
**Line:** 24
**Pattern Type:** JWT token redaction

**ReDoS Background:**
- Unbounded quantifiers like `.*`, `.+`, `\{n,\}` can cause exponential backtracking
- Multiple unbounded quantifiers in sequence multiply the risk
- sed uses backtracking regex engine (susceptible to ReDoS)

**Testing ReDoS Fix:**
```bash
# Craft attack string (near-JWT with many alternatives)
ATTACK="eyAAAAAAAAAAA.BBBBBBBBBBBBB.CCCCCCCCCCCCC"
ATTACK="${ATTACK}$(printf 'X%.0s' {1..10000})"  # Add 10k X's

# Time the redaction (should complete quickly with bounds)
time printf '%s' "$ATTACK" | sed -e 's/\bey[A-Za-z0-9_-]\{10,500\}\.[A-Za-z0-9_-]\{10,500\}\.[A-Za-z0-9_-]\{10,500\}/[REDACTED:jwt]/g'
```

**Legitimate JWT Example:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```
- Header: ~36 chars
- Payload: ~80 chars
- Signature: ~43 chars
- All well within 500-char limit

## Acceptance Criteria

- [ ] JWT regex pattern uses bounded quantifiers `\{10,500\}` instead of `\{10,\}`
- [ ] (Optional but recommended) Input size limit added via `head -c 1048576`
- [ ] Test with legitimate JWT confirms redaction still works
- [ ] Test with attack string (10k+ chars) completes in <1 second
- [ ] All existing Bats tests pass
- [ ] Security review confirms ReDoS risk is mitigated
