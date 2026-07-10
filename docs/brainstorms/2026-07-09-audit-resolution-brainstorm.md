# Brainstorm: Resolving the 2026-07-09 Full-Marketplace Plugin Audit

**Note on process:** this brainstorm was run by an orchestrator agent inside a
multi-agent team with no live human to answer interactive questions. Every
call that would normally go through `AskUserQuestion` was instead decided
here with an explicit rationale, and surfaced again in "Open Questions for
Maintainer" with a recommended default. Nothing below is blocked on a
pending answer.

## What We're Building

Not new code — a **remediation plan for the plan**: how to sequence, batch,
and stack the fixes for the 5 broken findings, ~20 quality findings, and 2
coherence-gap docs produced by the 2026-07-09 audit of all 17 yellow-plugins
plugins, so that `/workflows:plan` (or direct implementation) can execute
against a settled structure instead of re-deriving one per PR.

Scope of this doc is the **HOW**, not the WHAT of each fix:
- What unit of work goes in one PR vs. split across PRs
- What order the stack lands in
- What gets fixed vs. deleted vs. documented-as-decided vs. deferred with a
  recommendation
- Which of the 4 decision-gated items get a default recommendation here
  vs. wait for the maintainer's own follow-up PR

This does not re-rank the audit's 18-item list (already ranked) and does not
specify file-level diffs (that's the implementation plan's job).

## Why This Approach

**Recommended: sequence by severity wave, cut PR boundaries by logical
fix-unit (root cause), not by plugin folder or theme label.**

Three ways to cut the stack were considered. The deciding constraint is
**fix-atomicity vs. changeset/versioning granularity** — does the PR
boundary follow where the bug's root cause lives, or where the file happens
to sit?

### Approach A: Strict per-plugin (mirrors the 2026-06-10 stack)
One branch per plugin touched, matching how the prior audit
(`docs/maintenance/plugin-audit-2026-06-10.md`) was remediated and mapping
1:1 to `pnpm changeset` + per-plugin version bumps.

**Pros:** Matches prior art exactly; reviewers and changesets stay scoped to
one plugin; easy to parallelize across agents/reviewers.
**Cons:** Shreds finding #1 (Codex flag-order bug) across 3+ plugins
(yellow-codex, yellow-review's silent-empty leg, yellow-council's copied
doc) — no single reviewer sees the whole failure story, and the canonical
SKILL.md-plus-copies problem re-drifts because each plugin's copy gets
fixed in isolation by a different reviewer pass.
**Best when:** Findings are already plugin-local with no cross-plugin root
cause — true for most of the quality-cluster items, false for finding #1.

### Approach B: Per-theme (all "broken" in one PR, all "quality" in another, etc.)
Batch by audit category label (BROKEN / QUALITY / COHERENCE).

**Pros:** Superficially simple; matches the audit report's own headings.
**Cons:** Bundles unrelated root causes into one diff (the Codex bug and the
ruvector timeout bug share nothing but a severity label) — this produces
oversized, low-cohesion PRs that are harder to review and to changeset
correctly (a plugin.json version bump touching 5 unrelated plugins in one
PR fights `validate:versions`' three-way sync model).
**Best when:** Findings are genuinely interchangeable in root cause and
low-risk — not the case here given finding #1's blast radius.
**Rejected** for this reason.

### Approach C (recommended): Sequence by severity wave, PR-per-logical-fix-unit
Default fix-unit = per-plugin (same as Approach A, and it still maps to one
changeset per plugin per PR for the ~15 findings that are genuinely
plugin-local). The one deliberate exception: **findings whose root cause
spans plugins stay in a single PR**, with a changeset entry per affected
plugin inside that one PR. Waves are ordered by risk/blast-radius, not
audit-list rank.

**Pros:** Preserves fix-atomicity for the one finding where it matters
(Codex), while keeping every other PR small and plugin-scoped like the
proven prior-art stack. Reviewers see the whole causal chain for
cross-plugin bugs instead of three partial diffs that individually look
complete.
**Cons:** Slightly harder to parallelize the cross-plugin PR across
multiple agents (one owner must hold the whole root cause); requires an
explicit call on which findings qualify as "spans plugins" (made below,
not left ambiguous).
**Best when:** A stack has a mix of isolated and cross-cutting bugs — which
is exactly this audit's shape (1 cross-cutting bug among ~24 isolated
findings).

## Key Decisions

### Stack sequencing (5 waves, in order)

**Wave 0 — Cross-cutting bug fix (blocks trustworthy review of everything after it).**
Finding #1 (Codex CLI flag-order bug) ships as **one PR** touching
yellow-codex (7 call sites + canonical `skills/codex-patterns/SKILL.md`)
and yellow-council (`skills/council-patterns/SKILL.md:317-319`), with one
changeset per plugin inside that PR. Rationale: `/review:pr`'s Codex leg is
currently silently swallowing findings — every subsequent PR in this stack
gets reviewed by a tool that's quietly broken until this lands first.
Fixing the auth-failure-masquerade mapping (exit 2 → "authentication
failed") is in scope here too, since it's the same root cause (wrong flag
position → wrong error code → wrong error message).

