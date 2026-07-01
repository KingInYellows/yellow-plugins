---
title: "Doc-Fix PRs Need the Same Mechanical Verification as Code PRs"
date: "2026-07-01"
category: code-quality
track: knowledge
problem: "A docs-only PR whose purpose is fixing documentation defects introduced three new documentation defects, each because a claim was asserted from memory/prediction instead of checked mechanically against ground truth"
tags:
  - documentation
  - pr-review
  - verification
  - validator-claims
  - self-disclosure
  - citation-drift
  - multi-agent-review
components:
  - CLAUDE.md
  - plugins/yellow-core/skills/debugging/SKILL.md
  - plugins/yellow-review/commands/review/review-pr.md
---

# Doc-Fix PRs Need the Same Mechanical Verification as Code PRs

Discovered during multi-agent review of PR #601
(`docs(skills): rewrite 5 weak skill descriptions with concrete Use-when
triggers`, the Tier 1 optimization PR). The PR's entire purpose was
correcting documentation defects (C1–C5), yet three independent review
findings showed that fixing one documentation claim had introduced a new
one, or left a known pattern's disclosure incomplete — because the author
substituted an assertion or prediction for a mechanical check.

## Finding 1: A Doc Fix for a False Claim Introduced a New False Claim

C5 replaced a false enforcement claim in root `CLAUDE.md` ("all authoring
rules ... are enforced by `validate-agent-authoring.js`") with a narrower
one. The narrower claim was still wrong:

```diff
-Frontmatter and authoring rules below are enforced by
-`validate-agent-authoring.js`.
+- **Agent and command markdown** — CI-enforced by
+  `validate-agent-authoring.js` (agent frontmatter rules, `subagent_type`
+  references, the `BASH_SOURCE` ban on commands).
+- **SKILL.md** — the three-heading rule, the single-line `description:`
+  rule, and the `user-invokable` spelling are convention only: the
+  validator never applies its authoring rules to SKILL.md files, so
+  review is the gate.
```

"The validator never applies its authoring rules to SKILL.md files" is
itself an absolute claim, and it is false: `validateSubagentReferences()`
in `scripts/validate-agent-authoring.js` walks `markdownFiles` — every
`.md` under `plugins/` except `CHANGELOG.md` — which includes SKILL.md.
Only `validateAgentFile()` (the frontmatter rules: `tools:` vs.
`allowed-tools:`, RULE 13, W1.5, etc.) is scoped to `agentFiles` (paths
containing `/agents/`). The commit's own message bundled both checks under
one sentence — "agent/command markdown -> CI" — while the diff's SKILL.md
bullet claimed the validator "never" touches SKILL.md, contradicting the
`subagent_type references` bullet one line above it in the same commit.

Two reviewers (adversarial, architecture-strategist) independently caught
this in the very next review pass. The fix split
"subagent_type references" into its own bullet spanning ALL plugin
markdown including SKILL.md, and narrowed the SKILL.md-is-convention-only
bullet to the three specific rules it actually applies to (three-heading
rule, single-line `description:`, `user-invokable` spelling) — see
`CLAUDE.md`'s current "Plugin authoring — what the validators care about"
section.

**Root cause:** the author read the validator's file-collection code once,
generalized to "the validator" as a monolith, and wrote an absolute
negative ("never applies ... to SKILL.md") about the whole validator
instead of checking each function's own file-walk scope
(`agentFiles` vs. `markdownFiles`) separately.

## Finding 2: Deferred-List Self-Disclosure Named 1 of 4 Pattern Instances

The PR body's original "Deferred P3 findings" section named one instance
of a redirect-clause landing past the ~250-char auto-invocation zone
(community-observed convention documented in `CONTRIBUTING.md`). Three
reviewers (project-standards, agent-cli-readiness, adversarial) confirmed
the same clause-placement pattern recurred on 3 more surfaces the author
had touched in the same PR but not measured:

```text
debugging          — clause at char 226 of 314
optimize            — clause at char 235 of 322
session-history      — clause at char 243 of 352
/ruvector:memory     — destination name past char 250 of 318
/mempalace:search    — 205 chars, fully inside the zone (NOT affected)
```

Naming one instance of a pattern the author had personally introduced
across 5 files reads as a complete disclosure; a reader has no signal that
3 more instances exist until an independent reviewer measures all 5. The
fix was to grep/measure every surface the PR touched and list all 4
affected instances with their exact character offsets in the amended PR
body (plus the one surface confirmed unaffected, to show the check was
exhaustive rather than selective).

**Root cause:** the author noticed the pattern once, while writing one
surface, and disclosed that instance — without going back to check
whether the same edit (appending a redirect clause after existing content)
had the same effect on the other 4 surfaces touched by the same PR.

## Finding 3: A Section Move Broke a Citation the Move Was Predicted Not to Affect

C4 moved the 168-line "Subagent Failure Convention" section verbatim from
`create-agent-skills/SKILL.md` to `references/subagent-failure-convention.md`,
preserving the section's own heading. The PR body claimed "Live citations
(`work.md:479`, `review-pr.md:415-417`) resolve via the preserved
heading" — i.e., "no edits needed" to the citing files.

Four independent reviewers (plugin-contract, agent-native, adversarial,
code-simplicity) flagged that `review-pr.md:415-417` cited a *subsection*
of the moved content by file **and** heading — `create-agent-skills/SKILL.md`,
"When the convention applies" — not just the top-level section. Preserving
the top-level heading in the destination file did nothing for a citation
that named the original file path. The fix repointed the citation directly
at `references/subagent-failure-convention.md`.

**Root cause:** the prediction "citations resolve via the preserved
heading" was checked against heading text only. It was never checked
against the citations' actual grep pattern — which named the file path,
not just the heading — so a citation naming the pre-move file was
predicted safe without being read.

## The Shared Thesis

All three findings reduce to the same substitution: **an assertion or
prediction made from partial/remembered knowledge stood in for a
mechanical check, and a docs-only PR is not exempt from that discipline
just because its content is prose rather than code.**

| Finding | What was asserted | What the mechanical check would have been |
|---|---|---|
| 1 | "the validator never applies its rules to SKILL.md" | Read `validateAgentFile`'s and `validateSubagentReferences`'s file-collection code separately |
| 2 | "this is the one instance of the pattern" | `rg` the redirect-clause insertion point + char offset across every surface touched in the PR |
| 3 | "citations resolve via the preserved heading" | `rg` for citations naming the *original file path*, not just the heading text, across the whole repo |

Each check is a single grep or a few lines of code-reading — cheap relative
to a review round-trip, and cheap relative to writing a doc *about*
validator behavior, pattern completeness, or citation safety without first
confirming the claim against the artifact it describes.

## Prevention Checklist

Before asserting any of the following in a documentation PR, run the
check instead of writing the assertion from memory:

1. **"The validator/script does X"** — read the specific function that
   implements X, not just its file-collection glob one level up. A
   validator with multiple functions can have different file-walk scopes
   per function (see `agentFiles` vs. `markdownFiles` in
   `scripts/validate-agent-authoring.js`).
2. **"This is the only instance of pattern P"** — grep/measure every file
   the current PR touches for pattern P before writing "1 of N" in a PR
   body. If the PR introduced P once, it likely introduced P everywhere
   the same edit template was applied.
3. **"This citation/reference still resolves after the move"** — grep the
   whole repo for citations naming the **original file path**, not just
   the section heading. A heading-preserving move only protects citations
   that name the heading; it does nothing for citations that name the
   file.

## Related Documentation

- [multi-doc-schema-rename-drift.md](./multi-doc-schema-rename-drift.md) —
  same class of drift (a moved/renamed identifier breaking a citation
  elsewhere), applied to schema field renames rather than section moves
- [cross-plugin-documentation-correctness.md](./cross-plugin-documentation-correctness.md) —
  mechanical grep-based verification for command names and credential
  references
- `pr362-review-verification-patterns.md` (auto-memory) — the same
  root cause (trusting a summary instead of re-deriving ground truth)
  found in a prior PR's review pass, for verifying *reviewer* claims
  rather than the PR author's own claims
