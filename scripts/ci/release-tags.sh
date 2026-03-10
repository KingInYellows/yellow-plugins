#!/usr/bin/env bash
# release-tags.sh — called by changesets/action publish step after the
# Version Packages PR merges. Creates per-plugin git tags and the root
# catalog tag, then pushes them to the remote. Per-plugin tags are pushed
# individually in Step 1; the catalog tag is pushed in Step 5.
#
# Per-plugin tags (e.g. yellow-core@1.1.1) are created by `changeset tag`
# for all packages with privatePackages.tag: true in .changeset/config.json.
#
# The catalog tag (e.g. v1.1.2) is used by the build-and-release job in
# version-packages.yml to create the GitHub Release. The root package.json
# was already bumped in the Version Packages PR by catalog-version.js, so
# its version is the new catalog version.
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
# In normal mode, this prevents duplicate release triggers from reruns.
# In recovery mode (RECOVERY_MODE=true), skip tag creation if it already exists.
if git ls-remote --tags origin "refs/tags/${CATALOG_TAG}" | grep -q "${CATALOG_TAG}"; then
  if [ "${RECOVERY_MODE:-}" = "true" ]; then
    echo "::warning::Catalog tag ${CATALOG_TAG} already exists — recovery mode, skipping tag creation."
  else
    echo "::error::Catalog tag ${CATALOG_TAG} already exists on remote."
    echo "::error::This is likely a duplicate run. Re-run with workflow_dispatch"
    echo "::error::(force_publish=true) to skip tag creation, or create the"
    echo "::error::GitHub Release manually: gh release create ${CATALOG_TAG}"
    exit 1
  fi
else
  # Step 4: Create the local catalog tag.
  git tag "$CATALOG_TAG"
  echo "Created catalog tag: ${CATALOG_TAG}"

  # Step 5: Push only the new catalog tag (not all local tags).
  # Using a specific ref avoids pushing stale tags from prior failed runs.
  git push origin "$CATALOG_TAG"
  echo "Pushed ${CATALOG_TAG} — build-and-release job will proceed."
fi
