---
"yellow-core": patch
"yellow-morph": patch
"gt-workflow": patch
---

Apply mechanical audit followups (2026-05-07 audit):

- **C-02 (yellow-core):** update three legacy 2-segment `subagent_type:`
  references in `commands/workflows/plan.md` lines 90/98/132 to the
  3-segment runtime form (`yellow-core:research:repo-research-analyst`,
  `yellow-core:research:best-practices-researcher`,
  `yellow-core:workflow:spec-flow-analyzer`). Clears three INFO warnings
  from `pnpm validate:agents`.
- **M-02 (yellow-morph):** mark `hooks/scripts/prewarm-morph.sh` as
  executable. The hook already worked because `bash script.sh` was the
  invocation form, but the missing `+x` bit raised a WARNING in
  `pnpm validate:schemas`.
- **C-01 (gt-workflow):** document the un-namespaced command convention
  exception in `CLAUDE.md`. The seven gt-workflow commands ship without
  the `namespace:verb` prefix intentionally — they predate the
  namespacing convention. No behavior change; documentation only.

Companion to PR #436 (X-02 validator fix) and the broader audit followups
plan at `plans/audit-followups-2026-05-07.md`.