**Wave 1 — Trivial + security one-liners (low risk, fast, unblocks nothing else).**
- Finding #3: yellow-docs `doc-auditor.md` add `disallowedTools` (security
  scope-narrowing on a read-only agent — same pattern as the PR #255 sweep
  it was missed by).
- Finding #4: yellow-linear CLAUDE.md doc/code contradiction — fix the doc
  to match the code (env-var check only), not the reverse; per the
  canonical-source learning below, check whether this claim is restated
  elsewhere in yellow-linear before closing the finding.
- Finding #5: yellow-browser-test README dead link, one-line fix.
- Finding #2: yellow-ruvector hook timeout wrapper on
  `post-tool-use.sh`/`session-start.sh` (mirrors the pattern already
  applied to the two hardened siblings — copy their wrapper verbatim, per
  the frontmatter-sweep learning: paraphrasing a canonical pattern during
  copy re-introduces drift in the same PR that's supposed to fix it).

These four are independent root causes touching four different plugins —
either 4 small PRs or 1 PR with 4 changesets is acceptable; recommend 4
separate PRs since they have zero shared review context and independent
merge risk (default; not a hard requirement).

**Wave 2 — Validator hardening, coupled with the fixes it newly catches.**
Advisor-endorsed and adopted: **ship the validator change and the fixes for
sites it newly flags in the same PR**, not sequenced before/after. Harden
`validate-agent-authoring.js:370`'s `subagent_type` check to require ≥1
colon, which immediately reds on yellow-ci's bare `"runner-assignment"` and
all 6 yellow-browser-test Task call sites — fix those sites in the same PR.
The red→green transition inside one PR is the proof the hardened check
works; shipping the check alone first would just be a known-red CI state,
and shipping fixes first without the check gives no guarantee the next
author doesn't reintroduce the same gap.

**Wave 3 — Decision-gated quality items: resolve what's already decided, default the rest.**
Four items need a maintainer call; two of them are default-resolved here,
two get a recommendation only (see "Open Questions for Maintainer"):
- **yellow-mempalace stale doc counts: skip, don't polish.**
  `docs/memory-routing-protocol.md` (2026-07-01, Tier 2 C11) already
  recorded mempalace as deprecated pending removal. Fixing its stale
  tool-count prose (README 26 vs CLAUDE.md ~29 vs live 35) is throwaway
  work on a plugin already scheduled for deletion — explicitly cut from
  scope. The removal itself (marketplace.json + `setup/all.md` in the same
  change, per `validate-setup-all.js`, plus palace-data migration) is
  already tracked as its own follow-up per the routing-protocol doc; this
  audit doesn't need to re-open or re-schedule it, just confirm it's not
  accidentally bundled into a "doc drift sweep."
- **yellow-core orphaned agents ∩ yellow-docs duplicate: group, don't
  treat as 2 separate findings.** `yellow-core/agents/review/security-lens.md`
  is simultaneously one of the 3 orphaned-agent findings AND the
  duplicate-half of the yellow-docs `security-lens-reviewer.md` pair.
  Retiring the yellow-core copy (if that's the maintainer's wire-vs-retire
  call) resolves both findings in one action instead of two. Recommend
  this pairing be evaluated together in the same follow-up PR regardless
  of which direction the maintainer picks.
- Remaining two (orphaned-agent wire-vs-retire direction for the other 2
  agents; CLI-readiness reviewer retarget-vs-rewrite) are genuine
  product/architecture calls this brainstorm should not pre-empt — deferred
  to their own follow-up PR, each with a recommended default below.

### Fix vs. delete vs. document, applied to the doc-drift tail

Per the canonical-source-drift learning surfaced in the Phase 0b pre-pass
(`docs/solutions/code-quality/multi-doc-schema-rename-drift.md`): several of
the ~20 quality findings are the *same* fact restated in multiple places
(root README plugin/MCP-server counts, yellow-research's Ceramic omission
in both README and marketplace.json description, the 6-skill SKILL.md
heading drift). Batching these into **one sweep PR, landing last (Wave 4)**
is the right call — it has no dependencies on anything else in the stack,
is the lowest-risk change class, and doing it in one pass lets a single
author designate one canonical source per fact instead of fixing the same
count in one file and missing its two other restatements (the exact
failure mode the prior-art doc describes, independently caught by 3
reviewers + Greptile on that earlier PR).

**Hard constraint carried into this sweep, from repo memory:** hand-edit
only. Do NOT run `pnpm format` / Prettier over `plugins/**.md` as part of
this sweep — it reflows folded/wrapped text and silently truncates
single-line frontmatter `description:` fields
(`docs/solutions/code-quality/prettier-description-wrap-silent-truncation.md`).

The SKILL.md three-heading drift (6 skills + yellow-core's
`create-agent-skills`, which teaches the rule and doesn't follow it) rides
in the same Wave 4 PR — same class of "restated/violated convention," same
low risk, and the frontmatter-sweep learning applies directly: grep for
every skill matching the pattern before calling the sweep complete, not
just the 6 the audit happened to name, since sweeps of this shape have
previously and silently skipped structurally-equivalent siblings.

### Coherence-gap docs (review-routing, research-connector overlap)

Both are **net-new documents**, not fixes, modeled directly on
`docs/memory-routing-protocol.md` (which itself opens with "this records a
maintainer decision... deliberately NOT decided by the implementer" — the
same posture these two need). Treat each as its own deliverable:

- **Review-surface routing doc**: five entry points (gt-workflow
  smart-submit's 3-agent audit, `/review:pr`'s 16-persona pipeline,
  `/council`, `/codex:review`, `/devin:review-prs`) have zero
  cross-documentation today. This is a maintainer-decision doc (which
  surface is authoritative for what, how they hand off), not something an
  implementer should infer — draft the trigger-routing table structure
  (mirroring the routing-protocol's table) but leave the actual routing
  decision to the maintainer, same posture the memory doc modeled.
- **Research-connector overlap doc**: bundled Tavily/EXA vs. claude.ai
  connectors — yellow-composio's three-prefix pattern
  (`commands/composio/setup.md:65-73`) is the in-repo model to copy
  structurally, not necessarily the same routing logic.

Both are lower urgency than Waves 0-2 (nothing else in the stack depends on
them) but are the highest-value structural output of the audit — recommend
scheduling them as their own PRs after Wave 4, not squeezed into a fix PR.

### Graphite / changeset mechanics (repo-mandated, not a choice)

Every PR above that touches `plugins/` needs: `gt branch create` per PR (not
per-plugin blanket branch), `pnpm changeset` committed in the same PR,
`pnpm validate:schemas` plus the focused validator matching the change
(`validate:agents` for Wave 0/2, `validate:setup-all` for any mempalace
removal or plugin add/remove), and `gt stack submit` — never raw
`git push`/`gh pr create`. The mempalace-removal follow-up specifically
must update `marketplace.json` and `yellow-core/commands/setup/all.md` in
the same change or `validate-setup-all.js` fails the PR.

## Open Questions for Maintainer

These are the calls this brainstorm deliberately did not make (or made
provisionally) because they're product/architecture decisions, not
sequencing mechanics. Each has a recommended default so the downstream plan
isn't blocked waiting for an answer.

1. **Orphaned yellow-core agents (`test-coverage-analyst`, `git-history-analyzer`,
   and `security-lens` jointly with its yellow-docs duplicate) — wire or
   retire?** Known/deferred since the 2026-06-10 audit; still undecided.
   *Recommended default: retire `security-lens` from yellow-core in favor of
   the yellow-docs copy (resolves 2 findings at once per the pairing noted
   above); wire `test-coverage-analyst` and `git-history-analyzer` into an
   existing dispatcher only if a concrete caller is identified in the
   follow-up PR's own research — otherwise retire them too rather than
   leave them permanently orphaned.*
2. **CLI-readiness reviewer pair — retarget dispatch triggers or rewrite
   methodology?** The methodology (CLI framework source detection) and the
   only dispatch triggers (plugin-authoring markdown globs) never
   intersect. *Recommended default: retarget the dispatch triggers to
   actual CLI source paths — cheaper than rewriting a working methodology,
   and the mismatch looks like a trigger-authoring oversight rather than a
   deliberate design choice.*
3. **Mempalace removal timing** — already decided as "pending removal,
   follow-up plan" per the routing-protocol doc. *Recommended default: this
   audit's contribution is just "don't bundle its doc-drift into Wave 4";
   no new timing decision needed here.*
4. **yellow-linear/yellow-devin Devin V3 glue duplication** — dedupe into a
   shared implementation or document the divergence as intentional?
   *Recommended default: document the divergence explicitly (it's already
   diverged on `--tags`/`--max-acu` and comment-scan vs. session-title-scan)
   rather than force a risky merge of two already-different
   implementations; revisit true dedup only if a third consumer appears.*
5. **yellow-browser-test agent-browser version bump (0.10.0 → 0.31.1)** —
   out of scope for this remediation stack entirely; flagged by the audit
   as needing CLI-surface re-verification before any bump, which is
   larger-scoped work than a fix PR. *Recommended default: track as a
   separate, un-sequenced follow-up, not part of this stack.*
