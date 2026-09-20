# Plugin Validation Guide

**Version**: 1.0.0 **Last Updated**: 2026-03-19 **Schema Version**:
plugin.schema.json v1.0.0

---

## Overview

> Current script scope: `scripts/validate-plugin.js` validates manifest shape,
> directory-name consistency, semver formatting, short-description warnings,
> keyword types, `outputStyles`, and plugin-local hook script paths. It does
> not support `--skip-network` or perform separate runtime checks for
> compatibility ranges or URL reachability.

This guide explains how to validate Claude Code plugin manifests using the
`validate-plugin.js` script and JSON Schema validation.

**Validation Ensures**:

- Manifest complies with plugin.schema.json
- Plugin name matches the directory name
- Required fields (`name`, `description`, `author`) are present (the JSON Schema
  also requires `version`, enforced via AJV in CI)
- Versions use semver format
- Optional keywords are well-formed

---

## Quick Start

### Prerequisites

```bash
# Install AJV for JSON Schema validation
npm install -g ajv ajv-formats

# Or in plugin directory
npm install --save-dev ajv ajv-formats
```

### Basic Validation

```bash
# Validate all plugins
node scripts/validate-plugin.js

# Validate a single plugin directory
node scripts/validate-plugin.js plugins/yellow-core

# Validate using the CI-style manifest path
node scripts/validate-plugin.js --plugin plugins/yellow-core/.claude-plugin/plugin.json

# Validate solution docs added/modified in the current PR's diff
# (blocks on slug collisions and required-frontmatter violations; see
# CONTRIBUTING.md "Solution Docs")
node scripts/validate-solutions.js
```

This guide focuses on plugin-manifest validation. The full validator
inventory wired into `pnpm validate:schemas`:

- `scripts/validate-marketplace.js` — marketplace catalog
- `scripts/validate-plugin.js` — plugin manifests
- `scripts/validate-setup-all.js` — `/yellow-core:setup:all` coverage
- `scripts/validate-agent-authoring.js` — agent/skill/command markdown rules
- `scripts/lint-error-codes.js` — error catalog import discipline
- `scripts/sync-shell-snippets.js --check` — install-script snippet sync
- `scripts/validate-solutions.js` — solution-doc frontmatter and slug
  uniqueness, diff-scoped

### Expected Output

**✅ Success**:

```text
Validating plugin: yellow-core
✓ PASS: Version: 1.1.0
✓ PASS: Plugin "yellow-core" is valid
ℹ INFO:   Version: 1.1.0
ℹ INFO:   Author: KingInYellows
```

**❌ Failure**:

```text
Validating plugin: broken-plugin
✗ ERROR: Missing required field: "description"
✗ ERROR: Plugin name "wrong-name" does not match directory name "broken-plugin"
```

---

## Validation Rules

### Rule 1: Schema Compliance

**Check**: Manifest validates against plugin.schema.json

**Required Fields**:

- `name` (kebab-case, max 64 chars)
- `version` (semver: MAJOR.MINOR.PATCH)
- `description` (10-280 chars)
- `author` (`string` or object with `author.name`)

**Example Error**:

```json
{
  "rule": "SCHEMA_COMPLIANCE",
  "field": "version",
  "message": "must match pattern '^[0-9]+\\.[0-9]+\\.[0-9]+$'"
}
```

**Fix**:

```json
// ❌ Invalid
"version": "1.2"

// ✅ Valid
"version": "1.2.0"
```

---

### Rule 2: Name Consistency

**Check**: Plugin name must match directory name

**Example Error**:

```json
{
  "rule": "NAME_CONSISTENCY",
  "field": "name",
  "message": "Plugin name 'hookify' must match directory name 'hookify-old'"
}
```

**Fix**:

```bash
# Option 1: Rename directory
mv plugins/hookify-old plugins/hookify

# Option 2: Update manifest
# Change "name": "hookify-old" → "name": "hookify"
```

---

