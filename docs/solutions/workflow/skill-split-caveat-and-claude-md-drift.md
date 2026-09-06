---
title: "SKILL.md Split Leaves Reference Caveats and Plugin CLAUDE.md Stale"
category: workflow
track: bug
problem: 'Splitting a SKILL.md into references/*.md drops a host-specific caveat from a sibling reference and leaves plugin CLAUDE.md describing pre-split mechanics'
tags: [skill-authoring, skill-split, references, claude-md-maintenance, codex-host-notes, gt-workflow, documentation-drift]
date: "2026-07-27"
components:
  - plugins/gt-workflow/skills/gt-cleanup/references/worktree-cleanup-offer.md
  - plugins/gt-workflow/codex/skills/gt-cleanup/references/worktree-cleanup-offer.md
  - plugins/gt-workflow/CLAUDE.md
---

# SKILL.md Split Leaves Reference Caveats and Plugin CLAUDE.md Stale

## Problem

`gt-cleanup`'s `SKILL.md` was split into a main file plus several
`references/*.md` sidecars (mechanics moved out to keep the top-level file
short). Two satellites of that split were left stale, caught in the same PR
(#667) by different reviewer sets:

1. **The Codex host-note carve-out didn't travel with the mechanics it
   modifies.** `SKILL.md` Phase 4 carries a Codex-specific caveat (an
   `AskUserQuestion` fallback / "on Codex, `worktree:cleanup` is not
   Codex-exposed — skip the Skill invocation" note). One reference file
   restated it; `references/worktree-cleanup-offer.md` — reachable from two
   separate control-flow paths (the normal cleanup-summary path and the
   dry-run/nothing-to-clean exit) — did not. An agent that reached Phase 6
   through `worktree-cleanup-offer.md` without ever reading the file that
   carried the caveat had no way to know it applied.
2. **`plugins/gt-workflow/CLAUDE.md` was not updated in the same change
   that restructured the skill.** Its Testing section still claimed all of
   `gt-cleanup`'s deterministic bash lived in `SKILL.md`, when flag parsing
   and branch classification stayed there but the batch-cap-15 review
   queue, the `gt get` conflict-stop path, and the `gt delete` not-tracked
   fallback had moved to `references/actionable-categories.md`. Its
   generated-artifacts enumeration also omitted the new
   `codex/skills/<name>/references/*.md` class entirely.

## Symptoms

- A reference file whose own content depends on a caveat defined elsewhere
  in the skill, with no restatement of that caveat and no cross-reference
  pointing back to where it lives.
- A plugin's `CLAUDE.md` describing "where mechanics live" in terms that
  predate the most recent structural change to the skill it documents.
- `CLAUDE.md`'s enumeration of generated/authored file classes missing a
  category the split just introduced.

## What Didn't Work

Relying on cross-file recall — assuming a maintainer or agent reading one
reference file will remember (or go look up) a caveat stated only in a
sibling file they may never open, because both files are independently
reachable entry points into the skill's control flow.

## Solution

1. **Inline the caveat in every reference file whose prompts or control
   flow it modifies**, not just the first one split out. If a host-specific
   note changes how a reference file's own instructions should be
   interpreted, restate it (even briefly, with a pointer back to the
   canonical source in `SKILL.md`) directly in that file:

   ```markdown
   The host note in SKILL.md Phase 4 (Codex AskUserQuestion fallback)
   applies to the prompt below — and on Codex, the `worktree:cleanup`
   skill is not Codex-exposed: skip the Skill invocation and go directly
   to the graceful-degradation message instead of attempting it.
   ```

   Applied to both the source (`plugins/gt-workflow/skills/gt-cleanup/`)
   and generated Codex copy (`plugins/gt-workflow/codex/skills/gt-cleanup/`)
   of `references/worktree-cleanup-offer.md`.

2. **Update the plugin's `CLAUDE.md` in the same change that restructures a
   skill.** Re-derive the Testing bullet from the actual post-split file
   layout (which bash lives in `SKILL.md` vs. which reference file), and
   add the new generated-artifact class
   (`codex/skills/<name>/references/*.md`) to the enumeration, rather than
   leaving it for a follow-up PR.

## Why This Works

Each reference file is an independently reachable entry point — multiple
control-flow paths can land on either one without passing through the
other. Duplicating the caveat removes the single point of failure that
cross-file memory represents; the reader never needs to have seen the
sibling file for the caveat to apply. Treating `CLAUDE.md` as part of the
same commit as the split (not deferred documentation) prevents the
description of "where mechanics live" from drifting out of sync with the
code the moment the code's shape changes — the gap is caught by review
immediately instead of silently persisting until someone notices the doc
disagrees with the file tree.

## Prevention

- [ ] When splitting a `SKILL.md` into `references/*.md`, list every
      host-specific or caveat sentence in the original file and confirm it
      appears in **every** reference file whose prompts or control flow it
      modifies — not just the first reference file split out.
- [ ] Any PR that adds, removes, or moves skill files must update the
      plugin's `CLAUDE.md` in the same commit — regenerate the "where
      mechanics live" and "generated artifacts" bullets from the actual
      post-change file layout instead of leaving them for a follow-up.
- [ ] When multiple P2 findings in one review describe "documentation (or
      a caveat) didn't travel with the code it describes" across different
      files, treat it as one recurring pattern worth compounding once
      (this doc), not independent one-off fixes — the 2-file recurrence
      here (a reference file and a `CLAUDE.md`) is what elevated it above
      the "P2, don't bother" bar.

## Update — 2026-09-05

### Same cascade, but from trimming a root doc rather than splitting a skill

PR #746 (trim root `CLAUDE.md` to a "gotchas" format; rewrite `AGENTS.md`
authoring rules as bare facts) reproduced this pattern's failure mode
without touching a skill file at all — cutting an always-loaded doc down
for concision dropped the qualifying context that made several of its
claims true, and multi-agent review caught 8 resulting defects across
`CLAUDE.md`, `AGENTS.md`, and one `SKILL.md` in a single pass:

