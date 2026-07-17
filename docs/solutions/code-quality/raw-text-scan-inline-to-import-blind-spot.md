---
title: 'Raw-Text Regex Scanners Silently Lose Coverage on Inline-to-Import Refactors'
date: 2026-07-17
category: code-quality
track: knowledge
problem: 'Moving literal codes/strings from an inline source into an imported file drops them from a raw-text-regex lint with zero error'
tags:
  - lint-authoring
  - regex-scanning
  - refactoring-safety
  - error-codes
  - validation-architecture
  - plan-authoring
components:
  - scripts/lint-error-codes.js
  - packages/domain/src/validation/errorCatalog.ts
---

# Raw-Text Regex Scanners Silently Lose Coverage on Inline-to-Import Refactors

## Context

Found while expanding the plan for `claude-code-codex-plugin-pilot-02-codex-tooling`
(adding a new `ERROR-DIST-*` error-code family). `scripts/lint-error-codes.js`
builds its reference set of "protected" error codes by reading
`packages/domain/src/validation/errorCatalog.ts`'s **raw file text** and
regex-matching `ERROR-[A-Z]+-\d+` literals into `catalogCodes`. It then flags
any `scripts/*.js` file that hard-codes one of those same literal strings, as
catalog re-implementation drift (see the script's own header comment: the
repo intentionally runs two parallel validation stacks — hand-rolled
`scripts/*.js` and the AJV-based `packages/` library — and this lint is the
tripwire that keeps `scripts/` from silently re-implementing codes that
already live in the canonical catalog).

The plan under expansion needed to source the new `DIST-*` codes from an
**imported** `error-codes.json` file rather than inlining them as string
literals directly in `errorCatalog.ts`. That refactor would make the
`DIST-*` code strings disappear from `errorCatalog.ts`'s raw text, dropping
them out of `catalogCodes` — silently shrinking the lint's protection set,
with no error, warning, or test failure. A `scripts/*.js` file could then
hard-code `'ERROR-DIST-003'` with zero lint protection, exactly the failure
mode the lint exists to prevent.

## Guidance

Before changing a canonical data source from inline-literal representation
to an import/re-export, grep the repo for any tool that builds its reference
set by **regex-scanning that source file's raw text**, as opposed to
importing its exported values. Import-based re-exports do not preserve
literal-string presence in the raw text of the importing file, so any
text-scanning tool silently loses exactly the entries that moved — even
though the values are still reachable at runtime through the import.

The only guard `lint-error-codes.js` has against this is a
`catalogCodes.size === 0` check, which fails loudly on a *complete* wipeout
of the catalog file but says nothing about a *partial* shrink — one code
family disappearing while others remain untouched is exactly the
inline-to-import scenario, and it passes the guard silently.

## Why This Matters

The failure mode is invisible: the lint still exits 0 and prints a
smaller-but-plausible "no violations found among N codes" message, so
nothing in CI output signals that N just dropped. The set of codes the lint
actually protects has silently shrunk, defeating the tripwire's purpose for
exactly the codes that were most recently touched — the ones most likely to
still be under active development elsewhere in the same PR/plan.

## When to Apply

Any time a plan or PR migrates a canonical data source (error catalogs,
config schemas, feature-flag tables, enum lists, permission lists, etc.)
from inline literals to an import, a generated file, or an external
reference, check whether any tool in the repo does **raw-text/regex
scanning** (rather than importing exported values) of that same source
file. Two mitigations, in order of preference:

- Extend the scan to cover both the old and new locations (e.g. widen a
  single-file `CATALOG` constant to an array of scan targets).
- If the total count is expected to stay stable or grow, assert a count
  floor instead of only `size === 0` — a floor check catches partial shrinks
  that a non-zero check does not.

## Examples

- `scripts/lint-error-codes.js`'s `CATALOG` constant names exactly one file
  (`packages/domain/src/validation/errorCatalog.ts`) and regex-scans its raw
  text for `ERROR-[A-Z]+-\d+` literals.
- The plan's fix (verified against
  `plans/claude-code-codex-plugin-pilot-02-codex-tooling.md`, Step 6):
  extend `CATALOG` to an array covering both `errorCatalog.ts` and the new
  `packages/domain/src/validation/error-codes.json`, so the `DIST-*` codes
  remain part of the scanned set after the migration — caught during plan
  expansion, before implementation, by reading the lint script's source
  directly rather than relying on a survey subagent's prose summary of it.

## References

- `scripts/lint-error-codes.js`
- `packages/domain/src/validation/errorCatalog.ts`
- `plans/claude-code-codex-plugin-pilot-02-codex-tooling.md` (Step 6, R14)
