# Feature: Neutral Catalog Generation Foundation

## Overview

Everything downstream of the Codex pilot hangs off a neutral catalog layer
that can regenerate the existing Claude distribution artifacts byte-for-byte
before any Codex target exists. This plan introduces the catalog sources for
all 17 plugins, the generator engine with its apply/check/dry-run contract,
the byte-identity proof, the catalog-track CI guard (closing the known Q3
release gap), and the live-Codex spike whose recorded findings the three
plugin-port shells consume instead of re-deriving external contract facts.

## Origin

- Spec: `plans/specs/claude-code-codex-plugin-pilot.md`
- Covers: R1, R2, R3, R4, R8, R9, R13, R17, R18, R44, R39 (partial:
  pr1-delivery), R43 (partial: claude-generator-tests)
- Shell: claude-code-codex-plugin-pilot-01-neutral-generation

## Pattern Survey

- **Serialization contract (byte-identity target):**
  `JSON.stringify(obj, null, 2) + '\n'` — exactly as `scripts/sync-manifests.js:164,198`.
  Key order in every plugin.json: `$schema, name, version, description,
  author, homepage, repository, license, keywords, [outputStyles],
  [userConfig], [mcpServers], [hooks], [dependencies]` ($schema always first;
  17/17 have it; corrected post-implementation — five manifests carry
  `userConfig` between `outputStyles` and `mcpServers`, per
  `scripts/lib/generate/emit-claude.js`). `repository` is a bare string in plugin.json (object form only in root
  package.json) — preserve per-plugin as-is. Marketplace root:
  `$schema, name, description, owner{name,url}, metadata{description,
  version: "1.1.0"}, plugins[]`; per entry `name, description, version,
  author{name}, source, category`. `metadata.version` is a third version knob
  (neither root package.json 2.0.4 nor plugin versions) — model it as a
  catalog.json field.
- **Helper conventions:** `scripts/lib/` is plain CJS (scripts/ is NOT a pnpm
  workspace member), `'use strict'` + flat `module.exports`; validation
  helpers take a shared `errors` array + `addError` from
  `scripts/lib/logging.js`; `scripts/lib/marketplace-reader.js` returns a
  discriminated-union `{status: 'ok'|'missing'|'invalid', ...}` — the
  precedent for a catalog reader. `assertWithinRoot`
  (`scripts/sync-manifests.js:36`) and `atomicWrite` (`:44`) are lift-verbatim
  candidates; `scripts/catalog-version.js:42-51` duplicates `atomicWrite`
  (de-dup opportunity).
- **Characterization template:**
  `tests/integration/validate-plugin-characterization.test.ts` — in-process
  `require` of the script, `quietValidate` console-spy pattern, `it.each`
  over real plugins, `toMatchSnapshot()` into `__snapshots__/`. For
  exit-code-sensitive CLI modes, the subprocess harness pattern in
  `tests/integration/helpers/validator-harness.ts` (`execFileSync` returning
  `{status, stdout, stderr}`). Vitest discovers `tests/integration/*.test.ts`
  with no config change.
- **Q3 mechanics:** `.github/workflows/version-packages.yml` "Detect phase"
  (`id: detect`) computes `v${rootVersion}` and silently sets
  `run_changesets=false` when the tag exists and no changesets are pending —
  that silent-skip is the gap. Root package.json is only ever bumped by
  `scripts/catalog-version.js` (manual); `.changeset/config.json` has
  `fixed: []`, `linked: []`, and ignores the `@yellow-plugins/*` packages.
  `release:check` = `validate:schemas && validate:versions &&
  validate:doc-counts && typecheck` — the natural chain point for the guard.
- **Changeset rule:** the `changeset-check` CI job exits 0 when no
  `plugins/*` files changed (CONTRIBUTING.md "Not required for... scripts/")
  — this PR must touch no `plugins/*` file (byte-identity implies zero
  manifest diffs), so no changeset.
- **CI paths:** `validate-schemas.yml` `pull_request.paths` and `push.paths`
  are hand-maintained allowlists — `catalog/**` must be added to both. CI
  matrix wiring of a `generated` target is deliberately deferred to shell 02
  (R10/R16).
