---
title: "A Pre-Populated 'ok' Status Survives an Abort That Just Proved It Wrong"
date: 2026-07-30
category: logic-errors
track: bug
problem: "Per-plugin results map pre-populated 'ok' before validation; loadPluginSources abort left it uncorrected for a plugin its own errors just named broken"
tags:
  [
    status-map-initialization,
    abort-path-reconciliation,
    ci-annotation-integrity,
    silent-false-positive,
    generate-manifests,
  ]
components:
  [
    scripts/generate-manifests.js,
    scripts/lib/generate/catalog-reader.js,
    tests/integration/generate-manifests.test.ts,
    tests/integration/generate-manifests-codex.test.ts,
  ]
---

## Problem

`generateManifests()` in `scripts/generate-manifests.js` builds a
per-plugin `result.results[name]` map (`'ok' | 'error'`) intended to give
CI a per-plugin annotation surface, distinct from the run's overall
`status`. Every entry is pre-populated `'ok'` for all of
`catalog.pluginOrder` before any validation runs. `loadPluginSources()`
(in `scripts/lib/generate/catalog-reader.js`) can abort the whole run with
`{ status: 'invalid', errors }` when one or more plugin source files are
missing, fail a path-containment check, are unreadable, or have a
non-object top-level shape. Before this fix, the abort call site did
nothing but `errors.push(...sourcesResult.errors); result.status =
'error'; return result;` — it never touched `result.results`, so every
plugin's entry, including the one(s) `loadPluginSources` had just named
broken in `errors`, stayed at its pre-populated `'ok'`.

A 12-reviewer `/review:pr` pass on PR #678 caught this as a P1 via two
independent empirical repros (correctness, reliability personas, both
confidence 100): construct a two-plugin catalog where one plugin's source
file is missing, run `generateManifests()`, and observe
`result.results['<broken-plugin>'] === 'ok'` even though
`result.errors` names that exact plugin as the reason the run failed.

## Symptoms

- `result.results[name]` reports `'ok'` for a plugin that
  `result.errors` simultaneously names as the cause of the abort — not
  merely "no information," but an affirmatively wrong claim.
- The bug is invisible in single-plugin-focused fixtures: a fixture that
  only exercises the one broken plugin correctly shows `status: 'error'`
  and the right message in `errors`, so a reviewer skimming
  `result.errors` alone sees nothing wrong. The lie only shows up when a
  fixture has a *second*, unrelated, valid plugin whose `results` entry
  should have stayed `'ok'` — the same entry the broken plugin
  incorrectly shares.
- The CI-annotation feature this map exists to serve was silently inert
  for this entire error class (missing source file, path-containment
  failure, unreadable/misshapen source file, non-object source) — a
  consumer reading `results` for "which plugin(s) failed" would miss
  every one of them when the run aborted at this specific gate.

## What Didn't Work

The map's implicit contract before this PR was "pre-populate optimistically,
and only the run's all-or-nothing `status` field is reliable near an
abort — per-plugin `results` entries are a best-effort bonus that callers
shouldn't lean on close to a gate." That contract quietly broke the first
time a *new* per-plugin-attributable failure class (`loadPluginSources`)
was added without also adding the reconciliation step for it: nothing in
the type of `result.results` or in review distinguished "pre-populated,
never revisited" from "confirmed 'ok' by an actual check." Both look
identical in the returned object.

## Solution

Two-part fix, both changes are in commit `bbba114e`:

**1. The producer names its own failures.** `loadPluginSources()` now
returns `badNames: string[]` on every `'invalid'` result — a `Set`
accumulated inline at each per-plugin error site inside the function
(missing on-disk source file, `assertWithinRoot` containment failure,
any non-`'ok'` `readJsonSource` result, non-object top-level value). The
one failure that is *not* plugin-attributable — `readdirSync` failing on
`catalog/plugins/` itself — correctly returns `badNames: []`, since no
specific plugin is implicated by that failure.

**2. The caller overlays before returning, not after.**

```js
// Bad (before) — silently drops the error's own attribution:
if (sourcesResult.status === 'invalid') {
  errors.push(...sourcesResult.errors);
  result.status = 'error';
  return result; // result.results[name] is still the pre-populated 'ok'
}

// Good (after) — overlay the implicated names before returning:
if (sourcesResult.status === 'invalid') {
  errors.push(...sourcesResult.errors);
  for (const name of sourcesResult.badNames) {
    result.results[name] = 'error';
  }
  result.status = 'error';
  return result;
}
```

Test assertions were added in `tests/integration/generate-manifests.test.ts`
mirroring the two-plugin repro directly: `expect(result.results['<broken>'])
.toBe('error')` alongside `expect(result.results['<clean>']).toBe('ok')`,
so a regression that drops the overlay (or over-corrects unrelated
plugins) fails a test, not just a review.

