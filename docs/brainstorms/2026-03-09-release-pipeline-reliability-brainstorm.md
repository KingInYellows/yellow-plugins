# Release Pipeline Reliability

**Date**: 2026-03-09
**Status**: Brainstorm
**Approach chosen**: Pipeline Simplification (merge two workflows into one)

---

## What We're Building

A single unified release workflow that replaces the current two-workflow
architecture (`version-packages.yml` + `publish-release.yml`). Today these
workflows are connected by a tag-push handoff: `version-packages.yml` creates a
Version Packages PR via changesets/action, and when that PR merges,
`release-tags.sh` pushes a catalog tag that triggers `publish-release.yml`. This
handoff is fragile -- a permissions misconfiguration (the exact issue that
blocked releases on 2026-03-09) silently breaks the chain with no notification,
no recovery path, and changeset files pile up causing merge friction.

The unified workflow will handle the full lifecycle in one run: detect pending
changesets, create the Version Packages PR, and after that PR merges, create
per-plugin tags, build release artifacts, and publish the GitHub Release -- all
within a single workflow file with clear job dependencies.

Additionally:

- Add a permissions preflight step that fails fast with an actionable error
  message if `GITHUB_TOKEN` cannot create pull requests
- Add `workflow_dispatch` for manual recovery after fixing configuration issues
- Add a failure notification step so pipeline breakages are immediately visible
- Remove the redundant full validation suite from the publish phase (lint,
  typecheck, unit tests, integration tests already passed in pre-merge CI)

## Why This Approach

The two-workflow design introduced a tag-push handoff that is an invisible
failure point. When `version-packages.yml` fails, nothing downstream triggers,
nothing notifies, and the only symptom is that releases stop appearing. The
current `publish-release.yml` also redundantly re-runs the entire validation
suite (schema validation, linting, type checking, unit tests, integration tests)
even though these checks already passed in `validate-schemas.yml` before the PR
merged to main.

Merging the workflows eliminates the handoff entirely. A single workflow is
easier to reason about, debug, and recover from. The tag-trigger mechanism for
`publish-release.yml` is not pulling its weight -- manual tag pushes as a
release mechanism can still be supported via `workflow_dispatch` on the unified
workflow.

**Alternatives considered:**

- **Targeted Hardening** (add preflight + notification to existing two-workflow
  structure): Lower effort but preserves the fragile handoff. Would need to add
  recovery mechanisms to both workflows independently.
- **Scheduled Health Check** (weekly cron to validate pipeline prerequisites):
  Useful addition but treats the symptom (detecting breakage) rather than the
  cause (the handoff itself). Over-engineering for current project scale.

## Key Decisions

1. **Immediate fix (before any code changes):** Enable "Allow GitHub Actions to
   create and approve pull requests" in repo Settings > Actions > General >
   Workflow permissions. This unblocks the current stuck release. A re-run of
   the failed workflow should succeed.

2. **Single workflow file:** Merge `version-packages.yml` and
   `publish-release.yml` into one workflow (likely keeping the
   `version-packages.yml` name). The workflow has two phases controlled by job
   conditions:
   - **Phase 1 (on push to main with pending changesets):** Run
     changesets/action to create/update the Version Packages PR.
   - **Phase 2 (on push to main after Version Packages PR merges):** Detect
     that changesets were just consumed, create tags, build artifacts, publish
     GitHub Release.

3. **Preflight permissions check:** Add a step before changesets/action that
   tests whether `GITHUB_TOKEN` can create a PR (e.g., a dry-run API call to
   `GET /repos/{owner}/{repo}/collaborators/{actor}/permission`). Fail fast
   with `::error::` annotation explaining exactly what setting to enable.

4. **Drop redundant validation from publish phase:** The publish phase should
   trust that pre-merge CI (`validate-schemas.yml`) already validated the code.
   The publish phase only needs: checkout, build, create tags, create release,
   generate release notes. This cuts release time significantly.

5. **Keep `release-tags.sh` mostly intact:** The script's logic (create
   per-plugin tags, validate catalog version, check for duplicate tags, push
   catalog tag) is solid and well-guarded. It just moves from being called by
   changesets/action's `publish` command to being called directly by a job step
   in the unified workflow.

6. **Add `workflow_dispatch` trigger:** Allow manual re-runs with no inputs
   needed (the workflow detects state from changeset files and package.json
   versions). This is the recovery path for any future breakage.

7. **Add failure notification:** A job with `if: failure()` that posts a clear
   summary. GitHub Actions annotations (`::error::`) are sufficient -- no need
   for Slack/Discord integration at current project scale.

8. **Update `releases.md` runbook:** The runbook documents the current
   two-workflow architecture. It needs to be updated to reflect the unified
   workflow, including the new recovery procedure (`workflow_dispatch`).

## Open Questions

1. **Should `publish-release.yml` be deleted or kept as a manual-only
   workflow?** It could be retained with only `workflow_dispatch` as a trigger
   for cases where you want to create a GitHub Release from an existing tag
   without going through changesets. Alternatively, delete it entirely and use
   `gh release create` for one-off releases.

2. **Should the unified workflow keep `cancel-in-progress: false`?** The
   current `version-packages.yml` uses this to prevent partial PR state. The
   publish phase also should not be cancelled mid-run. Likely keep it, but
   confirm this does not cause queue buildup during rapid merges.

3. **How to handle the existing `changeset-release/main` branch?** If
   changesets/action already pushed this branch but could not create a PR, it
   needs to be cleaned up before the first run of the fixed workflow. Verify
   whether enabling the repo setting + re-running the workflow handles this
   automatically, or if manual branch deletion is needed first.

4. **NPM publishing:** `publish-release.yml` has conditional NPM publishing
   (gated on `NPM_TOKEN` secret existence). Confirm whether this should carry
   over to the unified workflow or be deferred until NPM publishing is actually
   needed.
