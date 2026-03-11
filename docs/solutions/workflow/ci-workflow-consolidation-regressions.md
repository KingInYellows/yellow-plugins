---
title: "CI Workflow Consolidation Regressions"
date: "2026-03-10"
category: "workflow"
tags:
  - github-actions
  - workflow-consolidation
  - npm-publish
  - gh-cli
  - release-automation
  - idempotency
  - recovery-mode
components:
  - .github/workflows/build-and-release.yml
  - scripts/ci/release-tags.sh
  - docs/release-checklist.md
  - docs/versioning.md
  - CONTRIBUTING.md
---

# CI Workflow Consolidation Regressions

When consolidating multiple GitHub Actions workflow files into a single unified
workflow, load-bearing configuration details from the original files can be
silently dropped. Unlike a code refactor where missing imports cause immediate
build failures, CI workflow regressions only surface at runtime -- often during
a release attempt, when the cost of failure is highest.

This document covers 5 critical bugs introduced during the consolidation of
`publish-release.yml` into `build-and-release.yml` (PR #160), plus a cascade
of stale documentation references caused by the same consolidation.

## Problems

### Bug 1: Missing `registry-url` in Setup Node.js step

The `build-and-release` job used `actions/setup-node` without the `registry-url`
input. Without this input, setup-node does not write an `.npmrc` file, so the
`NODE_AUTH_TOKEN` environment variable is never consumed. NPM publish fails
with an authentication error.

The deleted `publish-release.yml` had `registry-url: 'https://registry.npmjs.org'`
-- this was lost during consolidation.

**Observable symptom:** NPM publish step fails with `ENEEDAUTH` or
`npm ERR! need auth` despite `NODE_AUTH_TOKEN` being set in the environment.

### Bug 2: Repository name typo in publish condition

The publish step's `if` condition checked
`github.repository == 'kinginyellow/yellow-plugins'` (missing trailing `s` in
the owner name). The actual repository is `kinginyellows/yellow-plugins`. The
condition would never evaluate to true, meaning NPM publish would never execute
on any run.

**Observable symptom:** The publish step shows "skipped" in every workflow run.
No error is surfaced because the `if` condition is a valid expression that
evaluates to `false`.

### Bug 3: `gh api` preflight uses `-f` flag (implicit POST)

A preflight step used `gh api` with `-f state=closed -f per_page=1` to check
for a closed milestone. The `-f` flag tells `gh api` to send the values as
form fields in a POST request body, which implicitly switches the HTTP method
from GET to POST. The GitHub API returns 404 or 405 for POST on the milestones
endpoint.

**Observable symptom:** Preflight step fails with a GitHub API error. The fix
is to use URL query parameters instead: `?state=closed&per_page=1`.

### Bug 4: `body_path` and `generate_release_notes` conflict

The `softprops/action-gh-release` step specified both `body_path: release-notes.md`
and `generate_release_notes: true`. When both are present, the behavior is
ambiguous -- some versions of the action concatenate them, others prefer one
over the other. This produces unpredictable release note content.

**Observable symptom:** GitHub Release body contains auto-generated content
appended to or replacing the curated release notes.

### Bug 5: `release-tags.sh` fails in recovery mode

When `force_publish=true` (manual recovery after a failed release), the
`release-tags.sh` script checked whether the catalog tag already existed on
the remote and exited 1 if it did. This made recovery impossible -- the whole
point of `force_publish` is to retry after a partial failure where the tag may
already exist.

**Observable symptom:** Manual `workflow_dispatch` with `force_publish=true`
fails immediately with "Catalog tag already exists on remote" even though the
intent is to skip tag creation and proceed to the publish/release steps.

### Stale documentation cascade (Bugs 6-10)

The workflow consolidation changed the job structure from 5 jobs to 3,
removed `on.push.tags` trigger (the unified workflow triggers only on push
to `main` and `workflow_dispatch`), and renamed `workflow_dispatch` inputs
from `version`/`prerelease` to `force_publish`. Five documentation locations
retained stale references:

| Location | Stale Content |
|---|---|
| release-checklist.md | Referenced old `workflow_dispatch` inputs (`version`, `prerelease`) |
| release-checklist.md | 5-job architecture diagram (now 3 jobs) |
| release-checklist.md | "CI Workflow Dry-Run" section described running a real release via `force_publish=true` |
| versioning.md | Referenced `on.push.tags` trigger pattern |
| CONTRIBUTING.md | Referenced `on.push.tags` trigger pattern |

Multiple bots (devin, coderabbit, copilot, greptile, gemini) independently
flagged the same stale `on.push.tags` references -- a strong signal that
this class of staleness is detectable by automated review.

## Root Causes

All five bugs share a common root cause: **workflow consolidation treats CI
configuration as a code refactor, but CI configuration has no compile step**.

In a code refactor, missing an import or dropping a function parameter produces
an immediate build error. In a CI workflow refactor:

- Missing `registry-url` is syntactically valid YAML -- no error until runtime
- A typo in a string comparison is a valid expression -- no error ever, just
  always-false
- `-f` vs query params is a valid `gh` invocation -- wrong HTTP method, no
  static check
- `body_path` + `generate_release_notes` are both valid inputs -- conflict is
  semantic, not syntactic
- An `exit 1` on tag-exists is correct for normal mode but wrong for recovery
  mode -- context-dependent correctness

Each detail was **load-bearing but not obviously so** in the source file.
The consolidation author had to know that `registry-url` creates `.npmrc`,
that the repo owner has a trailing `s`, that `-f` implies POST, that the
release action's inputs interact, and that recovery mode requires idempotency.

## Fix

### Bug 1: Add `registry-url` to setup-node

```yaml
- uses: actions/setup-node@...
  with:
    node-version-file: '.node-version'
    registry-url: 'https://registry.npmjs.org'
```

### Bug 2: Correct repository name

```yaml
if: github.repository == 'kinginyellows/yellow-plugins'
```

### Bug 3: Use URL query params instead of `-f` flags

```bash
# BEFORE (implicit POST)
gh api "repos/$REPO/milestones" -f state=closed -f per_page=1

# AFTER (explicit GET via query params)
gh api "repos/$REPO/milestones?state=closed&per_page=1"
```

### Bug 4: Remove `generate_release_notes`

```yaml
- uses: softprops/action-gh-release@...
  with:
    body_path: release-notes.md
    # generate_release_notes: true  # REMOVED -- single source of truth
```

### Bug 5: Add `RECOVERY_MODE` env var to `release-tags.sh`

```bash
# Check if tag already exists on remote
if git ls-remote --tags origin "refs/tags/${CATALOG_TAG}" | grep -q "${CATALOG_TAG}"; then
  if [ "${RECOVERY_MODE:-}" = "true" ]; then
    echo "::notice::Catalog tag ${CATALOG_TAG} already exists (recovery mode -- skipping tag creation)"
  else
    echo "::error::Catalog tag ${CATALOG_TAG} already exists on remote."
    exit 1
  fi
else
  git tag "$CATALOG_TAG"
  git push origin "$CATALOG_TAG"
fi
```

The workflow passes `RECOVERY_MODE: ${{ inputs.force_publish }}` as an
environment variable to the script.

### Bugs 6-10: Documentation updates

- Rewrote release-checklist.md with correct 3-job architecture, current
  `workflow_dispatch` inputs, and a validation section (replacing the
  misleading "dry-run" section) with a warning that `force_publish=true`
  performs a real release
- Updated versioning.md and CONTRIBUTING.md to remove `on.push.tags`
  references and describe the actual trigger model (push to `main` +
  `workflow_dispatch`)

## Prevention

### 1. Diff the deleted file against the new file line-by-line

When consolidating workflow A into workflow B, do not just move the "important"
parts. Instead, diff A against B and account for every line in A:

```bash
# For each line in the deleted workflow, verify it exists in the new one
# or document why it was intentionally dropped
diff <(grep -v '^\s*#\|^\s*$' .github/workflows/publish-release.yml | sort) \
     <(grep -v '^\s*#\|^\s*$' .github/workflows/build-and-release.yml | sort)
```

### 2. Grep for the repository name after any consolidation

```bash
# Verify all repository name references are consistent
grep -rn 'github.repository' .github/workflows/ | \
  grep -v "kinginyellows/yellow-plugins"
# Any output = typo
```

### 3. Test `gh api` commands with `--verbose` before committing

```bash
# --verbose shows the HTTP method and URL
gh api "repos/owner/repo/milestones" -f state=closed --verbose 2>&1 | head -5
# If you see "POST /repos/...", the -f flag switched the method
```

### 4. Check action input interactions in the action's README

Before combining inputs from two different workflow files into one step,
read the action's documentation for input conflicts. For `softprops/action-gh-release`:
`body_path` and `generate_release_notes` should not both be set.

### 5. Design CI scripts for idempotent recovery from the start

Any CI script that creates remote state (tags, releases, packages) should
accept a recovery/force flag that makes it idempotent:

- Tag exists? Skip creation in recovery mode, error in normal mode
- Package version exists? Skip publish in recovery mode
- Release exists? Update body in recovery mode

### 6. Sweep documentation when changing workflow triggers or inputs

After changing `on:` triggers, `workflow_dispatch` inputs, or job structure,
grep all documentation for references to the old values:

```bash
grep -rn 'on\.push\.tags\|workflow_dispatch.*version\|workflow_dispatch.*prerelease' \
  docs/ CONTRIBUTING.md
```

### 7. Treat multi-bot convergence as a P1 signal

When 3+ independent review bots flag the same underlying issue (e.g., stale
`on.push.tags` references), treat the finding as P1 regardless of individual
bot severity ratings. Multi-bot convergence indicates a systemic issue, not
a style nit.

## Related Documentation

- [`docs/solutions/workflow/changeset-release-pipeline-silent-failures.md`](changeset-release-pipeline-silent-failures.md) -- Original release pipeline bugs (advisory checks, inline publish chain)
- [`docs/solutions/workflow/ci-path-filter-and-missing-tag-push.md`](ci-path-filter-and-missing-tag-push.md) -- Path filter gaps and ephemeral runner tag loss
- [`docs/solutions/code-quality/api-migration-stale-documentation-cascade.md`](../code-quality/api-migration-stale-documentation-cascade.md) -- Stale documentation patterns after API migrations (same class of problem in a different domain)
