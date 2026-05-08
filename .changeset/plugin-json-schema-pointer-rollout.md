---
"gt-workflow": patch
"yellow-browser-test": patch
"yellow-chatprd": patch
"yellow-ci": patch
"yellow-codex": patch
"yellow-composio": patch
"yellow-council": patch
"yellow-debt": patch
"yellow-devin": patch
"yellow-docs": patch
"yellow-linear": patch
"yellow-mempalace": patch
"yellow-morph": patch
"yellow-research": patch
"yellow-review": patch
"yellow-ruvector": patch
"yellow-semgrep": patch
---

Add `$schema` pointer to all remaining plugin manifests:
`https://json.schemastore.org/claude-code-plugin-manifest.json`

Per https://code.claude.com/docs/en/plugins-reference, Claude Code's
plugin loader ignores this field at load time, but editors and IDEs
use it for autocomplete and inline validation against the official
remote validator schema. yellow-core received the pointer earlier in
the stack as a single-plugin probe; this PR extends it to the other 17.

Also documents local vs remote validator divergence in CONTRIBUTING.md
with a recipe for empirical install testing (`claude plugin validate`,
`claude --plugin-url`, fresh-install probe). The `claude plugin validate`
CI integration is deferred to a follow-up PR pending CI runtime
evaluation.
