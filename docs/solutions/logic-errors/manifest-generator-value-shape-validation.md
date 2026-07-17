---
title: 'Manifest generator: value-shape validation, mutate-then-apply tests, self-distinguishing guards'
date: 2026-07-16
category: logic-errors
track: bug
problem: 'Catalog generator validated key presence only; malformed author/target values silently corrupted or dropped generated output'
tags: [validation, generate-manifests, catalog, determinism-testing, silent-failure]
components:
  [
    scripts/generate-manifests.js,
    scripts/lib/generate/emit-claude.js,
    scripts/lib/generate/catalog-reader.js,
    scripts/validate-catalog-track.js,
  ]
---

## Problem

`scripts/generate-manifests.js` and its `lib/generate/*` helpers build
`plugins/<name>/.claude-plugin/plugin.json` and the root
`marketplace.json` from `catalog/plugins/<name>.json` source files.
`validateSource()` checked that fields like `author` and `targets` were
*present*, never that their values had the right *shape*. Three review
personas (type-design, pr-test-analyzer, silent-failure-hunter) independently
found variants of the same root cause during a 17-persona `/review:pr` pass
on PR #644 (codex-pilot shell 01, "neutral catalog generation foundation").

## Symptoms

- A string-shaped `catalog/plugins/<name>.json` `"author": "Some Person"`
  passed `'author' in source` and silently emitted `"author": {}` into
  `marketplace.json` — no schema in the repo rejects an empty object there.
- A typo'd `"targets": {"claude": "true"}` (string, not boolean) passed the
  same presence check and silently excluded the plugin from generation —
  `source.targets.claude !== true` evaluates truthy-mismatch for the string
  `"true"` too, so the plugin just vanishes with a clean "all files match"
  run. Worst case: a brand-new catalog entry with no committed baseline to
  diff against, so nothing flags the drop.
- `catalog.json` itself was dereferenced by `buildMarketplace` /
  `buildPluginManifest` without checking its top-level keys existed first,
  so a malformed `catalog.json` either threw a raw `TypeError` or silently
  dropped keys downstream.
- The determinism test suite for `generateManifests()` proved apply-mode
  and `atomicWrite`'s real write path were **never exercised** — the only
  "apply" test copied an already byte-identical fixture tree, so the first
  apply was a no-op by construction and would pass even if drift
  correction were completely broken.
- `scripts/sync-manifests.js`, which ships the write-path behavior this PR
  changed, had zero test coverage.
- `scripts/validate-catalog-track.js`'s `tagExists` — a guard built
  specifically to catch a silent-skip class of bug (Q3 in
  `docs/maintenance/catalog-release-gap.md`) — caught *any* `git
  rev-parse` failure in its own `catch` block and treated it as "tag not
  cut yet," reproducing inside the guard the exact silent-skip failure
  mode it exists to prevent.

## What Didn't Work

- Checking `'author' in source` / `'targets' in source` — presence checks
  say nothing about whether the value is well-formed, and for **newly
  generated files there is no committed baseline diff to catch the
  malformed output** (the reason this was scored P1, not P2).
- A determinism test built by copying an already up-to-date fixture tree
  and re-running apply — byte-identical-in/byte-identical-out proves
  idempotency, not correction. It never forces the code down the
  "detected drift, rewrote the file" branch.
- `catch (_) { tagExists = false }` around `git rev-parse` — collapses
  "ref legitimately doesn't exist yet" and "git failed for an unrelated
  reason (corrupt repo, permissions, wrong cwd)" into the same silent
  fallback.

## Solution

**Value-shape validation** (`scripts/lib/generate/emit-claude.js`,
`scripts/generate-manifests.js`): `validateSource()` now requires `author`
to be `typeof === 'object'`, non-null, with a string `.name`, and
`targets.claude` / `targets.codex` to be `typeof === 'boolean'` — a
malformed value fails the `check`/`apply` run with a named error instead
of flowing through. A single `isClaudeEnabled(source)` predicate replaces
two independently-drifting inline checks (one in `generate-manifests.js`'s
per-plugin loop, one in `buildMarketplace`), so the two lists can no
longer diverge from each other.

**Catalog-level validation** (`scripts/lib/generate/catalog-reader.js`):
`loadCatalog()` now checks `REQUIRED_CATALOG_KEYS` (`name`, `description`,
`owner`, `metadata`, `pluginOrder`, `targets`) exist before any downstream
emitter dereferences them, plus that `targets.claude.marketplaceSchema` is
a string — same principle as the source-level check, applied one level up.

**Mutate-then-apply determinism tests**
(`tests/integration/generate-manifests.test.ts`): a new test mutates one
committed target file (`"MIT"` → `"Apache-2.0"`), runs
`generateManifests({ mode: 'apply' })`, and asserts both that
`result.written` contains the corrected path and that the file bytes are
restored. That is the only way to prove the apply/`atomicWrite` write
path, not just its no-op case. A parallel subprocess suite for
`scripts/sync-manifests.js` was added via a shared
`GENERATE_MANIFESTS_ROOT` env hook (the script is top-level code with no
exports, so it is driven as a subprocess against a temp fixture tree,
matching the existing `generate-manifests.test.ts` pattern).

