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

## Related Documentation

- `docs/solutions/code-quality/frontmatter-sweep-and-canonical-skill-drift.md` — adjacent but distinct: sweeps missing *sibling copies across plugins*, not a single-plugin split leaving satellites stale
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` — anti-pattern #30 (same PR #667): a JSON-example authoring defect found and fixed in the same review pass
