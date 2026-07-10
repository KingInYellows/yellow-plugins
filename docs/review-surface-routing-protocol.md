# Review Surface Routing Protocol

Which review surface fires for which trigger and situation. Sibling of
`docs/memory-routing-protocol.md`, `docs/plugin-credential-status-protocol.md`,
and `docs/plugin-scope-mode-protocol.md`. This records a **maintainer
decision, deliberately NOT decided by the implementer** — the 2026-07-09
full-marketplace audit found seven overlapping review entry points with no
recorded routing decision; this document frames the decision without making
it.

## Decision

**PENDING — maintainer to fill in.** The table below enumerates the seven
entry points and drafts a routing column with the implementer's observed
de-facto usage as a starting point. Each `(draft)` cell is a proposal, not a
ruling; replace with the maintainer's decision and delete this paragraph
when ruled.

## Trigger routing table

| Entry point | Owner plugin | What it actually does | Routes-from triggers (draft) |
|---|---|---|---|
| `/smart-submit` audit | gt-workflow | 3 parallel audit agents (code review, security, silent failures) on UNCOMMITTED work, then stage/commit/submit | "submit this", "ship it" — pre-commit gate, not a review destination (draft) |
| `/review:pr` | yellow-review | Adaptive multi-agent review of one OPEN PR (tiered persona pipeline, learnings pre-pass, confidence-rubric aggregation, auto-applies P0/P1 `safe_auto` fixes) | "review PR #N", "review this PR" — the default single-PR review surface (draft) |
| `/council` | yellow-council | Cross-lineage advisory fan-out to Codex + Gemini + OpenCode CLIs; consensus verdict, no fix application | "second opinion", "cross-check with other models", `/workflows:work` polish-loop escalation (draft) |
| `/codex:review` | yellow-codex | Single supplementary Codex CLI review of diff or PR; P1/P2/P3 findings | "what does Codex think" — standalone second opinion; NOTE: `/review:pr` auto-spawns the `codex-reviewer` agent (not this command) when yellow-codex is installed and diff > 100 lines (draft) |
| `/devin:review-prs` | yellow-devin | Reviews a batch of Devin-authored PRs LOCALLY via yellow-review's multi-agent pipeline (gh-based fallback if absent); remediation is a per-PR choice — fix locally, message the Devin cloud session, or comment on the PR | "review my Devin PRs", "check Devin's work" — explicit invocation only, never auto-routed (draft) |
| `/workflows:review` | yellow-core | SESSION-level review: plan adherence, cross-PR coherence, scope drift, autonomous P1 fix loop | "review this session/plan against the plan" — plan-file scope; redirects PR-number args to `/review:pr` (draft) |
| `/docs:review` | yellow-docs | Multi-persona review of a PLANNING DOCUMENT (PRD, brainstorm, spec, ADR) | "review this plan/spec/PRD" (document path, not PR) (draft) |

> **Scope of this table:** the batch-review surfaces `/review:all` and
> `/review:sweep-all` (yellow-review) are deliberately NOT given rows here —
> their routing vs `/devin:review-prs` (yellow-devin) is itself an open
> decision, since the real discriminator is whether the PRs are
> Devin-authored, not local vs cloud (question 4 below). The follow-up
> frontmatter sweep must still cover them once question 4 is ruled, so they
> are not silently skipped.
>
> `/review:sweep` (yellow-review) is also deliberately NOT given its own row
> — it wraps the `/review:pr` row above with `/review:resolve` into one
> unattended single-PR review-and-cleanup pass, so its trigger phrases
> overlap with `/review:pr`'s. The follow-up frontmatter sweep must decide
> whether "review and clean up this PR" routes to `/review:pr` alone or to
> `/review:sweep`, so it is not silently skipped either.

### Open routing questions the maintainer should rule on

1. **"review my changes" (uncommitted, no PR)** — `/smart-submit`'s audit is
   the only surface covering uncommitted work, but it couples review with
   submission. Should a review-only alias exist, or is coupling intentional?
2. **`/codex:review` vs `/council`** — both are second-opinion surfaces; codex
   is one lineage, council is three. Is `/codex:review` still a distinct
   user-facing surface, or should "second opinion" always route to `/council`
   (which subsumes the Codex leg)?
3. **Auto-escalation** — `/workflows:work`'s polish loop already escalates to
   `/council` on a stuck review cap. Should `/review:pr` gain the same
   escalation, or stay single-surface?
4. **Batch review** — `/review:all` and `/review:sweep-all` (yellow-review)
   vs `/devin:review-prs` (yellow-devin) both cover "review many PRs", and
   both review locally via yellow-review's multi-agent pipeline. The real
   discriminator is whether the PRs are Devin-authored, not local vs cloud;
   is that the ruling?

## Domain model

Overlapping with distinct primary axes rather than redundant: the seven
surfaces split by **target** (uncommitted work / one PR / many PRs,
optionally Devin-authored / a session / a planning document) and by
**lineage** (Claude-internal personas / Codex / three-CLI council). The one
strict-subset pair is
`/codex:review` ⊂ `/council` — its single Codex lineage is subsumed by
council's three-CLI fan-out (question 2); every other pair overlaps without
one strictly containing another.

## Follow-up (out of scope here)

- Once ruled: sweep each entry point's `description:` frontmatter so trigger
  phrases match the ruling (same canonical-source→mirror discipline as
  `docs/solutions/code-quality/multi-doc-schema-rename-drift.md`).
- Wave 3 of the 2026-07-09 audit (deferred) holds the related persona
  retirement decisions: security-lens pairing, `test-coverage-analyst` /
  `git-history-analyzer` wiring, CLI-readiness reviewer retargeting.
