---
title: "pnpm strict isolation MODULE_NOT_FOUND and semver regex metacharacter escaping"
date: 2026-02-24
category: build-errors
tags:
  - pnpm
  - strict-isolation
  - devDependencies
  - regex
  - semver
  - regexp
  - pr-review
  - release-scripts
  - versioning
  - false-positive
symptoms:
  - "scripts/catalog-version.js throws MODULE_NOT_FOUND for 'semver' at runtime under pnpm strict isolation"
  - "require() in a root-level Node.js script cannot resolve a package that exists only in a workspace sub-package"
  - "scripts/generate-release-notes.js regex fails to match versions containing + or other regex metacharacters in build metadata"
  - "extractChangelogSection returns empty string for versions like 1.0.0+build.1"
  - "trimEnd() flagged as potentially removing trailing dashes (false positive)"
affected_files:
  - scripts/catalog-version.js
  - scripts/generate-release-notes.js
  - package.json
  - pnpm-lock.yaml
related_docs:
  - docs/solutions/security-issues/yellow-linear-plugin-pr-review-fixes.md
  - docs/solutions/code-quality/multi-agent-re-review-false-positive-patterns.md
  - docs/solutions/code-quality/parallel-todo-resolution-file-based-grouping.md
severity: medium
---

# pnpm Strict Isolation `MODULE_NOT_FOUND` and Semver Regex Metacharacter Escaping

Two correctness bugs caught during PR #47 review, plus a false-positive pattern to recognize.

## Symptoms

1. **`MODULE_NOT_FOUND` at runtime** — `node scripts/catalog-version.js` crashes with `Error: Cannot find module 'semver'` even though `semver` appears somewhere in the workspace.
2. **Silent CHANGELOG mismatch** — `extractChangelogSection` returns empty for versions with `+` build metadata (e.g. `1.0.0+build.1`) because `+` is an unescaped regex quantifier.
3. **False-positive reviewer flag** — Automated reviewer claims `trimEnd()` could strip trailing `---` separators, but `trimEnd()` only strips whitespace.

---

## Root Cause 1 — pnpm Strict Module Isolation

pnpm v8+ uses strict module isolation by default (`node-linker=isolated` or symlinked `node_modules`). Packages required by root-level scripts must be declared in **root** `package.json` `devDependencies`. A package that is only a dependency of a workspace sub-package (e.g. `packages/infrastructure/package.json`) is **not** resolvable at the repo root.

```
Error: Cannot find module 'semver'
Require stack:
- /path/to/scripts/catalog-version.js
```

This affects any script run as:
```bash
node scripts/catalog-version.js  # or pnpm catalog:version
```

## Fix 1 — Add Package to Root `devDependencies`

Add the missing package to root `package.json` in alphabetical order within `devDependencies`:

```json
{
  "devDependencies": {
    "prettier": "^3.2.4",
    "semver": "^7.5.4",
    "typedoc": "^0.28.0"
  }
}
```

Then run `pnpm install` to update the lockfile. **Always stage both files together:**

```bash
pnpm install
git add package.json pnpm-lock.yaml
```

> **Rule:** If a root-level script calls `require('X')`, `X` must appear in root `devDependencies`. Never assume a sub-workspace's deps are reachable from the repo root under pnpm.

---

## Root Cause 2 — Incomplete Regex Escape for Semver Versions

When building a `RegExp` from a version string, only escaping dots is insufficient. Semver allows `+` in build metadata (e.g. `1.0.0+build.1`). An unescaped `+` in a `RegExp` constructor is a "one or more" quantifier and causes either `SyntaxError` or a silent pattern mismatch.

Before:
```javascript
// Only dots escaped — '+' in build metadata breaks the regex
const startPattern = new RegExp(`^## \\[?${ver.replace(/\./g, '\\.')}\\]?`);
```

## Fix 2 — Escape All Regex Metacharacters

```javascript
// Escape all regex metacharacters before interpolating into RegExp
const escaped = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startPattern = new RegExp(`^## \\[?${escaped}\\]?`);
```

The pattern `[.*+?^${}()|[\]\\]` covers all special regex characters. `\\$&` reinserts each matched character preceded by a backslash.

**General rule:** Any time you pass a user-supplied or externally-derived string into `new RegExp(...)`, escape all metacharacters first. This applies to version numbers, filenames, identifiers — anything not authored as a regex pattern.

---

## False Positive — `trimEnd()` Does Not Remove Dashes

Reviewer claimed `trimEnd()` before `endsWith('---')` could strip the trailing separator. This is incorrect. `String.prototype.trimEnd()` only removes Unicode whitespace characters (space, tab, newline, carriage return). Dash `-` is not whitespace and is never removed.

Resolution: add an inline comment to prevent the same flag in future review rounds:

```javascript
// trimEnd() strips only whitespace; '---' chars are preserved
const separator = catalogSection.endsWith('---') ? '\n\n' : '\n\n---\n\n';
```

**Pattern:** When correct code gets flagged, verify empirically first, then add a comment to document the invariant. Do not restructure working code to satisfy a false positive.

> See also: [Multi-Agent Re-Review False Positive Patterns](../code-quality/multi-agent-re-review-false-positive-patterns.md) — expected ~38% false-positive rate in round 2 reviews.

---

## Workflow Learnings

### Correct Agent Type for PR Comment Resolution

```
✅ yellow-review:workflow:pr-comment-resolver
❌ pr-review-toolkit:pr-comment-resolver
```

Agent type names must match the exact `name:` field in the agent's frontmatter. Plugin directory name differs from agent registry name.

### `gt modify` Multi-Line Commit Body

`gt modify -c -m "subject" -m "body"` fails when the body string contains literal newlines — the shell treats them as separate arguments which `gt` rejects as "unknown arguments."

```bash
# Fails with multi-line body
gt modify -c -m "fix: PR comments" -m "- escape regex
- add semver dep"

# Works — single concise message
gt modify -c -m "fix: address PR #47 review comments (round 3)"
```

See also: [Parallel Todo Resolution — Step 7: Commit patterns](../code-quality/parallel-todo-resolution-file-based-grouping.md)

### Lockfile Staging After `pnpm install`

After adding a root `devDependency`:

```bash
pnpm install          # updates pnpm-lock.yaml
git add package.json pnpm-lock.yaml   # stage BOTH
```

Staging only `package.json` leaves `pnpm-lock.yaml` dirty and fails CI's `--frozen-lockfile` integrity check.

---

## Prevention

- **Audit root scripts** — For every `require('X')` in `scripts/*.js`, verify `X` is in root `package.json` `devDependencies` before merging.
- **Regex from external strings** — Always apply `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` before passing any non-regex string to `new RegExp(...)`.
- **pnpm workspace setup** — When adding a new workspace package, re-check which scripts in `/scripts/` need deps now only declared in the new package.
