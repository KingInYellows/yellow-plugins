---
title: "Plugin manifest userConfig validator drift — type + title required by remote, absent locally"
category: build-errors
track: bug
date: 2026-05-05
tags:
  - plugin-manifest
  - userConfig
  - schema-validation
  - two-validator-drift
  - sensitive-credentials
  - release-coordination
affected_plugins:
  - yellow-devin@2.3.0
  - yellow-research@3.0.1
  - yellow-morph@1.2.0
  - yellow-semgrep@4.0.2
---

# Plugin manifest userConfig validator drift — type + title required by remote

## What We're Building

A fix for 4 plugins whose `userConfig` entries are rejected by Claude Code's
remote validator when reported via `claude doctor`. All 4 plugins declare API
tokens/secrets using a `sensitive: true` flag and a `description` string but
omit `type` and `title` — fields the remote validator requires. Local CI
(`pnpm validate:schemas`) passes because the local schema allows `sensitive`
and does not mandate `type` or `title`. We need to add the missing fields,
tighten the local schema to prevent this class of drift from recurring, and
ship through the standard Changesets release flow.

## Root Cause Confirmation (from reading actual files)

All 4 affected `plugin.json` files share the same structure for their
`userConfig` entries — neither `type` nor `title` is present, only
`description` and `sensitive`:

```json
"userConfig": {
  "devin_service_user_token": {
    "description": "...",
    "sensitive": true
  }
}
```

The remote validator reports two errors per key:
- `type: Invalid option: expected one of "string"|"number"|"boolean"|"directory"|"file"`
  — because `type` is absent (the remote validator apparently does not accept
  absence as defaulting to `"string"` the way the local schema does)
- `title: Invalid input: expected string, received undefined` — `title` field
  is not in the local schema at all (`label` is present locally, `title` is not)

**Local schema state** (`schemas/plugin.schema.json` `userConfigEntry`):
- Allows: `type` (enum: `string|number|boolean`, default `"string"`), `label`,
  `description`, `default`, `required`, `sensitive`
- Does NOT require `type` or `title`
- Does NOT include `"directory"` or `"file"` in the enum (remote adds these two)
- Uses `label` where remote uses `title` (field name mismatch)

**Affected plugins and keys:**
| Plugin | Keys |
|---|---|
| yellow-devin@2.3.0 | `devin_service_user_token`, `devin_org_id` |
| yellow-research@3.0.1 | `perplexity_api_key`, `tavily_api_key`, `exa_api_key` |
| yellow-morph@1.2.0 | `morph_api_key` |
| yellow-semgrep@4.0.2 | `semgrep_app_token` |

**Other plugins at risk:** `rg -l '"userConfig"' plugins/*/plugin.json` returns
only these 4 files. No other plugins are affected.

## Key Decisions

### Decision 1: Which `type` value to use for API tokens/secrets?

The remote validator accepts `"string"|"number"|"boolean"|"directory"|"file"`.
All affected keys are API tokens — alphanumeric strings with vendor-specific
prefixes (`cog_`, `sgp_`, etc.). The correct type is `"string"`.

`"directory"` and `"file"` are for filesystem path inputs and would
semantically misrepresent the values. `"number"` and `"boolean"` are obviously
wrong.

**Decision: use `"type": "string"` for all 7 keys across all 4 plugins.**

The `"sensitive": true` field handles keychain storage — `type` is purely for
the validator's input form rendering. Critically: the `sensitive` flag is what
prevents the value from being echoed back, and it is preserved. Nothing in this
fix changes the security posture.

### Decision 2: What value to use for `title`?

`title` is a required string the remote validator uses as a human-readable
label in the Claude Code setup UI. The local schema called this `label` — same
semantic, different field name. The fix is to add a `title` field alongside
(or instead of) `label`.

Since the local schema has `additionalProperties: false` on `userConfigEntry`,
we cannot simply add `title` without updating the schema. Options:
- Rename `label` → `title` in both the schema and plugin.json files (none of
  the 4 affected files currently use `label` at all — so there is nothing to
  rename in the manifests, only the schema definition to update)
- Keep `label` in the schema, add `title` as a new optional field

Given that no plugin.json currently uses `label` and the remote validator
requires `title` (not `label`), the correct move is to add `title` to the
`userConfigEntry` definition in the local schema and add it to every affected
key in the 4 plugin.json files.

**Decision: add `"title"` to `userConfigEntry` in the schema; add a `title`
value to each of the 7 keys in the 4 plugin.json files. Keep `label` for
backward compatibility but mark it as the legacy alternative.**

### Decision 3: Should the local schema be tightened to match the remote?

