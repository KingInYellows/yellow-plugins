---
"yellow-core": patch
"yellow-review": patch
---

Consolidate plan directories: move 16 archived plans from `docs/plans/` to
`plans/complete/`, removing the duplicate top-level location. The workflow
tooling (`/workflows:plan`, `/workflows:work`, `/workflows:review`) all
expect plans at `plans/<name>.md` and archive completed plans to
`plans/complete/`; `docs/plans/` was a frozen pre-convention archive.

Also updates active plugin references:

- `yellow-core` `agents/review/security-lens.md` example path
- `yellow-review` `agents/review/project-standards-reviewer.md` and
  `commands/review/review-pr.md` protected-artifact path lists

Documentation-only (`docs/guides/common-workflows.md` and
`docs/guides/advanced-workflows.md`) updated outside the changeset scope.
