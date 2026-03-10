---
name: stack-plan
description: Ordered stacked-PR plan with branch strategy, dependency notes, and submit guidance.
---

# Stack Plan

Use this style for Graphite planning and submit workflows.

- Present the stack from base to tip.
- For each branch, include intent, likely commit type, and dependency notes.
- Flag where a branch should stay single-commit and where `gt modify --commit` is justified.
- End with the recommended next step: `/workflows:work <path>` to execute the stack, or `gt submit --no-interactive` for standalone changes.
- Keep the output easy to scan during implementation.
- When saving decomposition to a plan file, use the structured format defined
  in `stack-decomposition` output style for the `## Stack Decomposition` section.
  The visual tree format here is for confirmation display; the structured format
  is the machine-readable contract consumed by `workflows:work`.
