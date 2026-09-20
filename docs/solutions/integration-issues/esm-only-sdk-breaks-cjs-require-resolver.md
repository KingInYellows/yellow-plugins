---
title: 'ESM-Only Vendor SDK Exports Break a CJS require()-Based SDK Resolver'
date: 2026-09-10
category: integration-issues
track: knowledge
problem: 'Vendor SDK ships ESM-only exports (type: module, no require condition); an existing CJS require()-based resolver pattern cannot statically import it (TS1479)'
tags: [esm, cjs, require, dynamic-import, node16, ts1479, sdk-resolver, yellow-cursor, yellow-jules]
components: [plugins/yellow-cursor/src/sdk-resolver.ts, plans/specs/yellow-jules-integration.md]
---

## Context

Planning a new `yellow-jules` remote-agent provider plugin, a registry
check (`npm view @google/jules-sdk version dist-tags dist.integrity type
exports engines --json`) showed the SDK is `type: module` with
`exports["."]` = `{types: ./dist/index.d.ts, import: ./dist/index.mjs}` —
no `require` condition, no `engines` field.

The existing `yellow-cursor` provider's `plugins/yellow-cursor/src/
sdk-resolver.ts` resolves vendor SDKs via `require()`/`tryRequire()` under
a `module: node16` (CJS-emitting) tsconfig. Neither half of that pattern
transfers to an ESM-only package:

- A node16 CJS build cannot statically `import` an ESM-only package
  (TS1479).
- ESM module resolution ignores `NODE_PATH`, so a data-dir SDK install
  (installed outside the plugin's own `node_modules`) cannot be loaded the
  way the CJS resolver expects — it must be loaded via an absolute
  file-URL dynamic `import()` instead.

## Guidance

Before adopting or extending a CJS `require()`-based SDK-resolver pattern
for a new vendor dependency, check the target package's `exports` map and
`type` field for an ESM-only shape. If `exports["."]` has no `require`
condition, the CJS resolver pattern does not apply and must be replaced
with (or branched to) a dynamic `import()` path using an absolute file URL
— `NODE_PATH`-based tricks do not help ESM resolution.

`require(esm)`, supported on Node 22.12+/24, is a possible third option
but should not be assumed available — treat it as out of scope unless a
target Node version floor guarantees it.

Any test harness for a plugin-local-ESM vs. CJS-with-dynamic-import
resolver boundary should run from a working directory with **no ancestor
`node_modules`**, so Node's module resolution can't accidentally succeed
via a directory-walk fallback that would not hold in a real install.

## Why This Matters

A resolver pattern proven to work for one vendor SDK (`@cursor/sdk`, CJS)
is not a template that transfers to the next vendor SDK without
re-verifying the target package's module format. Copying the pattern
blind produces a TS1479 compile failure or an install that resolves at
dev time but breaks in a real data-dir install.

## When to Apply

- Any new remote-agent (or other vendor-SDK-backed) provider plugin, before
  writing or reusing an SDK-resolver module.
- Reviewing a plan or spec that cites an existing resolver pattern as
  precedent for a new vendor dependency — verify the new dependency's
  `package.json` `exports`/`type` fields match the precedent's assumptions
  before approving.

## Examples

**Registry check that surfaces this early:**
```bash
npm view <package> version dist-tags dist.integrity type exports engines --json
```

**Bad** (assumed transferable): reusing `sdk-resolver.ts`'s
`require()`/`tryRequire()` unchanged for an ESM-only package — fails at
compile time (TS1479) or at runtime resolution.

**Good**: branch on the target package's `exports["."]` shape at design
time; for ESM-only packages, resolve via
`await import(pathToFileURL(resolvedPath).href)` instead of `require()`.
