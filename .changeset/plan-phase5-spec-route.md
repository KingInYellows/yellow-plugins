---
"yellow-core": minor
---

feat(yellow-core): offer /workflows:spec from /workflows:plan Phase 5 when the drafted plan reads as spec-tier

Phase 4 already aborts before writing when work is clearly multi-subsystem,
but a plan can only reveal its spec-tier scope after drafting. The Phase 5
post-generation menu now surfaces a "run /workflows:spec instead" route first
when the generated plan needs a dependency graph and requirement-coverage
across several independent units that won't fit one /workflows:work session.
The drafted plan stays in plans/ as a reference draft; step 3 routes the
choice through the Skill tool (skill: "workflows:spec").
