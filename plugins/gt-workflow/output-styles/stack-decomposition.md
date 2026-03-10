---
name: stack-decomposition
description: Structured format contract for ## Stack Decomposition sections in plan documents.
---

# Stack Decomposition Format

Machine-readable contract between `gt-stack-plan` (producer) and
`workflows:work` (consumer). Both commands must agree on this format.

## Section Structure

The `## Stack Decomposition` section is appended to a plan document by
`gt-stack-plan`. It uses structured markdown with numbered `###` subsections
per stack item.

```markdown
## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. feat/branch-slug-one
- **Type:** feat
- **Description:** Short description of what this PR does
- **Scope:** path/to/file1.ts, path/to/file2.ts
- **Tasks:** 1.1, 1.2, 1.3
- **Depends on:** (none)
- **Linear:** ENG-123

### 2. feat/branch-slug-two
- **Type:** fix
- **Description:** Short description of what this PR does
- **Scope:** path/to/file3.ts
- **Tasks:** 2.1, 2.2
- **Depends on:** #1
- **Linear:** ENG-124
```

## Fields

Each stack item heading uses the format `### N. type/branch-name` where N is
the stack position (1-indexed) and `type/branch-name` is the Graphite branch
name.

| Field | Required | Format | Description |
|-------|----------|--------|-------------|
| **Type** | Yes | Conventional commit prefix | `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, etc. |
| **Description** | Yes | Single line | One-line summary used as PR title |
| **Scope** | Yes | Comma-separated paths | Files or directories this item touches |
| **Tasks** | Yes | Comma-separated IDs | Plan task IDs from `## Implementation Plan` (e.g., `1.1, 1.2`) |
| **Depends on** | Yes | `(none)` or `#N` refs | Prerequisite items by number |
| **Linear** | No | Issue ID | Linear issue identifier (e.g., `ENG-123`) |

## HTML Comment Metadata

Placed immediately after the `## Stack Decomposition` heading, before the
first item.

| Comment | Required | Values | Description |
|---------|----------|--------|-------------|
| `stack-topology` | Yes | `linear`, `parallel`, `mixed` | How items relate to each other |
| `stack-trunk` | Yes | Branch name | Base branch for the stack (usually `main`) |

## Topologies

### Linear

Each item depends on the previous. `workflows:work` creates each branch on
top of the last with `gt create`.

```markdown
<!-- stack-topology: linear -->
### 1. feat/auth-types       → Depends on: (none)
### 2. feat/auth-middleware   → Depends on: #1
### 3. feat/auth-routes       → Depends on: #2
```

### Parallel

Items are independent, all branching off trunk. `workflows:work` checks out
trunk before creating each branch.

```markdown
<!-- stack-topology: parallel -->
### 1. docs/update-readme     → Depends on: (none)
### 2. fix/lint-warnings      → Depends on: (none)
### 3. test/add-coverage      → Depends on: (none)
```

### Mixed

Some items are stacked, others are parallel. The `Depends on` field determines
the dependency graph. v1 supports linear and parallel only; mixed topology is
a future consideration.

```markdown
<!-- stack-topology: mixed -->
### 1. feat/core-types        → Depends on: (none)
### 2. feat/core-logic        → Depends on: #1
### 3. feat/api-routes        → Depends on: #2
### 4. docs/migration-guide   → Depends on: (none)
```

## Standalone Invocation

When `gt-stack-plan` is invoked without a plan file path, it writes the full
`## Stack Decomposition` section to `.gt-stack-plan.md` in the repo root.
This file uses the identical format and can be consumed by `workflows:work`.

## Idempotency

If `## Stack Decomposition` already exists in the target plan file,
`gt-stack-plan` replaces it entirely (does not append a duplicate). The
replacement preserves all content before and after the section.

## Progress Tracking

When `workflows:work` executes a stack, it writes a `## Stack Progress`
section after `## Stack Decomposition`:

```markdown
## Stack Progress
<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. feat/branch-slug-one (completed 2026-03-10)
- [ ] 2. feat/branch-slug-two
- [ ] 3. fix/branch-slug-three
```

On resume, `workflows:work` reads this section and skips completed items,
cross-referencing with `gt log short` to verify branches exist.
