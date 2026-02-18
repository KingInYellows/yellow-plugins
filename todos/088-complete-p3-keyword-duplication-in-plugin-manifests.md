---
status: pending
priority: p3
issue_id: "088"
tags: [code-review, quality, plugin-structure]
dependencies: []
---

# 🔵 P3: Keyword Duplication in Plugin Manifests

## Problem Statement
7 of 9 plugins have keywords in their plugin.json manifests that duplicate words already present in the plugin's name or description. This reduces the value of keywords for search and discovery.

## Findings
Plugins with duplicate keywords:
- **gt-workflow**: "workflow" duplicates description
- **yellow-browser-test**: "testing" duplicates description
- **yellow-core**: "workflow" duplicates description
- **yellow-debt**: "technical-debt", "audit", "remediation" duplicate description
- **yellow-devin**: "multi-agent" duplicates description
- **yellow-linear**: "workflow" duplicates description
- **yellow-review**: "review", "multi-agent" duplicate name/description

Only yellow-ruvector and one other plugin avoid this issue.

## Proposed Solutions
### Solution 1: Remove Duplicate Keywords (Recommended)
Remove keywords that duplicate words from name or description, or replace with more specific alternatives that add discovery value.

Examples:
- yellow-debt: Keep "technical-debt" if not in name, remove if duplicating description, add specific tech like "code-quality", "refactoring"
- yellow-review: Remove "review", keep "multi-agent" only if not in description
- gt-workflow: Remove "workflow", add specific features like "graphite", "stacking"

### Solution 2: Add Clarifying Context
Transform duplicates into more specific keyword phrases that add value:
- "workflow" → "pr-workflow", "branch-workflow"
- "multi-agent" → "agent-orchestration"
- "testing" → "e2e-testing", "browser-automation"

## Recommended Action
Audit all plugin.json keywords field:
1. Compare each keyword against name and description words
2. Remove exact duplicates
3. Replace partial duplicates with more specific alternatives
4. Ensure keywords add discovery value

## Acceptance Criteria
- [ ] No keyword in any plugin.json duplicates words from that plugin's name or description
- [ ] All keywords provide unique discovery value
- [ ] Keywords follow consistent specificity level across plugins
- [ ] Update validated via `pnpm validate:plugins`

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- Plugin manifests: `plugins/*/plugin.json`
