---
'gt-workflow': minor
'yellow-core': patch
'yellow-linear': patch
'yellow-review': patch
---

gt-workflow: the eight entry points (`gt-setup`, `smart-submit`, `gt-amend`,
`gt-stack-plan`, `gt-cleanup`, `gt-sync`, `gt-nav`, `gt-merge`) are now
user-invocable skills, and the same-named wrapper commands are removed. Claude
Code resolved each command/skill pair to the wrapper, so the skill body was
unreachable through the Skill tool. Type `/gt-workflow:<name>`, and pass the
same qualified name to the Skill tool; a bare `/<name>` was not verified for a
plugin skill and can be taken by one of your own commands.

yellow-core and yellow-linear: `/flow:work`, `/flow:plan` and `/linear:work`
invoke `gt-workflow:smart-submit` and `gt-workflow:gt-stack-plan` by their
qualified names, `/setup:all` invokes `gt-workflow:gt-setup`, and the setup and
status hints in yellow-core and yellow-review name `/gt-workflow:<name>`.
