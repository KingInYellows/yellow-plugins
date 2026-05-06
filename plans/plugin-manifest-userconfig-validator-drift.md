# Feature: Plugin manifest userConfig validator drift fix

## Problem Statement

`claude doctor` reports 4 plugins with invalid `userConfig` blocks:

- `yellow-devin@2.3.0` — `devin_service_user_token`, `devin_org_id`
- `yellow-research@3.0.1` — `perplexity_api_key`, `tavily_api_key`, `exa_api_key`
- `yellow-morph@1.2.0` — `morph_api_key`
- `yellow-semgrep@4.0.2` — `semgrep_app_token`

Per-key the remote validator emits two errors:

- `userConfig.<key>.type: Invalid option: expected one of "string"|"number"|"boolean"|"directory"|"file"` — `type` is absent in all 7 entries
- `userConfig.<key>.title: Invalid input: expected string, received undefined` — `title` is absent (the local schema uses `label`, which the remote does not recognize)

Local CI (`pnpm validate:schemas`) passes today: the local `userConfigEntry` schema makes `type` optional (defaulting to `"string"`), uses `label` instead of `title`, and does not include `"directory"`/`"file"` in the type enum. This is the same two-validator drift class that produced the `changelog` and `repository` install-blocker incidents (PR #66 family).

## Current State

Reviewed files:

- `plugins/yellow-devin/.claude-plugin/plugin.json:19-28` — 2 keys, `description` + `sensitive` only
- `plugins/yellow-research/.claude-plugin/plugin.json:23-36` — 3 keys, same shape
- `plugins/yellow-morph/.claude-plugin/plugin.json:19-23` — 1 key, same shape
- `plugins/yellow-semgrep/.claude-plugin/plugin.json:19-23` — 1 key, same shape
- `schemas/plugin.schema.json:9-48` — `userConfigEntry` with `type` enum `[string, number, boolean]`, optional `type`, `label` (not `title`)

`rg -l '"userConfig"' plugins/*/.claude-plugin/plugin.json` confirms only these 4 files declare `userConfig`. No other plugins are at risk.

## Proposed Solution

**Approach B from the brainstorm: manifest patch + schema tightening + solutions doc.**

1. Add `"type": "string"` and `"title": "<label>"` to each of the 7 `userConfig` entries.
2. Tighten `schemas/plugin.schema.json` `userConfigEntry`: make `type` and `title` required, extend the `type` enum to include `"directory"` and `"file"` (parity with remote validator).
3. Document the failure mode under `docs/solutions/build-errors/`.
4. Single Changesets entry at `patch` level spanning all 4 plugins.

## Resolved decisions (from brainstorm open questions)

1. **Field name `title` vs `label`** — use `title`. The `claude doctor` output literally says `userConfig.X.title: Invalid input: expected string`. Confirmed unambiguous. The local schema's `label` field is removed (unused — no plugin.json currently uses it).
2. **Title style** — sentence case, matching the existing `description` style ("Devin service user token", not "Devin Service User Token").
3. **`devin_org_id` `sensitive: false`** — keep explicit. Defaults can change; explicit-is-better matches the existing style elsewhere in the file.
4. **`directory`/`file` enum entries** — add for parity with remote validator, even though no current plugin uses them. Purely additive, zero risk.
5. **`sensitive` field survival** — explicitly preserved in the new schema. Verified in step 3.2 below.
6. **`validate-plugin.js` hard-coded check (Approach C)** — defer per YAGNI. Schema enforcement via AJV is sufficient until a third drift incident.

## Implementation Plan

### Phase 1: Branch setup

- [ ] 1.1: `gt repo sync` — sync trunk
- [ ] 1.2: `gt branch create fix/plugin-manifest-userconfig-validator-drift`

### Phase 2: Manifest patches (4 files)

For each entry, add `"type": "string"` and `"title": "<label>"` immediately above the existing `description`.

- [ ] 2.1: `plugins/yellow-devin/.claude-plugin/plugin.json`
  - `devin_service_user_token` → title `"Devin service user token"`
  - `devin_org_id` → title `"Devin organization ID"` (keep `sensitive: false`)
- [ ] 2.2: `plugins/yellow-research/.claude-plugin/plugin.json`
  - `perplexity_api_key` → title `"Perplexity API key"`
  - `tavily_api_key` → title `"Tavily API key"`
  - `exa_api_key` → title `"Exa API key"`
- [ ] 2.3: `plugins/yellow-morph/.claude-plugin/plugin.json`
  - `morph_api_key` → title `"Morph API key"`
- [ ] 2.4: `plugins/yellow-semgrep/.claude-plugin/plugin.json`
  - `semgrep_app_token` → title `"Semgrep app token"`
- [ ] 2.5: Verify each file with `jq empty plugins/<name>/.claude-plugin/plugin.json` — catches any trailing-comma error post-edit
- [ ] 2.6: WSL2 line-ending check — `file plugins/*/.claude-plugin/plugin.json | grep -v 'JSON text data' || true`. If any show CRLF, run `sed -i 's/\r$//'` on them.

### Phase 3: Schema tightening (`schemas/plugin.schema.json`)

- [ ] 3.1: In `definitions.userConfigEntry.properties.type`, extend the enum: `["string", "number", "boolean", "directory", "file"]`. Remove the `default: "string"` field — defaults are now meaningless because `type` is required.
- [ ] 3.2: In `definitions.userConfigEntry.properties`, add `"title": { "type": "string", "minLength": 1 }`. Verify `sensitive`, `description`, `default`, `required` properties remain unchanged.
- [ ] 3.3: Remove the `label` property entirely (unused, replaced by `title`). Confirmed via `rg '"label"' plugins/` returns no hits inside any `userConfigEntry` block.
- [ ] 3.4: Add `"required": ["type", "title"]` to `userConfigEntry`. Place after `properties` and before `additionalProperties`.
- [ ] 3.5: Update the `allOf` block: the fourth branch (`if not required type`) becomes dead code — remove it. Keep the three type-specific default-constraint branches.
- [ ] 3.6: Update the `userConfig` top-level description (currently mentions `label` at line 249) — change `"declare type, label, description, default, required, sensitive"` to `"declare type, title, description, default, required, sensitive"`.
- [ ] 3.7: `jq empty schemas/plugin.schema.json` — verify no trailing comma after property removal.

### Phase 4: Solutions doc

- [ ] 4.1: Create `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md` documenting:
  - Symptom: `claude doctor` errors with `type: Invalid option` and `title: Invalid input: expected string, received undefined`
  - Root cause: local schema permitted absent `type` and used `label` instead of `title`
  - Fix: 2 fields added per entry + schema tightening
  - Prevention: schema is now strict — `pnpm validate:schemas` blocks future occurrences
  - Cross-reference: `claude-code-plugin-manifest-validation-errors.md` and `plugin-json-changelog-key-schema-drift-remote-validator.md`

### Phase 5: Memory + CLAUDE.md updates

- [ ] 5.1: Update auto-memory file `.claude/projects/-home-kinginyellow-projects-yellow-plugins/memory/MEMORY.md` "Plugin Manifest Validation" section with one-line entry pointing to the new solutions doc
- [ ] 5.2: No `plugins/<name>/CLAUDE.md` updates needed — the plugin docs reference `userConfig` in narrative form, not field-by-field, so no stale references to fix.

### Phase 6: Validation, changeset, submit

- [ ] 6.1: `pnpm validate:schemas` — must pass
- [ ] 6.2: `pnpm validate:versions` — must pass (no version changes yet, but confirms baseline)
- [ ] 6.3: `pnpm test:unit` — must pass (validates schema-test fixtures still align)
- [ ] 6.4: `pnpm changeset` — select `patch` for: `yellow-devin`, `yellow-research`, `yellow-morph`, `yellow-semgrep`. Summary: `fix(plugin-manifests): add type and title to userConfig entries — fixes claude doctor remote-validator rejection`
- [ ] 6.5: `gt commit create -m "fix(plugin-manifests): add type and title to userConfig entries"`
- [ ] 6.6: `gt stack submit`

## Technical Specifications

### Files to modify (6)

| File | Change |
|---|---|
| `plugins/yellow-devin/.claude-plugin/plugin.json` | +2 fields × 2 keys = 4 lines |
| `plugins/yellow-research/.claude-plugin/plugin.json` | +2 fields × 3 keys = 6 lines |
| `plugins/yellow-morph/.claude-plugin/plugin.json` | +2 fields × 1 key = 2 lines |
| `plugins/yellow-semgrep/.claude-plugin/plugin.json` | +2 fields × 1 key = 2 lines |
| `schemas/plugin.schema.json` | enum extension + `title` property + required array + remove dead `label` and dead `allOf` branch |
| `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md` | new file |

### Files to create (2)

| File | Purpose |
|---|---|
| `.changeset/<random-name>.md` | Patch bumps for all 4 plugins |
| `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md` | Solutions documentation |

### Example diff (yellow-morph entry)

Before:
```json
"morph_api_key": {
  "description": "Morph API key (...). Stored in system keychain or ~/.claude/.credentials.json.",
  "sensitive": true
}
```

After:
```json
"morph_api_key": {
  "type": "string",
  "title": "Morph API key",
  "description": "Morph API key (...). Stored in system keychain or ~/.claude/.credentials.json.",
  "sensitive": true
}
```

### Schema diff (excerpt)

Before:
```json
"userConfigEntry": {
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": ["string", "number", "boolean"],
      "default": "string"
    },
    "label": { "type": "string" },
    "description": { "type": "string" },
    ...
  },
  "additionalProperties": false,
  "allOf": [
    { "if": { "properties": { "type": { "const": "string" } }, "required": ["type"] },
      "then": { "properties": { "default": { "type": "string" } } } },
    { "if": { "properties": { "type": { "const": "number" } }, "required": ["type"] },
      "then": { "properties": { "default": { "type": "number" } } } },
    { "if": { "properties": { "type": { "const": "boolean" } }, "required": ["type"] },
      "then": { "properties": { "default": { "type": "boolean" } } } },
    { "if": { "not": { "required": ["type"] } },
      "then": { "properties": { "default": { "type": "string" } } } }
  ]
}
```

After:
```json
"userConfigEntry": {
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": ["string", "number", "boolean", "directory", "file"]
    },
    "title": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    ...
  },
  "required": ["type", "title"],
  "additionalProperties": false,
  "allOf": [
    { "if": { "properties": { "type": { "const": "string" } }, "required": ["type"] },
      "then": { "properties": { "default": { "type": "string" } } } },
    { "if": { "properties": { "type": { "const": "number" } }, "required": ["type"] },
      "then": { "properties": { "default": { "type": "number" } } } },
    { "if": { "properties": { "type": { "const": "boolean" } }, "required": ["type"] },
      "then": { "properties": { "default": { "type": "boolean" } } } }
  ]
}
```

(Note: `properties` truncated for clarity. `default`, `required`, `sensitive` are preserved verbatim.)

### Dependencies

None added. AJV already validates JSON Schema in `packages/infrastructure`.

## Acceptance Criteria

1. `pnpm validate:schemas` passes after the manifest changes (proves the new schema accepts the patched files).
2. `pnpm validate:schemas` fails if any `userConfigEntry` is intentionally reverted to omit `type` or `title` (proves the schema actually enforces). Manual sanity check: temporarily delete `"type": "string"` from one entry, run validate, confirm failure, restore.
3. After `pnpm changeset version` simulation (or after the auto-version bot runs in CI), all 4 plugins show patch bumps and the three-way version sync (`package.json` → `plugin.json` → `marketplace.json`) holds.
4. Local install of the marketplace HEAD on a fresh Claude Code instance: `claude doctor` returns 0 plugin errors. (Cannot verify in-repo — verify post-merge as part of the release smoke test.)
5. `pnpm validate:versions` passes.
6. `pnpm test:unit` passes (no test fixtures regress).
7. `git diff --stat` shows ≤ 7 files changed (4 manifests + 1 schema + 1 solutions doc + 1 changeset).

## Edge Cases

1. **`devin_org_id` is not sensitive** — fix still applies (`type: "string"`, `title: "Devin organization ID"`). `sensitive: false` stays.
2. **Schema reads `label` somewhere we missed** — guarded by `rg '"label"' plugins/ schemas/ scripts/ packages/` returning no hits inside any `userConfigEntry` context. If any production code reads `label`, switch the migration to add `title` while keeping `label` deprecated, instead of removing it.
3. **A plugin grows a `default` value for a userConfig field later** — the `allOf` constraint chain still enforces type-matched defaults. The 4th `if/then` branch was only reachable when `type` was absent; with `type` now required, that branch is unreachable and is correctly removed.
4. **A future plugin adds `userConfig` after this lands** — author will get a local schema error if `type` or `title` is missing. This is the desired behavior (catch at PR time, not at `claude doctor` time on a user's machine).
5. **CRLF on WSL2** — every JSON write goes through Edit (not Write), so existing LF endings are preserved. Validation step 2.6 catches accidental CRLF.

## Performance / Security Considerations

- **Performance:** None. Adding two scalar fields per entry. No runtime cost.
- **Security:** `sensitive: true` is preserved on every credential field — keychain storage behavior unchanged. `title` is a UI label only; it never carries the credential value. No echo-back risk.
- **Backward compatibility:** Schema additions are stricter, not looser. Any plugin currently passing validation continues to pass after the manifest fix is applied. No external consumer of the schema has been identified that would break.

## Migration & Rollback

- **Deployment:** Standard Changesets flow. Patch bumps for 4 plugins. Single PR. Single auto-version PR after merge.
- **Rollback:** Revert the PR. The 4 plugins regress to the pre-fix state (still passing local CI, still failing `claude doctor`). No data migration. No cache invalidation needed beyond Claude Code's normal plugin cache refresh.

## References

### Internal

- `docs/brainstorms/2026-05-05-plugin-manifest-userconfig-validator-drift-brainstorm.md` — full design rationale and approach options
- `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md` — prior `repository`/`hooks` drift incident
- `docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md` — prior `changelog` drift incident; prevention checklist
- `schemas/plugin.schema.json:9-48` — `userConfigEntry` definition
- `CLAUDE.md` "Plugin Manifest Validation" memory section
- `CONTRIBUTING.md` — Changesets flow

### Recent commits showing analogous patterns

- PR #66 — repository/hooks schema drift fix (manifest + schema in same change)
- `e0405546 docs(yellow-core, yellow-review)` — recent doc-only fix style
- `608ba247 chore: version packages` — Changesets version PR shape
