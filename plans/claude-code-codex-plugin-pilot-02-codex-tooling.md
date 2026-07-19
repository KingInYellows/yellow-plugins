# Feature: Codex Tooling, Validators, and CI

## Overview

With the neutral catalog proven byte-identical for Claude (PR1, merged as
\#644), this shell adds the entire Codex-target toolchain while the Codex
marketplace stays empty: the Codex emitters, repository-pinned schemas, the
exposure lint, target-aware version validation, the ERROR-DIST JSON registry
that finally bridges the ESM/CJS error-code wall, Ubuntu+Windows
install-verification CI, and retirement of the legacy TypeScript marketplace
validation path. Landing all gates before any plugin enables Codex means the
first enablement (yellow-core, shell 03) is validated by machinery that
already exists.

## Origin

- Spec: `plans/specs/claude-code-codex-plugin-pilot.md`
- Covers: R5, R6, R7, R10, R11, R12, R14, R15, R16, R20, R45, R39 (partial:
  pr2-delivery), R43 (partial: codex-generator-tests)
- Shell: claude-code-codex-plugin-pilot-02-codex-tooling

## Pattern Survey

- **Generator reuse is near-total.** `scripts/lib/generate/write.js`
  (`assertWithinRoot`, `atomicWrite`, `serializeJson`, `NAME_RE`) and
  `scripts/lib/generate/catalog-reader.js` (`loadCatalog`,
  `loadPluginSources`, discriminated-union `{status:'ok'|'missing'|'invalid'}`)
  need zero modification — a new `emit-codex.js` imports them as-is, mirroring
  `emit-claude.js`'s pure-builder shape (`buildPluginManifest`,
  `buildMarketplace`, `isClaudeEnabled`).
- **`targets.codex` must widen from boolean to object.** Shell 01 committed
  `catalog/plugins/<name>.json` with `"targets": {"claude": true, "codex":
  false}` (verified in all 17 files) as an interim placeholder. The spec's own
  Design section says the Codex order is computed by "filtering catalog.json's
  canonical order by `targets.codex.enabled`" (spec line ~308) — i.e. the
  spec's authoritative design already assumes an object shape. This shell
  migrates all 17 files' `codex` value from `false` to `{"enabled": false}`
  (mechanical, value-only; no plugin flips to `enabled: true` here, so Claude
  emitter output — which never reads `targets.codex` — is untouched and R4
  byte-identity holds) and adds the sibling optional fields R2 always intended
  (`interface.{displayName,category}`, `description` override,
  `skillAllowlist`, `componentPaths.skills`), populated only when a later
  shell (03/04/05) actually enables a plugin.
- **`catalog.json`'s marketplace-level Codex defaults already exist** —
  `targets.codex.{displayName,category,policy.{installation,authentication}}`
  is already committed (shell 01 step 2) and is what `buildCodexMarketplace`
  reads for the marketplace-wide fields; only per-plugin `targets.codex` needs
  the migration above.
- **Schema filenames are spec-fixed, not discretionary**: `schemas/
  catalog.schema.json`, `schemas/catalog-plugin.schema.json`, `schemas/
  codex-plugin.schema.json`, `schemas/codex-marketplace.schema.json`,
  `schemas/codex-hooks.schema.json` (spec Design section, "Schemas (R11)").
  The MCP shape R11 mentions is a property inside `codex-plugin.schema.json`
  (no 6th file is named). Provenance convention: `schemas/
  official-marketplace.schema.json:8`'s `$comment` field is the one existing
  precedent for "mirrored/derived, diverges intentionally, preserve on
  re-sync" — every new schema's `$comment` should read "repo-derived from the
  July 2026 Codex contract, not an official OpenAI schema" per R11, following
  that exact pattern rather than inventing new phrasing.
- **AJV fixture-test convention**: `tests/integration/
  example-files-schema.test.ts` is the template — `new AjvValidatorFactory()`
  \+ `factory.loadSchemaFromFile(name, path)` + `factory.validate(name,
  data).valid`, fixtures under `examples/`, `it.each`-style discovery by
  filename prefix, dedicated negative-case `describe` blocks (see its
  "tightening — negative cases" block, lines ~176-220). A Codex sibling test
  file should mirror this shape exactly rather than reuse `SchemaValidator`
  (which is the AJV factory's higher-level, marketplace/plugin-specific
  wrapper being partly retired below).
- **ERROR-DIST registry is a genuine first**, and its exact home + semantics
  are spec-fixed (Design section "Error registry"):
  `packages/domain/src/validation/error-codes.json` (plain JSON);
  `errorCatalog.ts` imports and re-exports typed constants (`tsconfig.base.json`
  already sets `resolveJsonModule: true`); CJS scripts `readFileSync` the same
  file directly (data read, not a module import — sidesteps the ESM/CJS wall
  entirely, unlike the SOL/PLAN/SETUP string-concatenation workaround at
  `errorCatalog.ts:76-124`, which exists precisely because no shared-JSON
  option existed before now — do not replicate that workaround for DIST).
  Codes: DIST-001 malformed catalog source; DIST-002 inventory/order
  mismatch; DIST-003 generated-artifact drift; DIST-004 invalid generated
  manifest; DIST-005 unsupported surface exposed to Codex; DIST-006 hook
  contract violation; DIST-007 Windows/path portability failure; DIST-008
  MCP/auth configuration failure.
