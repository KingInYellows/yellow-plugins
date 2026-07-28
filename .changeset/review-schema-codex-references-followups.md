---
"yellow-review": patch
"yellow-core": patch
"gt-workflow": patch
---

Review-schema definitions, Codex reference sidecars, and gt-cleanup split

- yellow-review: define `residual_risks`/`testing_gaps` as
  aggregator-populated demotion buckets in the `pr-review-workflow` skill;
  annotate the fields in all 10 structured persona JSON examples; correct
  the legacy-format rosters in `review-pr.md` (two places) and
  `review-all.md` that falsely listed `security-reviewer` and
  `performance-reviewer` as legacy-prose emitters.
- yellow-core: fix `performance-reviewer` and `security-reviewer` output
  schema — both emitted a 7-field shape that fell between the legacy-prose
  normalizer and structured-schema validation, so `review-pr.md` Step 6.1
  dropped their entire returns on every review that selected them. Both now
  emit the 10-field compact-return contract. Also annotate the
  demotion-bucket fields in both agents.
- gt-workflow: split `gt-cleanup` SKILL.md (561 → 359 lines, under the
  RULE 15a ceiling) by moving PR Status Lookups, Actionable Category
  mechanics, and the Worktree Cleanup Offer into `references/*.md` behind
  skill-relative Read stubs. Content restructure only — no interface
  change. Codex artifacts regenerated with the new reference sidecars.
