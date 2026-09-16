---
title: 'Claude Code plugin manifest validation errors on install'
category: build-errors
track: bug
problem: 'Claude Code plugin manifest validation errors on install'
date: 2026-02-18
tags:
  - claude-code
  - plugin
  - plugin-json
  - marketplace
  - schema-validation
  - install
problem_type: schema-validation
components:
  - .claude-plugin/marketplace.json
  - plugins/*/.claude-plugin/plugin.json
  - schemas/official-marketplace.schema.json
severity:
  critical: 3
  important: 0
  nice_to_have: 0
  total: 3
pr: direct-to-main
---

# Claude Code plugin manifest validation errors on install

## Problem Symptom

Plugin installation via `/plugin marketplace add KingInYellows/yellow-plugins` fails with validation errors on a fresh machine. Three distinct errors, each blocking install:

```
Error 1 (marketplace.json):
Unrecognized key: 'id'

Error 2 (plugin.json):
repository: Invalid input: expected string, received object

Error 3 (plugin.json):
hooks: Invalid input
```

All 10 plugins in the marketplace were affected by Error 2. Error 1 affected all 10 marketplace entries. Error 3 affected 3 plugins with hooks (gt-workflow, yellow-ci, yellow-ruvector).

## Investigation Steps

1. **Error 1** — Searched marketplace.json for the `"id"` field. Found it in all 10 plugin entries. Checked Claude Code's validator behavior: it uses strict schema validation that rejects any keys not defined in the schema. The `"name"` field already serves as the unique identifier, making `"id"` redundant.

2. **Error 2** — Examined all 10 plugin.json files. All used npm package.json convention for `repository`:
   ```json
   "repository": {
     "type": "git",
     "url": "https://github.com/KingInYellows/yellow-plugins.git"
   }
   ```
   Claude Code's validator expects a plain string URL, not an object.

3. **Error 3** — Three plugins referenced hooks via a file path string:
   ```json
   "hooks": "./hooks/hooks.json"
   ```
   Claude Code expects hooks defined inline as a JSON object. File path indirection is not supported.

## Root Cause

Claude Code's plugin validator enforces a stricter schema than npm's package.json conventions:

| Field | npm convention | Claude Code expectation |
|-------|---------------|------------------------|
| `repository` | `{"type": "git", "url": "..."}` object | Plain URL string |
| `hooks` | File path reference (`"./hooks.json"`) | Inline JSON object |
| Unknown keys | Ignored | Rejected (strict mode) |

The local validation schemas in `schemas/` did not enforce these constraints, so `pnpm validate:schemas` passed while actual Claude Code installation failed.

## Working Solution

### Fix 1: Remove unknown keys from marketplace.json

Remove any fields not in Claude Code's marketplace schema. The `"name"` field is the identifier.

```diff
 {
   "plugins": [
     {
-      "id": "yellow-core",
       "name": "yellow-core",
       "path": "plugins/yellow-core",
       "description": "..."
     }
   ]
 }
```

### Fix 2: Use string format for repository

```diff
 {
-  "repository": {
-    "type": "git",
-    "url": "https://github.com/KingInYellows/yellow-plugins.git"
-  }
+  "repository": "https://github.com/KingInYellows/yellow-plugins"
 }
```

### Fix 3: Inline hooks into plugin.json

Read the referenced hooks JSON file and inline its content directly into plugin.json.

Before:
```json
{
  "hooks": "./hooks/hooks.json"
}
```

After (inlined from hooks.json):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/check-git-push.sh"
          }
        ]
      }
    ]
  }
}
```

The hook handler JSON files (e.g., `hooks/hooks.json`) can remain in the repo for reference but are no longer loaded by Claude Code.

> **Superseded — see "Update — 2026-09-15" below.** Claude Code now auto-discovers `hooks/hooks.json`; the reference mirrors were deleted.

## Prevention Strategies

### 1. Schema-level enforcement

Add `"additionalProperties": false` to the marketplace schema's plugin entry definition and tighten the plugin.json schema:

```json
{
  "properties": {
    "repository": { "type": "string", "format": "uri" },
    "hooks": { "type": "object" }
  },
  "additionalProperties": false
}
```

This was partially done (marketplace schema updated) but plugin.json schema should also enforce `repository` as string-only.

### 2. CI validation alignment

The local `pnpm validate:schemas` pipeline must mirror Claude Code's actual validation behavior. When Claude Code rejects something that local CI accepts, the schema is too permissive. Treat remote install failures as schema bugs.

### 3. Test on a fresh machine

Before publishing a marketplace, test installation on a machine that has never seen the plugins. Local development environments may have cached state that masks validation failures.

### 4. Plugin authoring checklist

When creating plugin.json:

- `repository`: Always a plain URL string, never an object
- `hooks`: Always inline the hook definitions, never use file path references
- No extra keys: Only use fields defined in Claude Code's schema
- Run `pnpm validate:schemas` after every manifest change
- Test `plugin marketplace add` on a clean environment before release

## Related Documentation

- [AJV CLI v8 strict mode](./ajv-cli-v8-strict-mode-unknown-format.md) — Related schema validation issue with `ajv-formats`
- [Skill frontmatter requirements](../code-quality/skill-frontmatter-attribute-and-format-requirements.md) — Another Claude Code format strictness issue (`user-invocable` spelling)
- `docs/plugin-validation-guide.md` — Plugin validation reference
- `schemas/official-marketplace.schema.json` — Local marketplace schema (updated with `additionalProperties: false`)

## Update — 2026-09-15

The "can remain in the repo for reference but are no longer loaded" guidance
above is no longer true. Claude Code (observed on 2.1.272; the warning is
reported from ~2.1.267) auto-discovers `hooks/hooks.json` at the plugin root
**and** loads the inline `hooks` block in `plugin.json`, with no dedup between
the two sources. The six plugins that kept a "REFERENCE ONLY" mirror
(yellow-ruvector, yellow-ci, yellow-morph, yellow-debt, gt-workflow,
github-workflow) therefore registered every hook twice — a SessionStart
banner printed twice for yellow-ruvector, once for inline-only plugins — and
startup printed `hooks.json: unknown key "_comment" ignored` because the
loader only recognises `hooks` and `description` at the top level.

Resolution: the mirrors were deleted; the inline `plugin.json` block (generated
from `catalog/`) is the only Claude-side hook source, and `validate-plugin.js`
RULE 7 now errors whenever `hooks/hooks.json` exists, with or without inline
hooks (a hooks-only file is an un-cataloged hook source in this repo), and
`pnpm validate:generated` reports it as stale. The "Always inline the hook
definitions" checklist item above still stands — the change is that a file
mirror is no longer harmless. `hooks/codex-hooks.json`
is a separate, generated Codex contract and is unaffected. See also the
"Update — 2026-07-16" section in
[ci-schema-drift-hooks-inline-vs-string.md](./ci-schema-drift-hooks-inline-vs-string.md)
for the string-path vs inline-object history, and
`plans/fix-hooks-json-mirror-double-registration.md`.
