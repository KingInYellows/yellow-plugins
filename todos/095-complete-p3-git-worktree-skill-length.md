---
status: complete
priority: p3
issue_id: "095"
tags: [code-review, quality, skill-length]
dependencies: []
---

# 🔵 P3: Git Worktree Skill Length

## Problem Statement
The git-worktree SKILL.md file is 339 lines, approaching the soft limit for skill documentation. The troubleshooting section (lines 245-300, approximately 55 lines) could be extracted to reduce LLM token consumption while keeping essential reference accessible.

## Findings
**Current Length**: 339 lines total
- Essential command reference: ~150 lines
- Usage examples: ~80 lines
- Troubleshooting section: ~55 lines (lines 245-300)
- Configuration and edge cases: ~54 lines

From project memory: "Agent `.md` files: keep under 120 lines — don't duplicate LLM training data"

While 339 lines isn't excessive for a comprehensive skill, extracting troubleshooting would improve maintainability and reduce context size.

## Proposed Solutions
### Solution 1: Extract Troubleshooting to Separate File (Recommended)
Create `plugins/yellow-core/skills/git-worktree/troubleshooting.md`:
- Move lines 245-300 to new file
- Keep critical error patterns in SKILL.md
- Reference troubleshooting.md from SKILL.md: "For detailed troubleshooting, see troubleshooting.md"
- Agents can Read troubleshooting.md when needed

Reduces SKILL.md to ~285 lines, keeps troubleshooting accessible.

### Solution 2: Extract to Dedicated Troubleshooting Command
Create a new command `/worktree-troubleshoot` that loads troubleshooting context:
- More discoverable than reference file
- Adds command overhead
- May be overkill for reference content

### Solution 3: Accept Current Length
339 lines is reasonable for a comprehensive skill. Only act if frequent usage shows context token issues.

## Recommended Action
Apply Solution 1: extract troubleshooting section to `troubleshooting.md`.

This aligns with skill authoring quality rules (minimize LLM training data duplication) while keeping troubleshooting accessible via explicit Read calls.

## Acceptance Criteria
- [ ] Troubleshooting section extracted to `plugins/yellow-core/skills/git-worktree/troubleshooting.md`
- [ ] SKILL.md reduced to ~285 lines
- [ ] SKILL.md references troubleshooting.md for detailed error resolution
- [ ] Essential error patterns remain in SKILL.md
- [ ] Troubleshooting.md follows consistent markdown structure

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- File: `plugins/yellow-core/skills/git-worktree/SKILL.md` (339 lines)
- Project memory: Plugin Authoring Quality Rules (keep under 120 lines)
- Target extraction: Lines 245-300 (troubleshooting section)
