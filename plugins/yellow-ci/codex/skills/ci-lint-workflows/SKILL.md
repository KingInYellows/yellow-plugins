---
name: ci-lint-workflows
description: Lint GitHub Actions workflows for self-hosted runner issues (W01-W14). Use when checking workflows before pushing or finding common CI pitfalls; previews and confirms before applying any fix.
---

## What It Does

Scans `.github/workflows/*.yml` (and `.yaml`) files against a rule set of
common self-hosted-runner pitfalls (W01-W14), reports findings grouped by
severity, and — only after an explicit preview-and-confirm gate — applies
auto-fixes with the `Edit` tool.

## When to Use

- Before pushing workflow changes, or when the user asks to "lint CI",
  "check workflows", or find common GitHub Actions pitfalls.
- For deeper rule detail, the `ci-conventions` reference documents the same
  W01-W14 catalog.

## Usage

If the argument text after the skill name names a workflow file, lint only
that file; otherwise lint every workflow under `.github/workflows/`.

### Step 1: Find Workflows

If the argument text after the skill name specifies a file:

- **Validate the path** — reject if it contains `..`, starts with `/` or `~`,
  or contains characters outside `[a-zA-Z0-9._/-]`. Respond: "Invalid file
  path: must be a relative path within the repository."
- Verify the resolved path is within `.github/workflows/`. Respond: "Path must
  point to a file inside `.github/workflows/`."
- Verify the file exists; respond "File not found: `<path>`" if missing.
- Lint that file only.

Otherwise:

- Find all files matching `.github/workflows/*.yml` and
  `.github/workflows/*.yaml`.
- If none found: "No workflow files found in `.github/workflows/`".
- For each matched file, verify its resolved path is within
  `.github/workflows/` (reject a symlink that resolves outside the
  directory) before reading or editing it — the same check as the
  named-file branch above.

### Step 2: Read and Analyze

For each workflow file, check these rules:

**Errors (must fix):**

- **W01:** Job without `timeout-minutes` → suggest `timeout-minutes: 60`
- **W07:** Missing `runs-on: self-hosted` label on a directly defined job
  when repo uses self-hosted runners; skip reusable-workflow caller jobs
  (`uses:` pointing to either a local `./.github/workflows/...` file or a
  remote `owner/repo/.github/workflows/file.yml@ref`) since their runner
  labels are defined by the called workflow
- **W13:** Using `actions/cache@v2` or `@v3` → upgrade to `@v4`

**Warnings (should fix):**

- **W02:** Package install step without caching → suggest ecosystem-appropriate
  cache
- **W03:** Hardcoded `/home/runner/work/` paths → use
  `${{ github.workspace }}`; do not rewrite unrelated `/home/runner/*` paths
  (caches, tool installs, runner-service paths)
- **W04:** PR-triggered workflow without `concurrency` group
- **W05:** Docker usage without cleanup step
- **W06:** `ubuntu-latest` in repo with self-hosted runner jobs
- **W10:** `actions/checkout` without `clean: true` on self-hosted
- **W11:** Matrix strategy without `fail-fast: false`
- **W12:** Deploy job without `environment` field
- **W14:** Cleanup/teardown steps without `if: always()`

**Info:**

- **W08:** `upload-artifact` without `retention-days`

### Step 3: Report Findings

Group by severity (Error → Warning → Info). For each finding show: file path
and line number, rule ID and description, whether it is auto-fixable, and the
suggested fix.

Example output:

```
## Lint Results: .github/workflows/ci.yml

### Errors (2)
- **W01** Line 12: Job `build` missing `timeout-minutes`
  Fix: Add `timeout-minutes: 60` ✅ Auto-fixable
- **W13** Line 25: Using `actions/cache@v2` (outdated)
  Fix: Update to `actions/cache@v4` ✅ Auto-fixable

### Warnings (1)
- **W04** Line 1: No concurrency group for PR workflow
  Fix: Add concurrency block ✅ Auto-fixable
```

### Step 4: Preview and Confirm Before Any Fix

If auto-fixable findings exist, gate every edit behind an explicit
preview-and-confirm step — never modify a workflow file before the user
confirms:

- **Preview first.** For each proposed fix, show the exact before/after change
  (the affected lines) without touching the file yet.
- Then ask, using `AskUserQuestion`: "Apply auto-fixes? [Apply all / Select
  individually / Skip]".
- Only after explicit confirmation, apply each approved fix with the `Edit`
  tool. On a host without `AskUserQuestion`, obtain an equivalent explicit user
  confirmation first — never edit a workflow file without one.
- After applying, re-read the file to verify it is still valid YAML.

### Error Handling

If a YAML syntax error is present:

- Report the parse error with the approximate line.
- Suggest fixing the syntax before linting rules.

If the workflow uses reusable workflows (`uses: ./.github/workflows/`):

- Note that the lint applies to the caller workflow only, not the called
  workflow.

### Success Criteria

- Every workflow (or the single named file) is checked against W01-W14 and
  findings are reported by severity.
- No workflow file is edited before an explicit preview-and-confirm gate.