**Residual gap, not fully closed by this fix:** `'ok'` in this map still
only means "no attributed error was found before the run ended," not
"this plugin's later validation stages actually ran." If a *different*
plugin causes an abort at some other, later gate in the pipeline, plugins
whose later-stage checks were never reached still read `'ok'`. A P2
finding from the same review reproduced this directly (a real
path-containment escape in one plugin reported `'ok'` when a *different*
plugin failed an earlier package-validation gate first). A third
`'unchecked'` status, or a no-early-return redesign, was considered and
explicitly deferred — it conflicts with the pipeline's existing
all-or-nothing abort-gate design, and closing it was a deliberate scope
call, not an oversight. The current mitigation is an honest comment at
the top of `generateManifests()` spelling out exactly which error classes
are and aren't attributed, so a future reader doesn't infer more
completeness from `'ok'` than the code actually gives.

A related but separate finding from the same PR: 4 of 5 newly-wrapped
`assertWithinRoot` try/catch sites in this function are unreachable via
any valid catalog input today (plugin names are already `NAME_RE`-constrained
upstream by `loadCatalog`, and skill-tree target paths are
containment-checked inside `buildCodexSkillTree`). These were given an
explicit "unreachable by construction — defense-in-depth against a future
loosening of guard X" comment rather than being deleted or left silently
unexplained, so a future reviewer doesn't have to re-derive unreachability
from scratch or mistake the guard for dead code. Three existing
stale-artifact-sweep fixtures were also extended with
`expect(result.results[name]).toBe('error')`, but — read precisely — those
fixtures exercise the sweep loop's shared `sweepErrorsBefore`-delta
attribution mechanism, not any individual `assertWithinRoot` catch block
directly; every `assertWithinRoot` catch block in this file still has no
fixture that triggers it specifically.

## Why This Works

Attribution has to originate at the point of failure, not be reconstructed
by the caller from a generic error-string array. `badNames` makes
`loadPluginSources()` say, structurally, "these specific pluginOrder
entries are why I failed" instead of leaving `generate-manifests.js` to
guess from message text (which is exactly the kind of substring-parsing
this repo already treats as an anti-pattern elsewhere). Overlaying
`badNames` onto `results` *before* `return result` closes the gap because
it happens at the one place both facts — "the run is aborting" and
"these names are why" — are in scope together; deferring the overlay to
some later cleanup step would reopen the same class of gap for any
caller that reads `results` off an early return.

## Prevention

- Never pre-populate a status/results map with an optimistic default
  (`'ok'`) before the corresponding validation has actually run for that
  entry; if lazy/on-demand initialization isn't practical, use an
  explicit `'unchecked'`/`'pending'` sentinel and only promote an entry to
  `'ok'` at the point its checks truly pass.
- At every early-return/abort path in a function that also produces a
  per-item status map, grep for every place that map is written and
  confirm this specific abort site corrects the entries it implicates —
  don't assume a downstream gate will clean it up.
- Require producer functions to name their own failures structurally
  (`badNames: string[]`, not just prose in an `errors` array) so callers
  attribute the right entities without parsing error text.
- For every abort/early-exit branch, add a test that asserts the
  pre-populated default was overwritten for every implicated entity *and*
  left untouched for unrelated ones — a two-item fixture (one broken, one
  clean) is the minimum shape that can catch this; a single-item fixture
  cannot, because it can't distinguish "correctly flagged" from "would
  have wrongly stayed 'ok' next to a broken sibling."
- When a defensive try/catch or guard clause is provably unreachable
  under current invariants, don't delete it and don't leave it
  unexplained — add an explicit "unreachable by construction —
  defense-in-depth against future loosening of guard X" comment so future
  reviewers don't re-litigate whether it's dead code.
- Treat `'ok'` in a partially-attributed status map as "no attributed
  error observed by end of run," not "every stage executed" — if a
  pipeline has more than one sequential abort gate, explicitly document
  (or close) whether a later gate's abort can leave an earlier-declared
  `'ok'` misleading for entries whose later stages were never reached.

## Related

`docs/solutions/logic-errors/manifest-generator-value-shape-validation.md`
is the canonical lessons-learned doc for this same script (PR #644) but
covers a different bug class — value-shape validation gaps, not
status-map reconciliation on abort. A separate finding from a later PR
(#676, not yet merged to `main` as of this writing) documents
"a new outcome added to one producer falls through a downstream
closed-enumeration consumer's default branch" — a different mechanism
(missing enum slot in a *consumer*) that produces the same broad
consequence (a status field looks healthier than reality); this doc's
bug is about a *producer's own* pre-populated default never being
reconciled by its own abort path, not about a consumer's case list
falling short.
