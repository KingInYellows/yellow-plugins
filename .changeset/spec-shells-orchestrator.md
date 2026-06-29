---
"yellow-core": minor
---

feat(yellow-core): add /workflows:expand-shell and /workflows:pick-next-shell

Complete the spec→shells pipeline. `/workflows:pick-next-shell` selects the
lowest-numbered shell whose `depends_on` are all archived in `plans/complete/`
(exact-slug match against an optional date prefix), expands it, captures
learnings via `/workflows:compound`, and halts for a fresh `/workflows:work`
session — reporting dependency cycles, unsatisfiable deps, and the terminal
state explicitly. `/workflows:expand-shell` turns one shell into a concrete
`- [ ]` checkbox plan in `plans/`, verifying every `Consumes` against the live
codebase and deleting the shell only after approval. Also adds a spec-tier
escalation hint to `/workflows:plan` for multi-subsystem work.
