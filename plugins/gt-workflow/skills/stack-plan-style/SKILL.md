---
name: stack-plan-style
description: 'Display guidance for presenting a stacked-PR plan — ordered branch tree with intent, commit type, and dependency notes. Use when gt-stack-plan presents a stack plan for user confirmation.'
user-invokable: false
---

## What It Does

Defines how `gt-stack-plan` should present a proposed stack of branches to
the user for confirmation: a base-to-tip visual tree with per-branch intent,
commit type, and dependency notes.

## When to Use

- `gt-stack-plan` Phase 2, Step 2 ("Present the Stack Plan"), before asking
  the user to confirm, adjust, or cancel.

## Usage

Use this style for Graphite planning and submit workflows.

- Present the stack from base to tip.
- For each branch, include intent, likely commit type, and dependency notes.
- Flag where a branch should stay single-commit and where `gt modify --commit` is justified.
- End with the recommended next step: `/workflows:work <path>` to execute the stack, or `gt submit --no-interactive` for standalone changes.
- Keep the output easy to scan during implementation.
- When saving decomposition to a plan file, use the structured format defined
  by the `stack-decomposition-format` skill for the `## Stack Decomposition`
  section. The visual tree format here is for confirmation display; the
  structured format is the machine-readable contract consumed by
  `workflows:work`.
