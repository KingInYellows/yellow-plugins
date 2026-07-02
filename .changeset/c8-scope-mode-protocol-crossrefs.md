---
'yellow-review': patch
'yellow-core': patch
---

Document the shared scope/mode interfaces in `docs/plugin-scope-mode-protocol.md` (Tier 2 C8) and add conforms-to cross-references (with an update-in-same-PR obligation) in the five surface files (`review-pr.md`, `resolve-pr.md`, `review-all.md`, `compound.md`, `workflows/review.md`). Docs-only: the doc records CURRENT behavior (`--non-interactive` contract + forwarders, `--in-pr`, the debt-scanner file interface (plain-text scope files in, JSON findings out), `/workflows:review` positional-type dispatch, `/review:all` scope keywords, and turbo's diff-vs-file scope as a RECOMMENDED not-yet-uniform convention); no logic changes, and unifying divergent semantics is recorded as an explicit non-goal.
