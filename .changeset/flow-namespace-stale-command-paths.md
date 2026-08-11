---
"yellow-core": patch
---

Fix stale `commands/workflows/` directory paths in the `memory-recall-pattern`
and `memory-remember-pattern` skills. Those blockquotes list the command files
that consume the ruvector protocol, and the paths stopped resolving when the
command directory moved to `commands/flow/`.

The namespace gate could not catch these: it matches `workflows:` with a
colon, and a directory path has a slash. They were found by enumerating
`commands/workflows` separately from the namespace sweep — the same
"audit every structurally-similar reference shape, not just the one your
matcher knows about" discipline the migration needed for the `workflows:*`
glob form.
