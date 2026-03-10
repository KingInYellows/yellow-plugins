# Feature: Unified Release Workflow

## Problem Statement

The release pipeline uses two workflows connected by a tag-push handoff:
`version-packages.yml` creates a Version Packages PR, and when merged,
`release-tags.sh` pushes a catalog tag that triggers `publish-release.yml`.
This handoff is fragile -- a permissions misconfiguration silently broke the
chain on 2026-03-09 with no notification, no recovery path, and changeset
files piling up causing merge friction.

<!-- deepen-plan: external -->
> **Research:** Single-workflow release patterns are well-established and
> explicitly recommended for small monorepos. The two-workflow tag-push handoff
> has a well-known failure mode: commits/tags pushed by `GITHUB_TOKEN` **do not
> trigger other workflows** by design. Many teams discover this silently. A
> single workflow eliminates this class of failure entirely.
> See: [semantic-release#1906](https://github.com/semantic-release/semantic-release/discussions/1906)
<!-- /deepen-plan -->

## Current State

- **`version-packages.yml`**: Runs `changesets/action` on push to main. Creates
  Version PR (pending changesets) or runs `release-tags.sh` (no changesets).
- **`publish-release.yml`**: Triggered by catalog tag push (`v*`). Runs full
  validation (schemas, lint, typecheck, unit tests, integration tests), builds
  artifacts, creates GitHub Release, optionally publishes to NPM.
- **`release-tags.sh`**: Creates per-plugin tags + catalog tag, pushes to remote.
  Has duplicate-tag guard and semver validation. Well-guarded, keep mostly intact.
- **Validation duplication**: All 6 checks in `publish-release.yml` already run
  in `validate-schemas.yml` pre-merge.

## Proposed Solution

Merge both workflows into a single `version-packages.yml` with two phases
controlled by `changesets/action`'s `published` output:

- **Phase 1** (`published == false`): Create/update Version Packages PR
- **Phase 2** (`published == true`): Create tags, build artifacts, publish release

Add preflight permissions check, `workflow_dispatch` trigger, and failure
notification. Drop redundant full validation from the publish phase (keep only
`validate:versions`). Delete `publish-release.yml`.

<!-- deepen-plan: external -->
> **Research: CRITICAL — `published` output may not work as assumed.** The
> `changesets/action` determines `published` by parsing stdout of the publish
> command for literal `New tag: @scope/name@version` lines. The current publish
> command is `bash scripts/ci/release-tags.sh`, which runs `changeset tag` +
> `git push` — it does NOT emit `New tag:` lines in the format the action
> expects. This means `published` will likely always be `"false"` even on the
> publish path.
>
> **Fix options (pick one):**
> 1. **Check for pending changesets instead** — use a step before
>    `changesets/action` that runs `ls .changeset/*.md 2>/dev/null | grep -v
>    README` and outputs a `has_changesets` flag. If no changesets, skip the
>    action entirely and go straight to publish jobs. Simplest approach.
> 2. **Use the `hasChangesets` output** — the action also sets `hasChangesets`
>    to `"true"` when changeset files exist and `"false"` when none exist. Use
>    `hasChangesets == 'false'` as the publish gate instead of `published`.
> 3. **Modify `release-tags.sh`** to echo `New tag:` lines in the expected
>    format. Fragile — couples the script to action internals.
>
> Option 1 or 2 is recommended. Option 2 is cleanest if the output is reliable.
> See: [changesets/action source (run.ts)](https://github.com/changesets/action/blob/main/src/run.ts),
> [changesets/action#141](https://github.com/changesets/action/issues/141)
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research: Simplify the job graph.** For a ~15-plugin monorepo that does not
> publish to npm, the recommended minimal structure is **3 jobs**, not 7:
>
> | Job | Purpose |
> |-----|---------|
> | **version-or-publish** | Run changesets/action or detect publish state |
> | **build-and-release** | Build artifacts + create GitHub Release |
> | **notify** | Failure notification (lightweight, `if: failure()`) |
>
> The separate `validate-release`, `build-artifacts`, `publish-release`, and
> `publish-npm` jobs can be collapsed. `validate:versions` can be a step within
> `build-and-release`. NPM publish can be a conditional step rather than a
> separate job. This halves the workflow complexity.
>
> Source: External research across changesets community patterns, confirmed by
> react-router and similar monorepos.
<!-- /deepen-plan -->

## Implementation Plan

### Pre-work: Unblock Current Release

- [ ] 0.1: Enable "Allow GitHub Actions to create and approve pull requests"
  in repo Settings > Actions > General > Workflow permissions
- [ ] 0.2: Re-run failed workflow: `gh run rerun 22787746813 --failed`
- [ ] 0.3: Merge the Version Packages PR once it's created
- [ ] 0.4: Confirm `publish-release.yml` triggers and completes successfully
- [ ] 0.5: Verify no stale `changeset-release/main` branch remains

### Phase 1: Unified Workflow

- [ ] 1.1: Add preflight job to `version-packages.yml`
  - Test `GITHUB_TOKEN` PR creation permission via GitHub API
  - Fail fast with `::error::` annotation explaining the fix
  - Example: `gh api repos/$GITHUB_REPOSITORY/pulls --method HEAD` or check
    token permissions via response headers

- [ ] 1.2: Add `workflow_dispatch` trigger to `version-packages.yml`
  - Optional `force_publish` boolean input (default false)
  - When true, skip phase detection and go straight to publish path
  - When false (or on push trigger), use `changesets/action` `published` output

<!-- deepen-plan: codebase -->
> **Codebase:** The `force_publish` input needs special handling. When
> `force_publish == true`, `changesets/action` does not run, so the `published`
> output will not exist. Downstream publish job conditions must OR both:
> `if: needs.version-or-publish.outputs.published == 'true' || inputs.force_publish == true`
> Alternatively, with the simplified 3-job graph, `force_publish` can set a
> job output directly, avoiding the conditional complexity.
<!-- /deepen-plan -->

- [ ] 1.3: Add conditional publish jobs after the existing `changesets/action` step
  - **`validate-release`** (if `published == true`): Run `pnpm validate:versions`
    only (sub-second, meaningful guard against version drift)
  - **`build-artifacts`** (needs validate-release): Generate release notes,
    create tarball, SBOM, checksums. Carry over from `publish-release.yml`
    lines 136-222
  - **`publish-release`** (needs build-artifacts): Create GitHub Release via
    `softprops/action-gh-release`. Pin to commit SHA (currently unpinned `@v1`)
  - **`publish-npm`** (needs build-artifacts, if not prerelease): Keep NPM
    publish gated on `NPM_TOKEN` secret existence (graceful skip when absent)
  - **`notify`** (if failure): Post `::error::` annotation with failure summary

<!-- deepen-plan: codebase -->
> **Codebase:** The `changesets/action` step at `version-packages.yml:51`
> currently has **no `id:` field**. Without an `id`, outputs cannot be
> referenced by downstream jobs. Must add `id: changesets` to the step AND
> add an `outputs:` block on the job to forward
> `steps.changesets.outputs.published` (or `hasChangesets`).
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Action versions already pinned in `version-packages.yml` that
> can be reused for the new jobs:
> - `actions/checkout`: `34e114876b0b11c390a56381ad16ebd13914f8d5` (v4)
> - `pnpm/action-setup`: `41ff72655975bd51cab0327fa583b6e92b6d3061` (v4)
> - `actions/setup-node`: `49933ea5288caeca8642d1e84afbd3f7d6820020` (v4)
> - `changesets/action`: `6a0a831ff30acef54f2c6aa1cbbc1096b066edaf` (v1.7.0)
>
> Still need SHAs for: `softprops/action-gh-release` (currently `@v1`),
> `actions/upload-artifact` (currently `@v4`), `actions/download-artifact`
> (currently `@v4`).
<!-- /deepen-plan -->

- [ ] 1.4: Pin all third-party actions to commit SHAs
  - `actions/checkout` — already pinned in version-packages.yml, carry over
  - `softprops/action-gh-release` — currently `@v1`, pin to SHA
  - `actions/upload-artifact`, `actions/download-artifact` — pin to SHA
  - `pnpm/action-setup`, `actions/setup-node` — pin to SHA

- [ ] 1.5: Keep `cancel-in-progress: false`
  - Prevents partial PR state and mid-publish cancellation
  - At current merge frequency, queue buildup is not a concern

### Phase 2: Cleanup

- [ ] 2.1: Delete `.github/workflows/publish-release.yml`
  - The unified workflow's `workflow_dispatch` with `force_publish` covers
    the manual-release-from-tag use case
  - Ship deletion in the same PR as the unified workflow (atomic cutover)

- [ ] 2.2: Update `release-tags.sh` comments
  - Remove references to `publish-release.yml` being triggered
  - Update the `echo` on the final line that says "publish-release.yml will
    be triggered"
  - Keep all tag logic intact (per-plugin tags, catalog tag, duplicate guard)

- [ ] 2.3: Update documentation
  - `.github/releases.md` — rewrite to reflect single-workflow architecture,
    add `workflow_dispatch` recovery procedure, fix stale Node 20 reference
  - `docs/operations/release-checklist.md` — update workflow references
  - `docs/CLAUDE.md` — update release flow description

<!-- deepen-plan: codebase -->
> **Codebase:** Four additional files reference `publish-release.yml` by name
> and must also be updated:
> - `CONTRIBUTING.md` (line 218) — emergency manual release says `git push
>   --tags` triggers `publish-release.yml`. **This will break if not updated.**
> - `docs/operations/ci.md` — Section 2 documents the release workflow
> - `docs/operations/ci-pipeline.md` — references publish-release.yml
> - `docs/operations/versioning.md` (line 57)
<!-- /deepen-plan -->

### Phase 3: Quality

- [ ] 3.1: Test with `workflow_dispatch` after deployment
  - Trigger a manual run to verify Phase 1 (version PR) path works
  - Trigger with `force_publish: true` to verify Phase 2 (publish) path works

- [ ] 3.2: Validate end-to-end on next real changeset
  - Push a changeset to main, verify Version PR is created
  - Merge Version PR, verify tags + GitHub Release are created

## Technical Details

### Key files to modify
- `.github/workflows/version-packages.yml` — add preflight, workflow_dispatch,
  publish jobs (the bulk of the work)
- `scripts/ci/release-tags.sh` — update comments only
- `.github/releases.md` — rewrite for unified workflow
- `docs/operations/release-checklist.md` — update references

### Files to delete
- `.github/workflows/publish-release.yml`

### Phase detection mechanism
Use `changesets/action`'s built-in outputs:
- `published` (boolean string): `'true'` when the action ran the publish
  command (no pending changesets), `'false'` when it ran the version command
- `publishedPackages` (JSON array): list of published packages
- All downstream publish jobs use `if: needs.version-or-publish.outputs.published == 'true'`

<!-- deepen-plan: external -->
> **Research: Recommended phase detection (revised).** Since the `published`
> output depends on `New tag:` stdout parsing that may not work with the
> custom `release-tags.sh` publish command, use this alternative approach:
>
> ```yaml
> - name: Check for pending changesets
>   id: check
>   run: |
>     if ls .changeset/*.md 2>/dev/null | grep -qv README; then
>       echo "has_changesets=true" >> "$GITHUB_OUTPUT"
>     else
>       echo "has_changesets=false" >> "$GITHUB_OUTPUT"
>     fi
> ```
>
> Then gate downstream jobs on:
> `if: needs.version-or-publish.outputs.has_changesets == 'false' || inputs.force_publish == true`
>
> This is simpler, does not depend on action internals, and handles
> `force_publish` naturally.
<!-- /deepen-plan -->

### Unified workflow job graph (simplified)
```
preflight (optional — can be a step in version-or-publish)
    |
version-or-publish (changesets/action + changeset detection)
    |
    +-- [no changesets OR force_publish] --> build-and-release
    |                                        (validate:versions + build +
    |                                         GitHub Release + npm publish)
    |
    +-- [if failure()] --> notify
```

<!-- deepen-plan: external -->
> **Research:** The simplified 3-job graph (version-or-publish,
> build-and-release, notify) is the community-recommended minimum for
> changesets-based workflows with GitHub Releases. Preflight can be a step
> within the first job rather than a separate job, reducing to 3 total jobs.
> Each job has a single responsibility and can be independently retried.
> See: [OpenReplay: Release Workflows with Changesets](https://blog.openreplay.com/release-workflows-changesets/)
<!-- /deepen-plan -->

## Acceptance Criteria

- Single workflow handles both versioning and publishing
- Preflight check catches permission misconfiguration with actionable error
- `workflow_dispatch` allows manual recovery (zero-config and force_publish)
- No redundant lint/typecheck/test runs during publish
- `validate:versions` still runs before tag creation
- NPM publish gracefully skips when `NPM_TOKEN` absent
- All third-party actions pinned to commit SHAs
- Failure notification visible in GitHub Actions UI
- Documentation updated to reflect new architecture
- `publish-release.yml` deleted

## Edge Cases

- **Rapid merges to main**: `cancel-in-progress: false` queues runs; 15-min
  timeout is the safety valve
- **Partially pushed tags on retry**: `release-tags.sh`'s `comm -13` approach
  won't re-push tags from a prior failed run. Consider adding `git ls-remote`
  check per tag for full retry idempotency (nice-to-have)
- **In-flight Version PR during migration**: Merge or close any pending Version
  Packages PR before deploying the unified workflow
- **Tag push does not re-trigger workflow**: `GITHUB_TOKEN` events do not
  trigger workflows — no infinite loop risk. Document this assumption.
- **`changeset-release/main` branch from prior failure**: `changesets/action`
  handles this automatically — it force-pushes the branch on each run

<!-- deepen-plan: codebase -->
> **Codebase:** The `generate-release-notes.js` script reads from
> `CHANGELOG.md`. Verify it does not depend on tags being pushed to remote
> before execution — in the unified workflow, tags may be created locally
> by `release-tags.sh` but the build step could run before the remote push
> completes. In the current architecture this is not an issue because
> `publish-release.yml` runs after tags are already on remote.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** The `.changeset/config.json` has `"access": "restricted"` but
> `publish-release.yml` uses `pnpm -r publish --access public`. This is a
> pre-existing inconsistency that would carry over. All packages in the
> `ignore` list are also `private: true`, so the NPM publish is likely a
> no-op regardless.
<!-- /deepen-plan -->

## Migration Checklist

1. Complete pre-work (steps 0.1-0.5) to unblock current release
2. Ensure no pending Version Packages PR exists
3. Ship Phase 1 + Phase 2 in a single atomic PR
4. Test via `workflow_dispatch` before relying on push-to-main path
5. Monitor next real changeset end-to-end

## References

<!-- deepen-plan: external -->
> **Research:**
> - [changesets/action source (run.ts)](https://github.com/changesets/action/blob/main/src/run.ts) — `published` output implementation and `New tag:` parsing
> - [changesets/action#141](https://github.com/changesets/action/issues/141) — `--no-git-tag` edge case where `published` stays false
> - [changesets/action#532](https://github.com/changesets/action/issues/532) — `publishedPackages` empty string issue
> - [semantic-release#1906](https://github.com/semantic-release/semantic-release/discussions/1906) — GITHUB_TOKEN limitation: tags don't trigger downstream workflows
> - [OpenReplay: Release Workflows with Changesets](https://blog.openreplay.com/release-workflows-changesets/) — single-workflow implementation example
> - No standardized Claude Code plugin release patterns exist publicly yet — this implementation is early-mover
<!-- /deepen-plan -->
