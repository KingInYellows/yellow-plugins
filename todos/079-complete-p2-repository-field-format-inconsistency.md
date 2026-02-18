---
status: pending
priority: p2
issue_id: "079"
tags: [code-review, consistency, plugin-structure]
dependencies: []
---

# 🟡 P2: Repository field format inconsistency in plugin.json

## Problem Statement
The `repository` field in `plugin.json` files uses inconsistent formats across the marketplace. Two plugins (gt-workflow and yellow-core) use simple string format, while seven others use the object format with `{"type": "git", "url": "..."}`. Additionally, gt-workflow is missing the `homepage` field.

## Findings
**String format (inconsistent):**
- `plugins/gt-workflow/.claude-plugin/plugin.json`
- `plugins/yellow-core/.claude-plugin/plugin.json`

**Object format (standard):**
- yellow-chatprd
- yellow-debt
- yellow-devin
- yellow-linear
- yellow-review
- yellow-ruvector
- yellow-work

**Missing homepage:**
- `plugins/gt-workflow/.claude-plugin/plugin.json`

## Proposed Solutions
### Solution 1: Standardize all to object format, add missing homepage (Recommended)
Convert gt-workflow and yellow-core to use `{"type": "git", "url": "..."}` format and add homepage field to gt-workflow.

**Pros:**
- Consistent with majority of plugins
- More structured and extensible
- Aligns with npm package.json conventions
- Makes type explicit

**Cons:**
- Requires updating 2 files

**Effort:** 30 minutes
**Risk:** Low

### Solution 2: Standardize all to string format
Convert 7 plugins to simple string format.

**Pros:**
- Simpler format

**Cons:**
- Less structured
- Loses explicit type information
- Requires updating 7 files vs 2

**Effort:** 1 hour
**Risk:** Low

## Recommended Action
Adopt Solution 1: standardize to object format and add homepage to gt-workflow.

## Technical Details
Files to modify:
1. `plugins/gt-workflow/.claude-plugin/plugin.json` - convert repository to object, add homepage
2. `plugins/yellow-core/.claude-plugin/plugin.json` - convert repository to object

Example transformation:
```json
// Before
"repository": "https://github.com/user/repo"

// After
"repository": {
  "type": "git",
  "url": "https://github.com/user/repo"
},
"homepage": "https://github.com/user/repo"
```

## Acceptance Criteria
- [ ] All 9 plugins use object format for repository field
- [ ] All 9 plugins have homepage field
- [ ] `pnpm validate:plugins` passes
- [ ] Format matches npm package.json conventions

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- npm package.json documentation for repository field format
