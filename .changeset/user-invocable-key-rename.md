---
'github-workflow': patch
'gt-workflow': patch
'yellow-browser-test': patch
'yellow-ci': patch
'yellow-codex': patch
'yellow-composio': patch
'yellow-core': patch
'yellow-council': patch
'yellow-cursor': patch
'yellow-debt': patch
'yellow-devin': patch
'yellow-docs': patch
'yellow-linear': patch
'yellow-mempalace': patch
'yellow-research': patch
'yellow-review': patch
'yellow-ruvector': patch
'yellow-semgrep': patch
---

Rename the skill frontmatter key `user-invokable` to `user-invocable` in every
SKILL.md. Claude Code (verified against 2.1.259) parses only `user-invocable`;
the `k` spelling this repo standardised on was silently ignored, so every
internal skill declared `user-invokable: false` still appeared in the `/` menu.
The validator gains RULE 20 (error tier) rejecting the old key so it cannot
creep back through stale templates.
