---
"gt-workflow": minor
---

Repurpose gt-stack-plan as plan-only decomposition tool. Removes branch creation phase (Phase 3) and writes structured `## Stack Decomposition` section to plan files instead. Branches are created just-in-time during `workflows:work` execution.
