#!/usr/bin/env bash
# release-tags.sh — called by changesets/action publish step after the
# Version Packages PR merges. Creates per-plugin git tags and the root
# catalog tag, then pushes only the new catalog tag.
#
# Per-plugin tags (e.g. yellow-core@1.1.1) are created by `changeset tag`
# for all packages with privatePackages.tag: true in .changeset/config.json.
#
# The catalog tag (e.g. v1.1.2) triggers publish-release.yml. The root
# package.json was already bumped in the Version Packages PR by
# catalog-version.js, so its version is the new catalog version.
#
# Exit codes:
#   0  — all tags created and pushed successfully
#   1  — catalog tag already exists (likely a duplicate run); emit actionable error

set -euo pipefail

# Step 1: Create per-plugin tags via changeset tag and push them to remote.
# `changeset tag` is idempotent — it skips tags that already exist locally.
# To push only tags created in this run (not the remote-fetched tags the
# checkout already has locally), capture the local tag list before and after,
# then push only the difference.
git tag -l | sort > /tmp/plugin-tags-before.txt
echo "Creating per-plugin tags..."
pnpm tag
git tag -l | sort > /tmp/plugin-tags-after.txt

NEW_PLUGIN_TAGS=$(comm -13 /tmp/plugin-tags-before.txt /tmp/plugin-tags-after.txt)
if [ -n "$NEW_PLUGIN_TAGS" ]; then
  echo "Pushing per-plugin tags..."
  printf '%s\n' "$NEW_PLUGIN_TAGS" | while IFS= read -r tag; do
    [ -z "$tag" ] && continue
    git push origin "refs/tags/$tag"
    echo "  Pushed: $tag"
  done
else
  echo "No new per-plugin tags to push."
fi

# Step 2: Read and validate the catalog version.
CATALOG_VERSION=$(node -p "require('./package.json').version")
if ! echo "$CATALOG_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "::error::Invalid catalog version in package.json: '${CATALOG_VERSION}'"
  echo "::error::Expected semver format (e.g. 1.2.3). Check catalog-version.js output."
  exit 1
fi
CATALOG_TAG="v${CATALOG_VERSION}"

# Step 3: Verify the catalog tag does not already exist on the remote.
# This prevents duplicate publish-release.yml triggers from reruns.
if git ls-remote --tags origin "refs/tags/${CATALOG_TAG}" | grep -q "${CATALOG_TAG}"; then
  echo "::error::Catalog tag ${CATALOG_TAG} already exists on remote."
  echo "::error::This is likely a duplicate run. If a release was not created,"
  echo "::error::check publish-release.yml for the tag trigger, or create the"
  echo "::error::GitHub Release manually at the tag ${CATALOG_TAG}."
  exit 1
fi

# Step 4: Create the local catalog tag.
git tag "$CATALOG_TAG"
echo "Created catalog tag: ${CATALOG_TAG}"

# Step 5: Push only the new catalog tag (not all local tags).
# Using a specific ref avoids pushing stale tags from prior failed runs.
git push origin "$CATALOG_TAG"
echo "Pushed ${CATALOG_TAG} — publish-release.yml will be triggered."
