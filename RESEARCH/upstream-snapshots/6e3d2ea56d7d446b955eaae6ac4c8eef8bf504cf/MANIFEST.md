# Upstream Snapshot Manifest

**Source repo:** `cursor/plugins`
**Locked SHA:** `6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf`
**Commit at SHA:** "Restore thermo-nuclear-code-quality-review in cursor-team-kit (#95)" (2026-05-28)
**Licence:** MIT, per-plugin at `cursor-team-kit/LICENSE` (`Copyright (c) 2026 Cursor`). `cursor/plugins` has **no root LICENSE** and the GitHub API reports `license: null` for the repository, so the per-plugin file snapshotted here is the operative licence for this material.
**Fetched:** 2026-09-05
**Fetched by:** `/yellow-core:flow:work` Phase 1.1 for `plans/thermonuclear-review-integration.md` (stack item 1, `agent/chore/thermonuclear-upstream-snapshot`).
**Cap policy:** neither snapshotted file exceeds the 500-line reference cap. Both are adapted, not ported whole — see the task map below.

## Drift audit at fetch time

Re-run on 2026-09-05 per `docs/solutions/code-quality/upstream-concept-fork-snapshot-protocol.md`:

- `GET /repos/cursor/plugins/commits?path=<path>&since=2026-05-28T16:19:24Z` returned `0` commits for **both** snapshotted paths.
- Current `HEAD` blob SHAs equal the pinned blob SHAs for both paths (and for `cursor-team-kit/LICENSE`).
- Every fetched file's `git hash-object` output equals its upstream blob SHA, so the snapshot is byte-identical to upstream at the locked SHA.

**Conclusion: zero drift between the pinned commit and upstream `HEAD` as of 2026-09-05.**

## Snapshotted files

| Snapshot path (repo-relative upstream path) | Blob SHA | Bytes |
|---|---|---|
| `cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md` | `ac76a2bc88bb2d895e83ab1788aa584a82346cfc` | 12437 |
| `cursor-team-kit/agents/thermo-nuclear-code-quality-review.md` | `dc83d959306c41bb9a4b504608d9607be34e4297` | 1874 |
| `cursor-team-kit/LICENSE` | `ca2bba771cd39dbef6acf96b52481133983451f3` | 1063 |

Note: `cursor/plugins` ships the same skill blob from two plugins — `cursor-team-kit/skills/…` and `thermos/skills/…` share blob `ac76a2bc…`. We pin the `cursor-team-kit` copy because the pinned commit is the one that restored it there. `thermos/LICENSE` carries the same blob as `cursor-team-kit/LICENSE`.

## Snapshot -> yellow-plugins task map

| Snapshot file | yellow-plugins task(s) | Use |
|---|---|---|
| `cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md` | 1.2.1-1.2.7 | Rubric source for `plugins/yellow-review/skills/yellow-thermonuclear-review/SKILL.md`. Adapted, not copied: the yellow skill adds report-only safety rails, a compact-return JSON contract, evidence-gated size thresholds (the upstream absolute 1,000-line rule is replaced per plan blocker B1 and its research annotation), and inline MIT attribution. |
| `cursor-team-kit/agents/thermo-nuclear-code-quality-review.md` | 1.3.1-1.3.9 | Frontmatter and skill-preload reference for `plugins/yellow-review/agents/review/thermonuclear-reviewer.md`. Upstream's parent-orchestration section does not port: yellow's `/review:pr` already supplies the diff and dispatch context, and the yellow persona spawns nothing. |
| `cursor-team-kit/LICENSE` | 1.2.5 | Exact MIT notice text reproduced inline in the yellow `SKILL.md` body. Inline rather than a plugin-root path because the Cursor/Codex generator copies only `SKILL.md` + flat `references/*.md` from inside `skills/<name>/`, so any relative path out of that directory would dangle in every distributed copy. |

Upstream names are deliberately **not** retained. `cursor/plugins` already ships
`thermo-nuclear-code-quality-review` from two plugins; the yellow adaptation uses
`yellow-thermonuclear-review` (skill) and `thermonuclear-reviewer` (agent) so a
user with both marketplaces installed sees no third ambiguous copy.

## Verification

To verify snapshot integrity against upstream at the locked SHA:

```bash
SHA=6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf
# Portable SHA-256: prefer sha256sum (Linux), fall back to shasum -a 256 (macOS).
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 | cut -d' ' -f1; }
else
  echo "ERROR: neither sha256sum nor shasum is available" >&2
  exit 1
fi
# Every file except this MANIFEST is a verbatim upstream copy. $rel already
# matches the GitHub Contents API path (e.g.
# `cursor-team-kit/agents/thermo-nuclear-code-quality-review.md`) — cursor/plugins
# is a monorepo with each plugin at a top-level directory, so do NOT strip the
# `cursor-team-kit/` prefix.
drift=0
while IFS= read -r f; do
  rel=${f#./}
  remote=$(gh api "repos/cursor/plugins/contents/${rel}?ref=$SHA" -H "Accept: application/vnd.github.raw" | sha256)
  local=$(sha256 < "$f")
  if [ "$remote" != "$local" ]; then
    echo "DRIFT: $rel"
    drift=1
  fi
done < <(find . -type f ! -name MANIFEST.md)
[ "$drift" -eq 0 ] && echo "OK: snapshot matches upstream at $SHA"
exit "$drift"
```

To re-check for upstream movement **past** the locked SHA (the drift audit
proper, required if implementation slips more than a week past 2026-09-05):

```bash
for p in \
  cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md \
  cursor-team-kit/agents/thermo-nuclear-code-quality-review.md
do
  n=$(gh api "repos/cursor/plugins/commits?path=$p&since=2026-05-28T16:19:24Z" --jq 'length')
  printf '%s\t%s commit(s) since pin\n' "$p" "$n"
done
```
