---
status: complete
priority: p2
issue_id: '022'
tags: [code-review, security, agent-safety]
dependencies: []
---

# baseURL enforcement not enforced

## Problem Statement

The yellow-browser-test plugin's safety rule states "never navigate outside
baseURL" but this is only a prose instruction to the LLM, not enforced
programmatically. An agent could navigate to external URLs if a web page
contains external links, potentially exposing the system to untrusted content or
data exfiltration.

## Findings

- **Files affected**: `agents/testing/test-runner.md`,
  `skills/agent-browser-patterns/SKILL.md`
- **Current behavior**: Safety rule exists as LLM instruction only
- **Risk**: Agent could follow external links if confused or if malicious
  content tricks it
- **Impact**: Medium - depends on LLM reliability for security boundary
  enforcement

## Proposed Solutions

### Option A: Add URL validation check after each navigation (Recommended)

Add explicit verification step in test-runner agent:

- After each navigation command, verify current URL starts with baseURL
- If violation detected, abort test and log security event
- Provides defense-in-depth against LLM instruction failures

### Option B: Document as known limitation with mitigation guidance

- Add warning to README and skill documentation
- Provide mitigation: set restrictive browser permissions, run in isolated
  environment
- Simpler but relies on operational controls rather than technical enforcement

## Recommended Action

Implement Option A. Add URL validation as a safety check after navigation
commands in test-runner agent. The check should be simple and explicit:

```markdown
After each navigation:

1. Run `agent-browser execute "window.location.href"` to get current URL
2. Verify URL starts with expected baseURL
3. If mismatch: abort test, log security violation, exit with error code
```

This provides a programmatic safety boundary rather than relying solely on LLM
instruction following.

## Technical Details

- **Location to modify**: `agents/testing/test-runner.md` (navigation workflow)
- **Implementation**: Add verification step in agent instructions
- **Error handling**: Should be hard failure, not soft warning
- **Logging**: Include both expected baseURL and actual URL in error message

## Acceptance Criteria

- [ ] URL validation check added after navigation commands in test-runner
- [ ] Validation aborts test execution on baseURL violation
- [ ] Error message includes expected vs actual URL
- [ ] Documentation updated to describe security boundary enforcement
- [ ] Manual test: verify agent aborts if web page redirects to external domain

## Work Log

| Date       | Action                          | Learnings                                                                              |
| ---------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | Security boundaries should be enforced programmatically, not just via LLM instructions |

## Resources

- PR: #11 (yellow-browser-test code review)
- Related: Agent workflow security patterns from PR #9
- Pattern: Defense-in-depth for agent safety boundaries
