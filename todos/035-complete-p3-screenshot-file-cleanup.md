---
status: complete
priority: p3
issue_id: '035'
tags: [code-review, maintenance]
dependencies: []
---

# Screenshot File Cleanup

## Problem Statement

agent-browser screenshots accumulate in test-reports/ with no cleanup mechanism.
Over time could consume significant disk space, especially for projects with
frequent test runs or long-running test suites.

## Findings

- Files: test-reports/\*.png
- Every browser interaction that takes a screenshot leaves a file in
  test-reports/
- No documented cleanup process or retention policy
- Could grow to hundreds of MB or GB over months
- User must manually delete old screenshots

## Proposed Solutions

### Option A: Add Cleanup Step at Test Run Start (Recommended)

- Add cleanup logic to browser-test/test.md and explore.md commands
- Before spawning agents, delete screenshots older than N days (e.g., 7 days)
- Use `find test-reports/ -name '*.png' -mtime +7 -delete`
- Keep recent screenshots for debugging

### Option B: Add Configurable Retention Policy

- Add `screenshotRetentionDays` field to config schema
- Document cleanup process in test-conventions/SKILL.md
- Require user to run cleanup manually or via cron
- More flexible but requires user action

## Recommended Action

Implement Option A with 7-day retention. Add cleanup step to both test and
explore commands before agent spawn. Document retention policy in
test-conventions skill.

## Technical Details

```bash
# Add to commands before agent spawn
find test-reports/ -name '*.png' -mtime +7 -delete 2>/dev/null || true
```

## Acceptance Criteria

- [ ] Cleanup logic added to browser-test/test.md
- [ ] Cleanup logic added to browser-test/explore.md
- [ ] Retention period documented in test-conventions/SKILL.md
- [ ] User can override retention via config (optional)
- [ ] Cleanup handles missing test-reports/ directory gracefully

## Work Log

| Date       | Action                          | Learnings                                                     |
| ---------- | ------------------------------- | ------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | P3 maintenance finding - prevents disk space growth over time |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- Related files: commands/browser-test/test.md, explore.md
