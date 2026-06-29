---
"yellow-core": minor
---

feat(yellow-core): add /workflows:spec and /workflows:decompose commands

Borrow Turbo's spec→shells decomposition front-end into yellow-core's planning
pipeline. `/workflows:spec` drafts a requirements spec (stable R1..Rn IDs +
design) to `plans/specs/<slug>.md` through guided dialogue; `/workflows:decompose`
breaks a spec into dependency-ordered shell files in `plans/shells/` with a
blocking R-id coverage gate and `depends_on` traceability. Single-shell specs
bail out to `/workflows:plan`. Pairs with the forthcoming
`/workflows:expand-shell` and `/workflows:pick-next-shell` commands.
