---
status: complete
priority: p3
issue_id: '037'
tags: [code-review, quality, maintainability]
dependencies: []
---

# Safety Rule Duplication Across Files

## Problem Statement

Safety rules (don't click delete, stay within baseURL, skip destructive forms)
are repeated in 3+ places. Changes need to be synchronized. This violates DRY
principle and creates maintenance burden - updating safety rules requires
editing multiple files consistently.

## Findings

- Files: agents/test-runner.md, skills/agent-browser-patterns/SKILL.md,
  skills/test-conventions/SKILL.md
- Safety rules duplicated across agent and skill files
- Rules include:
  - Don't click delete/remove buttons
  - Stay within baseURL domain
  - Skip destructive form submissions
  - Handle authentication state carefully
- Adding a new safety rule requires updating 3+ files
- Risk of rules diverging if one file is updated and others are missed

## Proposed Solutions

### Option A: Define Safety Rules in One Canonical Skill (Recommended)

- Choose test-conventions/SKILL.md as canonical source
- Other files reference the skill: "See test-conventions skill for safety rules"
- Agent descriptions say "Follow safety rules from test-conventions skill"
- Single source of truth for all safety rules
- Easier to update and maintain

### Option B: Accept Duplication as Defense-in-Depth

- Treat duplication as intentional redundancy
- Agents see safety rules directly without needing to reference other files
- Lower chance of rules being missed if file is read in isolation
- Accept maintenance burden as tradeoff for clarity
- Add comment explaining intentional duplication

## Recommended Action

Implement Option A. Consolidate safety rules in test-conventions/SKILL.md.
Update test-runner.md and agent-browser-patterns/SKILL.md to reference the
canonical source. Add a "Safety Rules" section to test-conventions skill with
all rules enumerated.

## Technical Details

```markdown
# In test-conventions/SKILL.md - add section:

## Safety Rules

All browser testing must follow these safety rules:

1. Never click buttons labeled "delete", "remove", "destroy"
2. Stay within baseURL domain - reject navigation to external sites
3. Skip form submissions that modify production data
4. Handle auth state carefully - never expose credentials in logs ...

# In test-runner.md - replace inline rules with:

Follow all safety rules defined in the test-conventions skill.

# In agent-browser-patterns/SKILL.md - replace inline rules with:

See test-conventions skill for comprehensive safety rules.
```

## Acceptance Criteria

- [ ] Create "Safety Rules" section in test-conventions/SKILL.md
- [ ] Enumerate all safety rules in canonical location
- [ ] Update test-runner.md to reference test-conventions skill
- [ ] Update agent-browser-patterns/SKILL.md to reference test-conventions skill
- [ ] Remove inline duplicated safety rules from agent/skill files
- [ ] Verify all rules are covered in canonical source

## Work Log

| Date       | Action                          | Learnings                                                     |
| ---------- | ------------------------------- | ------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | P3 quality finding - DRY violation creates maintenance burden |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- Related files: agents/test-runner.md, skills/agent-browser-patterns/SKILL.md,
  skills/test-conventions/SKILL.md
