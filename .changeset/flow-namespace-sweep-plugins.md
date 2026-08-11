---
"gt-workflow": patch
"yellow-codex": patch
"yellow-core": patch
"yellow-docs": patch
"yellow-linear": patch
"yellow-research": patch
"yellow-review": patch
"yellow-ruvector": patch
---

Sweep the remaining prose references to the retired `workflows:` command
namespace under `plugins/` — 177 references across 42 files in 8 plugins — so
every documented invocation matches the `flow:` names the commands actually
carry. Documentation only; no behavior changes.

Eight plugins, not the seven the migration plan predicted: the list was
re-derived from `git status` rather than trusted, and `yellow-docs` had a
single reference nobody had counted.

Two findings worth recording:

- **The gate could not see the glob form.** `plugins/yellow-core/CLAUDE.md`
  documented the namespace as `` `/workflows:*` ``, which
  `scripts/validate-flow-namespace.js` matched against none of its ten
  enumerated command names. It was found by hand, which is exactly the
  "sweep misses N+1" mode the gate exists to prevent. The matcher now also
  bans the collective forms `workflows:*` and `workflows:<cmd>`.
- **The glob rule needed a `(?!\*)` guard.** Markdown bold places `**`
  immediately after a colon-terminated phrase — `**Template-driven
  workflows:**` — which a bare `\*` alternative matches as `workflows:` plus
  `*`. Three such false positives appeared the moment the rule was added; a
  real glob is never followed by a second asterisk.

The sweep used `perl`, not `sed`, so the replacement could carry the same
`(?![a-z-])` tail guard the gate matches with. The singular
`yellow-core:workflow:*` agent namespace is untouched throughout.
