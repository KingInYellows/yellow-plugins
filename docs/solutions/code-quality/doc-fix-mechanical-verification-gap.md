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

---

## Update — 2026-07-09

**New context:** PR #632 (`fix(yellow-ruvector): enforce hook budgets —
skip-npx + per-call timeouts`) surfaced the same substitution — prose
describing code, never mechanically re-verified — in a regular code PR, not
a doc-fix PR. The mechanism differs enough to note explicitly.

### Finding: A Changeset Description Went Stale From Mid-PR Churn, Not From a False Assertion

The changeset `.changeset/w1d-ruvector-hook-timeout-budgets.md` (which ships
verbatim into `CHANGELOG.md`) was written in commit `5a347d4c` to describe a
`$SECONDS`-based remaining-budget guard in `session-start.sh`. That guard
was **true when the changeset was written** — the commit adding it landed in
the same push. A later, review-driven commit (`8f306701`) removed the guard
as decorative (three reviewers converged: integer-second `$SECONDS`
granularity is useless against the sub-second per-call caps that stayed
authoritative), but the changeset prose was never re-synced. The stale claim
survived until a subsequent review round (comment-analyzer, reliability,
correctness, maintainability, plus codex git-archaeology — 12+ reviewers
converged, anchor 100) traced the guard through git history and confirmed it
had been deliberately removed, not merely undocumented. Fixed in `011af2cd`
by correcting the changeset to describe the shipped fixed per-call caps (and
fixing an already-inconsistent worst-case figure, 2.7s vs. the
arithmetically correct 2.8s, in the same pass).

**Distinct root cause:** the earlier findings in this doc are about
assertions made *from memory or prediction* that were wrong from the start.
This one was correct at the moment it was written — it went stale because a
**later commit in the same PR** changed the code the prose described, and
nothing re-diffed the prose against the PR's final state. The mechanical
check needed here is different in kind: not "verify the claim against
ground truth" (it was checked once, correctly) but "re-verify PR-lifecycle
artifacts — changesets, PR bodies, commit messages — against the tip of the
branch whenever a later commit touches the same code they describe."

**Prevention (in addition to the existing checklist):**

4. **"This changeset/PR-body/commit-message paragraph describes the shipped
   behavior"** — after any commit that alters or removes something an
   earlier commit in the same PR added, re-read every PR-lifecycle prose
   artifact (`.changeset/*.md`, PR body, squash-worthy commit messages) that
   referenced the changed code and re-diff it against the current tip.
   Changesets are especially exposed because they are typically written
   once, early, alongside the first implementation commit, and are easy to
   forget during later review-driven rework — see
   `docs/solutions/workflow/changeset-release-pipeline-silent-failures.md`
   for the release-pipeline consequences of stale/incorrect changeset
   content reaching `CHANGELOG.md` unreviewed.

---

## Update — 2026-07-16

**New context:** PR #644 (codex-pilot shell 01, "neutral catalog generation
foundation") shipped a research spike
(`docs/research/2026-07-16-codex-plugin-contract-spike.md`) in the same
commit as two solution docs that spike was meant to resolve
(`docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`
and `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`).
Both still read "pending the spike" / "do not resolve this from docs
alone" **after** the spike landed with its findings — even though the
spike doc's own header stated `Consumes/updates: [those two docs]`. Two
reviewer personas (comment-analyzer, project-standards) independently
caught it in the next review round.

### Finding 4: A Doc's Own "Consumes/Updates" Header Named a Contract the Same Commit Didn't Execute

The spike doc wasn't a passive research note — its frontmatter/header
explicitly declared which other docs it was responsible for updating once
its findings landed. That declaration is a checklist, not a citation: the
commit added the spike's findings but never opened the two consumer docs
to apply them, so the repo briefly shipped a resolved question still
labeled unresolved in two other files. Fixed in the same PR's next review
round (commit `16d830d`) by rewriting both docs' "Unverified"/pending
sections into resolved-with-pointers, using the spike's actual findings —
(a)–(c) for the manifest-and-hook-contract doc and (e)–(f) for the
ci-schema-drift hooks-path re-test — rather than re-asserting the old
"must not resolve from docs alone" caution.

**Distinct root cause:** Findings 1–3 are about a claim being wrong (from
the start, or gone stale mid-PR). This one is about a **self-declared
cross-document contract** — a doc explicitly stating "I update these other
docs" — going unexecuted within the very commit that could have satisfied
it. The mechanical check isn't "is this claim true" but "does this commit
do everything the new/changed doc's own header says it does."

**Prevention (in addition to the existing checklist):**

5. **A doc has a "Consumes"/"Updates"/"Resolves" header naming other
   files** — before closing out the commit, open every named file and
   confirm the described update actually happened in this commit, not a
   future one. Landing the spike/source-of-truth doc without touching its
   declared consumers is the same failure as checklist item 3 above (a
   citation not re-verified after a change), but triggered by the *new*
   doc's own promise rather than an existing citation elsewhere.

---

## Update — 2026-07-22

**5th recurrence** (PR #661, gt-workflow Codex-pilot conversion, shell 04):
`plugins/gt-workflow/README.md` and `plugins/gt-workflow/skills/gt-setup/SKILL.md`
still attributed the `jq` requirement to the PreToolUse/PostToolUse hooks
after the same PR rewrote those hooks from bash+jq to Node — a mechanical
grep for `jq` across the plugin's docs post-rewrite would have caught it;
the docs were left asserted-unchanged instead. Flagged by
project-compliance-reviewer, P2, routed to Residual Actionable Work
(out of the review's P0/P1-only auto-apply scope) rather than fixed in the
same PR. Prior recurrences: PR #601 (this doc's origin), #632, #644, #658.
