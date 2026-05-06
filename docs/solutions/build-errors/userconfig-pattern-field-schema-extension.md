---
title: "Schema extension: optional `pattern` regex field on userConfigEntry"
category: build-errors
track: feature
problem: "Plugin authors had no schema-level mechanism to enforce regex constraints on user-supplied userConfig values (URLs, API keys, file paths). The local schema's userConfigEntry used additionalProperties: false and did not list `pattern` as a recognized property, so any plugin that wrote `\"pattern\": \"^https://\"` into plugin.json failed `pnpm validate:plugins` with an additional-property error."
tags:
  - plugin-manifest
  - userConfig
  - schema-validation
  - two-validator-drift
  - input-validation
  - regex
severity: P2
components:
  - schemas/plugin.schema.json
  - scripts/validate-plugin.js
  - tests/integration/validate-plugin.test.ts
  - tests/integration/example-files-schema.test.ts
  - examples/plugin-extended.example.json
error_pattern: 'must NOT have additional properties \(pattern\) at #/properties/userConfig/properties/<key>'
date_resolved: 2026-05-06
---

# Schema extension: optional `pattern` regex field on `userConfigEntry`

## Problem

A reviewer on PR #396 (yellow-composio bundles HTTP MCP via `userConfig`)
flagged that `composio_api_key` is `sensitive: true` (keychain-backed) but
is sent as the `X-API-Key` header to whatever URL the user enters in
`composio_mcp_url`. With no schema-level constraint enforcing an `https://`
prefix, a user who pastes `http://mcp.composio.dev/...` (or any non-TLS URL)
leaks the keychain-protected credential in cleartext on the wire.

The reviewer proposed adding `"pattern": "^https://"` to the
`composio_mcp_url` userConfig entry. But the local schema's
`userConfigEntry` definition at `schemas/plugin.schema.json` used:

```json
"required": ["type", "title"],
"additionalProperties": false
```

…and did not list `pattern` as a recognized property. Writing `pattern`
into any `plugin.json` therefore failed `pnpm validate:plugins` with an
"additional property not allowed" AJV error, blocking the security fix.

The class of problem extends beyond URL TLS enforcement: any future plugin
handling user-supplied URLs, file paths, or vendor-prefixed tokens cannot
express input-format constraints declaratively.

## Solution

Add `pattern` as an optional schema-level property on `userConfigEntry`,
gated to `string`-typed values (and `directory`/`file` path-shape values),
with a corresponding hand-rolled RULE 10 in `scripts/validate-plugin.js`
that enforces the same constraints from the script path that does NOT
AJV-load the schema (the same architectural reality that motivated RULE 9
for `type`+`title`).

### Schema layer (`schemas/plugin.schema.json`)

Add `pattern` to `definitions.userConfigEntry.properties`:

```json
"pattern": {
  "type": "string",
  "minLength": 1,
  "description": "Regular expression (JavaScript syntax, anchored with ^ and $ recommended) the user-supplied value must match. Only valid when `type` is one of: string, directory, file (number/boolean values cannot meaningfully carry a regex constraint). Enforced locally by scripts/validate-plugin.js RULE 10; remote-validator support is empirically untested at the time of introduction."
}
```

Add a 6th `if/then` block to the existing `allOf` array that rejects
`pattern` on number/boolean entries:

```json
{
  "if": {
    "properties": { "type": { "enum": ["number", "boolean"] } },
    "required": ["type"]
  },
  "then": { "properties": { "pattern": false } }
}
```

The `properties: { pattern: false }` formulation (rather than
`not: { required: ["pattern"] }`) is required because AJV strict-mode
rejects the `not.required` formulation as `strictRequired` (it expects
properties named in `required` to also be declared in the local schema's
`properties`, even inside a `not` clause). The `false`-schema idiom is
both stricter and AJV-strict-mode-friendly.

### Script layer (`scripts/validate-plugin.js` RULE 10)

