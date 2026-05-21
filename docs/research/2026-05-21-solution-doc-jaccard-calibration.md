# Solution-Doc Jaccard Calibration

**Date:** 2026-05-21
**Context:** Empirical calibration data that drove the design decision in
`plans/solution-doc-git-workflow.md` to **drop write-time Jaccard duplicate
detection** from the initial `validate-solutions.js` implementation.

## Why this exists

The brainstorm at `docs/brainstorms/2026-05-21-solution-doc-git-workflow-brainstorm.md`
and the initial plan proposed a token-Jaccard duplicate detector with
thresholds at 0.5 (warn) / 0.6 (block) against the existing `docs/solutions/`
corpus. Before writing the validator, Phase 0 of the plan ran a one-off
calibration sweep across all 88 non-archived docs to validate those
thresholds. The data showed the proposed thresholds would never fire.

This document captures the calibration so the decision is auditable and so
that any future revisit of Jaccard duplicate detection can re-run the same
analysis against the then-current corpus.

## Methodology

1. **Corpus:** All `.md` files under `docs/solutions/` excluding `archived/`.
2. **Token source:** For each doc, combined `slug` (filename without `.md`),
   `title:` frontmatter, and `problem:` frontmatter (with `problems:` /
   `problem_type:` aliases).
3. **Tokenization:** Lowercase, split on non-alphanumeric, drop tokens shorter
   than 3 chars, drop initial stop-word list.
4. **Initial stop-words:** `hook plugin agent ci pr workflow validation review
   skill command claude code error build fix the and for with from when this
   that are not use using how why what`.
5. **Pairwise Jaccard:** `|A ∩ B| / |A ∪ B|` for all `N*(N-1)/2 = 3,828` pairs.

## Results

### Distribution (Phase 0.1)

```text
Found 88 non-archived docs
Total pairs analyzed:    3,828
Pairs with non-zero Jaccard: 791

Bin       | Count
----------+------
0.00-0.05 |   514
0.05-0.10 |   220
0.10-0.15 |    44
0.15-0.20 |     6
0.20-0.25 |     4
0.25-0.30 |     1
0.30-0.35 |     2
0.35+     |     0   ← NO pair exceeds 0.345
```

**Max pairwise Jaccard in the entire corpus = 0.345.** That maximum pair is
two intentional sibling docs about distinct prompt-injection failure modes
(`prompt-injection-fence-breakout-literal-delimiter.md` and
`sandwich-fence-delimiter-forgery.md`) — they share vocabulary by design.

### Top 20 pairs

| Score | Same-cat | Files |
|------:|:--------:|:------|
| 0.345 | YES | security-issues/prompt-injection-fence-breakout-literal-delimiter ↔ sandwich-fence-delimiter-forgery |
| 0.333 | YES | code-quality/brainstorm-orchestrator-agent-authoring-patterns ↔ plugin-review-defensive-authoring-patterns |
| 0.250 | YES | security-issues/yellow-linear-plugin-multi-agent-code-review ↔ yellow-linear-plugin-pr-review-fixes |
| 0.231 | YES | integration-issues/ruvector-cli-and-mcp-tool-name-mismatches ↔ ruvector-mcp-tool-parameter-schema-mismatch |
| 0.200 | YES | code-quality/agent-migration-audit-patterns ↔ plugin-review-defensive-authoring-patterns |
| 0.200 | YES | code-quality/agent-migration-audit-patterns ↔ session-level-review-command-patterns |
| 0.200 | YES | code-quality/plugin-review-defensive-authoring-patterns ↔ session-level-review-command-patterns |
| 0.185 | no  | code-quality/yellow-ci-shell-security-patterns ↔ security-issues/shell-binary-downloader-security-patterns |
| 0.182 | YES | build-errors/plugin-json-changelog-key-schema-drift-remote-validator ↔ userconfig-type-title-remote-validator-drift |
| 0.179 | YES | security-issues/prompt-injection-fence-breakout-literal-delimiter ↔ prompt-injection-fence-delimiter-escape |