### Rule 3: Semantic Version Compliance

**Check**: Version must be valid semver (MAJOR.MINOR.PATCH)

**Example Error**:

```json
{
  "rule": "SEMANTIC_VERSION",
  "field": "version",
  "message": "Invalid semver format: 1.2.x. Must be MAJOR.MINOR.PATCH (e.g., 1.2.3)"
}
```

**Fix**:

```json
// ❌ Invalid
"version": "1.2.x"
"version": "v1.2.3"
"version": "latest"

// ✅ Valid
"version": "1.2.3"
"version": "0.0.1"
"version": "2.10.15"
```

---

### Rule 4: Description Quality Warning

**Check**: Very short descriptions emit a warning

**Example Warning**:

```text
⚠ WARNING: Description is very short (< 10 chars). Consider being more descriptive.
```

### Rule 5: Keywords Format

**Check**: `keywords`, when present, must be an array of strings

**Example Error**:

```json
{
  "field": "keywords",
  "message": "All keywords must be strings"
}
```

**Fix**:

```json
// ❌ Invalid
"keywords": ["review", 123]

// ✅ Valid
"keywords": ["review", "automation"]
```

---

> **Additional checks**: The script also validates `outputStyles` values and
> plugin-local hook script paths (existence and basic structure). These checks
> run automatically but are not documented as separate numbered rules above.

