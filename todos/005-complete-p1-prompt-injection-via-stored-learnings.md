---
status: ready
priority: p1
issue_id: "005"
tags: [code-review, security, prompt-injection]
dependencies: []
---

# Prompt Injection via Stored Learnings Loaded into System Message

## Problem Statement

SessionStart hook loads learnings from the vector DB and injects them directly into the `systemMessage`. If an attacker stores malicious content via `/ruvector:learn`, it gets loaded into every future session's system context, enabling persistent prompt injection.

**Why it matters:** An attacker can manipulate agent behavior across all future sessions by storing a single malicious learning.

## Findings

- **Security Sentinel (H3):** Stored learnings injected into systemMessage without sanitization
- **Comment Analyzer:** Noted no HTML stripping implementation despite command docs mentioning it
- **Security Sentinel (C3):** learn/search commands reference "Strip HTML tags" but provide no implementation

## Proposed Solutions

### Option A: Wrap learnings in code fence + sanitize content (Recommended)
- Wrap loaded learnings in triple backtick code fence to prevent instruction parsing
- Strip HTML tags from content before storage
- Reject known prompt injection patterns ("IGNORE PREVIOUS", "SYSTEM:")
- Limit learning content to 10 lines
- **Pros:** Defense-in-depth, prevents both injection and XSS
- **Cons:** May slightly reduce learning utility if legitimate content is stripped
- **Effort:** Small (1-2 hours)
- **Risk:** Low

### Option B: Content-security policy for learnings
- Define blocklist of dangerous patterns
- Validate at storage time AND retrieval time
- **Pros:** Thorough protection
- **Cons:** Maintenance burden on blocklist
- **Effort:** Medium (3-4 hours)
- **Risk:** Low

## Technical Details

- **Affected files:**
  - `plugins/yellow-ruvector/hooks/scripts/session-start.sh` (lines 99-130, learning injection)
  - `plugins/yellow-ruvector/commands/ruvector/learn.md` (input validation)
  - `plugins/yellow-ruvector/agents/ruvector/memory-manager.md` (storage step)

## Acceptance Criteria

- [ ] Stored learnings wrapped in code fence when loaded into systemMessage
- [ ] HTML tags stripped from learning content before storage
- [ ] Known prompt injection patterns rejected at storage time
- [ ] Learning content limited to reasonable length (10 lines, 2000 chars)
- [ ] Existing learnings in DB don't cause issues (defensive retrieval)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Security H3, C3; comment-analyzer observation |

## Resources

- PR: #10
- Agent workflow security patterns: `docs/solutions/security-issues/agent-workflow-security-patterns.md`
