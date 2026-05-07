---
"yellow-review": major
---

Remove the `code-reviewer` deprecation stub. The Wave 2 minor that introduced
the stub has shipped; per the documented deprecation policy, callers had one
minor version to migrate to `project-compliance-reviewer`. The stub agent file
at `plugins/yellow-review/agents/review/code-reviewer.md` is deleted, and all
prose references to it in `commands/review/review-pr.md`,
`commands/review/review-all.md`, `CLAUDE.md`, and `README.md` are removed.

External callers still passing `subagent_type: "yellow-review:review:code-reviewer"`
must update to `"yellow-review:review:project-compliance-reviewer"`. Historical
CHANGELOG migration notes are preserved (with field/value wording adjusted so
the validator's `subagent_type` regex no longer treats them as live dispatch).

This PR also completes the W2.0a backfill of `track` and `problem` frontmatter
fields across `docs/solutions/` (7 files: 5 incomplete + 2 previously
missing-frontmatter); the catalog now passes
`scripts/backfill-solution-frontmatter.js --check` cleanly.
