---
"yellow-review": minor
---

`resolve-pr`, `resolve-stack`, `review-all`, `review-pr`, `sweep`, and
`sweep-all` (plus the `pr-review-workflow` and `stack-traversal` skills that
describe their behavior) now resolve the active stacked-PR provider once via
`stack-provider-router` before committing or submitting, instead of
hardcoding Graphite. The Graphite path is unchanged; a GitHub-provider repo
now routes through `github-workflow`'s runtime adapter instead of failing.
