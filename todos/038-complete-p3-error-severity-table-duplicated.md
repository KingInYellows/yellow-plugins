---
status: complete
priority: p3
issue_id: "038"
tags: [code-review, quality, maintainability]
dependencies: []
---

# Error Severity Table Duplicated

## Problem Statement
Error severity classification (critical/high/medium/low) defined in both test-conventions skill and test-reporter agent. Could diverge if one is updated without the other, leading to inconsistent error classification across the plugin.

## Findings
- Files: skills/test-conventions/SKILL.md, agents/test-reporter.md
- Severity table duplicated in two locations:
  - test-conventions skill defines 4 severity levels with criteria
  - test-reporter agent repeats the same classification
- Criteria for each level:
  - Critical: Complete test failure, crashes
  - High: Assertion failures, missing elements
  - Medium: Console errors, accessibility issues
  - Low: Warnings, performance suggestions
- If criteria change (e.g., elevate a11y issues to high), both files must be updated
- Risk of reporter classifying errors differently than documented in conventions

## Proposed Solutions
### Option A: Define in Skill Only, Agent References Skill (Recommended)
- Keep severity table only in test-conventions/SKILL.md
- test-reporter.md references the skill: "Use severity levels from test-conventions skill"
- Agent reads conventions skill if it needs the criteria
- Single source of truth
- Easier to update severity definitions

### Option B: Accept as Documentation Duplication
- Treat as intentional documentation duplication
- Agent needs to classify errors without referencing other files
- Severity table in agent is for quick reference during reporting
- Add comment that table must be kept in sync with skill
- Accept maintenance burden as tradeoff for agent autonomy

## Recommended Action
Implement Option A. Remove severity table from test-reporter.md. Add reference to test-conventions skill. Keep detailed severity criteria only in the skill. This reduces risk of divergence and makes it clear where to update severity definitions.

## Technical Details
```markdown
# In test-conventions/SKILL.md - keep section:
## Error Severity Classification
| Level | Criteria | Examples |
|-------|----------|----------|
| Critical | Complete test failure, crashes | Page won't load, agent crashes |
| High | Assertion failures, missing elements | Element not found, incorrect text |
| Medium | Console errors, a11y issues | JS errors, missing ARIA labels |
| Low | Warnings, performance | Slow page load, deprecation warnings |

# In test-reporter.md - replace table with:
Classify errors by severity using the criteria defined in the test-conventions skill:
- Critical: Complete test failure or crashes
- High: Assertion failures or missing elements
- Medium: Console errors or accessibility issues
- Low: Warnings or performance suggestions

Refer to test-conventions skill for detailed criteria and examples.
```

## Acceptance Criteria
- [ ] Keep severity table only in test-conventions/SKILL.md
- [ ] Update test-reporter.md to reference test-conventions skill
- [ ] Remove duplicated severity table from test-reporter.md
- [ ] Add brief summary of levels to test-reporter for quick reference
- [ ] Verify both files agree on severity classification approach

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | P3 quality finding - documentation duplication creates sync risk |

## Resources
- PR: #11 (yellow-browser-test plugin code review)
- Related files: skills/test-conventions/SKILL.md, agents/test-reporter.md
