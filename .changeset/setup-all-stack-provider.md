---
"yellow-core": patch
---

/setup:all, /stack:status and the stack-provider-router skill probe only the
stacked-PR provider the repository uses (`.yellow-stack.yml` intent, else the
single enabled provider), so a GitHub-stacks repository never runs `gt` and a
Graphite one never runs `gh extension list`. /setup:all and /statusline:setup
read installed state from `claude plugin list --json`, so a plugin left only in
the plugin cache no longer shows as installed or needing setup.
