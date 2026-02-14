---
status: pending
priority: p3
issue_id: "040"
tags: [code-review, quality, maintainability]
dependencies: []
---

# Test/Explore Command Content Overlap

## Problem Statement
~70% content overlap between browser-test/test.md and browser-test/explore.md commands. Both manage dev server lifecycle, spawn agents, handle cleanup. DRY violation creates maintenance burden - bug fixes and improvements must be applied to both files.

## Findings
- Files: commands/browser-test/test.md, commands/browser-test/explore.md
- Shared logic:
  - Config loading from `.claude/yellow-browser-test.local.md`
  - Dev server startup and readiness polling
  - agent-browser installation check
  - Agent spawn with similar parameters
  - Cleanup on exit (stop dev server)
  - Error handling patterns
- Differences:
  - test.md spawns test-runner agent with test file paths
  - explore.md spawns interactive-tester agent with goals
  - Test command validates test file paths exist
- Updating dev server logic requires editing both files
- Risk of behavior divergence if one file is updated and other is missed

## Proposed Solutions
### Option A: Extract Shared Logic to a Skill (Recommended)
- Create new skill: `browser-test-runner` or similar
- Skill contains:
  - Dev server lifecycle management
  - Config loading and validation
  - agent-browser installation check
  - Cleanup procedures
- Commands become thin wrappers that call the skill with different agent types
- Single source of truth for shared logic
- Easier to maintain and test

### Option B: Accept Duplication for Clarity
- Treat commands as independent entry points
- Each command is self-contained and readable in isolation
- User can understand full command flow without referencing other files
- Accept maintenance burden as tradeoff for clarity
- Add comment explaining intentional duplication
- Ensure both commands have comprehensive tests

## Recommended Action
Implement Option A. Create a `browser-test-lifecycle` skill that handles dev server management, config loading, and cleanup. Commands call the skill with agent-specific parameters. This reduces duplication from 70% to <20% and makes bug fixes easier to apply consistently.

## Technical Details
```markdown
# New skill: skills/browser-test-lifecycle/SKILL.md
## Use when
User needs to run browser tests or interactive testing. Handles dev server lifecycle, config loading, agent spawn, and cleanup.

## Parameters
- agent_type: test-runner or interactive-tester
- agent_params: JSON with agent-specific parameters
- cleanup_on_exit: boolean

## Steps
1. Load config from .claude/yellow-browser-test.local.md
2. Check agent-browser is installed
3. Start dev server if configured
4. Poll for dev server readiness
5. Spawn specified agent with params
6. On exit: stop dev server if we started it

# Updated commands reference the skill:
# test.md:
Use browser-test-lifecycle skill with:
- agent_type: test-runner
- agent_params: {testFiles: [...], config: {...}}

# explore.md:
Use browser-test-lifecycle skill with:
- agent_type: interactive-tester
- agent_params: {goals: [...], config: {...}}
```

## Acceptance Criteria
- [ ] Create browser-test-lifecycle skill
- [ ] Extract shared dev server logic to skill
- [ ] Extract shared config loading to skill
- [ ] Extract shared cleanup logic to skill
- [ ] Update test.md to use skill
- [ ] Update explore.md to use skill
- [ ] Verify both commands still work correctly
- [ ] Update plugin.json to include new skill

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | P3 quality finding - 70% duplication violates DRY principle |

## Resources
- PR: #11 (yellow-browser-test plugin code review)
- Related files: commands/browser-test/test.md, commands/browser-test/explore.md
