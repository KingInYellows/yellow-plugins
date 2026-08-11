---
"yellow-codex": patch
"yellow-core": patch
"yellow-linear": patch
"yellow-review": patch
"yellow-ruvector": patch
---

Sweep the remaining prose references to the retired `workflows:` command
namespace under `plugins/` — 59 references across 23 files in 5 plugins — so
every documented invocation matches the `flow:` names the commands actually
carry. Documentation only; no behavior changes.

Five plugins, not the seven the migration plan predicted, and not the eight an
earlier draft of this changeset claimed. The list is re-derived from this
commit's own diff rather than trusted, and it shrank twice during review as
references that turned out to be functional rather than prose were pulled
forward into the parent PR: `gt-workflow` and `yellow-research` (agent and
skill instructions), then `yellow-docs` (a `/docs:review` handoff a user can
accept at runtime). All three carry their bumps in the parent PR's changeset.
Listing them here would publish new versions of plugins this commit does not
touch.

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
