---
status: complete
priority: p2
issue_id: "033"
tags: [code-review, security, agent-safety]
dependencies: []
---

# human-in-the-loop gap in test command

## Problem Statement
The browser-test test command can spawn test-runner which runs arbitrary browser automation without user confirmation. The setup command has AskUserQuestion gates before agent spawning, but the test command doesn't. This creates an inconsistency in human-in-the-loop safety controls.

## Findings
- **File affected**: `commands/browser-test/test.md`
- **Current behavior**: test command spawns test-runner agent without confirmation
- **Comparison**: setup command uses AskUserQuestion before spawning agents
- **Risk**: Test-runner navigates to URLs, executes JavaScript, potentially sensitive actions
- **Impact**: User may not be aware of what routes/tests will be executed

## Proposed Solutions

### Option A: Add AskUserQuestion before spawning test-runner showing discovered routes (Recommended)
Show user what will be tested before execution:
```markdown
Before spawning test-runner agent:
1. Load route list from `.claude/browser-test-routes.json`
2. Show user: "About to test N routes: /route1, /route2, ..."
3. Ask: "Proceed with browser testing? (y/n)"
4. If user confirms: spawn test-runner
5. If user declines: exit with message "Testing cancelled by user"
```
Provides transparency and user control over automated actions.

### Option B: Add confirmation for exploratory mode only (structured mode uses pre-approved routes)
Differentiate between modes:
- **Structured mode**: Routes come from setup/config, already approved → no confirmation
- **Exploratory mode**: Agent discovers and tests routes → requires confirmation
- Reduces confirmation fatigue for routine tests

## Recommended Action
Implement Option B with a twist: first-time confirmation pattern.

```markdown
Confirmation Logic:
1. If routes file exists (from setup): skip confirmation (routes already approved)
2. If exploratory mode OR routes file missing: show confirmation with route list
3. Store confirmation in `.claude/browser-test-approved.flag`
4. On subsequent runs: skip confirmation if flag exists and routes unchanged
5. User can force re-confirmation by deleting flag

Confirmation Message:
```
About to run browser tests on http://localhost:3000:
- Discovered routes: /route1, /route2, /route3 (N total)
- Test type: [structured|exploratory]
- This will navigate browser and execute page interactions

Proceed? (y/n)
```
```

Balances security with usability - confirmation when needed, not on every run.

## Technical Details
- **Location to modify**: `commands/browser-test/test.md` (before test-runner spawn)
- **Approval flag**: `.claude/browser-test-approved.flag`
- **Route list source**: `.claude/browser-test-routes.json`
- **User prompt tool**: AskUserQuestion
- **Invalidation**: Remove flag when routes file changes (use hash comparison)

## Acceptance Criteria
- [ ] Confirmation added before test-runner agent spawn
- [ ] Confirmation shows list of routes to be tested
- [ ] Approval flag stored to prevent redundant confirmations
- [ ] Flag invalidated when routes change
- [ ] Exploratory mode always shows confirmation
- [ ] Structured mode with existing routes skips confirmation
- [ ] User can decline and abort testing
- [ ] Manual test: verify confirmation shown on first run
- [ ] Manual test: verify confirmation skipped on subsequent runs with same routes
- [ ] Manual test: verify confirmation re-shown if routes change

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Human-in-the-loop controls should be consistent across commands; balance security with usability using first-time confirmation |

## Resources
- PR: #11 (yellow-browser-test code review)
- Related: Agent workflow security patterns from PR #9 (human-in-the-loop requirement)
- Pattern: First-time confirmation with approval flag for repeated operations
