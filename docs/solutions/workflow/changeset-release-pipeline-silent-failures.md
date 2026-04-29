---
title: "Silent Failures in Changeset-Based Release Pipeline"
date: "2026-03-03"
category: "workflow"
track: knowledge
problem: 'Silent Failures in Changeset-Based Release Pipeline'
tags:
  - changesets
  - github-actions
  - ci-enforcement
  - release-automation
  - monorepo
  - silent-failures
  - action-pinning
components:
  - .github/workflows/validate-schemas.yml
  - .github/workflows/version-packages.yml
  - scripts/ci/release-tags.sh
---

# Silent Failures in Changeset-Based Release Pipeline

Plugin versions are the only mechanism Claude Code uses to detect and offer
updates to users. If version bumps don't happen, users never receive update
notifications — regardless of how many changes are shipped. This document covers
two related silent-failure patterns discovered during the setup of automated
Changesets release automation in a monorepo.

## Problems

### Problem 1: Advisory CI check "exists" but doesn't enforce

`changeset-check` was a job in `validate-schemas.yml` that correctly detected
missing changeset files. However, it always exited 0 — and was never added to
the `ci-status` aggregator's `needs` list. Branch protection rules look at the
aggregator, not individual jobs directly. Result: developers could merge plugin
changes without a `.changeset/*.md` file, and the advisory check appeared to
"pass" in CI.

**Observable symptom:** CI shows green, PR merges, `changeset-check` log says
"Plugin files changed but no changeset" — but it's a warning, not an error.

### Problem 2: Inline publish one-liner silently fails after PR merge

The Version Packages workflow used an inline YAML string for the publish step:

```yaml
publish: pnpm tag && git tag "v$(node -p "require('./package.json').version")" && git push origin --tags
```

If `git tag` failed (e.g., tag already exists from a prior manual release), the
`&&` chain stopped. No tags were pushed. But the Version Packages PR had already
merged — the changeset files were consumed. Subsequent workflow runs found no
pending changesets and exited silently. The release never happened, with no error
surfaced anywhere.

**Observable symptom:** Version Packages PR merged. No git tags appeared. No
GitHub Release created. Next pushes to `main` produce no action from the
workflow.

Additionally, `git push origin --tags` pushes **all** local tags — including
stale ones from prior failed runs. If a remote tag already exists, the push
fails with a non-zero exit code and an unhelpful error message.

## Root Causes

### Problem 1

- `changeset-check` job used `::warning::` annotations and always `exit 0`
- The job was not listed in `ci-status.needs` (the branch-protection aggregator)
- The job was also not in `report-metrics.needs`, so metrics could declare "passed"
  before changeset validation even completed

```yaml
# BEFORE — always green
if [ -z "$NEW_CHANGESETS" ]; then
  echo "::warning::Plugin files changed but no .changeset/*.md file found."
  echo "::warning::This is advisory — the PR can still merge without a changeset."
  # No exit 1 — job always succeeds
```

### Problem 2

- Multi-step publish logic compressed into a single `&&` YAML string
- No individual step error messages
- No idempotency guard (no check if catalog tag already exists before creating it)
- `git push origin --tags` pushes all local tags, not just the intended new one
- A failed run leaves a "stuck" state: no more changesets, so the workflow's
  `publish` branch never runs again automatically

## Fix

### Fix 1: Make `changeset-check` blocking

**File:** `.github/workflows/validate-schemas.yml`

```yaml
# AFTER — blocking with actionable error
if [ -z "$NEW_CHANGESETS" ]; then
  echo "::error::Plugin files were modified but no .changeset/*.md file found."
  echo "::error::Changed plugins: $(echo "$CHANGED_PLUGINS" | tr '\n' ' ')"
  echo "::error::Run 'pnpm changeset' and commit the resulting .changeset/*.md file."
  echo "::error::See CONTRIBUTING.md#versioning for the developer workflow."
  exit 1
```

Add `changeset-check` to **both** the `ci-status` aggregator and `report-metrics`:

```yaml
ci-status:
  needs:
    [validate-schemas, validate-versions, lint-and-typecheck, unit-tests,
     integration-tests, contract-drift, security-audit, build, changeset-check]
  steps:
    - run: |
        # Allow skipped (changeset-check only runs on pull_request events,
        # not on push — the "Version Packages" PR itself correctly skips it)
        { [ "${{ needs.changeset-check.result }}" == "success" ] ||
          [ "${{ needs.changeset-check.result }}" == "skipped" ]; }
```

