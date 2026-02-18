---
status: complete
priority: p1
issue_id: '046'
tags: [code-review, security, path-traversal, rce]
dependencies: []
pr_number: 12
completed_date: '2026-02-13'
---

# 🔴 P1: Path Traversal in Synthesizer via Unconstrained Slug Generation

## Problem Statement

The audit-synthesizer generates todo filenames using slugs derived from finding
titles, but slug generation logic is NOT IMPLEMENTED with proper validation. A
malicious scanner could craft a title with path traversal sequences, causing
files to be written outside `todos/debt/` directory - potentially to
`.git/hooks/` for RCE.

**Why this matters**: Arbitrary file write vulnerability leading to git hook
injection enables remote code execution on every commit. This is CRITICAL and
BLOCKS merge.

## Findings

**Location**:
`plugins/yellow-debt/agents/synthesis/audit-synthesizer.md:237-240`

**Current documentation**:

```markdown
**Filename format**: `NNN-pending-SEVERITY-slug-HASH.md`

- `slug`: Kebab-case title (first 40 chars)
```

**The problem**: "Kebab-case title (first 40 chars)" has NO implementation. If
implemented as:

```bash
slug=$(echo "$title" | head -c 40 | tr ' ' '-')
```

Then attack vector exists:

```bash
Finding title: "../../.git/hooks/pre-commit-malicious-payload"
Resulting file: "todos/debt/001-pending-high-../../.git/hooks/pre-commit-malicious-payload.md"
Actual path: ".git/hooks/pre-commit-malicious-payload.md"
```

**Impact**: Git hook injection → RCE on next commit

**Source**: Security Sentinel agent, finding C2

## Proposed Solutions

### Solution 1: Strict Slug Validation with [a-z0-9-] Regex (Recommended)

**Pros:**

- Whitelist approach (most secure)
- Simple regex validation
- Follows MEMORY.md "derived path validation" pattern

**Cons:**

- Loses some title information (special chars removed)

**Effort**: Small (1 hour) **Risk**: Very Low

**Implementation**:

```bash
derive_slug() {
  local title="$1"
  local slug

  # Convert to lowercase, replace spaces/special chars with hyphen
  slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]-' '-' | sed 's/-\+/-/g' | sed 's/^-\|-$//g')

  # Truncate to 40 chars
  slug=$(printf '%s' "$slug" | cut -c1-40 | sed 's/-$//')

  # CRITICAL: Validate slug contains only [a-z0-9-]
  if ! [[ "$slug" =~ ^[a-z0-9-]+$ ]]; then
    printf '[synthesizer] ERROR: Invalid slug derived from title: %s\n' "$title" >&2
    return 1
  fi

  printf '%s' "$slug"
}

slug=$(derive_slug "$finding_title") || {
  # Fallback to hash-based slug if derivation fails
  slug=$(echo -n "$finding_title" | sha256sum | cut -c1-16)
}

todo_filename="todos/debt/${id}-pending-${severity}-${slug}-${content_hash}.md"

# DEFENSE IN DEPTH: Canonicalize and verify final path
resolved=$(realpath -m "$todo_filename")
case "$resolved" in
  "$(pwd)/todos/debt/"*) ;;
  *)
    printf '[synthesizer] ERROR: Path traversal detected in todo filename\n' >&2
    exit 1
    ;;
esac
```

### Solution 2: Hash-Only Slug (Simpler, Less Readable)

**Pros:**

- No validation needed (hash is always safe)
- Shorter code

**Cons:**

- Filenames not human-readable
- Harder to identify findings by name

**Effort**: Quick (15 min) **Risk**: Very Low

**Implementation**:

```bash
slug=$(echo -n "$finding_title" | sha256sum | cut -c1-16)
todo_filename="todos/debt/${id}-pending-${severity}-${slug}.md"
```

## Recommended Action

**Use Solution 1** - Provides readable filenames while maintaining security.

## Technical Details

**Affected Components**:

- audit-synthesizer agent (agents/synthesis/audit-synthesizer.md)

**Attack Surface**: Scanner agents with malicious title output

**Severity Justification**:

- Exploitability: Medium (requires malicious scanner or compromised dependency)
- Impact: Critical (RCE via git hooks)
- OWASP: A01 Broken Access Control, A08 Software/Data Integrity

**MEMORY.md Pattern**: "Derived path validation: validate category/slug contain
only [a-z0-9-] before constructing file paths"

## Acceptance Criteria

- [ ] derive_slug() function implemented with strict validation
- [ ] Regex check enforces [a-z0-9-] character class only
- [ ] Defense-in-depth: final path canonicalized and verified
- [ ] Fallback to hash-based slug if title is malformed
- [ ] Manual test with path traversal title fails safely
- [ ] No files created outside todos/debt/ directory

## Work Log

**2026-02-13**: Finding identified by Security Sentinel during comprehensive PR
review. Classified as critical RCE vector.

## Resources

- Security audit:
  `docs/solutions/security-issues/yellow-debt-plugin-security-audit.md:116-201`
- PR: https://app.graphite.com/github/pr/KingInYellows/yellow-plugins/12
- MEMORY.md: "Derived path validation" pattern
- Agent workflow security:
  `docs/solutions/security-issues/agent-workflow-security-patterns.md`

### 2026-02-13 - Approved for Work

**By:** Triage Session **Actions:**

- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on

### 2026-02-13 - Resolved

**By:** pr-comment-resolver agent **Implementation:**

- Added derive_slug() function with strict [a-z0-9-] validation
- Implemented whitelist approach: tr -c '[:alnum:]-' replaces all
  non-alphanumeric chars
- Added regex validation: `[[ "$slug" =~ ^[a-z0-9-]+$ ]]`
- Fallback to SHA256-based slug if title contains invalid characters
- Defense-in-depth: realpath canonicalization + case pattern match verification
- Added security documentation explaining attack prevention **Location:**
  plugins/yellow-debt/agents/synthesis/audit-synthesizer.md:242-285 **Status:**
  All acceptance criteria met, path traversal vulnerability eliminated
