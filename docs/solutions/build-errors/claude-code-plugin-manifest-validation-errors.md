---
title: 'Claude Code plugin manifest validation errors on install'
category: build-errors
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
- [Skill frontmatter requirements](../code-quality/skill-frontmatter-attribute-and-format-requirements.md) — Another Claude Code format strictness issue (`user-invokable` spelling)
- `docs/plugin-validation-guide.md` — Plugin validation reference
- `schemas/official-marketplace.schema.json` — Local marketplace schema (updated with `additionalProperties: false`)
