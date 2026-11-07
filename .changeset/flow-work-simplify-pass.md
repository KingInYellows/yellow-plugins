---
'yellow-core': minor
'yellow-review': minor
---

`/flow:work` runs a simplify pass at the end of Phase 3, before Ship It
(CLAUDE-214). It dispatches `code-simplifier` plus two new yellow-review agents,
`test-value-reviewer` and `comment-reviewer` (code files only), on what the
branch added or changed, applies their fixes without asking, deletes a test only
after running it green, and skips docs- and Markdown-only diffs with "nothing to
simplify". `/review:pr` never selects the new agents, and its Step 8
code-simplifier pass is unchanged.
