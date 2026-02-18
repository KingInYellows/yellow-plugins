---
status: complete
priority: p2
issue_id: '081'
tags: [code-review, security, human-in-the-loop]
dependencies: []
---

# 🟡 P2: Missing AskUserQuestion before gt submit in smart-submit

## Problem Statement

The `gt-workflow/commands/smart-submit.md` command auto-proceeds to `gt submit`
when the audit is clean or contains only minor issues, violating the project's
human-in-the-loop security requirement that "commands that push LLM-generated
code must AskUserQuestion before gt submit."

## Findings

Location: `plugins/gt-workflow/commands/smart-submit.md` around line 180

The command currently:

1. Runs audit checks
2. If clean or minor issues only, proceeds directly to `gt submit`
3. No user confirmation step before pushing code

This violates Agent Workflow Security Patterns from project memory, which
explicitly requires human approval before any git submission of LLM-generated
changes.

## Proposed Solutions

### Solution 1: Add AskUserQuestion before all submissions (Recommended)

Add a confirmation step before `gt submit` regardless of audit status.

**Pros:**

- Complies with security policy
- User maintains control over submissions
- Prevents accidental pushes
- Allows final review

**Cons:**

- Adds one extra step to workflow
- Less "automatic" in the happy path

**Effort:** 30 minutes **Risk:** Low

### Solution 2: Only require confirmation for non-clean audits

Keep auto-submit for clean audits, add confirmation for minor issues.

**Pros:**

- Smoother workflow for clean code

**Cons:**

- Violates security policy
- Still allows unreviewed auto-push
- Inconsistent with project standards

**Effort:** 30 minutes **Risk:** High (policy violation)

## Recommended Action

Adopt Solution 1: always require user confirmation before `gt submit`.

## Technical Details

File: `plugins/gt-workflow/commands/smart-submit.md:~180`

Add before the `gt submit` command:

```markdown
4. Use AskUserQuestion to confirm submission:
   - Show audit summary
   - Ask: "Ready to submit this stack? (yes/no)"
   - Only proceed if user confirms "yes"
```

This ensures compliance with: "commands that push LLM-generated code must
AskUserQuestion before gt submit"

## Acceptance Criteria

- [ ] User is always asked to confirm before submission
- [ ] Confirmation shows audit summary
- [ ] "no" response cancels submission
- [ ] "yes" response proceeds to `gt submit`
- [ ] Pattern matches other commands with human-in-the-loop

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- Project memory: "Agent Workflow Security Patterns"
- `docs/solutions/security-issues/agent-workflow-security-patterns.md`
