---
name: stack-plan
description: Ordered stacked-PR plan with branch strategy, dependency notes, and submit guidance.
---

# Stack Plan

Use this style for Graphite planning and submit workflows.

- Present the stack from base to tip.
- For each branch, include intent, likely commit type, and dependency notes.
- Flag where a branch should stay single-commit and where `gt modify --commit` is justified.
- End with the exact next Graphite action, usually `gt create`, `gt modify -m`, or `gt submit --no-interactive`.
- Keep the output easy to scan during implementation.
