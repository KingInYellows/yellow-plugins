---
"yellow-core": patch
"yellow-review": patch
"yellow-debt": patch
"yellow-devin": patch
"yellow-semgrep": patch
---

Fix `READY_GITHUB` stack operations in the installed plugin cache. Commands,
skills and agents called `${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js`,
which exists only in the source tree; the cache is `<marketplace>/<plugin>/<version>/`.
They now call `lib/run-github-stack-runtime.js`, which finds the runtime in
either layout (highest numeric cached version) and reports
`RUNTIME_NOT_FOUND` with a recovery action when github-workflow is absent.
