---
title: "Claude Code Validator Rejects userConfig Entries Missing type or title"
category: build-errors
track: bug
problem: "Claude Code remote validator rejects userConfig entries that omit type or title — local CI passes but claude doctor reports 4 plugins as invalid"
tags:
  - plugin-manifest
  - userConfig
  - schema-validation
  - two-validator-drift
  - sensitive-credentials
severity: P1
components:
  - plugins/yellow-devin/.claude-plugin/plugin.json
  - plugins/yellow-research/.claude-plugin/plugin.json
  - plugins/yellow-morph/.claude-plugin/plugin.json
  - plugins/yellow-semgrep/.claude-plugin/plugin.json
  - schemas/plugin.schema.json
error_pattern: 'userConfig.<key>.type: Invalid option: expected one of "string"|"number"|"boolean"|"directory"|"file"'
date_resolved: 2026-05-05
---

# Claude Code Validator Rejects userConfig Entries Missing `type` or `title`

## Problem

`claude doctor` reports 4 plugins with invalid manifests:

```text
✘ Plugin errors
└ 4 plugin error(s) detected:
  ├ yellow-devin@yellow-plugins ... Validation errors:
    userConfig.devin_service_user_token.type: Invalid option: expected one of
    "string"|"number"|"boolean"|"directory"|"file",
    userConfig.devin_service_user_token.title: Invalid input: expected string,
    received undefined, ...
  ├ yellow-research@yellow-plugins ... (same shape × 3 keys)
  ├ yellow-morph@yellow-plugins ... (same shape × 1 key)
  └ yellow-semgrep@yellow-plugins ... (same shape × 1 key)
```

Per `userConfig` entry, two errors:

- `type: Invalid option: expected one of "string"|"number"|"boolean"|"directory"|"file"` — `type` is absent
- `title: Invalid input: expected string, received undefined` — `title` is absent

`pnpm validate:schemas` passed locally throughout. The 4 plugins installed
successfully on prior Claude Code versions; the remote validator now enforces
`type` and `title` on every `userConfig` entry.

## Root Cause

Two-validator drift between the local CI schema and the Claude Code remote
validator (the same class as the [`changelog` key drift](plugin-json-changelog-key-schema-drift-remote-validator.md)
and the [`repository` / `hooks` shape drift](claude-code-plugin-manifest-validation-errors.md)):

| Aspect | Local schema | Remote validator |
|---|---|---|
| `type` field | Optional (defaults to `"string"`) | Required; absence triggers enum-mismatch error |
| `type` enum | `string`, `number`, `boolean` | `string`, `number`, `boolean`, `directory`, `file` |
| Human-readable label field | `label` (optional) | `title` (required) |

All 4 affected `plugin.json` files used the most permissive shape — only
`description` and `sensitive`, no `type`, no `label`, no `title`. Local CI
accepted them; Claude Code rejected them.

## Solution

Two coordinated changes:

### Phase 1 — Add `type` and `title` to all 7 userConfig keys

For each entry across the 4 manifests, add `"type": "string"` and
`"title": "<sentence-case label>"` immediately above the existing `description`.

| Plugin | Key | Title |
|---|---|---|
| yellow-devin | `devin_service_user_token` | Devin service user token |
| yellow-devin | `devin_org_id` | Devin organization ID |
| yellow-research | `perplexity_api_key` | Perplexity API key |
| yellow-research | `tavily_api_key` | Tavily API key |
| yellow-research | `exa_api_key` | Exa API key |
| yellow-morph | `morph_api_key` | Morph API key |
| yellow-semgrep | `semgrep_app_token` | Semgrep app token |

`sensitive: true` (or `sensitive: false` for `devin_org_id`) is preserved
verbatim — keychain storage behavior is unchanged. `title` is a UI label
only; it never carries the credential value.

### Phase 2 — Tighten `schemas/plugin.schema.json` `userConfigEntry`

Convert the runtime `claude doctor` failure into a local CI failure:

1. Make `type` required: add `"required": ["type", "title"]` to `userConfigEntry`
2. Add `title` property: `"title": { "type": "string", "minLength": 1 }`
3. Extend `type` enum: `["string", "number", "boolean", "directory", "file"]`
4. Remove the unused `label` property
5. Remove the dead 4th `allOf` branch (`if not required type` — unreachable now that type is required)
6. Add `directory`/`file` constraint branches to `allOf` so their defaults must be strings (paths)

After this change, `pnpm validate:schemas` blocks any future `userConfig` entry
that omits `type` or `title`.

## Why Both Changes

Approach B from the brainstorm. The manifest fix alone (Approach A) restores
install success but leaves the local schema permissive — the next person
adding a `userConfig` entry will hit the same `claude doctor` failure. Schema
tightening (Approach B) closes the two-validator gap, matching the established
doctrine from PR #66 (`changelog` and `repository`/`hooks` drift fixes).

## Prevention Checklist

When changing any plugin manifest field or `userConfig` entry:

- [ ] Confirm the local schema (`schemas/plugin.schema.json`) actually constrains
      every field the remote validator constrains. If you see `type` defaulting
      to a value, ask whether the remote treats absence as an error.
- [ ] If a field has different names between local and remote schemas
      (`label` vs `title`, `changelog` vs nothing), prefer the remote name and
      drop the local one.
- [ ] Run `pnpm validate:schemas` AND test a fresh `/plugin install` against a
      clean Claude Code instance before tagging a release. Local CI alone is
      not sufficient.
- [ ] When tightening the schema, verify by deliberately reverting one entry
      to the broken shape — `pnpm validate:schemas` must fail. If it passes,
      the tightening did not actually constrain anything.

## Detection

Pre-flight script (run before `pnpm release:check`):

```bash
# Find any userConfigEntry that lacks "type" or "title"
for f in plugins/*/.claude-plugin/plugin.json; do
  if jq -e '
    .userConfig // empty
    | to_entries[]
    | .value
    | (.type == null or .title == null)
  ' "$f" > /dev/null 2>&1; then
    printf 'MISSING type or title: %s\n' "$f"
  fi
done
```

After this fix, the same check is enforced by the JSON Schema itself.

## Related

- [`plugin-json-changelog-key-schema-drift-remote-validator.md`](plugin-json-changelog-key-schema-drift-remote-validator.md) — earlier instance of two-validator drift (P0)
- [`claude-code-plugin-manifest-validation-errors.md`](claude-code-plugin-manifest-validation-errors.md) — `repository` and `hooks` shape divergence
- [`ci-schema-drift-hooks-inline-vs-string.md`](ci-schema-drift-hooks-inline-vs-string.md) — pattern reference

## Files Changed

- `plugins/yellow-devin/.claude-plugin/plugin.json` — 2 keys × 2 fields
- `plugins/yellow-research/.claude-plugin/plugin.json` — 3 keys × 2 fields
- `plugins/yellow-morph/.claude-plugin/plugin.json` — 1 key × 2 fields
- `plugins/yellow-semgrep/.claude-plugin/plugin.json` — 1 key × 2 fields
- `schemas/plugin.schema.json` — `userConfigEntry` definition (title + required + enum extension + dead-branch cleanup)