- **Spike doc home:** `docs/research/<date>-<slug>.md` (H1 + bold metadata
  lines, no YAML frontmatter; the `validate-solutions.js` frontmatter gate is
  scoped to `docs/solutions/` only).
- **Anti-patterns to design against** (docs/solutions/): `--check` must fail
  while ANY diff remains, not merely when diffs stop changing
  (`iterate-until-clean-loop-stop-condition.md`); match inventory by explicit
  name keys, never glob counts (`structured-filename-glob-counting-bugs.md`);
  no `$(cat file)` inline substitution in any shell wrapper
  (`cat-file-argmax-inline-substitution-antipattern.md`). No in-JSON
  "generated" marker: both manifest schemas set `additionalProperties: false`,
  so drift enforcement lives entirely in `--check` (the
  `sync-shell-snippets.js --check` / `validate:snippets` precedent,
  `package.json:27-28`), plus a `catalog/README.md` pointer
  (`api/cli-contracts/README.md` is the README-in-a-JSON-source-dir
  precedent).

## Implementation

- [x] Step 1: Baseline characterization capture — create
  `tests/integration/generate-manifests-characterization.test.ts` that reads
  `.claude-plugin/marketplace.json` and all 17
  `plugins/*/.claude-plugin/plugin.json` as raw UTF-8 and pins them via
  `toMatchSnapshot()` (one `it.each` over plugin names), committing
  `__snapshots__/` BEFORE any generator code exists (R4 "captured before the
  generator lands"). Reuse the console-spy quieting pattern from
  `validate-plugin-characterization.test.ts:46-57`.
- [x] Step 2: Author `catalog/catalog.json` — marketplace identity (`name`,
  `description`, `owner`), `metadata.description` + `metadata.version`
  (currently `"1.1.0"`), the exact 17-plugin canonical order as an array, and
  per-target presentation defaults (Claude block now; Codex defaults —
  displayName `Yellow Plugins`, category `Developer Tools`, policy
  `installation: AVAILABLE` / `authentication: ON_INSTALL` — as inert data
  consumed by shell 02) (R1).
- [x] Step 3: Author `catalog/plugins/<name>.json` for all 17 plugins
  (filename = exact `name` field, `plugins/<name>/` precedent): shared
  metadata (description, author, homepage, repository bare-string, license,
  keywords), Claude component fields verbatim (outputStyles, mcpServers,
  hooks, dependencies where present, `$schema` pointer value), marketplace
  entry fields (category, source `./plugins/<name>`), and target enablement
  `{"claude": true, "codex": false}`. NO `name`/`version` keys —
  package.json stays sole authority (R2, R3).
- [x] Step 4: Add `catalog/README.md` declaring catalog/ the source of truth
  and that `.claude-plugin/marketplace.json` + `plugins/*/.claude-plugin/plugin.json`
  are generated (regenerate: `pnpm generate:manifests`; drift check:
  `pnpm validate:generated`).
- [x] Step 5: Create `scripts/lib/generate/write.js` — lift `atomicWrite` +
  `assertWithinRoot` verbatim from `scripts/sync-manifests.js:36-53`, export
  both plus `serializeJson(obj)` returning
  `JSON.stringify(obj, null, 2) + '\n'` (R8).
- [x] Step 6: Create `scripts/lib/generate/catalog-reader.js` —
  `loadCatalog()` and `loadPluginSources()` returning discriminated-union
  results (`marketplace-reader.js` precedent), enforcing the
  `^[a-zA-Z0-9_-]+$` name allowlist, `assertWithinRoot` containment,
  rejecting symlinked source files (`openSync(..., O_NOFOLLOW)`) (final source files only —
  symlinked parent/ancestor directories are followed; hardening deferred
  alongside the documented atomicWrite/.tmp and package.json symlink P3s),
  and cross-checking catalog order entries against `catalog/plugins/*.json`
  by explicit name key both directions (R1, R2; glob-counting anti-pattern).
- [x] Step 7: Create `scripts/lib/generate/emit-claude.js` — pure builders
  `buildPluginManifest(source, pkg)` (emits the exact key order from the
  Pattern Survey, omitting absent optional fields) and
  `buildMarketplace(catalog, sources, pkgs)` (entry order = catalog.json
  canonical order); no timestamps or environment-dependent content anywhere
  (R4, R8).
- [x] Step 8: Create `scripts/generate-manifests.js` — CLI entry exporting
  `generateManifests({mode})` for in-process tests. Modes: default apply
  (atomic writes); `--check` computes every target's serialized bytes vs the
  committed file and exits nonzero while ANY difference remains, performing
  zero writes; `--dry-run` prints the same diff report and exits 0 (R9).
- [x] Step 9: Refactor `scripts/sync-manifests.js` to delegate to the shared
  helpers (import `atomicWrite`/`assertWithinRoot`/`serializeJson` from
  `scripts/lib/generate/write.js` and regenerate manifests via
  `generateManifests`), preserving its CLI flags (`--dry-run`/`--verify`) and
  log wording so `pnpm apply:changesets` (`changeset version && node
  scripts/sync-manifests.js`) keeps working unchanged; de-dup
  `scripts/catalog-version.js:42-51`'s copy of atomicWrite to the same import
  (R9).
- [x] Step 10: Wire `package.json` scripts:
  `"generate:manifests": "node scripts/generate-manifests.js"` and
  `"validate:generated": "node scripts/generate-manifests.js --check"` as
  standalone entries (chaining into `validate:schemas`/`release:check` and
  the CI matrix `generated` target are shell 02's R10/R16 — do not wire here).
- [x] Step 11: Q3 guard — create `scripts/validate-catalog-track.js` with a
  pure comparison core `computeTrackViolations({pluginVersionsAtTag,
  pluginVersionsAtHead, rootVersionAtTag, rootVersionAtHead})` (exported for
  unit tests) plus a git shell (`git show
  v<rootVersion>:plugins/<n>/package.json`) that fails when any plugin
  version changed since the last catalog tag while root package.json did not
  advance. Plain prefixed error messages for now — migration to
  `ERROR-DIST-*` codes happens in shell 02 when the R14 registry lands (R13).
- [x] Step 12: Wire the Q3 guard — append
  `&& node scripts/validate-catalog-track.js` to `release:check` in
  `package.json`, and add a guard step in
  `.github/workflows/version-packages.yml`'s Detect phase (the "nothing to
  do" else-branch) so "plugins changed but catalog didn't" is distinguished
  from "legitimately nothing changed"; ensure the job has the `fetch-depth: 0`
  the tag comparison needs (R13).
- [x] Step 13: Add `catalog/**` to BOTH the `pull_request.paths` and
  `push.paths` allowlists in `.github/workflows/validate-schemas.yml`
  (mirror the existing list style; no other path additions).
- [x] Step 14: Generator behavior tests —
  `tests/integration/generate-manifests.test.ts` covering: byte-identity
  (generated output === committed bytes for marketplace + all 17 manifests);
  determinism (two consecutive runs byte-equal); inventory/order (a
  catalog-order entry with no source file, and a source file missing from
  the order, both fail by name); path traversal (malicious `name` in a temp
  catalog rejected); symlinked source rejected; malformed source JSON →
  clean structured error; stale-artifact detection (`--check` nonzero after
  mutating a committed manifest in a temp copy, and again on a second
  distinct mutation — any-diff-remains semantics); `--check` performs no
  writes (file bytes + mtimes unchanged); `--dry-run` exit 0. Use in-process
  `generateManifests` for builders and the `validator-harness.ts`
  `execFileSync` pattern for `--check`/`--dry-run` exit codes (R43 partial:
  claude-generator-tests).
- [x] Step 15: Q3 guard tests — unit-test `computeTrackViolations` pure
  function in the same integration test file or a sibling
  `tests/integration/validate-catalog-track.test.ts` (no live git fixtures;
  the git shell is exercised by `release:check` at HEAD → exit 0).
- [x] Step 16: Live Codex spike — with codex-cli (currently 0.144.1; use
  latest available) and Claude Code 2.1.211 in a temp `CODEX_HOME` and a
  throwaway fixture plugin, empirically record: (a) how arguments reach a
  Codex skill (no `$ARGUMENTS` primitive documented — capture the working
  pattern); (b) the scriptable plugin-list surface (`codex plugin list
  --help`; does `--available --json` exist?); (c) the exact
  `agents/openai.yaml` field for non-implicit skill invocation; (d)
  manifest hook-path override acceptance for `"hooks":
  "./hooks/codex-hooks.json"`; (e) `claude plugin validate` + clean-install
  acceptance of a file-referenced `mcpServers` (`"./.mcp.json"`); (f)
  whether Claude's validator now accepts a string file path for `hooks`
  (Feb 2026 inline-only re-test). Record all six + the CLI version verified
  against (provenance only, latest-CLI is the support target) in
  `docs/research/2026-07-16-codex-plugin-contract-spike.md` (H1 + bold
  metadata lines, no YAML frontmatter) (R17).
- [x] Step 17: Delivery — `sed -i 's/\r$//'` every new file; run the full
  Verification list; confirm `git status` shows NO changes under `plugins/`
  or `.claude-plugin/` (byte-identity, R18) and that any pre-existing
  untracked files are untouched (R44); `gt branch create
  agent/feat/codex-pilot-01-neutral-generation`, commit, `gt submit
  --no-interactive` as the stack base. Tooling-only PR — no changeset
  (confirmed by the changeset-check job's plugins/-only trigger) (R39
  partial: pr1-delivery).

## Verification

- `pnpm generate:manifests` then `git status --porcelain` -> expected: empty
  (regeneration produces zero diffs = live byte-identity proof, R4/R18).
- `pnpm validate:generated` -> expected: exit 0 on a clean tree; after
  temporarily mutating one committed manifest, exit nonzero naming the file;
  no file writes in either case (verify mtimes) (R9).
- `node scripts/generate-manifests.js --dry-run` -> expected: diff report,
  exit 0 (R9).
- `pnpm vitest run tests/integration/generate-manifests-characterization.test.ts tests/integration/generate-manifests.test.ts` -> expected: all pass (R4, R43).
- `node scripts/validate-catalog-track.js` -> expected: exit 0 at HEAD;
  unit tests for `computeTrackViolations` cover the failing combinations
  (R13).
- `pnpm apply:changesets` dry sanity: `node scripts/sync-manifests.js
  --dry-run` -> expected: unchanged log wording, exit 0 (R9).
- `pnpm validate:schemas && pnpm validate:versions && pnpm test:unit && pnpm
  test:integration && pnpm lint && pnpm typecheck` -> expected: all green.
- `docs/research/2026-07-16-codex-plugin-contract-spike.md` exists with all
  six findings + verified CLI version recorded (R17).

## Context Files

- `scripts/sync-manifests.js` — source of `assertWithinRoot`/`atomicWrite`
  (lines 36-53), serialization contract (164, 198), version-collection loop;
  refactor target.
- `scripts/catalog-version.js` — duplicated atomicWrite to de-dup; the only
  writer of the root catalog version the Q3 guard protects.
- `scripts/validate-versions.js` — existing three-way drift check the
  catalog layer must not disturb.
- `scripts/lib/logging.js`, `scripts/lib/marketplace-reader.js` — helper +
  discriminated-union conventions for new `scripts/lib/generate/` modules.
- `.claude-plugin/marketplace.json` + `plugins/*/.claude-plugin/plugin.json`
  — the 18 byte-identity targets and the field/key-order inventory the
  catalog sources must reproduce.
- `tests/integration/validate-plugin-characterization.test.ts`,
  `tests/integration/helpers/validator-harness.ts` — test templates.
- `.github/workflows/version-packages.yml` — Detect-phase Q3 guard call
  site; `.github/workflows/validate-schemas.yml` — paths allowlists.
- `docs/maintenance/catalog-release-gap.md` — Q3 definition (note: its
  version figures are stale vs HEAD root version 2.0.4).
- `package.json` — scripts block (generate:manifests, validate:generated,
  release:check chain).
- `plans/specs/claude-code-codex-plugin-pilot.md` — requirement text for
  every R-id in Origin.
