---
"yellow-core": patch
---

`/plan:complete` no longer exits when `gt` is missing before the stacked-PR
provider is resolved. The Graphite archival path still fails closed without
`gt`. The GitHub path keeps using `run-github-stack-runtime.js`.
