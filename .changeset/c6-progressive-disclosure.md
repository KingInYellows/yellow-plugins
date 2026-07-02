---
'yellow-core': patch
'yellow-council': patch
'yellow-review': patch
---

Progressive-disclosure splits (Tier 2 C6): move conditional and late-sequence detail out of oversized skill and command files into `references/` files behind imperative load stubs, verbatim (except positional cross-reference words like "above"/"below" corrected for the new file locations, and the review-pr Steps 9a/9b top-level skip-gate merged into one provably-equivalent condition).

- `yellow-core/skills/optimize/SKILL.md` 461 → 297 lines (judge protocol, pagination layouts, failure modes, design rationale → `references/`)
- `yellow-core/skills/compound-lifecycle/SKILL.md` 414 → 291 lines (staleness/clustering formulas + config keys, report template, archive rationale → `references/`)
- `yellow-council/skills/council-patterns/SKILL.md`: only the non-executed Cross-References provenance bullets move (grep-confirmed unconsumed); every runtime-load-bearing preloaded section stays inline
- New command-file pattern (no prior precedent): `/review:pr` legacy fallback + Steps 9a/9b, `/workflows:work` Graphite cheat-sheet, and `/setup:all` Steps 1.6/1.7 move to plugin-local `references/` dirs loaded via `${CLAUDE_PLUGIN_ROOT}` stubs at their branch points
- Manual stub-firing e2e checklist at `docs/testing/c6-progressive-disclosure-stub-firing-checklist.md`; stale provenance comment in `debugging/SKILL.md` corrected