`validate-plugin.js` does NOT AJV-load `schemas/plugin.schema.json`. The
schema layer alone catches `pattern` misuse only when an example fixture
runs through `tests/integration/example-files-schema.test.ts`. To make
`pnpm validate:plugins` enforce the same constraints, RULE 10 was added
inside the existing `validateUserConfigEntries` helper. The check fires
in both invocations (top-level `userConfig` and `channels[i].userConfig`)
and validates four invariants per entry:

1. `pattern` is a non-empty string when present.
2. `pattern` is only valid when `type` is one of `{string, directory, file}`.
3. `pattern` compiles as a JavaScript `RegExp` (via `new RegExp` in a
   try/catch) — invalid regex syntax is rejected with the V8 compile
   error message verbatim.
4. When `default` is present alongside `pattern` and is a string, the
   default itself must match the pattern. This catches internally
   inconsistent manifests (e.g., `pattern: "^https://"` with
   `default: "http://example.com"`).

### Test coverage

- `tests/integration/validate-plugin.test.ts` — new "PR-B" describe block
  with 10 fixture-based cases exercising every accept/reject path (string
  + directory + file accept; non-string, empty, number, boolean, invalid
  regex, default-mismatch reject; back-compat without `pattern`).
- `tests/integration/example-files-schema.test.ts` — new "PR-C" describe
  block with 8 cases that AJV-validate synthetic plugin manifests against
  the loaded `plugin.schema.json`. Plus: `examples/plugin-extended.example.json`
  now sets `pattern: "^https://"` on its `userConfig.api_endpoint` entry,
  exercising the field through the existing fixture loop.

## Architectural rationale: why both layers

The two-validator drift discussed in
`userconfig-type-title-remote-validator-drift.md` applies here too. The
`pnpm validate:schemas` chain runs four Node scripts; only
`validate-marketplace.js` AJV-loads its schema, and
`validate-plugin.js` is a 900-line hand-rolled validator that does NOT
load `schemas/plugin.schema.json`. Tightening the schema therefore
catches drift only via `pnpm test:integration` (which validates example
fixtures against the schema), not via `pnpm validate:plugins`. The
authoritative statement of this architectural reality lives in the
`validate-plugin.js` source comment at lines 856–864 (RULE 9 leading
comment), which RULE 10's leading comment now extends.

This is "Approach C" from the userConfig type+title brainstorm: schema
tightening + hand-rolled script rule. Approach B (schema only) was
rejected because `validate-plugin.js` does not AJV-load and would silently
miss the constraint on the script path.

## Common pattern recipes

These regex shapes are production-grade for common userConfig input types.
Always anchor with `^` and `$`. Adopt incrementally — `pattern` is purely
optional.

### HTTPS-only URL (the immediate motivating case)

```json
"composio_mcp_url": {
  "type": "string",
  "title": "Composio MCP URL",
  "pattern": "^https://[^\\s/$.?#].[^\\s]*$"
}
```

Looser variant accepting any HTTPS URL:

```json
"pattern": "^https://"
```

### Vendor-prefixed API keys

| Vendor | Pattern |
|---|---|
| OpenAI `sk-...` | `^sk-[A-Za-z0-9_-]{20,}$` |
| Anthropic `sk-ant-...` | `^sk-ant-[A-Za-z0-9_-]{20,}$` |
| Composio `cog_...` | `^cog_[A-Za-z0-9_-]{16,}$` |
| GitHub PAT (classic) | `^ghp_[A-Za-z0-9]{36}$` |
| GitHub PAT (fine-grained) | `^github_pat_[A-Za-z0-9_]{82}$` |
| Generic alphanumeric token | `^[A-Za-z0-9_\\-]{20,}$` |

### Filesystem path inputs (anti-traversal)

```json
"workspace_dir": {
  "type": "directory",
  "title": "Workspace directory",
  "pattern": "^[A-Za-z0-9_./\\-]+$"
}
```

