---
"yellow-core": patch
"yellow-review": patch
"yellow-debt": patch
"yellow-devin": patch
"yellow-semgrep": patch
---

Active-install sibling lookups (`run-github-stack-runtime.js`, yellow-review's
`lib/sibling-plugin.sh`, yellow-core's `worktree-restack.sh`) now rank a
`local`-scoped `installed_plugins.json` entry above a `project`-scoped one for
the same `projectPath`, matching Claude Code's local > project > user
precedence, and canonicalize `projectPath` and the cwd before comparing them,
so a project recorded through a symlink still matches.