### Fix 2: Extract publish logic to a named script

**File:** `.github/workflows/version-packages.yml`

```yaml
# BEFORE
publish: pnpm tag && git tag "v$(node -p "require('./package.json').version")" && git push origin --tags

# AFTER
publish: bash scripts/ci/release-tags.sh
```

**File:** `scripts/ci/release-tags.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Step 1: Create per-plugin tags (changeset tag, idempotent)
pnpm tag

# Step 2: Validate catalog version
CATALOG_VERSION=$(node -p "require('./package.json').version")
if ! echo "$CATALOG_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "::error::Invalid catalog version: '${CATALOG_VERSION}'"
  exit 1
fi
CATALOG_TAG="v${CATALOG_VERSION}"

# Step 3: Check if tag already exists on remote (idempotency guard)
if git ls-remote --tags origin "refs/tags/${CATALOG_TAG}" | grep -q "${CATALOG_TAG}"; then
  echo "::error::Catalog tag ${CATALOG_TAG} already exists on remote."
  echo "::error::If no release was created, check publish-release.yml for the tag"
  echo "::error::or create the GitHub Release manually at tag ${CATALOG_TAG}."
  exit 1
fi

# Step 4: Create and push only the new catalog tag
git tag "$CATALOG_TAG"
git push origin "$CATALOG_TAG"   # Not --tags — avoids pushing stale prior-run tags
```

### Fix 3: Additional hardening (found during code review)

```yaml
# Pin all third-party actions to commit SHAs (not floating tags)
# Floating tags can be moved by the upstream repo, executing arbitrary code
# in a contents: write context.
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5     # v4
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020   # v4
- uses: changesets/action@6a0a831ff30acef54f2c6aa1cbbc1096b066edaf   # v1.7.0

# Add timeout to prevent indefinite queue with cancel-in-progress: false
jobs:
  version:
    timeout-minutes: 15
```

## Prevention

- **"Exists in YAML" ≠ "enforced by branch protection."** A CI job must be in
  the `needs` list of the `ci-status` aggregator job, and must `exit 1` on
  failure, for branch protection to block merges on it.

- **Never compress multi-step release logic into a YAML `&&` string.** Extract
  to `scripts/ci/<name>.sh` with `set -euo pipefail`, explicit `::error::` messages,
  and idempotency guards for any operation that creates remote state.

- **Push specific tags, not `--tags`.** Use `git push origin "$TAG"` to push
  only the intended tag. `git push origin --tags` pushes all local tags,
  including stale ones from prior failed runs, and fails opaquely if a remote
  tag already exists.

- **Guard against duplicate remote tags before creating them locally.**
  `git ls-remote --tags origin "refs/tags/${TAG}"` returns non-empty if the tag
  exists. Check this before `git tag "$TAG"` to emit a helpful recovery message
  instead of a silent partial failure.

- **Add all blocking checks to `report-metrics.needs` too.** The metrics job
  should reflect the final state of all required checks — not report "passed"
  while a check is still running.

- **Pin third-party CI actions to commit SHAs.** Floating tags (e.g., `@v1`,
  `@v4`) can be moved by upstream maintainers. Pinning to SHA protects
  `contents: write` workflows from supply chain attacks. Record the human-readable
  version in a comment: `uses: foo/bar@abc123 # v1.2.0`.

- **Add `timeout-minutes` to any job with `cancel-in-progress: false` concurrency.**
  Without a timeout, a hung job blocks the concurrency group indefinitely,
  preventing all future pushes to the branch from being processed.

## Related Documentation

- [`docs/solutions/code-quality/hook-set-e-and-json-exit-pattern.md`](../code-quality/hook-set-e-and-json-exit-pattern.md) — Shell `set -e` and exit code handling in hooks
- [`docs/solutions/code-quality/yellow-ci-shell-security-patterns.md`](../code-quality/yellow-ci-shell-security-patterns.md) — Shell script security patterns for CI
- [`docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`](../build-errors/ci-schema-drift-hooks-inline-vs-string.md) — CI schema validation patterns
- [PR #118](https://github.com/KingInYellows/yellow-plugins/pull/118) — Implementation of this fix
- [GitHub issue #26744 (anthropics/claude-code)](https://github.com/anthropics/claude-code/issues/26744) — Upstream bug: background auto-update doesn't prompt users even when newer version available
