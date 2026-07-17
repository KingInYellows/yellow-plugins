---
title: 'CI schema drift — local plugin schema requires string hooks, plugins use inline objects'
category: build-errors
track: bug
problem: 'CI schema drift — local plugin schema requires string hooks, plugins use inline objects'
date: 2026-02-21
tags:
  - ci
  - schema-validation
  - plugin-json
  - hooks
  - schema-drift
  - ajv
problem_type: schema-drift
components:
  - schemas/plugin.schema.json
  - plugins/*/.claude-plugin/plugin.json
  - .github/workflows/validate-schemas.yml
severity:
  critical: 1
  important: 0
  nice_to_have: 0
  total: 1
pr: '31'
---

# CI schema drift — local plugin schema requires string hooks, plugins use inline objects

## Problem Symptom

`Validate Schemas (plugins)` CI job fails with:

```
plugins/gt-workflow/.claude-plugin/plugin.json invalid
[
  {
    instancePath: '/hooks',
    schemaPath: '#/properties/hooks/type',
    keyword: 'type',
    params: { type: 'string' },
    message: 'must be string'
  }
]
```

All other checks pass. The error repeats for every plugin that has a `hooks`
field.

## Root Cause

> **2026-07 update:** the validator asymmetry described below was
> time-scoped — it no longer reproduces on current Claude Code (2.1.211).
> See "Update — 2026-07-16" at the end of this doc.

Two validators for the same `plugin.json` field diverged:

| Validator | Expected `hooks` format |
|-----------|------------------------|
| Local CI (`schemas/plugin.schema.json`) | `"type": "string"` (file path) |
| Claude Code remote validator | Inline object (file paths rejected) |

When commit `7179c20` switched all plugins from:

```json
"hooks": "hooks/hooks.json"
```

…to inline objects (to satisfy Claude Code's validator):

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "bash ..." }]
    }
  ]
}
```

…the local CI schema was not updated. The CI had been silently failing on
every push since that commit landed on `main`.

## Fix

Update `schemas/plugin.schema.json` to accept both formats via `oneOf`:

```json
"hooks": {
  "oneOf": [
    {
      "type": "string",
      "description": "Path to hooks configuration file (legacy)."
    },
    {
      "type": "object",
      "description": "Inline hooks configuration keyed by event name."
    }
  ],
  "description": "Hooks configuration — inline object (preferred) or path to hooks file (string)."
}
```

The `oneOf` is deliberately permissive (no inner `additionalProperties`
constraint on the object) because the hook event schema is complex and
controlled upstream by Claude Code.

## Prevention

### Rule: Update both validators when changing plugin.json format

Any time you change `plugin.json` to satisfy one validator, immediately audit
the other:

| Changed | Also check |
|---------|-----------|
| Claude Code remote validator requirement | `schemas/plugin.schema.json` |
| Local CI schema | Test install on fresh machine |

### Add `additionalProperties: false` to local schemas

The local schema had `"additionalProperties": false` at the top level but not
inside nested objects. This caused it to catch unknown keys but not catch type
mismatches inside oneOf branches. Consider adding stricter validation inside
each branch.

### Validation checklist for `plugin.json` changes

- [ ] Run `pnpm validate:plugins` locally
- [ ] Check that local validation error matches the field you changed
- [ ] After fixing the local schema, verify CI passes on push
- [ ] If Claude Code remote validator was the reason for the format change,
      document the format requirement in `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`

### Detecting schema drift early

```bash
# Run local validator before pushing any plugin.json changes
pnpm validate:schemas

# If CI fails with "must be string/object/array" on a field that looks correct,
# the schema type definition is stale — not the plugin.json
```

## Related Docs

- [`claude-code-plugin-manifest-validation-errors.md`](./claude-code-plugin-manifest-validation-errors.md) —
  Claude Code's remote validator requirements (`repository` as string, `hooks`
  as inline object, no unknown keys in marketplace.json)
- [`ajv-cli-v8-strict-mode-unknown-format.md`](./ajv-cli-v8-strict-mode-unknown-format.md) —
  AJV v8 strict mode format keyword failures

## Secondary Learnings: Devin API Shell Pattern Fixes (PR #31)

From the same session, several shell script pattern fixes for the yellow-devin
plugin's LLM instruction files:

### Dedup check must include suspended/resuming states

```bash
# Wrong — misses paused sessions that are effectively active
# "status `new`, `claimed`, or `running`"

# Correct — V3 has two more active (non-terminal) states
# "status `new`, `claimed`, `running`, `suspended`, or `resuming`"
```

`suspended` and `resuming` sessions are not terminal — they can receive
messages and resume. Including them in the dedup check prevents creating a
duplicate session when one is just paused for cost savings.

### `--argjson` requires non-empty valid JSON

```bash
# Wrong — fails if TAGS_JSON is empty string
payload=$(jq -n --argjson tags "$TAGS_JSON" ...)

# Correct — always set defaults before --argjson
TAGS_JSON="${TAGS_JSON:-[]}"
REPOS_JSON="${REPOS_JSON:-[]}"
payload=$(jq -n --argjson tags "$TAGS_JSON" --argjson repos "$REPOS_JSON" ...)
```

`jq --argjson` fails with "invalid JSON" if the variable is an empty string.
Always set a valid JSON default (`[]` or `null`) before use.

### ENTERPRISE_URL must be defined alongside ORG_URL

LLM instruction files that reference `${ENTERPRISE_URL}` later in the doc must
define it in the same bash block where `ORG_URL` is defined:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"
ENTERPRISE_URL="${DEVIN_API_BASE}/enterprise"   # required if referenced later
```

### Client-side status filter — document page scope

When `--status STATUS` filtering is client-side (not a direct API filter),
document that it applies to the **current page only**:

> Note: `--status` filtering is applied client-side to the current page only —
> sessions with the requested status may exist on subsequent pages.

### `org_ids` is required in enterprise listing calls

Omitting `org_ids` from enterprise session list requests returns sessions from
all organizations in the enterprise account — a cross-org data access risk.
Always include:

```bash
url="${url}&$(jq -nr --arg org "$DEVIN_ORG_ID" '@uri "org_ids=\($org)"')"
```

---

## Update — 2026-07-16

While planning the Claude Code + Codex plugin pilot, primary-source
verification of the current Claude Code plugin docs
(code.claude.com/docs/en/plugins-reference, fetched 2026-07-16) found that
upstream now documents **both** `hooks` and `mcpServers` as accepting
`string | array | object`, with file-path examples for each, and states
"Plugin MCP servers work identically to user-configured servers."

This appears to reopen the question this doc closed in February 2026: has
Claude Code's remote validator started accepting a file-path string for
`hooks` — the exact case the Feb 2026 finding said was rejected?

Two explanations fit the evidence and neither is confirmed:

- The remote validator changed between Feb and Jul 2026.
- The Feb 2026 finding was scoped to a stricter surface (e.g. `claude plugin
  validate` / marketplace submission) that coexists with the currently
  documented general contract.

**Resolved 2026-07-16 — the spike landed in the same PR.**
`docs/research/2026-07-16-codex-plugin-contract-spike.md` findings (e) and
(f), verified against Claude Code 2.1.211: a file-referenced `mcpServers`
AND a string file path for `hooks` both pass `claude plugin validate` and a
clean install. The Feb 2026 inline-only rejection **no longer reproduces** —
the Root Cause table above is a correct historical record of the Feb–Jul
2026 window, but the asymmetry it describes (hooks inline-only vs mcpServers
file-path) is gone on current CLI versions.

Consequence: this repo's local `schemas/plugin.schema.json` constraint on
`hooks` shape is now a **local policy decision**, not a remote-validator
requirement. Loosening it (or keeping it strict for reviewability) is a
separate choice deferred to the pilot's later shells; nothing upstream
forces either.

Related: `plans/specs/claude-code-codex-plugin-pilot.md` R17(e)(f) — this
addendum is the durable record of *why* the spike existed, independent of
whether the plan file itself is later archived via `/plan:complete`.
