---
status: complete
priority: p3
issue_id: "098"
tags: [code-review, cleanup, public-release]
dependencies: []
---

# Stale .codemachine/ Ignore Rules

## Problem Statement

The `.codemachine/` directory was deleted in this PR (Phase 1), but 3 config
files still contain ignore rules referencing it. These are harmless no-ops but
create confusion about what `.codemachine/` was.

## Findings

1. `.gitignore:84-88` — 5 lines ignoring `.codemachine/` subdirectories
2. `.eslintrc.cjs:164` — ignoring `.codemachine` in ESLint
3. `.eslintignore` and `.prettierignore` — likely also have entries

## Proposed Solutions

### Option A: Remove stale entries (Minimal effort)

Delete the `.codemachine/` references from all ignore files.

- **Effort:** Minimal
- **Risk:** None

### Option B: Leave as-is

Ignore rules for non-existent paths are harmless.

- **Effort:** None
- **Risk:** None

## Acceptance Criteria

- [ ] No references to `.codemachine/` in config files
- [ ] Or: explicit decision to defer

## Work Log

| Date       | Action          | Notes                              |
| ---------- | --------------- | ---------------------------------- |
| 2026-02-18 | Finding created | PR #24 review — stale ignore rules |

## Resources

- PR: #24
