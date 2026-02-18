---
status: complete
priority: p2
issue_id: '034'
tags: [code-review, reliability, prerequisites]
dependencies: []
---

# gh CLI availability not checked

## Problem Statement

The test-reporter agent uses `gh issue create` to file GitHub issues for test
failures but doesn't check if gh CLI is installed and authenticated first. This
would fail with confusing error messages instead of clear "gh CLI not available"
guidance.

## Findings

- **File affected**: `agents/testing/test-reporter.md`
- **Current behavior**: Assumes gh CLI is installed and authenticated
- **Failure modes**:
  - gh not installed → "command not found" error
  - gh not authenticated → "authentication required" error
  - Neither provides clear guidance on how to fix
- **Impact**: Poor user experience, unclear error messages

## Proposed Solutions

### Option A: Add `command -v gh` check before attempting issue creation (Recommended)

Check availability and provide clear guidance:

```markdown
Before creating GitHub issues:

1. Check if gh CLI is installed: `command -v gh >/dev/null 2>&1`
2. If not found:
   - Log:
     `[test-reporter] GitHub CLI (gh) not found. Install from https://cli.github.com/`
   - Skip issue creation, write failures to local file instead
3. Check authentication: `gh auth status >/dev/null 2>&1`
4. If not authenticated:
   - Log: `[test-reporter] GitHub CLI not authenticated. Run: gh auth login`
   - Skip issue creation, write failures to local file
5. If both checks pass: proceed with issue creation
```

Follows project conventions for tool availability checking.

### Option B: Fall back to manual instructions if gh unavailable

Provide manual issue creation instructions:

```markdown
If gh CLI unavailable:

1. Write issue details to `.claude/browser-test-issues.md`
2. Format as GitHub issue templates
3. Log: "GitHub CLI unavailable. Issue templates written to
   .claude/browser-test-issues.md"
4. User can manually copy/paste to create issues
```

More work for user but ensures failures are still documented.

## Recommended Action

Implement both options - Option A as primary check, Option B as fallback.

Combined workflow:

```markdown
Issue Reporting Workflow:

1. Check gh CLI availability: `command -v gh >/dev/null 2>&1`
2. Check gh authentication: `gh auth status >/dev/null 2>&1`
3. If both pass: create issues directly with `gh issue create`
4. If either fails: a. Log clear error with installation/auth instructions b.
   Write issue templates to `.claude/browser-test-issues.md` c. Provide manual
   creation instructions d. Continue with rest of reporting (don't abort)

Error Messages:

- Missing gh:
  `[test-reporter] gh CLI not found. Install: https://cli.github.com/ OR use manual templates in .claude/browser-test-issues.md`
- Not authenticated:
  `[test-reporter] gh CLI not authenticated. Run 'gh auth login' OR use manual templates in .claude/browser-test-issues.md`
```

## Technical Details

- **Location to modify**: `agents/testing/test-reporter.md` (issue creation
  section)
- **Availability check**: `command -v gh >/dev/null 2>&1` (POSIX-compliant)
- **Auth check**: `gh auth status >/dev/null 2>&1` (exit code 0 if
  authenticated)
- **Fallback file**: `.claude/browser-test-issues.md` (Markdown format)
- **Component prefix**: `[test-reporter]` for all log messages

## Acceptance Criteria

- [ ] gh CLI availability check added before issue creation
- [ ] Authentication check added after availability check
- [ ] Clear error messages with installation/auth instructions
- [ ] Fallback to manual issue templates if gh unavailable
- [ ] Manual templates written to `.claude/browser-test-issues.md`
- [ ] Error logging uses `[test-reporter]` component prefix
- [ ] Reporter continues with other tasks even if gh unavailable
- [ ] Manual test: uninstall gh, verify clear error and fallback
- [ ] Manual test: unauthenticate gh, verify auth error and fallback

## Work Log

| Date       | Action                          | Learnings                                                                                                        |
| ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | External tool usage requires availability and authentication checks with clear error messages and fallback paths |

## Resources

- PR: #11 (yellow-browser-test code review)
- Related: Shell documentation patterns from PR #7 (tool availability checks)
- Convention: `command -v` check before using external tools
- Pattern: Provide both automated and manual fallback paths
