---
"yellow-core": patch
"yellow-review": patch
"yellow-debt": patch
"yellow-devin": patch
"yellow-semgrep": patch
---

Sibling-plugin lookups in the installed cache now prefer the active install
recorded in `installed_plugins.json` over the highest numeric version
directory, so a rolled-back plugin no longer runs an orphaned newer cache
copy. This covers `lib/run-github-stack-runtime.js`, yellow-review's
`lib/sibling-plugin.sh` and the git-worktree restack adapter lookup. A
project-scoped install applies inside its project; the highest version stays
the fallback when the file or entry is missing or unusable.
