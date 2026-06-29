---
"yellow-core": minor
---

feat(yellow-core): bounded review→fix polish loop in /workflows:work Phase 3

Wrap the four-reviewer Quality Check suite in a re-run-until-stable loop: after
fixes are applied, if any file changed, re-run review on the changed files,
capped at 3 iterations. A first-pass fix can introduce a second-order issue —
this catches it. The existing trivial-skip gate (doc/comment/rename-only) still
short-circuits the loop. On hitting the cap with outstanding P1/P2 findings, an
AskUserQuestion gate offers Continue / Stop / Escalate to /council for
cross-lineage review (graceful degradation if yellow-council is absent).
