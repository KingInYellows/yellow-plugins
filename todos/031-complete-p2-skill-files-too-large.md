---
status: complete
priority: p2
issue_id: "031"
tags: [code-review, quality, conventions]
dependencies: []
---

# skill files too large

## Problem Statement
Two skill files exceed the 120-line project convention: `agent-browser-patterns/SKILL.md` (145 lines) and `test-conventions/SKILL.md` (217 lines). The test-conventions skill is nearly 2x the limit. Much content duplicates LLM training data (JSON schema definitions, standard HTTP status codes, etc.) rather than project-specific conventions.

## Findings
- **Files affected**:
  - `skills/agent-browser-patterns/SKILL.md`: 145 lines (21% over limit)
  - `skills/test-conventions/SKILL.md`: 217 lines (81% over limit)
- **Convention**: Agent/skill files should be under 120 lines (avoid duplicating LLM training data)
- **Violations identified**:
  - JSON schema boilerplate (LLMs already know JSON structure)
  - Standard HTTP status code definitions (200, 404, 500)
  - Generic test result format definitions
  - Verbose examples that could be condensed

## Proposed Solutions

### Option A: Split into focused sub-skills (Recommended for test-conventions)
Break test-conventions into smaller, focused skills:
- `test-conventions-core`: Routes, naming, structure (core project conventions)
- `test-conventions-auth`: Authentication and credential handling
- `test-conventions-results`: Result formats and reporting
Each skill stays under 120 lines, focuses on project-specific patterns only.

### Option B: Remove training-data duplicates, keep only project-specific (Recommended for agent-browser-patterns)
Aggressively trim non-project-specific content:
- Remove standard JSON schema examples (LLMs know JSON)
- Remove standard HTTP status codes (LLMs know 200, 404, 500)
- Condense verbose examples to essential patterns
- Keep only yellow-browser-test-specific conventions
Target: Bring both files under 120 lines through elimination.

## Recommended Action
Use both approaches:

**For test-conventions (217 lines):**
Split into three focused skills:
1. `test-conventions-core.md` (~60 lines): Route discovery, naming, test structure
2. `test-conventions-auth.md` (~40 lines): Authentication flows, credential handling
3. `test-conventions-results.md` (~40 lines): Result formats, reporting patterns

**For agent-browser-patterns (145 lines):**
Trim to under 120 lines by removing:
- Generic JSON examples (LLMs know JSON)
- Standard selector syntax docs (LLMs know CSS selectors)
- Verbose "how to use execute command" explanations
- Keep only project-specific safety rules and integration patterns

## Technical Details
- **Target**: All skill files under 120 lines
- **Method**: Remove training data duplication, split large skills
- **Validation**: Run line count after changes: `wc -l skills/*/SKILL.md`
- **Update references**: Skills that reference test-conventions need updates for new split

## Acceptance Criteria
- [ ] test-conventions split into 3 focused sub-skills, each under 120 lines
- [ ] agent-browser-patterns trimmed to under 120 lines
- [ ] All skill files pass line count check: `wc -l skills/*/SKILL.md | grep -v ' total$' | awk '$1 > 120'` returns empty
- [ ] Agent references updated for new skill split
- [ ] plugin.json updated with new skill entries
- [ ] Content removed is verified to be LLM training data, not project-specific
- [ ] Manual review: verify no critical project conventions lost

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | 120-line limit prevents duplication of LLM training data; large files should be split by concern area |

## Resources
- PR: #11 (yellow-browser-test code review)
- Convention source: Project memory, skill authoring guide
- Related: PR #8 patterns for focused, minimal skill documentation
