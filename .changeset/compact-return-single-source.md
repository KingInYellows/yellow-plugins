---
'yellow-review': minor
'yellow-core': patch
---

Single-source the review compact-return schema and depth-gate
`reviewer_set.include`.

- `pr-review-workflow/references/compact-return-schema.md` now holds the
  canonical compact-return schema and persona notes between marker comments.
  Every persona copy (yellow-review's eleven Wave 2 personas, the thermonuclear
  skill, and yellow-core's `security-reviewer` and `performance-reviewer`) is
  marked, and the new `validate:compact-return` gate fails a copy whose keys,
  key order, value types or `rule`/`scope` placeholders drift, whose enums widen
  past the canonical set, or whose notes are not byte-identical (CLAUDE-30).
- `reviewer_set.include` no longer bypasses depth tiering in `/review:pr` and
  `/review:all`. An included `thermonuclear-reviewer`, `adversarial-reviewer`,
  `code-simplicity-reviewer` or `architecture-strategist` that no rule already
  selected is skipped below the medium tier, with a stderr line and a Coverage
  entry. The new `reviewer_set.force_depth` list keeps one running at every size
  (CLAUDE-31).