- **Real coverage gap in `scripts/lint-error-codes.js`** (must be closed in
  this same change, not deferred): `CATALOG` (line ~31) points only at
  `errorCatalog.ts` and its `CODE_PATTERN` regex-scans that one file's raw
  text (lines 66-68). Once `errorCatalog.ts` re-exports DIST codes from
  `error-codes.json` via `import` rather than inlining literal strings, the
  literal `ERROR-DIST-*` text disappears from `errorCatalog.ts`'s source, so
  `catalogCodes` silently stops including the DIST family and a `scripts/*.js`
  file could hard-code `'ERROR-DIST-003'` with zero lint protection. Fix:
  widen `CATALOG` to a list of source files (`errorCatalog.ts` +
  `error-codes.json`) scanned for the same pattern.
- **R14's substring-collision lint is spec-mandated as a lint, not a
  rename — and "DIST vs existing DISC" is illustrative, not a case the
  lint must reject.** `DIST` is not a substring of `DISC` nor vice versa
  (they share a 3-char common prefix `DIS` but differ in the 4th
  character). An earlier pass at this plan added a second rule — flag any
  two equal-length prefixes differing in exactly one character (Hamming
  distance 1) — specifically to make DIST/DISC trip the check, reasoning
  that R14's named example must be a case the lint rejects. Implementing it
  proved that reading wrong: R14 ships both "ERROR-DIST-001..008 defined"
  and "a passing registry-level lint" from this same shell, and a check
  that flags DIST/DISC can never pass while the DIST family exists — an
  impossible-to-satisfy state, caught empirically (the lint script itself
  went red) and confirmed via a second advisor call rather than silently
  reverting without re-checking. Corrected resolution: substring
  containment ONLY. Under that rule DIST/DISC correctly pass (neither
  contains the other) — the only reading consistent with shipping both
  deliverables. R14's parenthetical names DIST/DISC to confirm the lint
  does NOT false-positive on this deliberately-chosen, substring-safe near
  miss, not to demand its rejection. Current prefixes
  (`errorCatalog.ts:24,56-59`: SCHEMA, COMPAT, INST, DISC, PERM, NET, SOL,
  PLAN, SETUP) plus the new DIST — verified no pair in this set collides
  under the substring rule; a hypothetical `DIS` prefix (substring of both
  DISC and DIST) is the genuine collision case the lint guards against.
- **R16's unpinned Codex CLI is spec-mandated, not an oversight** — despite
  every other external tool in `.github/workflows/*.yml` being version-pinned
  (`ajv-cli@5.0.0`, `bats@1.11.0`), R16 explicitly says "install the latest
  generally-available Codex CLI at run time (no pinned version), so drift
  against new CLI releases surfaces in CI." No repo OS-matrix precedent
  exists yet (grepped all 7 workflow files for `windows-latest`/`macos-latest`
  — zero hits); the new Windows job is GitHub-hosted (`windows-latest`) since
  no self-hosted Windows pool exists in the `runs-on:` ternary used elsewhere.
- **CI matrix wiring point**: `.github/workflows/validate-schemas.yml`'s
  `validate-schemas` job (line ~53) has `matrix.target: [marketplace, plugins,
  contracts, examples, solutions, authoring, plans]` dispatched via a bash
  `case` (lines ~111-247) inside the single "Run schema validations" step —
  `codex` and `generated` are new case arms in the same job/step, per the
  spec's Design section. The Ubuntu+Windows Codex install-verification jobs
  (R16) are functionally different (they install a live CLI and exercise
  install/list, not `ajv validate`) and belong in a **separate new job**, not
  a `matrix.target` arm, since they need `codex` on PATH and a temp
  `CODEX_HOME`, and may need a timeout budget beyond the existing 2-minute
  critical-path SLO (R16 explicitly allows this).
