---
title: "JSON Schema typeof-object Check Bypassed by Array Form"
date: 2026-04-28
category: logic-errors
tags: [json-schema, validation, discriminated-union, typeof, plugin-manifest]
components: [scripts/validate-plugin.js, schemas/plugin.schema.json]
---

## Problem

A validator script checked `typeof value === 'object'` to guard a block that
iterated hook entries with `Object.entries()`. When the hooks field accepted a
new array form (a discriminated union), arrays also satisfy `typeof === 'object'`,
so every hook entry silently bypassed shebang, set-e, and decision-output audits.
An inner `if (!Array.isArray(hookEntries)) continue` suppressed errors instead of
surfacing the mismatch.

Separately, a JSON Schema oneOf branch accepted `{ "type": "object" }` with no
further constraints, making `[{}]` (array containing an empty object) and `{}`
(bare empty object) pass validation. The intended shape was never enforced.

## Root Cause

Two independent patterns, same underlying failure mode:

1. **`typeof === 'object'` is not a discriminated union guard.** Both plain
   objects and arrays satisfy it. Any code path that needs to distinguish the two
   must add `&& !Array.isArray(value)` (or `Array.isArray(value)`) explicitly.
   Existing guards in Rules 6 and 7 of the same file already did this correctly;
   Rule 8 was added later without auditing the pattern.

2. **Unconstrained `{ "type": "object" }` in a JSON Schema oneOf means "any
   object accepted."** An empty object `{}` has type `"object"`, so it always
   matches. Without `minProperties: 1` or explicit `properties` + `required`,
   the branch imposes no real constraint.

## Fix

**Rule 8 guard (validate-plugin.js):**

```js
// Before
if (typeof manifest.hooks === 'object') { ... }

// After
if (typeof manifest.hooks === 'object' && !Array.isArray(manifest.hooks)) { ... }
```

**JSON Schema oneOf branches:**

```json
{
  "type": "object",
  "minProperties": 1
}
```

Apply `minProperties: 1` to every inline-object branch that carries semantic
meaning — both the items-of-array branch and the standalone branch 3 form.

## Prevention

- **Audit all `typeof === 'object'` consumers when adding an array-form variant.**
  Search the codebase for `typeof … === 'object'` on the same field name before
  merging any PR that introduces a new value shape. The pattern is invisible to
  TypeScript if the field is typed as `unknown` or `any`.
- **Pair every `{ "type": "object" }` branch in a oneOf with `minProperties` or
  `required`.** A naked object branch is functionally a catch-all for any object,
  including `{}`. Treat it the same way you treat an unguarded `else` clause.
- **Runtime validators and JSON Schema must be updated atomically.** When a new
  discriminant is added to a schema, open the validator script in the same PR and
  audit every consumer of the affected field.

## Related Documentation

- `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`
- `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`
