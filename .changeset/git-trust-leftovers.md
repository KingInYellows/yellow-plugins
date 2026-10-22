---
"yellow-review": patch
---

Close the remaining git trust-boundary gaps from the #1076 review
(CLAUDE-100). A program-running key in a global or system git config that
uses shell syntax the check cannot judge (`core.sshCommand=sh $PWD/evil`) is
now refused, while `!` aliases, pagers, editors and diff or merge tools keep
working. The hardened git environment forces `protocol.ext.allow=never`, so an
`ext::` remote cannot run its command. In the verify command's environment
the ssh command line runs on the screened PATH and bare `GIT_SSH`,
`GIT_ASKPASS`, `SSH_ASKPASS` and `GIT_PROXY_COMMAND` values are pinned to
absolute paths, so a verifier that runs `/usr/bin/git` no longer reaches a
worktree `ssh`. `resolve-paths.bats` negated assertions now fail when they
should, and the README states that any `GIT_EXEC_PATH` is refused
(CLAUDE-111).
