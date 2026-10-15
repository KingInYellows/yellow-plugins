---
"yellow-core": minor
---

Add `lib/jev-category-eval.py`, a manual offline evaluation of TypeSafe Jev on
the `docs/solutions/` category pick. `run` sends tracked docs' frontmatter
(never bodies) with frozen, committed criteria and writes results outside the
repository; `report` prints agreement per split and a pre-registered paired
non-inferiority verdict, and writes `disagreements.tsv` for judging. No hook,
agent or staging behaviour changes.
