---
status: complete
priority: p2
issue_id: "076"
tags: [code-review, yellow-ci, consistency]
dependencies: []
---

# Hooks JSON Timeout Unit Inconsistency

## Problem Statement

The yellow-ci plugin uses `"timeout": 3000` (implying milliseconds) while yellow-ruvector uses `"timeout": 3` (implying seconds). This inconsistency creates confusion and potential runtime issues if the timeout unit is misinterpreted.

## Findings

**Files:**
- `plugins/yellow-ci/hooks/hooks.json`
- `plugins/yellow-ruvector/hooks/hooks.json`

**Current State:**

**yellow-ci:**
```json
{
  "hooks": [
    {
      "name": "yellow-ci-session-start",
      "event": "session:start",
      "command": "bash",
      "args": ["plugins/yellow-ci/hooks/scripts/session-start.sh"],
      "timeout": 3000
    }
  ]
}
```

**yellow-ruvector:**
```json
{
  "hooks": [
    {
      "name": "yellow-ruvector-pre-commit",
      "event": "git:pre-commit",
      "command": "bash",
      "args": ["plugins/yellow-ruvector/hooks/scripts/pre-commit.sh"],
      "timeout": 3
    }
  ]
}
```

**Impact:**
- Inconsistent timeout interpretation across plugins
- Risk of unexpectedly short or long timeouts
- Maintenance confusion for developers

## Proposed Solutions

**Step 1: Verify Specification**
- Check Claude Code documentation for hooks.json timeout units
- Determine if timeout is in seconds or milliseconds
- Reference: validate-plugin.ts or plugin schema documentation

**Step 2: Align Plugins**
- If milliseconds: yellow-ci is correct (3000 = 3s), update yellow-ruvector to 3000
- If seconds: yellow-ruvector is correct (3s), update yellow-ci to 3
- Ensure all hooks across all plugins use consistent units

**Step 3: Document Convention**
- Add comment in each hooks.json: `// timeout in milliseconds` or `// timeout in seconds`
- Add to project memory (CLAUDE.md): "hooks.json timeout uses [unit]"
- Consider adding to plugin-template.md

## Technical Details

**Files to Update:**
- `plugins/yellow-ci/hooks/hooks.json`
- `plugins/yellow-ruvector/hooks/hooks.json`
- `docs/plugin-template.md` (add timeout documentation)
- `/home/kinginyellow/.claude/projects/-home-kinginyellow-projects-yellow-plugins/memory/MEMORY.md`

**Research Needed:**
- Check Claude Code plugin validation schema
- Review other plugins in ecosystem for precedent
- Verify timeout behavior in plugin runtime

**Recommendation:**
If specification is ambiguous, prefer milliseconds for consistency with common JavaScript/TypeScript conventions and finer-grained control.

## Acceptance Criteria

- [ ] Claude Code hooks.json timeout unit specification verified
- [ ] yellow-ci and yellow-ruvector timeouts aligned to use same units
- [ ] Comment added to hooks.json files documenting unit
- [ ] Project memory (CLAUDE.md) updated with timeout convention
- [ ] Plugin template documentation includes timeout guidance
- [ ] `pnpm validate:plugins` passes for both plugins
