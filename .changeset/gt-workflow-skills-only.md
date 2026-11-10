---
'gt-workflow': minor
'yellow-core': patch
'yellow-linear': patch
---

gt-workflow: the eight entry points (`gt-setup`, `smart-submit`, `gt-amend`,
`gt-stack-plan`, `gt-cleanup`, `gt-sync`, `gt-nav`, `gt-merge`) are now
user-invocable skills, and the same-named wrapper commands are removed. Claude
Code resolved each command/skill pair to the wrapper, so the skill body was
unreachable through the Skill tool. Every name still works; type
`/gt-workflow:<name>` if a bare name is also used by one of your own commands.

yellow-core and yellow-linear: `/flow:work`, `/flow:plan` and `/linear:work`
invoke `gt-workflow:smart-submit` and `gt-workflow:gt-stack-plan` by their
qualified names.
