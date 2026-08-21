---
"yellow-linear": minor
---

`linear-pr-linker`, `linear:sync`, `linear:work`, and the `linear-workflows`
skill now resolve the active stacked-PR provider once via
`stack-provider-router` before committing or submitting, instead of
hardcoding Graphite. The Graphite path is unchanged.
