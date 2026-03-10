---
"yellow-core": minor
---

Add stack-aware bottom-up execution to workflows:work. When a plan contains a `## Stack Decomposition` section, workflows:work creates branches just-in-time and executes each stack item sequentially with checkpoints and progress tracking.