**Self-distinguishing silent-skip guard**
(`scripts/validate-catalog-track.js`): `tagExists`'s catch now treats only
`git rev-parse -q --verify`'s exit status `1` as "ref doesn't exist yet"
(the one legitimate skip condition); any other exit status prints stderr
and exits 1 loudly. `readVersionsAtTag`'s catch was narrowed the same
way — only a stderr match for `does not exist|exists on disk, but not
in` is treated as "no package.json at that tag," everything else
re-throws.

Two related P2s landed in the same commit but don't need their own
lessons here: `catalog-version.js` now calls the already-extracted
`serializeJson()` instead of duplicating its
`JSON.stringify(pkg, null, 2) + '\n'` contract inline, and
`generate-manifests.js`'s apply-error path now logs which targets were
already rewritten before the failure. Two other P2s were deferred by
plan, not fixed in this commit: a CI byte-identity gate for the
bot-authored Version Packages PR (deferred to codex-pilot shell 02,
R10/R16) and `sync-manifests.js`'s version-only drift loop duplicating
`SEMVER_RE` validation (kept intentionally, revisit only if its
log-wording contract is relaxed).

## Why This Works

Key-presence checks (`'field' in obj`) and loose truthiness checks
(`!source.targets || x !== true`) both silently accept malformed values —
they were written to catch *missing* fields, not *wrong-shaped* ones, and
nothing forced a review of what happens when the field is present but
malformed. Explicit `typeof`/shape checks close that gap. Similarly,
`catch (_) { defaultValue }` around a subprocess call silently merges
every failure mode into the one the author had in mind when writing the
catch; narrowing to the *specific* condition that legitimately should
fall back (exit code, stderr text) and re-throwing everything else is
what makes a guard actually guard.

For tests: a determinism suite that only feeds already-correct fixtures
into "apply" and checks nothing changed proves stability under a no-op,
not correctness of the write path. A mutate-then-apply test is the
minimum bar for claiming a drift-correction code path is covered.

## Prevention

- When validating an external or generated input's fields, ask "what
  happens if this key is present but has the wrong type or shape?" — not
  just "what happens if it's missing?" This matters most for **newly
  created** generated artifacts, where there is no committed baseline
  diff to catch a malformed value after the fact.
- Any test claiming to cover "apply mode" or "drift correction" must
  start from a fixture that is deliberately stale/wrong and assert the
  file changed — a byte-identical-copy fixture only proves the no-op
  path.
- A guard built specifically to prevent a silent-skip bug must itself
  distinguish "the expected-absent condition" from "an unrelated
  failure" in its own error handling, or it reproduces the exact bug
  class it exists to catch.
- See also `docs/maintenance/catalog-release-gap.md` (Q3, resolved in
  this PR) and `docs/research/2026-07-16-codex-plugin-contract-spike.md`
  (sibling research doc from the same PR, not duplicated here).

## Update — 2026-07-16 (second review round, same PR)

A second `/review:pr` pass on the same diff (four personas: correctness,
adversarial, architecture, silent-failure-hunter — independently converged,
P1) found a **third occurrence of the exact bug class this doc describes**,
in the same function the first round had just hardened.
`validateSource()` (`scripts/generate-manifests.js:49`) checked `author` and
`targets` for value-shape (this doc's original Problem), but a third
unconditionally-dereferenced field in the same function —
`source.marketplace` — was still gated by a bare truthy check
(`if (source.marketplace) { ... }`). A `null` or primitive
(`"marketplace": "oops"`) value passed straight through: `null` is falsy so
the block was silently skipped (no error, no crash — the exact "vanishes
cleanly" failure mode), and a truthy primitive like a non-empty string
would have entered the block and crashed on `key in source.marketplace`
(`TypeError: Cannot use 'in' operator`).

**Why the first pass missed it:** the first round's finding and fix were
scoped to the two fields review comments had specifically named
(`author`, `targets`). Nothing in that pass's process asked "does this
function have any *other* unconditionally-dereferenced fields?" —
`validateSource()`'s only value-shape-hardened field left unaudited was
found by a second, independent review round on the same file, not by
re-reading the function's own field list.

**Fix** (mirrors the existing `targets` guard exactly):

```js
if ('marketplace' in source && source.marketplace !== null && typeof source.marketplace === 'object') {
  for (const key of ['category', 'source']) {
    if (!(key in source.marketplace)) {
      errors.push(`catalog/plugins/${name}.json: missing required key "marketplace.${key}"`);
    }
  }
} else if ('marketplace' in source) {
  errors.push(`catalog/plugins/${name}.json: "marketplace" must be an object`);
}
```

Plus two regression tests: a `null` marketplace (would have silently
skipped validation) and a primitive marketplace (would have thrown inside
`validateSource` itself, before any of its own error-collection logic
runs).

**Generalized lesson — the one this update adds:** when a review finding
identifies one value-shape bug in a function, the fix scope must be "audit
every field this function unconditionally dereferences," not "fix the
field(s) named in the finding." A guard sweep that stops at the reported
instances leaves siblings of the same bug in the same function for a
*later* review round to catch — which is exactly what happened here. The
practical check: for any function doing presence/shape validation, list
every key you see referenced past a truthy/presence check
(`source.X`, `source.X.Y`, `for (const k of [...]) source.X[k]`) and
confirm each one has an explicit `typeof`/`null` guard before the fix is
considered complete — not just the ones a reviewer already named.