> **Rules 6–11** run inside `validate-plugin.js` but have no numbered heading
> here. They cover plugin-local inline hook script paths and content sanity —
> for `bash "${CLAUDE_PLUGIN_ROOT}/…"` and `node "${CLAUDE_PLUGIN_ROOT}/…"`
> commands, existence and containment of the script (both interpreters,
> leading interpreter flags allowed), plus shebang, `set -e`, and decision
> output for `bash` scripts only; an unquoted or single-quoted
> `${CLAUDE_PLUGIN_ROOT}` in ANY word of the command is an error (`hook
> command has unquoted …` / `single-quotes …`) and any other interpreter
> (`sh`, `nodejs`, `/usr/bin/node`, `env node`, a leading assignment, a
> bare placeholder) is an error with no path check — RULE 6 checks
> `bash`/`node` only (RULES 6 + 8). Interpreter options are an
> allowlist: every option a hook command carries must appear in exactly
> one of the per-interpreter tables in `HOOK_OPTIONS`
> (`scripts/lib/plugin-paths.js` — `flag`, `takesValue`, `fileOperand`,
> `pathOperand`, `valueShape`, `noExecValues`, `attachedOnly`, `inline`,
> `noExec`; the table's comment block is the authoritative list and the
> reasoning behind each exclusion), and an option in none is itself an
> error (`passes an interpreter option RULE 6 does not recognise`) so an
> unknown option can never swallow the entrypoint word. What the tables
> enforce: inline-code options (`bash -c`, `node -e`/`-pe`) and no-exec
> options (`bash -n`/`-o noexec`/`-o onecmd`, `node --check`, help /
> version) are errors because there is no script, or it never runs;
> attached-only V8 flags written bare are an error; an operand that is
> empty, is really the next option, or fails the interpreter's own shape
> (`set -o` / `shopt` names, `--input-type` / `--unhandled-rejections`
> modes, numeric V8 values) is an error; bash short flags bundle and are
> looked up letter by letter with a value-taking letter allowed only
> last; bash has no `--opt=value` form and reads its long options before
> any single-character one (`bash -x --norc …` is "invalid option"); `--`
> (and bash's `-`) ends the options. The script word and every path
> operand must start with `${CLAUDE_PLUGIN_ROOT}/`, continue with plain
> path characters only (`[A-Za-z0-9._/-]` — node resolves `--import` as
> an ESM URL, where `%2e%2e`, `#` and `?` would make it load a different
> file than the one the validator checked), contain no `..`, not end in
> `/` or `/.`, and stay inside the plugin — hooks run with the project's
> cwd, so `bash hooks/x.sh` would name a file in whatever repository is
> open; a `fileOperand` (files node loads before the entrypoint:
> `-r`/`--require`, `--import`, the loaders, `--env-file`,
> `--openssl-config`) must also exist as a regular, non-symlink file whose
> real path stays inside the plugin's real path (no symlinked directory on
> the way), exactly like the script word, and its contents are trusted
> like the script's. Options with no script word
> after them are an error too. Quoting rule: every character of every
> `${CLAUDE_PLUGIN_ROOT}` occurrence must sit inside double quotes as the
> shell-word splitter sees it, so `""${CLAUDE_PLUGIN_ROOT}/x` (empty
> quotes quote nothing), a placeholder in a separated option operand, and
> `"$"{CLAUDE_PLUGIN_ROOT}/x` (a quote boundary inside the placeholder)
> are all errors. Anything else the splitter does not model is rejected
> outright: a backslash; a newline anywhere — between words too, `sh -c`
> treats it as a separator so `… x.sh` + newline + `curl … | sh` would
> run unchecked — or any other control character or non-shell whitespace
> (`\r`, `\v`, `\f`, NBSP, U+2028, BOM: the shell keeps them inside the
> word); an unquoted control operator or redirection; a `$(…)`/backtick
> substitution outside single quotes; any `$`/`~` expansion other than
> the exact placeholder (`$HOME/x`, `${CLAUDE_PLUGIN_ROOT:-x}`, unbraced
> `$CLAUDE_PLUGIN_ROOT`); and an unquoted glob or brace character. Only
> space and tab separate words, as in the shell. Verdicts are checked in
> that order — unterminated quote, placeholder quoting, unmodelled
> syntax, options, script — and the first hit is the one
> error reported; `hooks/hooks.json`
> presence (RULE 7) — an error whenever the file exists, with or without
> inline `hooks` in the manifest, because Claude Code auto-loads it as a
> second hook source and hook config in this repo lives only in `catalog/`
> (`pnpm validate:generated` reports the same file as `forbidden`, never deletes it); `userConfig`
> entry shape — a
> required `type` from the supported set, a required `title`, and the
> allowlist of fields Claude Code's remote validator accepts, applied to both
> the top-level object and each `channels[].userConfig` (RULE 9); and
> cross-plugin `dependencies` declarations, where a hard dep missing from the
> marketplace catalog warns (RULE 11). There is no RULE 10 — it was a reverted
> `userConfig` `pattern` rule. `outputStyles` is checked alongside the other
> path fields in the same pass (RULES 5b/5c), directory-only. Numbering
> resumes at 12 so existing error-message references stay stable.

> **Symlink policy — `validate-plugin`.** Symlinks are rejected outright,
> never followed. The validator refuses a plugin whose root is itself a
> symlink before reading anything (`Plugin directory is a symlink`), and
> auto-discovery (no argument) refuses a symlinked `plugins/` — dangling or
> not — with exit 2 before reading its entries (`discoverPlugins()` visits
> symlinked entries so they hit the root error instead of being skipped).
> Every path field (`commands`, `agents`, `skills`, `outputStyles`,
> `lspServers`, …) and every RULE 6 hook script rejects a `..` component
> (the kernel resolves a symlinked `docs/` before applying `docs/..`, which
> no lexical check can see), `lstat`s the final entry (a symlinked file or
> directory is an error) and walks every directory between the plugin
> root and the entry, erroring on the first symlink (`passes through a
> symlinked directory (hooks)`). RULE 6 additionally compares
> `realpath(script)` against `realpath(pluginDir)` — defence in depth,
> both sides resolved, so a plugin reached through a symlinked parent
> (macOS `/var` → `/private/var` cache roots) still passes. RULE 7 and the
> generator's forbidden-file check share one `lstat`-based existence
> helper (`lexistsSync` in `scripts/lib/plugin-symlink-policy.js`): a *dangling*
> `hooks/hooks.json` symlink is still an error (`existsSync` would report
> it absent while Claude Code can still try to load it), `hooks` being a
> plain file counts as absent, and an entry that cannot be inspected
> (ELOOP, EACCES) counts as present.

