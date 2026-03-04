---
title: "CI Path Filter Too Narrow and Per-Plugin Tags Never Pushed"
date: "2026-03-03"
category: "workflow"
tags:
  - github-actions
  - path-filters
  - git-tags
  - changeset
  - ephemeral-runners
  - release-pipeline
  - pnpm-tag
components:
  - .github/workflows/validate-schemas.yml
  - scripts/ci/release-tags.sh
---

# CI Path Filter Too Narrow and Per-Plugin Tags Never Pushed

GitHub Actions `pull_request.paths` filters control which paths trigger a
workflow. Being too specific means entire enforcement jobs silently never run.
Similarly, git tags created by sub-commands on ephemeral CI runners are
discarded at job end unless explicitly pushed. Both patterns produce the same
failure mode: the release pipeline appears to work but delivers incomplete
remote state.

## Problems

### Problem 1: `changeset-check` silently bypassed for plugin content files

The `validate-schemas.yml` workflow had a `pull_request.paths` filter listing
only specific manifest files:

```yaml
  pull_request:
    paths:
      - 'plugins/**/.claude-plugin/plugin.json'
      - 'plugins/*/package.json'
```

Any PR that only changed plugin content files — `commands/**`, `skills/**`,
`agents/**`, `CLAUDE.md`, `README.md`, hooks — did **not** trigger the
workflow at all. The `changeset-check` job, which was meant to block PRs
without a `.changeset/*.md` file, was never reached for the most common type
of plugin change.

**Observable symptom:** A PR that modifies `plugins/yellow-core/commands/workflows/review.md`
shows no CI runs and merges without a changeset file, contradicting the
enforced workflow described in CONTRIBUTING.md.

### Problem 2: Per-plugin git tags created locally but never pushed to remote

`scripts/ci/release-tags.sh` ran `pnpm tag` (`changeset tag`) which creates
per-plugin version tags like `yellow-core@1.1.1` in the local git state of
the ephemeral runner. Only the catalog tag was explicitly pushed:

```bash
git push origin "$CATALOG_TAG"   # only the catalog tag
```

Since CI runners are ephemeral, the per-plugin tags were discarded when the
runner terminated. No error was surfaced — the job exited 0.

**Observable symptom:** After a Version Packages PR merges, the catalog tag
(`v1.1.2`) exists on remote but per-plugin tags (`yellow-core@1.1.1`) do not.
CONTRIBUTING.md and the version-packages.yml comments explicitly promise
per-plugin tags will be created on merge.

## Root Causes

### Problem 1

Path filter patterns are evaluated by GitHub as glob patterns against changed
file paths. The two listed patterns (`plugins/**/.claude-plugin/plugin.json`
and `plugins/*/package.json`) only match two specific file types. Changes to
any other file under `plugins/` result in zero path-filter matches and the
workflow does not trigger. The `changeset-check` job condition
(`if: github.event_name == 'pull_request'`) is never evaluated — the workflow
simply doesn't start.

### Problem 2

`changeset tag` (invoked via `pnpm tag`) creates tags in the local git
repository. The script logic only accounted for the single catalog tag it
constructed and pushed explicitly. Tags created by the upstream `pnpm tag`
command were an invisible side-effect that was never pushed. There was no
verification step confirming remote tags matched local tags after the job.

A naive fix of `git push origin --tags` would push all local tags — including
the full set of tags fetched from the remote during `actions/checkout` with
`fetch-depth: 0`. If any of those tags already exist remotely, the push fails
with a non-zero exit code. The targeted approach (before/after diff) avoids
this.

## Fix

### Fix 1: Broaden the path filter

**File:** `.github/workflows/validate-schemas.yml`

```yaml
# BEFORE
  pull_request:
    paths:
      - '.claude-plugin/marketplace.json'
      - 'plugins/**/.claude-plugin/plugin.json'
      - 'plugins/*/package.json'
      - 'schemas/*.schema.json'
      - 'scripts/validate-*.js'
      - 'api/cli-contracts/*.json'
      - 'packages/**/*.ts'
      - '.github/workflows/validate-schemas.yml'

# AFTER
  pull_request:
    paths:
      - '.claude-plugin/marketplace.json'
      - 'plugins/**'
      - '.changeset/**'
      - 'schemas/*.schema.json'
      - 'scripts/validate-*.js'
      - 'api/cli-contracts/*.json'
      - 'packages/**/*.ts'
      - '.github/workflows/validate-schemas.yml'
```

Changes:
- Replace the two narrow plugin patterns with `plugins/**` (catches all plugin
  content: commands, agents, skills, hooks, CLAUDE.md, README.md, manifests)
- Add `.changeset/**` so PRs that only add a changeset file also trigger the
  workflow

Apply the same `plugins/**` broadening to the `push.paths` filter.

### Fix 2: Push per-plugin tags using before/after diff

**File:** `scripts/ci/release-tags.sh`

```bash
# BEFORE — Step 1 only ran pnpm tag, never pushed per-plugin tags
echo "Creating per-plugin tags..."
pnpm tag

# AFTER — capture before/after tag sets and push only new tags
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
```

The before/after diff approach works because:
- All local tags at "before" were fetched from remote (already exist remotely)
- `pnpm tag` is idempotent — it only creates tags that don't already exist locally
- The diff is therefore exactly the set of new tags created by this run
- Each new tag is pushed individually with a specific ref, avoiding `--tags`

## Prevention

- **Audit path filter coverage at write time**: After writing `on.pull_request.paths`, enumerate all file types in the target directories and verify each type matches at least one filter pattern. Use `plugins/**` as the anchor rather than `plugins/**/*.json`
- **Prefer directory-level path filters over file-type patterns**: When the intent is "any change inside a plugin", write `plugins/**` not individual file patterns — future file types are automatically covered
- **Add `.changeset/**` to PR trigger paths**: A PR that only adds a changeset file should still trigger the workflow so changeset format validation runs
- **Enumerate all tags a command creates**: When invoking `changeset tag`, `semantic-release`, or similar commands that create git state internally, capture the full tag list before and after and push everything new — `git tag -l > before.txt` → run → `git tag -l > after.txt` → `comm -13 before.txt after.txt`
- **Never assume sub-commands push their output**: Any git state created inside a command must be explicitly pushed before the ephemeral runner exits; add a verification step (`git ls-remote --tags origin | grep prefix`) if correctness matters
- **Use `git push origin "refs/tags/$tag"` not `--tags`**: Targeted push avoids failing on already-remote tags; `--tags` fails if ANY local tag already exists on remote with a different SHA

## Related Documentation

- [`docs/solutions/workflow/changeset-release-pipeline-silent-failures.md`](changeset-release-pipeline-silent-failures.md) — CI advisory checks not in aggregator; inline publish `&&`-chain silent failures
- [PR #118](https://github.com/KingInYellows/yellow-plugins/pull/118) — Implementation reviewed and these issues identified
