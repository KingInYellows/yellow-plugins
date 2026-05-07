# Feature: validate-plugin.js — fail CI on broken `hooks/hooks.json` shape

## Problem Statement

PR #390 fixed `plugins/yellow-morph/hooks/hooks.json`, which had `SessionStart` at the top level instead of nested under a `"hooks"` key. Claude Code 2.1.131+ auto-discovers and validates that file with shape `{ hooks: Record<EventName, ...> }` and rejected the plugin entirely with `Hook load failed: expected "record", received undefined at path ["hooks"]`. The official Claude Code hooks docs (`code.claude.com/docs/en/hooks`) confirm the wrapper is mandatory.

Our local validator did not catch the bug because `scripts/validate-plugin.js:696` reads `hooksJson.hooks || {}` — when `.hooks` is undefined the drift check silently treats events as absent and never errors. None of the four other plugins with `hooks/hooks.json` (`gt-workflow`, `yellow-ci`, `yellow-debt`, `yellow-ruvector`) currently have the broken shape, but only by convention. We need a CI gate that fails on this class of bug going forward.

<!-- deepen-plan: external -->
> **Research:** No documented breaking change exists to the `{ hooks: { EventName: [...] } }` wrapper contract — it has been stable since the plugin auto-discovery feature shipped. There is no public Anthropic-hosted JSON Schema reference for `hooks/hooks.json`; the contract is enforced internally by Claude Code's validator only. The `anthropics/claude-code` repository is closed-source with no public issue tracker, so no community-pressure path exists to push for friendlier validation messages — a CI gate in this repo is the only durable defense.
<!-- /deepen-plan -->

## Current State

