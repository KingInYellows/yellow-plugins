---
date: 2026-02-23
topic: plugin-versioning
---

# Plugin Versioning Strategy

## What We're Building

A versioning system for the yellow-plugins monorepo that supports **independent per-plugin versioning** — each plugin bumps on its own schedule, driven by changesets — while keeping a single catalog release artifact (one tarball, one GitHub Release).

Currently the entire infrastructure exists (publish-release.yml, marketplace.json, version fields in plugin.json) but has never been exercised, versions have drifted, and there is no process for when/how to bump. This work defines that process and adds lightweight tooling to enforce it.

## Why This Approach

Three options were considered:

- **A (full per-plugin changesets + per-plugin tags):** Maximum independence, but per-plugin git tags scatter the namespace and require separate release artifacts
- **B (changesets + single catalog release) ← chosen:** Per-plugin version granularity where it matters (Claude Code update detection reads `plugin.json` / `marketplace.json`), but keeps the existing release model (one tarball, one tag)
- **C (manual bump script):** Zero dependencies but no commit-based changelog automation and easy to forget

Approach B was chosen because Claude Code's marketplace only needs per-plugin versions in `marketplace.json` — it does not require per-plugin GitHub Releases or tarballs. The single catalog tag satisfies the existing `publish-release.yml` validation while changesets handles the per-plugin version math and CHANGELOG generation.

## Key Decisions

- **Per-plugin versioning:** Each plugin has its own `package.json` (added to `plugins/<name>/`) registered as a pnpm workspace. Changesets bumps these independently.
- **Changesets for automation:** Developers run `pnpm changeset` to record intent. `pnpm changeset version` auto-bumps and writes per-plugin `CHANGELOG.md`.
- **sync-manifests.js bridge:** A post-`changeset version` script reads all `plugins/*/package.json` versions and syncs them to `plugin.json` and `marketplace.json` — keeping Claude Code's native update detection accurate.
- **Single catalog tag (v1.x.x):** The root `package.json` version and git tag represent a "catalog snapshot." Bumping it signals a new set of plugin versions is available. The existing `publish-release.yml` fires on this tag.
- **Per-plugin CHANGELOG.md:** Lives at `plugins/<name>/CHANGELOG.md`. Claude Code's update command can display these if a `changelog` URL is added to each plugin's `plugin.json`.
- **Root CHANGELOG.md removed or repurposed:** The current root CHANGELOG.md would become a high-level "catalog release notes" file (not per-plugin detail).
- **CI enforcement:** New `validate-versions` CI step ensures `plugins/<name>/package.json` version equals `plugin.json` version equals the entry in `marketplace.json`. Fails PR if they drift.
- **No compatibilityConstraints yet:** Defer adding `claudeCodeMin`/`claudeCodeMax` fields until a real compatibility break occurs.

## Open Questions

- Should the catalog version reset to `1.0.0` now that individual plugins have their own versions, or continue from `1.1.0`?
- What initial version should each plugin's new `package.json` be set to — current `plugin.json` value (so `yellow-devin` starts at `2.0.0`)?
- Should `changelog` URL field be added to `plugin.json` manifests immediately, or deferred?
- Does `publish-release.yml` need to be extended to push per-plugin CHANGELOG content into GitHub Release notes, or is a single combined release note sufficient?

## Next Steps

→ `/workflows:plan` for implementation details (pnpm workspace setup, sync-manifests.js, CI job, initial version alignment)