> **Symlink policy — `generate-manifests`.** One up-front pass refuses a
> symlinked `plugins/` (every plugin errors: `plugins is a symlink`) or a
> symlinked `plugins/<name>` root (`plugins/<name> is a symlink`), and the
> run aborts before any target is assembled. Every write and every stale
> unlink then gets the same on-disk check (`sweepCandidateProblem`): a
> target under `plugins/<name>` is contained in that plugin, a root-level
> marketplace (`.claude-plugin/`, `.agents/plugins/`, `.cursor-plugin/`) in
> the repository root; it is refused (`refusing to sweep|write …: … is a
> symlink …`) when any directory between the container and the path is a
> symlink or when the path's real target escapes the container's real
> path; a path that is itself a symlink is unlinked or renamed over only
> as the link (never through it), and a dangling one the same way.
> `atomicWrite` creates its `<target>.tmp` sibling with `O_EXCL`, so a
> planted `plugin.json.tmp` symlink is never written through (a leftover
> regular `.tmp` from an interrupted run is unlinked and recreated; a
> directory there is a labeled error). A trailing `/` on a plugin path
> does not defeat the root check (the path is resolved before `lstat`).
>
> Accepted residual: the on-disk checks run once before the apply pass, so
> a local process racing the generator between check and write could
> still swap a directory for a symlink (Node has no directory-relative
> `openat` writes); nothing in the repository can trigger that.

### Rule 12: Credential-userConfig Env-Var Fallback (warning)

For each `mcpServers.<server>.env.<KEY>: "${user_config.X}"` interpolation,
the validator checks whether a companion `${KEY:-}` shell-env-passthrough
entry exists in the same env block (or whether the env-key name itself ends
with `_USERCONFIG`, indicating the wrapper pattern is already in use).

When the companion entry is missing, the validator emits a warning
recommending the 3-element fallback wrapper pattern (yellow-research /
yellow-morph precedent). This pattern lets power users on multi-host fleets
resolve credentials from shell env vars (`PERPLEXITY_API_KEY`,
`SEMGREP_APP_TOKEN`, etc.) instead of running the userConfig prompt cycle
on every host.

**Why a warning, not an error**: Plugins that interpolate `${user_config.X}`
directly aren't broken — they just don't accept a shell env fallback. The
warning gives plugin authors a clear remediation path without breaking
existing manifests.

**Example warning**:

```text
[warn] yellow-foo: mcpServers.foo-server.env.FOO_API_KEY interpolates
${user_config.foo_api_key} directly. Consider the 3-element wrapper pattern
(FOO_API_KEY_USERCONFIG + FOO_API_KEY with ${FOO_API_KEY:-} fallback) so
power users on multi-host fleets can use shell env. See
plugins/yellow-research/bin/start-*.sh for the canonical pattern.
```

**Remediation**: Add a wrapper script under `bin/` that resolves precedence
(userConfig wins → shell env fallback → unset empty), and rewrite the env
block to declare both `_USERCONFIG` and shell-passthrough variants. See
`plugins/yellow-core/skills/multi-host-fleet/SKILL.md` for the canonical
contract and `plugins/yellow-research/bin/start-perplexity.sh` for the
~12-line wrapper template.

---

## CI Integration

### GitHub Actions

```yaml
name: Validate Plugin Manifests

on:
  pull_request:
    paths:
      - 'plugins/**'
      - 'schemas/**'
      - 'scripts/validate-plugin.js'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22.22.0'

      - name: Install dependencies
        run: |
          npm install -g ajv ajv-cli ajv-formats

      - name: Validate all plugins
        run: |
          set -e
          for plugin in plugins/*; do
            if [ -d "$plugin" ]; then
              echo "Validating $plugin..."
              node scripts/validate-plugin.js "$plugin"
            fi
          done

```

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Validate modified plugin manifests
git diff --cached --name-only | grep 'plugins/.*/\.claude-plugin/plugin\.json' | while read file; do
  plugin_dir=$(dirname $(dirname "$file"))
  echo "Validating $plugin_dir..."
  node scripts/validate-plugin.js "$plugin_dir" || exit 1