Three divergences to address:

| Gap | Local schema | Remote validator | Fix |
|---|---|---|---|
| `type` required | Optional (defaults to `"string"`) | Effectively required (absence causes error) | Make `type` required in `userConfigEntry` |
| `title` field | Not present (uses `label`) | Required string | Add `title` as required to `userConfigEntry` |
| `type` enum | `string|number|boolean` | `string|number|boolean|directory|file` | Extend enum to add `directory` and `file` |

Making `type` required in the local schema would fail all 4 files immediately
during local validate:schemas — which is exactly the desired behavior. The cost
is that future plugin authors must always specify `type` explicitly. Given that
the default is always `"string"` for tokens, this is a low burden with a high
safety return.

**Decision: tighten the local schema on all three gaps.** This converts a
runtime `claude doctor` failure into a local CI failure — the correct direction.

### Decision 4: Should `validate-plugin.js` grow a hard-coded check?

`validate-plugin.js` runs the JSON Schema validator. If the schema is tightened
(Decision 3), AJV catches missing `type` and `title` automatically — no
hard-coded check needed. A hard-coded check would be redundant.

However, `validate-plugin.js` could add an explicit check that bans `sensitive`
without `title` as a belt-and-suspenders guard, in case a future schema update
accidentally loosens the constraint again. Given the history of two-validator
drift in this repo, this extra guard has value.

**Decision: defer the hard-coded check to a follow-up — the schema tightening
is sufficient for now (YAGNI). Document the gap in the solutions doc.**

### Decision 5: Single changeset or one per plugin?

All 4 fixes are patch bumps (bug fix to a non-user-facing manifest field).
They are independent (no cross-plugin changes required). Recent practice
(`608ba247 chore: version packages`) shows the version bot batches multiple
plugins into one PR, so a single changeset file listing all 4 plugins at
`patch` bump type is appropriate and matches the existing release flow.

The schema change (`schemas/plugin.schema.json`) is not versioned separately —
it lives in the repo root and is not a plugin. No changeset needed for it.

**Decision: one changeset spanning all 4 plugins at `patch` level.**

### Decision 6: Schema change backward compatibility

Adding `title` as required and adding `directory|file` to the enum is backward
compatible for all existing plugins that currently pass validation (they have no
userConfig at all, or will have it added in this fix). The only risk is if a
plugin.json already uses `label` expecting it to behave as `title` — confirmed
above: no plugin.json currently uses `label`, so no backward compatibility issue.

Removing the default `"string"` from `type` (by making it required) will not
break anything already in the repo because all 4 affected files are being fixed
in this same change.

## Why This Approach

The fix is surgical: add 2 fields per userConfig key (`type: "string"` and a
`title` string), update the local schema to enforce both, ship as a single
patch changeset. This is the minimum change that eliminates the `claude doctor`
errors, hardens local CI to catch this class of drift going forward, and
follows the established two-validator doctrine from prior solutions docs.

The alternative of leaving the local schema permissive and only fixing the
manifests would repeat the same gap that caused the `changelog` and `repository`
incidents. Schema tightening is the established pattern in this repo.

## Approach Options

### Approach A: Manifest-only patch (minimal scope)

Add `type: "string"` and `title: "..."` to each of the 7 userConfig keys
across the 4 plugin.json files. Leave the local schema unchanged.

**Pros:** Smallest possible diff; no risk of breaking `pnpm validate:schemas`
for other plugins; fastest to ship.

**Cons:** Does not prevent recurrence — the next person adding a userConfig
entry will hit the same `claude doctor` failure because local CI still won't
catch missing `type` or `title`. Perpetuates two-validator drift.

**Best when:** You want the narrowest possible change and are willing to rely on
manual discipline rather than tooling.

### Approach B: Manifest patch + schema tightening (recommended)

Add `type: "string"` and `title: "..."` to the 7 keys, AND update
`schemas/plugin.schema.json` to: (1) make `type` required, (2) add `title`
as required, (3) extend the `type` enum with `"directory"` and `"file"`.
Also add a `docs/solutions/build-errors/` entry documenting the userConfig
drift pattern.

**Pros:** Local CI (`pnpm validate:schemas`) now catches any future userConfig
entry missing `type` or `title` before it reaches `claude doctor`. Closes the
two-validator gap. Matches established repo doctrine (see `changelog` and
`repository` fixes). Self-documenting via the new solutions doc.

**Cons:** Schema change is slightly more surface area; future authors must
always specify `type` explicitly even when it's obviously `"string"`. One-time
cost of writing the solutions doc.