- **Legacy retirement is scoped narrowly by R45 itself** — not full
  `packages/cli` retirement (grepped: nothing outside `packages/cli` itself
  references `pnpm cli`/`@yellow-plugins/cli`, and `packages/cli` is still
  wired into root `tsconfig.json`/`typedoc.json`/`.changeset/config.json`,
  none of which shell 02's `Produces` mentions touching). Concrete removal
  set, verified directly:
  - `packages/infrastructure/src/validation/validator.ts`: the
    `validateMarketplace()` method (~lines 105-120) and the `marketplace`
    schema load inside `initialize()` (~lines 79-83) — but **keep** the
    `plugin` schema load, since `validatePluginManifest` stays.
  - `packages/domain/src/validation/types.ts:61-62`: `IValidator` declares
    `validateMarketplace(data: unknown): DomainValidationResult;` — remove
    from the interface too, or `SchemaValidator implements IValidator` stops
    compiling.
  - `packages/cli/src/index.ts`: the `validate`/`validate:marketplace`
    branch (lines ~28-51) and those two names from the allowed-`command`
    list; `validate:plugins`'s print-only branch stays as-is.
  - `schemas/marketplace.schema.json` — the nested `schemaVersion`/
    `marketplace`/`plugins` shape, confirmed distinct from the CI-gating
    `schemas/official-marketplace.schema.json`; delete outright.
  - `packages/infrastructure/src/validation/validator.test.ts` — confirmed it
    only exercises `validateCompatibility`; no test references
    `validateMarketplace`, so no test deletion is needed, only a scan to
    confirm that stays true after the edit.
  - `packages/infrastructure/src/validation/README.md:88,134,224` — three
    `validator.validateMarketplace(...)` usage examples become stale
    documentation the moment the method is removed; update in the same PR.
- **PR1 already merged to `main`** (#644) — this shell branches fresh from
  `main` via `gt branch create agent/feat/codex-pilot-02-codex-tooling`, not
  stacked on an unmerged PR1 branch.
- **Spike findings this shell must honor** (`docs/research/
  2026-07-16-codex-plugin-contract-spike.md`, codex-cli 0.144.1): (c)
  `agents/openai.yaml` is not parsed at all — do not build schema/emission
  logic around it (it belongs to shells 03-05's skill-delegation work, not
  this one). (d) `hooks/codex-hooks.json` path-override is accepted by the
  parser but hooks do not currently execute (`plugin_hooks` feature
  `removed`) — still emit the file per R20 (forward-compatible), and note in
  the emitter's header comment that execution is currently inert pending
  upstream. (f) Claude's live validator now accepts string-path `hooks`, but
  this repo's local `schemas/plugin.schema.json` deliberately keeps the
  inline-only constraint (R20) — do not loosen it.

## Implementation

- [x] Step 1: Migrate `targets.codex` from boolean to object across all 17
  `catalog/plugins/<name>.json` files: `"codex": false` → `"codex": {"enabled":
  false}`. Mechanical value-only change (Claude emitter never reads
  `targets.codex`, so `.claude-plugin/` byte-identity is unaffected) (R2
  follow-through, grounding for R5/R6/R7/R12). Also updated
  `scripts/generate-manifests.js`'s `validateSource`/new
  `validateCodexTarget` value-shape check to accept the widened object shape
  (was hardcoded to `typeof === 'boolean'` for both `targets.claude` and
  `targets.codex`, discovered when `pnpm generate:manifests` failed on all 17
  files after the migration) — verified `pnpm generate:manifests` reports "0
  rewritten" (Claude byte-identity holds) and `pnpm test:integration` is
  still 347 passed.
- [x] Step 2: Author `schemas/catalog.schema.json` and `schemas/
  catalog-plugin.schema.json` — formalize `catalog/catalog.json` and
  `catalog/plugins/<name>.json` shapes including the widened `targets.codex`
  object (`enabled`, optional `interface.{displayName,category}`, optional
  `description`, optional `skillAllowlist: string[]`, optional
  `componentPaths.skills`) sibling to the existing `marketplace` override
  block. `$comment` provenance per the `official-marketplace.schema.json:8`
  pattern (R11). Verified: both schemas compile under AJV strict mode
  (matching `AjvValidatorFactory`'s config), validate all 18 live catalog
  files (catalog.json + 17 plugin sources), and correctly reject 4 negative
  cases (missing `codex.enabled`, bare-boolean `codex`, incomplete
  `interface`, unknown top-level key).
- [x] Step 3: Author `schemas/codex-plugin.schema.json`, `schemas/
  codex-marketplace.schema.json`, `schemas/codex-hooks.schema.json` —
  required `name`, `interface.displayName`/`interface.category`, `version`;
  marketplace schema mirrors R5 (name `yellow-plugins`, version-less entries,
  policy defaults); hooks schema matches the `hooks/codex-hooks.json` shape
  emitted in Step 5. Same `$comment` provenance convention as Step 2 (R11).
  The marketplace per-entry shape (`source: {source: "local", path}`,
  per-entry `category`/`policy`) is grounded directly in the spike doc's
  "Incidental observations" (empirically verified, not guessed); the
  plugin-manifest and hooks-file shapes are best-effort/provisional per R11
  and flagged as such in each schema's `$comment`, pending the Step 15 live
  CI round-trip. All 3 compile under AJV strict mode; verified against 9
  hand-crafted positive/negative fixtures (empty-state marketplace, version
  rejected on entries, bare-string `source` rejected, inline-object `hooks`
  rejected on the plugin manifest, missing `interface.category` rejected,
  missing hook `command` rejected).
- [x] Step 4: Create `scripts/lib/generate/emit-codex.js` — pure builders, no
  I/O, mirroring `emit-claude.js`'s shape:
  - `isCodexEnabled(source)` → `Boolean(source.targets?.codex?.enabled) ===
    true` (single source-of-truth twin to `isClaudeEnabled`).
  - `buildCodexMarketplace(catalog, sources, pluginOrder)` → filters
    `pluginOrder` by `isCodexEnabled`, name `yellow-plugins`, `displayName`
    from `catalog.targets.codex.displayName`, per-entry `policy` from
    `catalog.targets.codex.policy`, no `version` field (R5).
  - `buildCodexPluginManifest(source, pkg)` → `name` from `pkg.name`,
    `version` from `pkg.version`, `interface.displayName`/`interface.category`
    from `source.targets.codex.interface`, `description` from
    `source.targets.codex.description ?? source.description` (R6). (Field
    path corrected to nest under `targets.codex`, matching Steps 1-2 — not a
    top-level `source.codex` — per advisor review before implementation.)
  - `buildCodexSkillTree(source, skillsDir)` → for each entry in
    `source.targets.codex.skillAllowlist`, copy `plugins/<name>/skills/<s>/`
    into
    `plugins/<name>/codex/skills/<s>/`, normalize frontmatter to `name` +
    single-line `description` only (strip Claude-only fields), reject
    symlinks (`O_NOFOLLOW`, reuse the `catalog-reader.js` pattern) and
    path-escaping skill names via `NAME_RE`, and exclude any skill not in the
    allowlist (R7).
  - `buildCodexHookConfig(source)` → emits the `hooks/codex-hooks.json` shape
    Codex-only; header comment notes hooks are currently inert per the spike
    finding (d) but emitted for forward compatibility (R20).
  - Generator hook-authority rule (R20): confirm and document (comment in
    `emit-claude.js`, unchanged) that the Claude emitter builds hook config
    solely from `source.hooks` (inline) and has no code path reading any
    `hooks/hooks.json` reference-only mirror (yellow-ci's documented pattern)
    — `buildCodexHookConfig` is the only producer of `hooks/codex-hooks.json`
    and is Codex-only.

  **Implementation note:** `buildCodexPluginManifest` takes a third
  `hookConfig` parameter (the `buildCodexHookConfig` result) so the
  manifest's `"hooks"` pointer field is only set when a non-null hooks
  object actually exists — `schemas/codex-hooks.schema.json` requires
  `minProperties: 1`, so an empty/absent-hooks plugin must neither get a
  `hooks/codex-hooks.json` file nor a dangling manifest pointer to one.
  `buildCodexSkillTree(rootDir, name, source)` does controlled I/O (unlike
  the other pure builders) since it must read N skill files to normalize
  them; returns the same discriminated-union shape as `catalog-reader.js`.
  Verified end-to-end against synthetic fixtures: marketplace/manifest/hook
  construction, skill frontmatter normalization (Claude-only fields like
  `user-invokable`/`allowed-tools` stripped, body preserved byte-for-byte),
  missing-description rejection, symlinked-skill rejection (`ELOOP` via
  `O_NOFOLLOW`), and path-escaping skill-name rejection (`NAME_RE`).
- [x] Step 5: Wire `emit-codex.js` into `scripts/generate-manifests.js`'s
  `generateManifests({mode, rootDir})` — for each Codex-enabled source,
  compute the same `targets.push({path, bytes})` entries the Claude path
  uses, so `apply`/`--check`/`--dry-run` cover Codex outputs uniformly with
  zero mode-specific branching. Commit the empty-state artifact
  `.agents/plugins/marketplace.json` with `plugins: []` (no plugin is
  Codex-enabled yet) as part of this step's initial `apply` run.
  `buildCodexSkillTree`'s `status: 'error'` propagates into the shared
  `errors` array (not silently skipped) before the write loop, matching the
  existing pkg-validation gating convention. Also tightened
  `schemas/catalog.schema.json` to require `targets.codex` (was optional,
  but `buildCodexMarketplace` dereferences `displayName`/`category`/`policy`
  unconditionally — advisor-flagged before it could reach `validate:codex`
  as a silent `undefined`). Fixed two existing-suite regressions this
  surfaced: `tests/integration/generate-manifests.test.ts`'s `TARGET_COUNT`
  (was `+1` for the Claude marketplace only, now `+2` for both marketplaces)
  and its `makeFixtureRoot()`/`targetPaths()` helpers (didn't know about the
  new `.agents/plugins/marketplace.json` target at all). Verified: `pnpm
  generate:manifests` creates the empty-state artifact once then reports "0
  rewritten" on a second run (idempotent); the artifact validates against
  `schemas/codex-marketplace.schema.json`; full `pnpm test:unit` +
  `pnpm test:integration` green (350 tests).
- [x] Step 6: Create `packages/domain/src/validation/error-codes.json` with
  `ERROR-DIST-001` through `ERROR-DIST-008` (semantics per Pattern Survey);
  update `packages/domain/src/validation/errorCatalog.ts` to `import` the
  JSON and spread the DIST entries into `ERROR_CODES` as typed re-exports
  (R14). Added `ErrorCategory.DISTRIBUTION` to `types.ts` and a matching
  entry in `getErrorCodesByCategory()`. Used the `with { type: 'json' }`
  import-attribute form (Node 24 / TS 5.9, confirmed working). Hit and fixed
  the exact friction the advisor predicted: `tsc -b` (composite/project-
  references mode) rejected the JSON file as "not listed within the file
  list of project" even though `include: ["src/**/*"]` glob-matches it —
  fixed by adding an explicit `"src/**/*.json"` entry to
  `packages/domain/tsconfig.json`'s `include` array. Verified on the real
  gates, not just `node`: `pnpm build` (all 3 packages), `pnpm typecheck`,
  `pnpm test:unit`, `pnpm test:integration` all green, plus a direct check
  against the built `dist/` output that all 8 DIST codes and the new
  `DISTRIBUTION` category resolve correctly.
- [x] Step 7: Widen `scripts/lint-error-codes.js`'s `CATALOG` constant to an
  array covering both `errorCatalog.ts` and the new `error-codes.json`,
  scanning both with the existing `CODE_PATTERN` regex so the DIST family
  stays covered by the anti-hardcoding check (closes the coverage gap
  identified in Pattern Survey; part of R14). Renamed to `CATALOG_FILES` and
  added a per-file (not just aggregate) empty-codes guard, since an
  aggregate `size === 0` check across 2 files wouldn't notice one file's
  contribution silently vanishing while the other still has codes — exactly
  the DIST migration scenario the coverage gap was about. Also corrected the
  header comment's stale claim that "the packages build emits CJS that
  scripts/ can require" (packages/domain is ESM-only; scripts/ genuinely
  cannot require() it — confirmed by the earlier survey). Verified: clean
  pass (49 codes across both files); a scratch script hard-coding
  `ERROR-DIST-001` is caught; wiping `error-codes.json` to `{}` fails loudly
  via the new per-file guard naming the exact file; full test suites green.
- [x] Step 8: Add the prefix-collision assertion — extend
  `scripts/lint-error-codes.js` to fail if any two category prefixes in the
  combined catalog are a literal substring of one another (R14). Added
  `findPrefixCollisions`, exported (with a `require.main === module` guard
  added to gate the CLI's `main()`) for unit testing. Went through one
  wrong turn: a first pass added a second, Hamming-distance-1 "near-miss"
  rule specifically to make `DIST`/`DISC` trip the check, per an earlier
  (incorrect) reading of R14's named example as a case the lint must
  reject — running it immediately proved that impossible (the lint can
  never pass while `ERROR-DIST-*` exists, contradicting R14 shipping both
  from this same shell). Reverted to substring-only per the corrected
  Pattern Survey entry above. Verified: clean pass (49 codes, `DIST`/`DISC`
  correctly do NOT collide); injecting a hypothetical `DIS` prefix (a real
  substring of both `DISC` and `DIST`) correctly reports 2 collisions;
  same-prefix codes and `DISCX`-contains-`DISC` cases behave correctly.
- [x] Step 9: Create `scripts/validate-codex.js` (`validate:codex`) —
  Codex-artifact validation (each Codex-enabled plugin's manifest/marketplace
  entry/hooks file against the Step 3 schemas) plus the exposure lint (R15):
  reject Claude-only tool names, slash-command syntax, `$ARGUMENTS`,
  `.claude/` writes, sibling-plugin paths, hard-coded `mcp__plugin_*` names,
  `userConfig`, output styles, agent references, and undeclared
  executables/MCP dependencies in any Codex-exposed skill or manifest.
  Registry-gate against the actual generated Codex output (never token
  shape — reuse the registry-gated, fence-aware pattern from
  `subagent-ref-registry-gated-fence-aware-checks.md`), scanning raw file
  content including fenced blocks. **Implementation note:** uses
  `require('ajv')`/`require('ajv-formats')` directly (plain CJS, mirroring
  `ajvFactory.ts`'s config) rather than `AjvValidatorFactory` — that class
  lives in ESM-only `packages/infrastructure`, unreachable from
  `scripts/*.js`, same wall Step 6/7 already worked around for error codes.
  Registry-gating is real for two checks (sibling-plugin paths, against
  actual `catalog.pluginOrder`; `mcp__plugin_*` names, against a registry
  built from every Claude-enabled plugin's actual committed `mcpServers`
  keys) and direct-pattern for the rest ($ARGUMENTS, `.claude/`,
  `userConfig`, `outputStyles`, `subagent_type`, slash-command syntax) since
  those have no legitimate Codex-exposed occurrence regardless of context.
  Verified end-to-end against synthetic fixtures: clean pass (0 findings);
  a schema violation (missing manifest `description`) and a bonus
  version-on-marketplace-entry violation both caught; all 8 exposure checks
  fire correctly in one combined fixture; a negative control confirms
  registry-gating avoids false positives on hypothetical/nonexistent
  plugin and tool mentions.
- [x] Step 10: Wire `pnpm validate:generated` (`node
  scripts/generate-manifests.js --check`, already covers Codex targets per
  Step 5) and `pnpm validate:codex` (`node scripts/validate-codex.js`) into
  `package.json` scripts, and chain both into `validate:schemas` and
  `release:check` (R10). Added both underlying commands directly to the
  `validate:schemas` chain (matching how every other check there is wired);
  `release:check` covers them transitively since it calls `pnpm run
  validate:schemas` first, so no separate direct entry is needed there.
  `validate:generated` already existed from shell 01; only `validate:codex`
  was new. Verified: full `pnpm validate:schemas` chain runs clean
  end-to-end (all prior checks + the two new ones); full test suites still
  green (350 tests).
- [x] Step 11: Make `scripts/validate-versions.js` target-aware (R12).
  **Deviation from the original plan, deliberate (advisor-reviewed):**
  rather than extracting the EXISTING Claude three-way logic into a pure
  core (risking a regression to previously-untested, working code for no
  functional gain), left it completely untouched in place and added two
  NEW pure, exported functions alongside it: `computeCodexTwoWayDrift`
  (package.json vs `.codex-plugin/plugin.json`) and
  `computeCodexMarketplaceIssues` (membership/name/order/path against
  `.agents/plugins/marketplace.json`, no version comparison since Codex
  marketplace entries carry none). Wrapped the whole script body in
  `main()` gated behind `require.main === module` (mechanical, so the new
  functions are `require()`-able for tests without executing the CLI).
  Verified zero regression: captured `pnpm validate:versions`,
  `--dry-run`, and `--plugin yellow-core` output on the clean tree BEFORE
  the refactor, confirmed byte-identical after. New functions verified
  directly: two-way drift (in-sync/mismatch/missing-manifest) and all 4
  marketplace-issue cases (missing entry, orphan entry, wrong order, wrong
  path) plus the empty case. Full `pnpm release:check` chain (includes
  `validate:versions` and `validate:catalog-track`) passes end-to-end.
- [x] Step 12: Add `examples/codex-plugin.example.json`, `examples/
  codex-marketplace.example.json`, `examples/codex-hooks.example.json`
  fixtures and a new `tests/integration/codex-schema-examples.test.ts`
  mirroring `example-files-schema.test.ts`'s `AjvValidatorFactory` +
  `loadSchemaFromFile` + prefix-discovery pattern, including a
  negative-case `describe` block per schema (mirroring the "tightening —
  negative cases" block). Confirmed no discovery collision with the
  existing test (its filter is `startsWith('plugin')`; the new files are
  `codex-*`). 18 tests: 3 positive-fixture + 1 discovery sanity check + 14
  negative cases across the 3 schemas (including the empty-state
  `plugins: []` marketplace shape and the version-less/string-hooks
  constraints). Full suites green (365 tests), `pnpm typecheck` and `pnpm
  validate:schemas` both clean.
- [x] Step 13: Generator tests (R43 partial: codex-generator-tests) — new
  sibling `tests/integration/generate-manifests-codex.test.ts` (self-
  contained minimal fixture builder, not the full 17-plugin repo fixture,
  for precise control over `targets.codex` per scenario) with all 6
  scenarios: Codex enablement filtering; empty-state marketplace
  (byte-identical on regeneration); path portability (skill names with
  spaces/backslashes/Windows-drive syntax rejected by `NAME_RE`); symlink +
  path-escape rejection (mirrors `catalog-reader.js`); the hook-authority
  case (decoy `hooks/hooks.json` on disk with different content than
  inline `hooks` — confirmed the generated output for BOTH targets matches
  `source.hooks`, never the decoy); and four-way version drift, scoped to
  the two NEW legs Step 11 added (`computeCodexTwoWayDrift`,
  `computeCodexMarketplaceIssues`) — the Claude-plugin leg and catalog-track
  leg already have dedicated coverage in this file's sibling and in
  `validate-catalog-track.test.ts` from shell 01, noted inline rather than
  duplicated. 8 tests, all passing on first run. Full suites green (373
  tests), `pnpm typecheck` clean.
- [x] Step 14: CI wiring, part A — add `codex` and `generated` entries to
  `.github/workflows/validate-schemas.yml`'s `matrix.target` list and the
  bash `case` statement (same job, same step, ~lines 111-247), running
  `pnpm validate:codex` / `pnpm validate:generated` respectively (R16).
  Case arms invoke the underlying `node scripts/...` commands directly
  (matching the `authoring`/`plans` arms' style, not `pnpm run`). Verified:
  `node -e` YAML.parse confirms both new matrix targets are present and the
  file parses correctly; `actionlint` reports zero findings on the new
  lines (all findings elsewhere in the file are pre-existing, unrelated);
  confirmed clean LF (no CRLF introduced by the Edit tool).
- [x] Step 15: CI wiring, part B — new `codex-install-verification` job
  (`ubuntu-latest` + `windows-latest` matrix, `shell: bash` default so one
  script serves both legs): installs the latest Codex CLI unpinned (`npm
  install -g @openai/codex`, per R16), adds the local marketplace via
  `codex plugin marketplace add`, asserts the empty-state artifact lists 0
  available pilots (`codex plugin list --available --json`), then derives
  the Codex-enabled plugin list from the live catalog and installs/verifies
  each (currently zero — a correct no-op, not a stub, since no plugin is
  Codex-enabled yet). 10-minute timeout budget, distinct from the 2-minute
  critical-path SLO. **Scope decision, documented in the job's own
  comments:** made **advisory-only** (deliberately NOT added to
  `ci-status`'s `needs` list) — mirrors `upstream-pins-advisory.yml`'s
  established non-blocking pattern for live/unpinned external-tool checks,
  so a transient upstream Codex CLI issue can't block unrelated PRs.
  **Honesty gap, documented rather than papered over:** WSL/UNC path forms
  are NOT fabricated (a GitHub-hosted runner has no real WSL to exercise
  meaningfully); only the spaces case (both OSes) and a Windows-drive
  backslash form (Windows leg) are genuinely exercised via the `CODEX_HOME`
  path. Verified: YAML parses, `actionlint` reports zero findings specific
  to the new job's lines, all 4 embedded Node.js snippets tested standalone
  against synthetic stdin/argv data, and the live-catalog-derived
  enabled-plugin-list snippet correctly returns `[]` against this repo's
  actual catalog right now.
- [x] Step 16: Legacy retirement — removed `validateMarketplace()` from
  `packages/infrastructure/src/validation/validator.ts` and its `marketplace`
  schema load inside `initialize()` (kept the `plugin` schema load); removed
  `validateMarketplace` from the `IValidator` interface in
  `packages/domain/src/validation/types.ts`; rewrote
  `packages/cli/src/index.ts` down to the single remaining `validate:plugins`
  command (default arg updated from `'validate'` to `'validate:plugins'`
  since `'validate'` no longer exists); removed the now-orphaned
  `@yellow-plugins/infrastructure` dependency from `packages/cli/package.json`
  (confirmed zero remaining usages first) and ran `pnpm install` to update
  the lockfile; deleted `schemas/marketplace.schema.json`; confirmed (no
  edit needed) `validator.test.ts` still only exercises
  `validateCompatibility` (R45). **Scope note:** swept beyond the plan's 3
  named README spots after finding the deletion also falsified 5 more
  spots the plan didn't name — 2 more in the same README (a generic
  `AjvValidatorFactory` example and a schemas/ directory listing), 1 in
  root `CLAUDE.md` ("schemas/marketplace.schema.json ... are the local
  schemas"), 1 in `tests/integration/example-files-schema.test.ts`'s header
  comment (explained a schema-shape mismatch against a file that no longer
  exists), all fixed since each was a direct, immediate falsehood MY
  deletion introduced, not pre-existing drift. Left `docs/cli/publish.md`
  alone — it documents a `publish` command confirmed absent from
  `packages/cli` entirely, pre-existing staleness unrelated to this
  change. Verified: `pnpm build` (all 3 packages), `pnpm typecheck`, full
  test suites (376 tests), and `pnpm validate:schemas` all green; the
  built CLI's 4 commands behave exactly as intended
  (`validate:plugins`/default → delegation message;
  `validate`/`validate:marketplace` → rejected with exit 1).
- [x] Step 17: Delivery — `sed -i 's/\r$//'` every new file; run the full
  Verification list below; confirm `git status` shows changes only under
  `catalog/`, `schemas/`, `scripts/`, `packages/`, `tests/`, `.github/
  workflows/`, `package.json`, and the new empty-state `.agents/` artifact
  (no unexpected `plugins/*/.claude-plugin/` diffs — Claude byte-identity
  still holds); `pnpm changeset` (minor, tooling-only, per R39 — note:
  `changeset-check` only gates `plugins/*` diffs, so this PR needs a
  changeset only if a plugin-facing behavior actually changed — verify
  against the final diff before deciding); `gt branch create
  agent/feat/codex-pilot-02-codex-tooling` from `main`, commit, `gt submit
  --no-interactive` (R39 partial: pr2-delivery). Verified: CRLF check
  (`grep -rlP '\r$' <changed files>` reported zero matches, so no
  `sed -i` normalization was needed). Ran every item in the Verification
  section below individually (generate:manifests byte-identity —
  "0 rewritten"; `validate:generated`; `validate:codex`;
  `lint-error-codes.js`; `validate-versions.js`; all 3
  Codex-specific test files — `codex-schema-examples.test.ts` 18/18,
  `generate-manifests-codex.test.ts` 8/8, plus the pre-existing
  `generate-manifests.test.ts` 35/35 with its updated TARGET_COUNT).
  Ran the full CI-baseline gate end-to-end twice: the first pass caught
  an `import/order` ESLint violation in
  `packages/domain/src/validation/errorCatalog.ts` (the
  `error-codes.json` import needed to precede the `types.js` import;
  per-file `npx eslint <file>` checks after each step had not caught
  this — only a full-repo `pnpm lint` did), fixed and committed
  separately; the second pass (`validate:schemas`, `validate:versions`,
  `test:unit`, `test:integration`, `lint`, `typecheck`, plus a fresh
  `pnpm build`) was fully green. Ran `pnpm release:check` — green.
  Ran `pnpm format:check` (read-only) and found 792 pre-existing files
  with formatting issues unrelated to this change; correctly left them
  alone since `pnpm format --write` is not part of the CI gate and
  running it would create a large unrelated diff. Advisor review
  (mid-Step-17) flagged one more cleanup:
  `packages/cli/tsconfig.json` still carried a `references` entry to
  `../infrastructure` even though `packages/cli/src/index.ts` (rewritten
  in Step 16) no longer imports from `@yellow-plugins/infrastructure` at
  all — removed the dangling reference, rebuilt all 3 packages clean,
  and re-ran the full gate end-to-end a third time (also green) before
  committing it as a separate `chore(cli)` commit. Changeset decision:
  `git diff main...HEAD --stat -- 'plugins/'` returned zero files across
  all 53 changed files (all under `catalog/`, `schemas/`, `scripts/`,
  `packages/`, `tests/`, `.github/workflows/`, `package.json`, `.agents/`,
  plus plan/doc files) — confirmed via `grep` on
  `.github/workflows/validate-schemas.yml`'s `changeset-check` job that it
  keys on `^plugins/[^/]+/` diffs only, so with none present the job
  exits 0 with "No plugin files changed — no changeset required." No
  changeset created, matching shell 01's identical tooling-only
  precedent.

## Verification

- `pnpm generate:manifests` then `git status --porcelain` under
  `plugins/*/.claude-plugin/` and `.claude-plugin/marketplace.json` ->
  expected: empty (Claude byte-identity still holds after adding Codex
  emission, R4 unaffected).
- `pnpm validate:generated` -> expected: exit 0 on a clean tree, including
  the new empty-state `.agents/plugins/marketplace.json` (R10).
- `pnpm validate:codex` -> expected: exit 0; temporarily inject a
  Claude-only construct into a Codex-exposed fixture skill and confirm
  nonzero exit naming the violation (R15).
- `node scripts/lint-error-codes.js` -> expected: exit 0; temporarily
  hard-code `'ERROR-DIST-001'` in a scratch `scripts/*.js` file and confirm
  nonzero exit (closes the coverage-gap risk); unit test confirms
  `findPrefixCollisions` does NOT flag `DIST`/`DISC` (the illustrative
  near-miss pair R14 names, correctly not a substring collision) and DOES
  flag a genuine substring pair (e.g. an injected `DIS` prefix, contained in
  both `DISC` and `DIST`) (R14).
- `node scripts/validate-versions.js` -> expected: exit 0 at HEAD (no
  plugin Codex-enabled yet, so only the Claude three-way check is exercised);
  unit tests for the extracted `computeVersionDrift` core cover the Codex
  two-way and marketplace-membership failure cases (R12).
- `pnpm vitest run tests/integration/codex-schema-examples.test.ts
  tests/integration/generate-manifests.test.ts` -> expected: all pass (R11,
  R43).
- `pnpm validate:schemas && pnpm validate:versions && pnpm test:unit &&
  pnpm test:integration && pnpm lint && pnpm typecheck` -> expected: all
  green, including the new `codex`/`generated` matrix targets locally via
  `ajv validate` where applicable.
- `node packages/cli/dist/index.js validate:plugins` (or equivalent
  build+run) -> expected: still prints the delegation message; `validate`/
  `validate:marketplace` are no longer accepted commands (R45).

## Context Files

- `scripts/lib/generate/write.js`, `scripts/lib/generate/catalog-reader.js`,
  `scripts/lib/generate/emit-claude.js` — reuse targets for `emit-codex.js`.
- `scripts/generate-manifests.js` — `generateManifests({mode, rootDir})`
  wiring point for Codex targets.
- `catalog/catalog.json`, `catalog/plugins/*.json` — the 17 files whose
  `targets.codex` widens from boolean to object in Step 1.
- `schemas/official-marketplace.schema.json:8` — the `$comment` provenance
  pattern every new schema follows.
- `packages/domain/src/validation/errorCatalog.ts`,
  `scripts/lint-error-codes.js` — DIST registry wiring and the coverage-gap
  fix.
- `packages/infrastructure/src/validation/validator.ts`,
  `packages/domain/src/validation/types.ts`, `packages/cli/src/index.ts`,
  `schemas/marketplace.schema.json`,
  `packages/infrastructure/src/validation/README.md` — legacy retirement
  (R45).
- `scripts/validate-versions.js` — target-aware version validation
  extraction point.
- `tests/integration/example-files-schema.test.ts` — AJV fixture-test
  template.
- `.github/workflows/validate-schemas.yml` — matrix/case wiring and the new
  Ubuntu/Windows install-verification job.
- `docs/research/2026-07-16-codex-plugin-contract-spike.md` — empirical
  Codex CLI/plugin-contract findings this shell must honor.
- `plans/specs/claude-code-codex-plugin-pilot.md` — requirement text and
  Design section (schema filenames, error registry semantics, MVP staging)
  for every R-id in Origin.
