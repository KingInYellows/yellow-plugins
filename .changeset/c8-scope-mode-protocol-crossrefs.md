---
'yellow-review': patch
'yellow-core': patch
---

Document the shared scope/mode interfaces in `docs/plugin-scope-mode-protocol.md` (Tier 2 C8) and add one-line conforms-to cross-references in the four surface files (`review-pr.md`, `resolve-pr.md`, `compound.md`, `workflows/review.md`). Docs-only: the doc records CURRENT behavior (`--non-interactive` contract + forwarders, `--in-pr`, the debt-scanner JSON-file interface, `/workflows:review` positional-type dispatch, and turbo's diff-vs-file scope as a RECOMMENDED not-yet-uniform convention); no logic changes, and unifying divergent semantics is recorded as an explicit non-goal.