- **Rule 7 in `scripts/validate-plugin.js:688-793`** — runs only when both `plugin.json` has inline `hooks` AND `hooks/hooks.json` exists on disk. Reports every drift with `logWarning`, never `addError`. Warnings do not push to the `errors[]` array, so `result.valid` stays `true` and CI exits 0.
- **Error/warning convention** (`validate-plugin.js:320-344`): `addError(errors, msg)` blocks CI; `logWarning(msg)` does not. Things Claude Code rejects at install (e.g., missing hook script `validate-plugin.js:375`, path-escape `:661`) use `addError`. The new check belongs in the `addError` family because Claude Code's auto-discovery rejects the plugin.
- **Schema landscape**: `schemas/plugin.schema.json:194-197` defines `hooks` via `fileFilesOrInline` which accepts any `{type: object, minProperties: 1}` — too permissive to detect the top-level wrapper bug. There is no `schemas/hooks-file.schema.json`. CI currently runs ajv-cli only against `plugin.schema.json` and `marketplace.schema.json` (`.github/workflows/validate-schemas.yml:108-130`).
- **AJV config** (`packages/infrastructure/src/validation/ajvFactory.ts:87-94`): `strict: true, allErrors: true, verbose: true`. Closed-shape convention is `additionalProperties: false`.
- **Schema reuse precedent**: none. Both existing schemas use Draft-07 with inline `"definitions"` blocks; no cross-schema `$ref` infrastructure exists in the repo.
- **Test harness**: `tests/integration/validate-plugin.test.ts` — programmatic temp-dir fixtures (`mkdtempSync` in `beforeEach`, `rmSync` in `afterEach`), `runValidator(pluginDir)` via `spawnSync`. New test cases drop into a `describe(...)` block; no on-disk fixture tree. Existing precedent at lines 145-151 (`fails when name is missing`, asserts `status > 0`) and 190-208 (warning-path, asserts `status === 0`).
- **Changeset policy**: `CONTRIBUTING.md:157-161` and `validate-schemas.yml` `changeset-check` job confirm changes restricted to `scripts/`, `schemas/`, and `.github/` do NOT require a changeset.
- **All 5 current `hooks/hooks.json` files have the correct shape** (yellow-morph fixed in PR #390). No content migration needed.

## Proposed Solution

**Item 1 alone is sufficient to prevent recurrence.** Item 2 is independent gold-plating that adds parity with the AJV-driven schema validation pipeline — recommend deferring unless we add other hook-file shape constraints later.

### Item 1 (REQUIRED): Imperative shape check in `validate-plugin.js`

Add a pre-drift shape assertion in Rule 7. Run it whenever `hooks/hooks.json` exists on disk, regardless of whether `plugin.json` declares inline hooks. Fail with `addError` on:

1. Missing top-level `hooks` key (`typeof parsed.hooks !== 'object' || parsed.hooks === null || Array.isArray(parsed.hooks)`).
2. Unparseable JSON (today this is `logWarning` at `:790` — promote to `addError` for consistency, since Claude Code's auto-discovery rejects unparseable files too).

<!-- deepen-plan: codebase -->
> **Codebase:** Promotion to `addError` is fully consistent with how every other validator in `scripts/` treats JSON-parse failure. `validate-marketplace.js:96-104` does `logError(...) + return false`. `validate-versions.js:56-61` does `console.error(...) + process.exit(1)`. `validate-setup-all.js:41` and `validate-agent-authoring.js` use a `readJson()` helper with no try/catch, so unparseable input throws and crashes the process. The current `:790` `logWarning` is the **sole** soft-fail JSON parse path in the entire scripts directory. Promoting it brings hooks.json in line with the repo-wide convention.
<!-- /deepen-plan -->

Drop the `if (hasInlineHooks)` guard around the file-existence check so the shape gate runs even for plugins that ship `hooks/hooks.json` without an inline manifest block. The drift check stays gated on `hasInlineHooks` (drift only makes sense when both sources exist).

### Item 2 (OPTIONAL, defer): `schemas/hooks-file.schema.json`

A standalone Draft-07 schema mirroring the conventions of `schemas/plugin.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/KingInYellows/yellow-plugins/schemas/hooks-file.schema.json",
  "type": "object",
  "required": ["hooks"],
  "properties": {
    "_comment": { "type": "string" },
    "hooks": { "type": "object", "minProperties": 1 }
  },
  "additionalProperties": false
}
```

Wire-up via a new ajv-cli step in `validate-schemas.yml` per-plugin matrix target, plus a `node scripts/validate-hooks-files.js` invocation in the `validate:schemas` script chain (mirrors `validate-plugin.js` discovery).

**Why defer:** Item 1 closes the same hole imperatively, with one test case and ~10 lines of code. Item 2 adds a new file, a new CI matrix step, a new script, and a duplicated definition (no cross-schema `$ref` precedent → must inline-duplicate per best-practices research). Belt-and-suspenders for a one-bug class.

## Implementation Plan

### Phase 1: Validator hardening (Item 1)

- [ ] **1.1** Edit `scripts/validate-plugin.js`:
  - Move the `fs.existsSync(hooksJsonPath)` block out of the `if (hasInlineHooks)` guard at line 691 — wrap it in its own `if (fs.existsSync(...))` so the shape gate runs unconditionally when the file is present.
  - **Hoist `hooksJsonPath`:** the `const hooksJsonPath = path.join(pluginDir, 'hooks', 'hooks.json')` at line 692 is currently scoped *inside* the `if (hasInlineHooks)` branch. To run the shape check when `hasInlineHooks` is false, move the `const` declaration above the `if (hasInlineHooks)` line so both branches can read it.
  - After `JSON.parse`, before `hooksJson.hooks || {}`: assert `typeof hooksJson.hooks === 'object' && hooksJson.hooks !== null && !Array.isArray(hooksJson.hooks)`. If not, `addError(errors, 'hooks/hooks.json: top-level "hooks" key is required and must be a non-null object — Claude Code 2.1.131+ rejects plugins with a different shape')`.
  - Promote the JSON-parse-failure path (`:790`) from `logWarning` → `addError(errors, ...)` with a similar message: `hooks/hooks.json: cannot parse — must be valid JSON for Claude Code to load the hook config`.
  - Re-enter the `if (hasInlineHooks)` branch only for the drift comparison block (`:701` onward), so drift remains a warning while shape and parseability become errors.

<!-- deepen-plan: codebase -->
> **Codebase:** `inlineHooks` (line 628), `hasInlineHooks` (line 629), `errors`, and `pluginDir` are all in scope at the proposed insertion point — no further hoisting is needed beyond `hooksJsonPath`. The `errors[]` array passed to `addError(errors, msg)` is the same function-local array `validatePlugin()` returns; pushing to it from the new block correctly drives the exit code at line 947 (`if (!result.valid) hasErrors = true`) and `process.exit(1)` at line 958.
<!-- /deepen-plan -->

- [ ] **1.2** Add three test cases to `tests/integration/validate-plugin.test.ts`:
  - **Negative — missing wrapper:** `hooks/hooks.json` = `{"PostToolUse": [...]}` → expect `status > 0`, stderr matches `/top-level "hooks" key is required/`.
  - **Negative — unparseable:** `hooks/hooks.json` = `{not valid json` → expect `status > 0`, stderr matches `/cannot parse/`.
  - **Positive — runs even without inline hooks:** plugin.json with no `hooks` field, `hooks/hooks.json` = `{"hooks": {"PostToolUse": [...]}}` → expect `status === 0` (file is well-formed regardless of plugin.json).

<!-- deepen-plan: codebase -->
> **Codebase:** Insertion target is `describe('validate-plugin PR-A new behaviors', ...)` at `tests/integration/validate-plugin.test.ts:316` — NOT the lines 138-208 range cited under References (those are the *baseline regression* describe block at `:123`, useful as a pattern reference but not the right home for new behavior tests). Helpers needed: `runValidator(pluginDir): {status, stdout, stderr}` at `:51`, `writePluginManifest(pluginDir, manifest)` at `:65`, `writeHookScript(pluginDir, relativePath, content)` at `:78` (creates parent dirs and `chmod 0o755`), and `VALID_BASE_MANIFEST` / `SHEBANG_HOOK` constants. All helpers are module-level — accessible from any describe block in the file.
<!-- /deepen-plan -->

- [ ] **1.3** Run the local CI gate: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`.

### Phase 2: Submit

- [ ] **2.1** Branch via Graphite: `gt create fix/validate-plugin-js-hooks-shape-error`.
- [ ] **2.2** Commit (no changeset needed per `CONTRIBUTING.md:157-161` since paths are limited to `scripts/` and `tests/`).
- [ ] **2.3** `gt submit` — open PR with reference to PR #390 and root cause analysis.

### Phase 3 (DEFERRED): Item 2 declarative schema

Capture as a separate follow-up issue. Only implement if a future bug shows the imperative check missed something Item 2 would have caught.

## Technical Specifications

### Files to modify

- `scripts/validate-plugin.js` — Rule 7 prelude (~10 lines added, 1-2 changed). Reference: lines 688-793.
- `tests/integration/validate-plugin.test.ts` — three new `it(...)` blocks in the existing PR-A `describe` block (~30 lines).

### Files to create

- None. Item 2 (`schemas/hooks-file.schema.json` + `scripts/validate-hooks-files.js`) is deferred.

### Dependencies

- None new. AJV + ajv-formats already loaded for other validators. The shape check is plain JS.

### CI wire-up

- None new. The existing `pnpm validate:plugins` already runs `node scripts/validate-plugin.js` against every plugin (`.github/workflows/validate-schemas.yml:134-136`); the new errors propagate automatically.

## Acceptance Criteria

1. **Negative case fails CI.** A plugin with `hooks/hooks.json` containing `{"PostToolUse": [...]}` (no top-level `hooks` wrapper) makes `pnpm validate:plugins` exit non-zero with a message naming the file and the missing key.
2. **Unparseable JSON fails CI.** A plugin with malformed `hooks/hooks.json` makes `pnpm validate:plugins` exit non-zero (today it's a warning).
3. **All 5 current plugins still pass.** `gt-workflow`, `yellow-ci`, `yellow-debt`, `yellow-morph`, `yellow-ruvector` remain green under the new check.
4. **Plugins without inline hooks still validated.** A plugin with `hooks/hooks.json` but no `hooks` field in `plugin.json` is now subject to the shape check (it wasn't before).
5. **Drift warnings unchanged.** Existing warnings about event/matcher/timeout/command drift remain warnings, not errors.
6. **Three new test cases pass** in `tests/integration/validate-plugin.test.ts`.

## Edge Cases

- **`hooks` is null:** caught by `parsed.hooks === null` clause.
- **`hooks` is an array:** caught by `Array.isArray(parsed.hooks)` clause (JSON `[{...}]` would parse `typeof === 'object'` true but is wrong shape).
- **`hooks` is an empty object `{}`:** allowed at this layer — that's the existing drift-check's job to flag if events are missing relative to `plugin.json`.
- **`hooks/hooks.json` exists but is empty file:** caught by JSON-parse-failure clause.
- **No `hooks/hooks.json` at all:** Rule 7 still skips (current behavior preserved).
- **Plugin has inline hooks but no `hooks/hooks.json`:** Rule 7 still skips (current behavior preserved). Drift cannot exist.
- **Backwards compatibility with third-party plugins:** None — this validator only runs in our own CI. Third-party plugins are unaffected.

## Out of Scope

- Migrating any plugin's `hooks/hooks.json` content (yellow-morph already fixed in PR #390; the other four are already correctly shaped).
- Changing Claude Code's behavior, filing upstream issues, or documenting the auto-discovery contract beyond what's in `code.claude.com/docs/en/hooks`.
- Item 2 (`schemas/hooks-file.schema.json` + AJV wire-up) — deferred to a separate plan.
- Adding cross-schema `$ref` infrastructure (would be the first instance in the repo; defer until two consumers actually need shared definitions).

## References

- **PR #390** — the fix that motivated this hardening (yellow-morph hooks/hooks.json shape).
- `scripts/validate-plugin.js:320-344` — `addError` / `logWarning` / `logSuccess` definitions and CI exit-code wiring.
- `scripts/validate-plugin.js:688-793` — Rule 7 (current implementation).
- `scripts/validate-plugin.js:872-884` — `discoverPlugins()` (used here implicitly via the existing iteration).
- `tests/integration/validate-plugin.test.ts:138-208` — positive/negative/warning-path test patterns.
- `schemas/plugin.schema.json:194-197` — current `hooks` definition (intentionally permissive for `plugin.json`).
- `packages/infrastructure/src/validation/ajvFactory.ts:87-94` — AJV strict-mode config (relevant only if Item 2 is later picked up).
- `CONTRIBUTING.md:157-161` — changeset policy (no changeset needed for `scripts/`-only changes).
- `.github/workflows/validate-schemas.yml:5-10, 134-136` — CI invocation of `validate-plugin.js`.
- `code.claude.com/docs/en/hooks` — official Claude Code hooks docs confirming the `{ hooks: { ... } }` wrapper shape.
- `/home/kinginyellow/.claude/plans/i-think-we-still-cached-dongarra.md` — origin plan for PR #390 (captures the original "optional follow-up" that became this plan).
- `plans/plugin-manifest-userconfig-validator-drift.md` — closely-related precedent (same validator-drift class, schema tightening pattern).

<!-- deepen-plan: external -->
> **Research:** External-research note — no public Claude Code release-notes entry, GitHub issue, or community thread documents the introduction or change of the `hooks/hooks.json` wrapper requirement (the `anthropics/claude-code` repo is closed-source with no public issue tracker; `docs.anthropic.com/en/release-notes/claude-code` was unreachable during deepen-plan). The wrapper contract has been stable since auto-discovery shipped — files lacking the wrapper are author-error, not a schema migration. The single concrete error-shape data point we have is the path-and-message on Claude Code 2.1.131; that is sufficient to write the test assertion. Revisit if upstream publishes a hooks JSON schema reference and Item 2 (declarative schema) becomes worth the duplicated definition.
<!-- /deepen-plan -->
