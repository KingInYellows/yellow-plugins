---
'yellow-core': minor
'yellow-review': minor
---

Rule packs (CLAUDE-211): team rules in `rule-packs/<id>/*.md` with `title` and
`applies_when` frontmatter. `/review:pr` reads them from the PR's base branch
and gives them, fenced as reference only, to `project-standards-reviewer`, which
reports contradictions citing `(pack: <id>, <file>)` and caps them at P2 unless
the rule names a concrete consequence. `/flow:plan` adds the packs to
`learnings-researcher`'s search. Machine-local packs come from `rule_pack_dirs`
in a user-level or untracked `yellow-plugins.local.md`. Repositories without
packs behave as before.
