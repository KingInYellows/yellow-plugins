---
status: complete
priority: p1
issue_id: '071'
tags: [code-review, yellow-ci, security]
dependencies: []
---

# Fix AWS Secret Key Regex Bypass in redact.sh

## Problem Statement

The AWS secret key redaction pattern in
`plugins/yellow-ci/hooks/scripts/lib/redact.sh:19` uses `\{40\}` (exactly 40
characters), but AWS secret access keys can be 40 or more characters. Any AWS
secret keys longer than 40 characters will leak unredacted into CI logs,
creating a critical security vulnerability.

## Findings

**Location:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh:19`

**Current Code:**

```bash
-e 's/\b[A-Za-z0-9/+=]\{40\}\b/[REDACTED:aws-secret]/g'
```

**Issue:** Pattern requires EXACTLY 40 characters due to `\{40\}` (no range
specified).

**AWS Secret Key Facts:**

- AWS secret access keys are currently 40 characters
- However, AWS documentation does not guarantee this length is fixed
- AWS has historically changed credential formats (e.g., temporary credentials
  are longer)
- Security best practice: assume key lengths can vary

**Impact:**

- If AWS issues keys >40 characters, they leak unredacted
- CI logs containing these longer keys would expose secrets
- This is a forward-compatibility security bug

**Similar Patterns in File:**

- Line 18 (AWS access key): uses `\{20\}` (should be `\{20,\}`)
- Line 20 (generic API key): uses `\{32,\}` (correct, unbounded)

**Precedent:** The generic API key pattern (line 20) already uses unbounded
quantifier `\{32,\}`, indicating awareness that key lengths vary.

## Proposed Solutions

### Option 1: Change to Unbounded Quantifier (Recommended)

**Change line 19:**

```bash
-e 's/\b[A-Za-z0-9/+=]\{40,\}\b/[REDACTED:aws-secret]/g'
```

**Pros:**

- Future-proof: handles AWS keys of any length ≥40 chars
- Matches the pattern used for generic API keys (line 20)
- Simple one-character fix: `40` → `40,`

**Cons:**

- Theoretical: could over-match non-AWS base64 strings ≥40 chars
- In practice, risk is low since this is already a heuristic pattern

### Option 2: Add Upper Bound for Safety

**Change line 19:**

```bash
-e 's/\b[A-Za-z0-9/+=]\{40,128\}\b/[REDACTED:aws-secret]/g'
```

**Pros:**

- Prevents over-matching extremely long base64 strings
- Still covers reasonable AWS key length evolution (40-128 chars)
- More conservative approach

**Cons:**

- If AWS keys ever exceed 128 chars, they'd leak again
- Arbitrary limit without strong justification

### Option 3: Fix Both AWS Patterns (Access Key + Secret Key)

**Change line 18 (access key):**

```bash
-e 's/\bAKIA[A-Z0-9]\{16,\}\b/[REDACTED:aws-key]/g'
```

**Change line 19 (secret key):**

```bash
-e 's/\b[A-Za-z0-9/+=]\{40,\}\b/[REDACTED:aws-secret]/g'
```

**Pros:**

- Fixes both AWS credential patterns consistently
- Most thorough approach

**Cons:**

- Broader scope than the original finding
- Could be done as separate fix

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh` **Function:**
`redact_secrets()` **Line:** 19 (AWS secret key pattern) **Related:** Line 18
(AWS access key, same issue)

**Current AWS Credential Lengths:**

- Access Key ID: 20 characters (format: `AKIA...`)
- Secret Access Key: 40 characters (base64-like)
- Temporary Credentials: Variable length (can be longer)

**AWS Documentation:**

- AWS does not guarantee fixed credential lengths
- Format and length are subject to change
- Security tools should handle variable-length credentials

**Testing:**

```bash
# Test 40-char key (current behavior)
echo "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" | \
  sed -e 's/\b[A-Za-z0-9/+=]\{40\}\b/[REDACTED:aws-secret]/g'
# Output: [REDACTED:aws-secret]

# Test 45-char key (bypass with current pattern)
echo "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYEXTRA" | \
  sed -e 's/\b[A-Za-z0-9/+=]\{40\}\b/[REDACTED:aws-secret]/g'
# Output: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYEXTRA (LEAKED!)

# Test 45-char key with fix
echo "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYEXTRA" | \
  sed -e 's/\b[A-Za-z0-9/+=]\{40,\}\b/[REDACTED:aws-secret]/g'
# Output: [REDACTED:aws-secret]
```

## Acceptance Criteria

- [ ] Line 19 uses `\{40,\}` instead of `\{40\}`
- [ ] (Optional) Line 18 uses `\{16,\}` instead of `\{16\}` for consistency
- [ ] Test with 40-char AWS secret confirms redaction still works
- [ ] Test with 45-char simulated secret confirms it's redacted (not leaked)
- [ ] All existing Bats tests pass
- [ ] Security review confirms the pattern now handles variable-length AWS keys
