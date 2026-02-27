---
name: ci:lint-workflows
description: "Lint GitHub Actions workflows for self-hosted runner issues. Use when user wants to check workflows before pushing, asks \"lint CI\", \"check workflows\", or wants to find common pitfalls in their GitHub Actions configuration."
argument-hint: '[workflow-file.yml]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Edit
  - AskUserQuestion
---

<!--
Usage: /ci:lint-workflows [file.yml]
       /ci:lint-workflows                          # All workflows
       /ci:lint-workflows .github/workflows/ci.yml # Specific file
Requires: .github/workflows/ directory with YAML files
-->

# Lint GitHub Actions Workflows

**Reference:** Load `ci-conventions` skill and `references/linter-rules.md` for
rule details (W01-W14).

## Step 1: Find Workflows

If `$ARGUMENTS` specifies a file:

- **Validate the path** — reject if it contains `..`, starts with `/` or `~`, or
  contains characters outside `[a-zA-Z0-9._/-]`. Respond: "Invalid file path:
  must be a relative path within the repository."
- Verify the resolved path is within `.github/workflows/`. Respond: "Path must
  point to a file inside `.github/workflows/`."
- Verify file exists; respond: "File not found: `<path>`" if missing
- Lint that file only

Otherwise:

- Find all files: `Glob: .github/workflows/*.yml` and `.github/workflows/*.yaml`
- If none found: "No workflow files found in `.github/workflows/`"

## Step 2: Read and Analyze

For each workflow file, check these rules:

**Errors (must fix):**

- **W01:** Job without `timeout-minutes` → suggest `timeout-minutes: 60`
- **W07:** Missing `runs-on: self-hosted` label when repo uses self-hosted
  runners
- **W13:** Using `actions/cache@v2` or `@v3` → upgrade to `@v4`

**Warnings (should fix):**

- **W02:** Package install step without caching → suggest ecosystem-appropriate
  cache
- **W03:** Hardcoded `/home/runner/` paths → use `${{ github.workspace }}`
- **W04:** PR-triggered workflow without `concurrency` group
- **W05:** Docker usage without cleanup step
- **W06:** `ubuntu-latest` in repo with self-hosted runner jobs
- **W10:** `actions/checkout` without `clean: true` on self-hosted
- **W11:** Matrix strategy without `fail-fast: false`
- **W12:** Deploy job without `environment` field
- **W14:** Cleanup/teardown steps without `if: always()`

**Info:**

- **W08:** `upload-artifact` without `retention-days`

## Step 3: Report Findings

Group by severity (Error → Warning → Info). For each finding:

- File path and line number
- Rule ID and description
- Whether auto-fixable
- Suggested fix

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

## Step 4: Offer Auto-Fix

If auto-fixable findings exist:

- Use AskUserQuestion: "Apply auto-fixes? [All / Select individually / Skip]"
- If applying: use Edit tool for each fix, show diff
- After applying: re-read file to verify YAML validity

## Error Handling

If YAML syntax error:

- Report parse error with approximate line
- Suggest fixing syntax before linting rules

If workflow uses reusable workflows (`uses: ./.github/workflows/`):

- Note: lint applies to caller workflow only, not called workflow