For deeper traversal protection, combine with a `not.pattern` rejection
of `..` segments. Some JSON Schema implementations do not support
lookaheads, so the explicit anti-pattern is more portable than negative
lookahead inside the main pattern.

### File-path with extension constraint

```json
"config_file": {
  "type": "file",
  "title": "Config file",
  "pattern": "\\.json$"
}
```

The schema's own `relativeFile` pattern at line 65 of
`schemas/plugin.schema.json` is a reusable in-repo precedent for path
shape constraints.

## Empirical question: does the remote validator honor `pattern`?

As of the time of introduction, the Anthropic Claude Code remote validator
(`claude doctor`) has not been observed to honor or reject `pattern` on
userConfig entries. No public plugin in the observable ecosystem has
shipped this field. The local schema and RULE 10 enforce it deterministically
during `pnpm validate:plugins`; the remote may silently ignore it (best
case) or reject the entry as carrying an unknown field (worst case — same
class of failure as the `changelog` and `repository` field drift).

**Empirical-test recipe:**

1. Add `"pattern": "^https://"` to one `userConfig` entry in a test
   plugin's `plugin.json`.
2. Run `pnpm validate:schemas` locally — must pass after this PR lands.
3. `/plugin marketplace add <test-plugin>` in a clean Claude Code
   environment.
4. `claude doctor` — if it passes without a manifest validation error,
   `pattern` is accepted by the remote validator (silently or with
   enforcement, TBD).
5. Set a userConfig value violating the pattern. If Claude Code surfaces
   an error → remote enforces. If the value is silently accepted →
   remote ignores. Either way, local enforcement catches violations
   before publish.

Update this doc with the result once empirically verified.

## ReDoS risk note

ReDoS (catastrophic backtracking) risk for plugin-author-supplied regex
is **low** in this threat model. The compile path is one-shot at
validation time, not a hot path; ReDoS requires both an adversarial regex
AND an adversarial input length to manifest. The plugin-author trust
boundary is the same as `npm install` — if a plugin author wrote a
malicious regex, you have bigger problems. AJV itself does not guard
pattern strings, nor do `semantic-release`, `lerna`, or `Renovate` in
their config validators. If evidence of ReDoS-shaped patterns
recurs, `safe-regex` (npm) is the standard mitigation tool to wire into
RULE 10 as a warning (not a hard failure).

## Detection

To audit existing plugins for `pattern` adoption opportunities:

```bash
# Plugins with a userConfig field
jq '.userConfig // empty | keys' plugins/*/.claude-plugin/plugin.json

# Plugins that already use pattern (after this PR)
jq '.userConfig // empty | to_entries[] | select(.value.pattern) | {key: .key, pattern: .value.pattern}' plugins/*/.claude-plugin/plugin.json
```

## Prevention

- New plugin authoring docs reference this doc when discussing userConfig
  fields.
- `validate-plugin.js` RULE 10 enforces the four invariants on every
  CI run.
- The `additionalProperties: false` posture of `userConfigEntry` remains
  the contract — any future userConfig field requires the same
  schema + RULE pairing.

## References

- PR #396 review thread `PRRT_kwDOQ3SUys6AIYpq` (greptile P1 finding) —
  the motivating cleartext-credential incident.
- `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
  — prior art using the same schema + RULE pairing.
- `docs/brainstorms/2026-05-05-plugin-manifest-userconfig-validator-drift-brainstorm.md`
  — Decision 4 implementation note documenting the script-vs-schema
  enforcement reality.
- `scripts/validate-plugin.js:856–864` — source-of-truth comment on the
  AJV-vs-script split.
- AJV docs: <https://ajv.js.org/json-schema.html#if-then-else>
- AJV strict-mode `strictRequired` reference:
  <https://ajv.js.org/strict-mode.html#prohibit-required-keyword-in-shared-properties>
- JSON Schema draft-07: <https://json-schema.org/draft-07/json-schema-validation.html>
