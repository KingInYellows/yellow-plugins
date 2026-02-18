---
status: complete
priority: p1
issue_id: "072"
tags: [code-review, yellow-ci, security]
dependencies: []
---

# Implement Missing SSH Private Key Redaction

## Problem Statement

The `docs/security-patterns.md` documentation explicitly lists pattern #13 (SSH private key redaction) as a required security control, but the actual implementation in `plugins/yellow-ci/hooks/scripts/lib/redact.sh` does not include this pattern. This means SSH private keys appearing in CI logs would leak unredacted, creating a critical security vulnerability.

## Findings

**Documentation:** `docs/security-patterns.md` (assumed location based on project structure)
**Pattern #13:** SSH private key redaction

**Implementation:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh`
**Status:** Missing

**Gap:** Documentation-implementation mismatch. The security specification requires SSH key redaction, but the code doesn't implement it.

**Risk Scenarios:**
1. Developer accidentally commits SSH key to repo
2. CI job runs `cat ~/.ssh/id_rsa` in debug output
3. Build script echoes SSH key from environment variable
4. CI log captures `git` error message containing key path
5. SSH key appears in failed command output (e.g., `ssh-add` debugging)

**SSH Key Formats:**
```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----
```

```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA...
...
-----END OPENSSH PRIVATE KEY-----
```

Other formats: `BEGIN EC PRIVATE KEY`, `BEGIN DSA PRIVATE KEY`, `BEGIN PRIVATE KEY` (PKCS#8)

## Proposed Solutions

### Option 1: Simple Range-Based Redaction (Recommended)
**Add to `redact_secrets()` in redact.sh:**
```bash
-e '/-----BEGIN.*PRIVATE KEY-----/,/-----END.*PRIVATE KEY-----/c\[REDACTED:ssh-key]'
```

**Pros:**
- Simple sed range pattern
- Handles all SSH key formats (RSA, ECDSA, Ed25519, DSA, PKCS#8)
- Single line replacement for entire key block
- No regex complexity or ReDoS risk

**Cons:**
- Collapses multi-line key to single line (acceptable for logs)
- If log contains multiple keys, each gets separate `[REDACTED:ssh-key]` line

### Option 2: Preserve Line Count (Multi-Line)
**Add to `redact_secrets()`:**
```bash
-e '/-----BEGIN.*PRIVATE KEY-----/,/-----END.*PRIVATE KEY-----/s/.*/[REDACTED:ssh-key]/'
```

**Pros:**
- Preserves line count (each line becomes `[REDACTED:ssh-key]`)
- Maintains log structure

**Cons:**
- Noisier output (many repeated `[REDACTED:ssh-key]` lines)
- Less clear that it's a single redacted entity

### Option 3: Comprehensive PEM Redaction (Defense in Depth)
Redact all PEM-format secrets (SSH keys, certificates, etc.):
```bash
-e '/-----BEGIN.*-----/,/-----END.*-----/c\[REDACTED:pem-encoded-secret]'
```

**Pros:**
- Catches SSH keys, TLS certs, other PEM secrets
- Most comprehensive approach

**Cons:**
- Over-redacts: would hide legitimate certificates in logs
- Public certificates (not secrets) would be redacted unnecessarily
- Too aggressive for CI log transparency

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh`
**Function:** `redact_secrets()`
**Location:** Add after line 28 (current end of sed pipeline)

**Implementation:**
```bash
redact_secrets() {
    local content="$1"

    printf '%s' "$content" | sed \
        -e 's/\bAKIA[A-Z0-9]\{16\}\b/[REDACTED:aws-key]/g' \
        -e 's/\b[A-Za-z0-9/+=]\{40\}\b/[REDACTED:aws-secret]/g' \
        -e 's/\b[A-Za-z0-9/+=]\{32,\}\b/[REDACTED:api-key]/g' \
        -e 's/ghp_[A-Za-z0-9]\{36\}/[REDACTED:github-token]/g' \
        -e 's/gho_[A-Za-z0-9]\{36\}/[REDACTED:github-oauth]/g' \
        -e 's/ghs_[A-Za-z0-9]\{36\}/[REDACTED:github-secret]/g' \
        -e 's/\bey[A-Za-z0-9_-]\{10,\}\.[A-Za-z0-9_-]\{10,\}\.[A-Za-z0-9_-]\{10,\}/[REDACTED:jwt]/g' \
        -e '/-----BEGIN.*PRIVATE KEY-----/,/-----END.*PRIVATE KEY-----/c\[REDACTED:ssh-key]'  # NEW
}
```

**SSH Key Format Reference:**
- RSA: `-----BEGIN RSA PRIVATE KEY-----`
- ECDSA: `-----BEGIN EC PRIVATE KEY-----`
- Ed25519: `-----BEGIN OPENSSH PRIVATE KEY-----`
- DSA: `-----BEGIN DSA PRIVATE KEY-----`
- PKCS#8: `-----BEGIN PRIVATE KEY-----`
- Encrypted: `-----BEGIN ENCRYPTED PRIVATE KEY-----`

Pattern `BEGIN.*PRIVATE KEY` catches all variants.

**Testing:**
```bash
# Create test input with SSH key
cat > test_ssh_key.txt << 'EOF'
Some log output
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAtest
fakekeydata
-----END RSA PRIVATE KEY-----
More log output
EOF

# Test redaction
source plugins/yellow-ci/hooks/scripts/lib/redact.sh
redact_secrets "$(cat test_ssh_key.txt)"

# Expected output:
# Some log output
# [REDACTED:ssh-key]
# More log output
```

**Cross-Reference:**
- Verify `docs/security-patterns.md` pattern #13 requirements
- Check if other documentation references SSH key redaction
- Update `docs/security-patterns.md` to mark pattern #13 as implemented

## Acceptance Criteria

- [ ] SSH private key redaction sed expression added to `redact_secrets()`
- [ ] Pattern uses `/-----BEGIN.*PRIVATE KEY-----/,/-----END.*PRIVATE KEY-----/c\[REDACTED:ssh-key]`
- [ ] Test with RSA private key confirms full key block is redacted
- [ ] Test with OPENSSH private key (Ed25519) confirms redaction
- [ ] Test with multiple keys in log confirms each is redacted separately
- [ ] Surrounding log content (before/after key) is preserved
- [ ] All existing Bats tests pass
- [ ] Documentation (`docs/security-patterns.md`) updated to mark pattern #13 as implemented
- [ ] Security review confirms implementation matches specification
