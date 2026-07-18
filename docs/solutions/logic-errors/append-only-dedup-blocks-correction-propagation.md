---
title: 'Seeded-corpus + similarity-dedup designs block corrections from ever propagating'
date: 2026-07-17
category: logic-errors
track: bug
problem: 'A near-duplicate dedup threshold on an append-only store with no delete-by-id means a corrected source doc can never overwrite its own stale entry'
tags: [dedup, append-only, mcp, seeding, data-model, design-gap]
components: [plugins/yellow-ruvector/commands/ruvector/seed-solutions.md]
---

## Problem

`/ruvector:seed-solutions` seeds `ERROR-FIX:` entries into ruvector's
recall store from `docs/solutions/` and is designed to be safely
re-runnable: a near-duplicate similarity check (score > 0.82) skips
re-storing an entry whose text already exists, so repeat runs after new
docs land don't inflate the store with copies.

That same dedup check has an unintended side effect: when an
already-seeded doc's fix text is later **corrected** (a follow-up review
round finds the original fix was wrong or incomplete, and the doc is
edited in place), re-running the seed command does not update the stored
entry. Either the corrected text still scores above 0.82 similarity
against the stale entry and gets skipped, or — if the wording changed
enough to drop below threshold — it gets stored *alongside* the stale
one, and recall now has two entries for the same error signature, one of
them wrong.

## Root cause

Two independent constraints compound:

1. **The store is append-only with similarity-based dedup**, not
   identity-based. Entries are matched by how similar their *text* is,
   not by a stable key tying an entry back to the source doc + section it
   came from. There is no way to ask "is there already an entry seeded
   from this specific doc" — only "is there already an entry whose text
   looks like this."
2. **The MCP surface has no delete-by-id.** Even if the stale entry could
   be identified, `hooks_remember`/`hooks_recall` (the tools
   `seed-solutions.md` is scoped to) expose no operation to remove or
   replace a specific stored entry. `brain_delete` exists on the MCP
   surface but operates on named brain partitions, not individual
   recall-store entries, and is out of scope for a plugin command using
   only the `hooks_*` tools.

Because corrections can't propagate in place, the only honest remediation
is out-of-band: quiesce every ruvector process, edit
`.ruvector/intelligence.json` directly to drop the stale `ERROR-FIX:`
entries (or do a full store re-import), then re-seed fresh.

## Why this is easy to miss

The dedup check does exactly what it was built for — preventing duplicate
entries on ordinary re-runs — and that's the case most testing exercises.
The correction-propagation gap only shows up on the second and later times
a *specific* seeded doc's content changes, which is rare enough in a
single PR's testing window to go unnoticed. It surfaced here only because
a follow-up review round corrected a doc that had already been seeded
earlier in the same session.

## Prevention / generalization

Any design combining a **seeded corpus** (bulk-imported from an external
source of truth, like `docs/solutions/`) with **similarity-based dedup**
(rather than identity-based) on an **append-only store** (no delete/update
by key) needs an explicit replace-by-identity story *before* the first
correction happens — not after. Options, in increasing order of
complexity:

- Tag each seeded entry with a stable identity key (e.g. the source doc's
  path + a content hash) so a re-seed can detect "this doc changed since
  last seeded." Identity tagging is detection-only — it flags the stale
  entry but cannot remove it; removal still requires a delete/update
  primitive on the store or the documented out-of-band reset.
- If the store truly has no delete/replace primitive reachable from the
  tools in scope, document the out-of-band remediation path explicitly
  (as `seed-solutions.md` now does) rather than letting users discover
  the limitation when a recalled fix turns out to be the stale one.
- Don't rely on similarity-dedup as a substitute for identity tracking —
  it solves "don't duplicate," not "keep this entry in sync with its
  source."

## References

- `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md` Step 7
  ("Correction-propagation limitation") — the inline note this doc
  generalizes from.
- PR #647 follow-up review thread (fix commit `28a685de`).