1. **Overclaimed validator coverage (P1).** The trim compressed "RULE 15d
   applies to SKILL.md `description:` fields, warning-tier only" down to
   an unqualified "RULE 15d governs agent descriptions" — but
   `scripts/validate-agent-authoring.js`'s RULE 15d check lives only
   inside `validateSkillFiles` (confirmed: `grep -n "RULE 15d"
   scripts/validate-agent-authoring.js` returns hits only in that
   function, invoked only for `SKILL.md`). The trimmed sentence now
   claims CI coverage for agent/command descriptions that does not exist
   — the single most dangerous class of drift from this pattern, because
   an agent trusting the doc has no way to know the enforcement claim is
   false without reading the validator source itself.
2. **Internal self-contradiction from clause compression (P2).** "Branch
   counts are floors, not ceilings" and "do not spawn agents a skill does
   not specify" were merged into one sentence, but the merge makes them
   read as mutually exclusive rather than as two independent rules
   (floors → never fewer; the second rule → never *extra*, unspecified
   agents). Trimming for word count merged clauses that needed to stay
   separately scoped.
3. **A step whose target was itself trimmed into non-existence (P2).**
   "Run the focused validator for your change" pointed at a discoverable
   list of focused validators that the same trim removed, and a
   "hand-edit `.claude-plugin/marketplace.json`" instruction survived the
   trim after a separate change made that file fully generated from
   `catalog/` — the trimmed doc now instructs the reader to violate the
   generation pipeline it documents elsewhere in the same file.
4. **Dropped non-derivable gotchas (P2).** The Codex two-way version
   check and the WSL2 CRLF solution-doc pointer are exactly the kind of
   fact this doc's own Prevention section (below) says can't be
   recovered by reading the code — they were cut anyway because the trim
   pass optimized for line count, not for which sentences were load-bearing
   vs. restatable.
5. **A hardcoded path that only resolves inside this repo, shipped in a
   template meant for consumer projects** (`plugins/yellow-core/skills/
   create-agent-skills/SKILL.md:201`) — the same class of defect as this
   doc's original finding #1 (a caveat that doesn't travel with the
   context it depends on), but here the failure is a repository-relative
   path baked into template prose instead of a caveat left off a sibling
   file.

## Prevention (addendum)

- [ ] Before trimming an always-loaded doc (`CLAUDE.md`, `AGENTS.md`) for
      concision, classify every sentence being cut or compressed as
      derivable-from-code (safe to cut) vs. non-derivable gotcha (must
      survive, even if reworded) — see the original Prevention checklist
      below for the split-file version of this same triage.
- [ ] Any claim of the form "rule X is enforced by validator Y" must be
      checked against the validator's actual call graph
      (`grep -n '<rule tag>' <validator file>`) before or immediately
      after a trim — trims compress qualifying scope words ("only for
      SKILL.md", "warning-tier only") first, because they're the words
      that look most cuttable.
- [ ] When two independent rules get merged into one sentence during a
      trim, re-read the merged sentence in isolation and ask whether it
      still permits both rules' original edge cases — clause compression
      is a distinct failure mode from clause deletion and needs its own
      check.

## Related Documentation

- `docs/solutions/code-quality/frontmatter-sweep-and-canonical-skill-drift.md` — adjacent but distinct: sweeps missing *sibling copies across plugins*, not a single-plugin split leaving satellites stale
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` — anti-pattern #30 (same PR #667): a JSON-example authoring defect found and fixed in the same review pass
- `docs/solutions/code-quality/api-migration-stale-documentation-cascade.md` — sibling pattern: a primary-pattern change leaves secondary docs stale, generalized in its own 2026-09-05 update to any near-duplicate prose sweep; this doc's 2026-09-05 update covers the inverse trigger (cutting for concision, not migrating a pattern)