**Best when:** You want tooling to enforce correctness, not just fix the
immediate symptoms. This is the appropriate choice given the recurring
two-validator drift history in this repo.

### Approach C: Manifest patch + schema tightening + validate-plugin.js guard

Everything in Approach B, plus add a hard-coded check in `validate-plugin.js`
that explicitly fails if any userConfig entry has `sensitive: true` but no
`title`, as a belt-and-suspenders guard against future schema loosening.

**Pros:** Maximum defense-in-depth; explicit error message can reference the
exact `claude doctor` failure mode.

**Cons:** Redundant with the schema (AJV already enforces required fields once
the schema is tightened); adds maintenance surface in the validator script;
violates YAGNI — the schema fix alone is sufficient until there is evidence of
schema drift recurring.

**Best when:** After a third or fourth instance of two-validator drift where
schema tightening has demonstrably not been enough.

## Recommended Approach

**Approach B.** The manifest patch is required; the schema tightening is the
right call given this repo's track record of two-validator drift producing P0
install blockers. The `changelog` fix (PR #66) and the `repository`/`hooks` fix
(PR #66 family) both followed this pattern — fix the manifests AND tighten the
schema. Repeating only the manifest fix without the schema is explicitly
identified as insufficient in the prevention checklist in
`docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md`.

## Implementation Checklist (for /workflows:plan)

1. **Confirm remote validator's exact `title` field name** — the problem
   statement says `title`, local schema uses `label`. This brainstorm assumes
   `title` is correct. Verify against a real `claude doctor` error message or
   Anthropic plugin schema docs before writing code.

2. **Update 4 plugin.json files** — add `"type": "string"` and `"title": "..."`
   to each key. Title values should be concise, human-readable UI labels:
   - `devin_service_user_token` → `"Devin service user token"`
   - `devin_org_id` → `"Devin organization ID"`
   - `perplexity_api_key` → `"Perplexity API key"`
   - `tavily_api_key` → `"Tavily API key"`
   - `exa_api_key` → `"Exa API key"`
   - `morph_api_key` → `"Morph API key"`
   - `semgrep_app_token` → `"Semgrep app token"`

3. **Update `schemas/plugin.schema.json`** — in `userConfigEntry`:
   - Make `type` required (add to `"required": ["type"]`)
   - Add `"title": { "type": "string" }` to properties
   - Add `"title"` to the required array
   - Extend `type` enum: `["string", "number", "boolean", "directory", "file"]`
   - Run `jq empty schemas/plugin.schema.json` to verify no trailing commas

4. **Run validation** — `pnpm validate:schemas && pnpm validate:versions` must
   pass cleanly.

5. **Create changeset** — `pnpm changeset`, select patch for:
   `yellow-devin`, `yellow-research`, `yellow-morph`, `yellow-semgrep`.

6. **Write solutions doc** — `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
   documenting this specific instance with the `sensitive`/`title`/`type` drift
   pattern, the two solutions steps, and the prevention checklist update.

7. **Verify CLAUDE.md memory entry is up to date** — the "Plugin Manifest
   Validation" section in `MEMORY.md` should be updated to include the
   `userConfig.type` + `title` required fields as a known remote-only constraint.

## Open Questions for /workflows:plan

1. **Exact field name: `title` vs `label`** — the remote validator error says
   `title: Invalid input: expected string, received undefined`. But is `title`
   the correct field name to add, or is there a separate `label` → `title`
   rename that Claude Code is expecting? Recommend reading a confirmed-working
   plugin that uses userConfig (from a different marketplace) to verify before
   writing the fix.

2. **Does `sensitive` survive the schema tightening?** — The local schema has
   `additionalProperties: false` on `userConfigEntry`. If `title` is added to
   `properties` but `sensitive` is removed from the schema for any reason, all 4
   plugins would fail. Confirm `sensitive` remains in the `userConfigEntry`
   definition after the schema edit.

3. **Is `"directory"` or `"file"` type needed by any existing or planned
   plugin?** — Adding them to the enum is safe (purely additive), but confirm
   whether any planned plugin will use them before treating their absence as the
   cause of any future error.

4. **Title string style guide** — should titles be title case ("Devin Service
   User Token") or sentence case ("Devin service user token") or match the
   description's opening phrase? No style is enforced by the validator but
   consistency matters for the UI. Pick one and document it.

5. **`devin_org_id` has `sensitive: false`** — this key is not a secret. The
   fix still adds `type: "string"` and `title`, but confirm whether
   `sensitive: false` is still needed (it is the explicit default — it could be
   removed to reduce noise, or kept for clarity). This is a style decision, not
   a correctness one.
