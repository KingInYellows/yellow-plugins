---
title: "Claude Code Plugin Validator Rejects Unknown changelog Key in plugin.json"
category: build-errors
tags:
  - plugin-manifest
  - schema-validation
  - two-validator-drift
  - additionalProperties
  - marketplace
  - plugin-install
severity: P0
components:
  - plugin.json
  - schemas/plugin.schema.json
  - all 11 marketplace plugins
error_pattern: 'Unrecognized key: "changelog"'
date_resolved: 2026-02-25
pr: "#66"
---

# Claude Code Plugin Validator Rejects Unknown `changelog` Key

## Problem

All 11 plugins in the yellow-plugins marketplace fail to install with:

```
Error: Unrecognized key: "changelog"
```

Claude Code's remote validator enforces `additionalProperties: false` and
rejects the `changelog` field that was added to every `plugin.json` during the
PR #24 public release audit. This was a **P0 blocker** — no plugin in the
marketplace could be installed.

## Root Cause

Two-validator drift between the local CI schema and Claude Code's remote
validator:

- The local schema (`schemas/plugin.schema.json`) was updated to include
  `"changelog"` as a valid property, so `pnpm validate:schemas` passed locally.
- Claude Code's remote validator never added `"changelog"` to its schema and
  uses `additionalProperties: false`, which rejects any key not in its
  allowlist.
- Result: all 11 plugins pass local CI but fail on plugin install.

This is an instance of the two-validator problem documented in
[CI Schema Drift Patterns](ci-schema-drift-hooks-inline-vs-string.md): local
schema and remote validator can diverge silently, and a locally-passing CI run
does not guarantee the remote validator will accept the manifest.

## Solution

Six phases applied in order:

### Phase 1 — Remove `changelog` from all plugin.json files

Remove the `"changelog": "https://..."` line from every
`plugins/*/.claude-plugin/plugin.json` (11 files total).

### Phase 2 — Remove `changelog` from local schema

In `schemas/plugin.schema.json`, delete the `"changelog"` property block from
the `"properties"` object so the local schema stays in sync with the remote
validator's expectation.

### Phase 3 — Bump versions

Increment the version field to `1.1.0` in all `plugins/*/package.json` files
(10 files; yellow-core was already at 1.1.0).

### Phase 4 — Propagate versions via sync script

```bash
node scripts/sync-manifests.js
```

This pushes updated versions into `plugin.json` and `marketplace.json`.

### Phase 5 — Update changelogs

Add `1.1.0` entries to all 11 `plugins/*/CHANGELOG.md` files documenting the
removal of the unsupported `changelog` field.

### Phase 6 — Validate

```bash
pnpm run release:check    # validate:marketplace + validate:plugins + validate:versions + typecheck
grep -r '"changelog"' plugins/ schemas/   # should return nothing
```

## Bonus: Trailing Comma Fix

After removing the `"changelog"` block from `schemas/plugin.schema.json`, the
preceding `"hooks"` property retained its trailing comma. Since `"changelog"`
was the last entry in `"properties"`, removing it left `"hooks"` as the new
last property with a dangling comma — making the JSON invalid.

```json
// Before (invalid — trailing comma on last property):
"hooks": { ... },

// After (valid):
"hooks": { ... }
```

This was caught by the code-reviewer audit agent during `/smart-submit`. Always
inspect the property immediately before any deleted block to catch this. JSON
does not allow trailing commas, and this class of error causes a parse error
before schema validation even runs.

## Key Commands

```bash
# Verify which plugin.json files contain the offending key
grep -rl '"changelog"' plugins/

# Sync versions into plugin.json and marketplace.json
node scripts/sync-manifests.js

# Validate locally before submitting
pnpm run release:check

# Verify the key is gone from all manifests
grep -r '"changelog"' plugins/ schemas/

# Verify JSON syntax after any property removal
jq empty schemas/plugin.schema.json
```

## Prevention Strategies

### Treat the local schema as a subset enforcer

The local schema should only permit what the remote validator permits. Never add
a field to the local schema speculatively or ahead of remote validation. The
local schema's job is to catch typos and structural errors in fields that are
already remotely accepted.

### Require empirical remote validation as a gate

Before merging any PR that touches `plugin.json` or `plugin.schema.json`, test
plugin install on a clean machine. This is not optional even when local CI
passes.

### Run `jq empty` after every JSON edit

After any field removal, run `jq empty` on every modified JSON file. This
catches trailing commas and structural breakage that schema validators may miss.

## Checklist: Adding New Fields to plugin.json

- [ ] Confirm the field is accepted by Claude Code's remote validator on a
      clean install — before writing any code
- [ ] Add the field to `schemas/plugin.schema.json` `properties` block
- [ ] Verify `additionalProperties: false` is still present
- [ ] Add the field to all relevant `plugin.json` files
- [ ] Run `jq empty` on every modified file
- [ ] Run `pnpm validate:schemas` locally
- [ ] Test `claude /plugin add` on a clean environment

## Checklist: Removing Fields from plugin.json

- [ ] Identify every file containing the field:
      `grep -r '"fieldname"' plugins/ schemas/`
- [ ] Remove the field from each `plugin.json`
- [ ] Check the preceding property for a trailing comma
- [ ] Run `jq empty` on every modified file immediately
- [ ] Remove the field from `schemas/plugin.schema.json`
- [ ] Check the preceding property in the schema for a trailing comma
- [ ] Run `jq empty` on the schema
- [ ] Run `pnpm run release:check`
- [ ] Grep the repo for documentation referencing the removed field

## Related Documentation

<!-- prettier-ignore -->
**Primary references:**
- [CI Schema Drift: hooks inline vs string](ci-schema-drift-hooks-inline-vs-string.md) — documents the two-validator problem and `oneOf` fix pattern
- [Claude Code Plugin Manifest Validation Errors](claude-code-plugin-manifest-validation-errors.md) — documents `repository`, `hooks`, and unknown-key rejection patterns
- [AJV CLI v8 Strict Mode Unknown Format](ajv-cli-v8-strict-mode-unknown-format.md) — documents `ajv-formats` requirement for schema validation tooling

<!-- prettier-ignore -->
**Related patterns:**
- [Skill Frontmatter Attribute and Format Requirements](../code-quality/skill-frontmatter-attribute-and-format-requirements.md) — same class of Claude Code format strictness (parser mismatches)
- [MCP Bundled Server Tool Naming](../integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md) — plugin.json structural correctness driving runtime behavior

## Recurring Theme

Three recurring themes appear across all related documents:

1. **Local CI permissiveness vs. Claude Code strictness** — local schemas use
   lenient definitions while the remote validator enforces undocumented stricter
   rules. Mitigation: tighten local schemas to match remote behavior.

2. **Format strictness from convention copying** — Claude Code does not follow
   npm conventions, full YAML spec, or other common patterns. Always verify
   empirically rather than inferring from conventions.

3. **Two-validator divergence after format changes** — whenever a plugin.json
   format changes to satisfy one validator, the other is often not updated.
   Treat every format change as a two-step operation requiring both validators
   to be audited.
