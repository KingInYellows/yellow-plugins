---
title: 'AJV CLI v8 strict mode rejects format keywords without ajv-formats'
category: build-errors
date: 2026-02-17
tags:
  - ajv
  - ajv-cli
  - json-schema
  - ci
  - github-actions
  - schema-validation
problem_type: ci-configuration
components:
  - .github/workflows/validate-schemas.yml
  - schemas/plugin.schema.json
severity:
  critical: 1
  important: 0
  nice_to_have: 0
  total: 1
---

# AJV CLI v8 strict mode rejects format keywords without ajv-formats

## Problem Symptom

All CI schema validation jobs fail with:

```
schema schemas/plugin.schema.json is invalid
error: unknown format "email" ignored in schema at path
       "#/properties/author/oneOf/1/properties/email"
Process completed with exit code 1.
```

Every PR triggers `UNSTABLE` CI status on the `Validate Schemas` jobs
(marketplace, plugins, examples targets).

## Root Cause

`ajv-cli@5.0.0` uses AJV v8 internally. AJV v8 in **strict mode**
(`--strict=true`) treats unregistered format keywords as errors instead of
silently ignoring them. The format `"email"` in the plugin schema requires the
`ajv-formats` plugin to be registered — but it was not being loaded.

The CI workflow installed `ajv-cli` globally but did not install or load
`ajv-formats`:

```yaml
# ❌ What was in CI — missing ajv-formats
- name: Install AJV CLI
  run: npm install -g ajv-cli@5.0.0

# ajv validate calls used --strict=true without -c ajv-formats
ajv validate \
  -s schemas/plugin.schema.json \
  -d "$manifest" \
  --strict=true \
  --all-errors
```

The TypeScript infrastructure code
(`packages/infrastructure/src/validation/ajvFactory.ts`) correctly loaded
`ajv-formats` via `applyFormats(this.ajv)`, but this only applied to the Node.js
validation scripts — not the `ajv` CLI binary used in CI.

## Working Solution

Install `ajv-formats` alongside `ajv-cli` and pass `-c ajv-formats` to all
`ajv validate` calls that use `--strict=true`.

### Step 1: Update the `Install AJV CLI` steps

Both `validate-schemas` job and `contract-drift` job install `ajv-cli`. Pin
`ajv-formats` version for reproducibility:

```yaml
- name: Install AJV CLI
  run: npm install -g ajv-cli@5.0.0 ajv-formats@3.0.1
```

### Step 2: Add `-c ajv-formats` to every `ajv validate --strict=true` call

```yaml
# Marketplace validation
ajv validate \
  -s schemas/marketplace.schema.json \
  -d .claude-plugin/marketplace.json \
  -c ajv-formats \
  --strict=true \
  --all-errors

# Plugin manifest validation (in loop)
ajv validate \
  -s schemas/plugin.schema.json \
  -d "$manifest" \
  -c ajv-formats \
  --strict=true \
  --all-errors

# Example files
ajv validate \
  -s schemas/marketplace.schema.json \
  -d examples/marketplace.example.json \
  -c ajv-formats \
  --strict=true \
  --all-errors

ajv validate \
  -s schemas/plugin.schema.json \
  -d "$example" \
  -c ajv-formats \
  --strict=true \
  --all-errors
```

### How `-c` works in ajv-cli v5

The `-c` flag tells ajv-cli to `require(module)(ajv)` — it loads the module and
calls it with the ajv instance. `ajv-formats` exports
`function addFormats(ajv, opts)`, so this works directly.

The module must be resolvable from the global node_modules where ajv-cli is
installed. Installing both with `npm install -g ajv-cli ajv-formats` puts them
in the same global prefix.

## Alternative: Remove format keyword from schema

If you don't need email format validation, remove `"format": "email"` from the
schema entirely. AJV v8 strict mode only complains about unknown formats that
appear in schemas — if the keyword isn't there, no error.

## Prevention

- When upgrading from `ajv-cli@4.x` (AJV v6) to `ajv-cli@5.x` (AJV v8), always
  check for format keywords in your schemas. AJV v6 silently ignored unknown
  formats; AJV v8 strict mode treats them as errors.
- Pair `ajv-cli@5` installs with `ajv-formats` in any CI workflow using
  `--strict=true`.
- Consider linting the CI workflow YAML to ensure both packages are always
  installed together.

## Related

- AJV v8 migration guide: https://ajv.js.org/v8-migration.html#formats
- ajv-formats package: https://www.npmjs.com/package/ajv-formats
- PR #21 in yellow-plugins:
  `fix: load ajv-formats in CI to satisfy AJV v8 strict mode format keywords`
