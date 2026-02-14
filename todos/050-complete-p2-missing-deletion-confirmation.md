---
status: complete
priority: p2
issue_id: "050"
tags: [code-review, security, human-in-loop]
dependencies: []
pr_number: 12
---

# 🟡 P2: Missing Confirmation Before Deleting Pending Todos

## Problem Statement

The audit-synthesizer automatically deletes ALL existing pending todos without user confirmation. If user manually reviewed/annotated pendings or audit is run by mistake, review work is lost.

## Findings

**Location**: `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md:128-134`

**Current**: `rm -f todos/debt/*-pending-*.md` with no confirmation

**Impact**: Data loss, wasted review effort, poor UX

**Source**: Security Sentinel H3

## Proposed Solutions

### Solution 1: Add AskUserQuestion Confirmation

```bash
pending_count=$(find todos/debt -name '*-pending-*.md' | wc -l)

if [ "$pending_count" -gt 0 ]; then
  printf 'Found %d existing pending todo(s). New audit will replace these.\n'

  # Use AskUserQuestion:
  # "Delete $pending_count existing pending findings?
  #  Yes: Delete and proceed
  #  No: Abort synthesis"

  # If NO: exit 0

  rm -f todos/debt/*-pending-*.md
fi
```

**Effort**: Small (30 min)

## Recommended Action

Add confirmation prompt.

## Acceptance Criteria

- [x] Count existing pendings before deletion
- [x] AskUserQuestion prompts user
- [x] On NO: abort synthesis, preserve scanner outputs
- [x] On YES: delete and continue

## Resources

- Security audit: `docs/solutions/security-issues/yellow-debt-plugin-security-audit.md:556-634`

### 2026-02-13 - Resolved
**By:** pr-comment-resolver agent
**Actions:**
- Added confirmation logic with pending count in audit-synthesizer.md
- Added AskUserQuestion to allowed-tools list
- User can now abort synthesis to preserve manually reviewed pending todos
- Error logging added with component prefix
- All acceptance criteria met
