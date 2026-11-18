---
'yellow-ci': patch
'yellow-goal': patch
---

Name the typed-only commands in a description Claude still sees (CLAUDE-341).
`/ci:runner-cleanup` and `/goal:run-real` set `disable-model-invocation: true`,
so their own descriptions are hidden. Asked in plain language, Claude now tells
the user to type them instead of working around them.

- yellow-ci: the `/ci:runner-health` description says disk cleanup is
  typed-only.
- yellow-goal: the `/goal:run-stub` description says a real, paid run is
  typed-only.