done

echo "✅ All plugin manifests valid"
```

---

## Common Errors and Solutions

### Error: "must have required property 'name'"

**Cause**: Missing required field

**Solution**:

```json
{
  "name": "my-plugin", // Add this
  "version": "1.0.0"
  // ...
}
```

---

### Error: "must match pattern '^[a-z0-9-]+$'"

**Cause**: Plugin name contains uppercase, spaces, or special chars

**Solution**:

```json
// ❌ Invalid
"name": "My Plugin!"
"name": "my_plugin"
"name": "MyPlugin"

// ✅ Valid
"name": "my-plugin"
"name": "myplugin"
"name": "my-plugin-v2"
```

---

### Error: "must be >= 10 characters"

**Cause**: Description too short

**Solution**:

```json
// ❌ Invalid
"description": "Plugin"  // Only 6 chars

// ✅ Valid
"description": "A simple plugin for testing purposes"  // 42 chars
```

---

### Error: "keywords must be an array"

**Cause**: `keywords` is not an array

**Solution**:

```json
// ❌ Invalid
"keywords": "review"

// ✅ Valid
"keywords": ["review", "automation"]
```

---

### Error: "must match format 'email'"

**Cause**: Invalid email address

**Solution**:

```json
// ❌ Invalid
"author": {
  "email": "not-an-email"
}

// ✅ Valid
"author": {
  "email": "dev@example.com"
}
```

---

## Secrets & Environment Variables

Best practices for handling credentials, API keys, and environment variables in
plugins.

### Prefer OAuth over API keys

Claude Code handles the full OAuth lifecycle (token storage in system keychain,
automatic refresh, revocation via `/mcp`) for HTTP MCP servers. Users don't need
to manage any files or environment variables.

Use OAuth when your MCP server supports it (see yellow-linear, yellow-chatprd
for examples).

### For env-var-based auth

When a plugin requires API keys or tokens (e.g., for REST API calls via curl):

1. **Document the required env var** in the plugin's `README.md` under
   "Prerequisites" — within the first 3 lines of the section
2. **Validate at entry points** — check the variable is set, validate its
   format, and show the setup URL on failure:

   ```bash
   if [ -z "$MY_API_TOKEN" ]; then
     printf 'ERROR: MY_API_TOKEN not set\n' >&2
     printf 'Get your token: https://example.com/settings/api\n' >&2
     printf 'Then: export MY_API_TOKEN="your_token_here"\n' >&2
     exit 1
   fi
   ```

3. **Never echo or log token values** in error messages or debug output
4. **Use `env` field in plugin.json** for non-secret config (paths, feature
   flags) — not for credentials:

   ```json
   "mcpServers": {
     "my-server": {
       "command": "npx",
       "args": ["my-mcp-server"],
       "env": {
         "STORAGE_PATH": "${PWD}/.my-server/"
       }
     }
   }
   ```

5. **Use `${VAR}` expansion** in `.mcp.json` for secrets that come from the
   user's shell environment:

   ```json
   {
     "my-server": {
       "type": "http",
       "url": "https://api.example.com/mcp",
       "headers": {
         "Authorization": "Bearer ${MY_API_TOKEN}"
       }
     }
   }
   ```

### No `.env` file convention

Plugins should NOT require users to create `.env` files. Instead:

- **MCP servers**: use OAuth or `${VAR}` expansion in `.mcp.json`
- **Shell commands**: read from the user's shell environment (`$VAR`)
- **Rationale**: avoids the "which `.env` file?" confusion across projects and
  worktrees

### Never store secrets in plugin code

- No hardcoded tokens or API keys in any plugin file
- No `.env` files committed to the repository
- The `.gitignore` already excludes `.env`, `.env.local`, and `.env.*.local`

---

## Validation Checklist

Before publishing plugin:

- [ ] Run `node scripts/validate-plugin.js plugins/<name>`
- [ ] Required fields are present in `.claude-plugin/plugin.json`
- [ ] Plugin name matches the directory name
- [ ] Version is valid semver (e.g., 1.2.3)
- [ ] Description is not trivially short
- [ ] `keywords`, if present, is an array of strings
- [ ] `outputStyles`, if present, points to a plugin-local directory with `.md`
  files
- [ ] Inline hook scripts, if present, resolve inside the plugin and are
  readable/executable

---

## Advanced Validation

### Custom Validation Rules

```javascript
// scripts/custom-validate.js
const { validatePlugin } = require('./validate-plugin');

