---
"yellow-codex": patch
"yellow-core": patch
"yellow-docs": patch
"yellow-linear": patch
"yellow-review": patch
"yellow-ruvector": patch
---

Sweep the remaining prose references to the retired `workflows:` command
namespace under `plugins/` — 60 references across 24 files in 6 plugins — so
every documented invocation matches the `flow:` names the commands actually
carry. Documentation only; no behavior changes.

Six plugins, not the seven the migration plan predicted, and not the eight an
earlier draft of this changeset claimed. The list is re-derived from this
commit's own diff rather than trusted: `yellow-docs` had a single reference
nobody had counted, while `gt-workflow` and `yellow-research` end up swept in
the parent PR and carry their bumps in that PR's changeset — listing them here
would publish new versions of two plugins this commit does not touch.

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
