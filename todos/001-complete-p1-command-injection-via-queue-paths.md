---
status: complete
priority: p1
issue_id: '001'
tags: [code-review, security, shell-scripting]
dependencies: []
---

# Command Injection via Unvalidated Queue Paths in session-start.sh

## Problem Statement

`session-start.sh` extracts `file_path` from the JSONL queue file and passes it
directly to `npx ruvector insert` without validation. While `post-tool-use.sh`
validates paths before writing to the queue, the queue file itself can be
modified between write and flush by another process, manual edit, or malicious
git commit.

**Why it matters:** Arbitrary command execution on session start. A crafted
queue entry like `{"type":"file_change","file_path":"; rm -rf / #"}` could
execute arbitrary commands.

## Findings

- **Security Sentinel (C1):** File `session-start.sh` lines 66-67 use queue
  paths without `validate_file_path()`
- **Data Integrity Guardian (#8):** Confirms queue file is writable by external
  processes
- **Silent Failure Hunter (#1):** npx insert failures are also silently
  swallowed with `|| true`

## Proposed Solutions

### Option A: Reuse validate_file_path() from post-tool-use.sh (Recommended)

- Extract validation to a shared function, source in both hooks
- Add validation before every `npx ruvector insert` call
- **Pros:** Consistent validation, defense-in-depth
- **Cons:** Need shared utility file
- **Effort:** Small (1-2 hours)
- **Risk:** Low

### Option B: Inline validation in session-start.sh

- Copy the case/realpath/prefix pattern directly into session-start.sh
- **Pros:** Self-contained, no shared dependency
- **Cons:** Code duplication
- **Effort:** Small (30 min)
- **Risk:** Low

## Recommended Action

**Option A: Shared validate_file_path().** Extract to
`hooks/scripts/lib/validate.sh`, source in both hooks.

## Technical Details

- **Affected files:** `plugins/yellow-ruvector/hooks/scripts/session-start.sh`
  (lines 57-70)
- **Related file:** `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh`
  (lines 23-47, has validate_file_path)

## Acceptance Criteria

- [ ] All file paths read from queue are validated before use in shell commands
- [ ] Paths containing `..`, `/`, `~` are rejected
- [ ] Resolved paths outside project root are rejected
- [ ] Validation function is shared between hooks (no duplication)
- [ ] ShellCheck passes after changes

## Work Log

| Date       | Action                          | Learnings                               |
| ---------- | ------------------------------- | --------------------------------------- |
| 2026-02-12 | Created from PR #10 code review | Security-sentinel C1, data-integrity #8 |

## Resources

- PR: #10
- Security audit:
  `docs/solutions/security-issues/yellow-ruvector-plugin-security-audit.md`
- Shell security patterns: project memory (PR #5 guidelines)