async function customValidation(pluginDir) {
  // Run standard validation
  const result = await validatePlugin(pluginDir);

  // Add custom checks
  const manifest = JSON.parse(
    fs.readFileSync(`${pluginDir}/.claude-plugin/plugin.json`)
  );

  // Example: Check license exists
  if (!manifest.license) {
    console.warn('⚠️  No license specified');
  }

  // Example: Check changelog for version
  if (manifest.docs.changelog) {
    const changelog = await fetch(manifest.docs.changelog).then((r) =>
      r.text()
    );
    if (!changelog.includes(manifest.version)) {
      console.warn(`⚠️  Changelog missing version ${manifest.version}`);
    }
  }

  return result;
}
```

### Programmatic Validation

```javascript
const { validatePlugin } = require('./scripts/validate-plugin');

// Validate in Node.js
const result = validatePlugin('plugins/hookify');

if (result.valid) {
  console.log('✅ Plugin valid');
} else {
  console.error('❌ Validation failed');
  process.exit(1);
}
```

---

## Troubleshooting

### "Cannot find module 'ajv'"

**Solution**:

```bash
npm install -g ajv ajv-formats
# Or in plugin directory
cd plugins/hookify
npm install --save-dev ajv ajv-formats
```

---

### "EACCES: permission denied"

**Solution**:

```bash
# Make validation script executable
chmod +x scripts/validate-plugin.js

# Or run with node explicitly
node scripts/validate-plugin.js plugins/hookify
```

---

### "plugin.json not found"

**Solution**:

```bash
# Check manifest location
ls -la plugins/hookify/.claude-plugin/plugin.json

# Create directory if missing
mkdir -p plugins/hookify/.claude-plugin
```

---

### Unsupported `--skip-network` flag

**Solution**:

```bash
# The current validator does not support --skip-network.
# Run the script directly against the plugin directory instead.
node scripts/validate-plugin.js plugins/hookify
```

---

## Exit Codes

| Code | Meaning   | Description                                |
| ---- | --------- | ------------------------------------------ |
| 0    | Success   | Plugin manifest is valid                   |
| 1    | Invalid   | Validation errors (schema, business rules) |
| 2    | Not Found | Manifest file not found or unreadable      |

**Usage in Scripts**:

```bash
node scripts/validate-plugin.js plugins/hookify
if [ $? -eq 0 ]; then
  echo "✅ Valid, proceeding with install"
else
  echo "❌ Invalid, aborting"
  exit 1
fi
```

---

## Summary

Validation ensures plugin manifest integrity:

1. **Schema Compliance**: Required fields and JSON schema shape are valid
2. **Name Consistency**: Plugin name matches the directory name
3. **Version Quality**: Versions are valid semver strings
4. **Description Quality**: Very short descriptions are flagged
5. **Optional Field Hygiene**: `keywords`, `outputStyles`, and inline hook
   scripts are validated when present

**Golden Rule**: Validate before every publish/commit!

```bash
node scripts/validate-plugin.js plugins/<name>
```
