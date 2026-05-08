---
"yellow-debt": patch
"yellow-ci": patch
"yellow-chatprd": patch
---

X-01 (audit 2026-05-07): declare cross-plugin MCP dependencies in three
consumer manifests that silently require yellow-linear's MCP at runtime.
Surfaces install-time coupling that previously failed opaquely as
"MCP tool not found".

**yellow-debt:** `/debt:sync` uses
`mcp__plugin_yellow-linear_linear__create_issue` to push debt findings
to Linear as issues.

**yellow-ci:** `/ci:report-linear` uses the same Linear MCP tool to
create issues from CI failure diagnoses.

**yellow-chatprd:** `/chatprd:link-linear` uses it to bridge ChatPRD
documents to Linear issues.

All three deps are declared `optional: true` (matches npm
`peerDependenciesMeta` semantics: declared as soft deps for
audit/documentation purposes; consumers degrade gracefully when
yellow-linear is absent — the Linear-specific commands surface "plugin
not installed" rather than crashing).

The schema extension (`schemas/plugin.schema.json`) and validator
addition (RULE 11 in `scripts/validate-plugin.js`) ship in the same PR
but do not require a changeset (root-level files, no plugin touches).

⚠️ External smoke gate: do NOT tag a release until a fresh
`claude plugin install` smoke test confirms Claude Code's remote
validator accepts the new `optional` and `reason` fields. Local CI
passing does NOT guarantee remote validator acceptance — see
`docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
for the precedent on local-vs-remote validator drift.