Manual review of all 20 confirmed: every pair is a legitimate sibling about
related-but-distinct failure modes. None are accidental duplicates.

### DF-based stop-word analysis (Phase 0.2)

```text
Total unique tokens: 736

Top terms by document frequency:
  plugin     21 docs (23.9%)
  agent      18 docs (20.5%)
  code       16 docs (18.2%)
  review     15 docs (17.0%)
  patterns   13 docs (14.8%)
  pattern    10 docs (11.4%)
  command     9 docs (10.2%)
  shell       9 docs (10.2%)
  multi       9 docs (10.2%)
  yellow      8 docs (9.1%)
  ...

Stop-word candidates by DF threshold:
  DF >= 40%: 0 terms
  DF >= 30%: 0 terms
  DF >= 20%: 2 terms (plugin, agent)
  DF >= 15%: 4 terms (plugin, agent, code, review)
  DF >= 10%: 9 terms (plugin, agent, code, review, patterns, pattern,
                      command, shell, multi)
```

The Microsoft Research duplicate-detection paper suggests a domain stop-word
threshold near 40% DF. **No tokens cross that threshold** in this corpus.
Even at 10% DF the candidate list is small. This is consistent with the
bimodal Jaccard distribution the nelhage MinHash analysis predicts for
technical documentation: tokens are highly specific to the failure mode each
doc describes.

### Error-codes regex check (Phase 0.3)

`scripts/lint-error-codes.js` uses `/ERROR-[A-Z]+-\d+/g`. `ERROR-SOL-001`
matches without modification. No regex change required when introducing the
`SOL` category.

## Conclusion

**Jaccard duplicate detection is not warranted at this corpus size.** Three
findings drive the conclusion:

1. **No accidental duplicates exist.** Every high-similarity pair is an
   intentional sibling, manually verified.
2. **The proposed 0.5/0.6 thresholds would never fire.** Maximum pair = 0.345.
3. **Lower thresholds catch only legitimate siblings.** Setting block at
   anything ≤ 0.30 would either fire on zero pairs (no value) or fire on
   pairs the author legitimately needed to write (false positives).

## What ships instead

The `validate-solutions.js` initial implementation enforces only:

- **`ERROR-SOL-001`** — exact slug collision against existing corpus (BLOCK)
- **`ERROR-SOL-002`** — missing required frontmatter field (BLOCK)

No similarity scoring, no stop-word list, no threshold calibration, no
`intentional_variant: true` opt-out semantics.

The orphan-MEMORY-reference problem (the original pain point from PR #548)
is addressed by the `knowledge-compounder` in-PR mode (`/workflows:compound
--in-pr`), which is what actually delivers value.

## When to revisit

Re-run this calibration when any of the following become true:

- Corpus exceeds ~500 docs (the inflection point where Jaccard typically
  begins seeing real duplicates — see nelhage analysis).
- A reviewer flags an actual duplicate doc landing in main — i.e., the
  failure mode the validator was meant to prevent.
- MEMORY.md index churn suggests references are colliding (multiple bullets
  pointing at semantically-overlapping docs).

The calibration scripts used to produce this data
(`jaccard-calibration.js`, `df-stopword.js`) are not committed — they were
throwaways. Re-derive them from this methodology section if needed.

## References

- [Draisbach & Naumann, "On Choosing Thresholds for Duplicate Detection," HPI Potsdam 2013](https://hpi.de/fileadmin/user_upload/fachgebiete/naumann/publications/2013/On_Choosing_Thresholds_for_Duplicate_Detection.pdf)
- [Microsoft Research, "Duplicate News Story Detection Revisited," 2013](https://www.microsoft.com/en-us/research/wp-content/uploads/2013/12/NewsDuplicateDetectionRevisted.pdf)
- [nelhage, "Finding near-duplicates with Jaccard similarity and MinHash"](https://blog.nelhage.com/post/fuzzy-dedup)
- Plan: `plans/solution-doc-git-workflow.md`
- Brainstorm: `docs/brainstorms/2026-05-21-solution-doc-git-workflow-brainstorm.md`
