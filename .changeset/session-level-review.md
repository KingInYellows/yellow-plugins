---
"yellow-core": minor
"yellow-review": patch
---

Transform `/workflows:review` from a thin redirect to `/review:pr` into a
session-level review command. Evaluates plan adherence, cross-PR coherence, and
scope drift against the original plan file. Autonomously fixes P1 issues via
Edit tool with a max 2-cycle review-fix loop. Falls back to `/review:pr`
redirect for PR number/URL/branch arguments (backwards compatible).
