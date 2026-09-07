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
| `cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md` | 1.2.1-1.2.7 | Rubric source for `plugins/yellow-review/skills/yellow-thermonuclear-review/SKILL.md`. Adapted, not copied: the yellow skill adds report-only safety rails, a compact-return JSON contract, evidence-gated size thresholds (the upstream absolute 1,000-line crossing is **retained**; B1 only moves the count into an orchestrator-injected `<file-line-counts>` block so the reviewer does not guess), and inline MIT attribution. |
| `cursor-team-kit/agents/thermo-nuclear-code-quality-review.md` | 1.3.1-1.3.9 | Frontmatter and skill-preload reference for `plugins/yellow-review/agents/review/thermonuclear-reviewer.md`. Upstream's parent-orchestration section does not port: yellow's `/review:pr` already supplies the diff and dispatch context, and the yellow persona spawns nothing. |
| `cursor-team-kit/LICENSE` | 1.2.5 | Exact MIT notice text reproduced inline in the yellow `SKILL.md` body. Inline rather than a plugin-root path because the Cursor/Codex generator copies only `SKILL.md` + flat `references/*.md` from inside `skills/<name>/`, so any relative path out of that directory would dangle in every distributed copy. |

Upstream names are deliberately **not** retained. `cursor/plugins` already ships
`thermo-nuclear-code-quality-review` from two plugins; the yellow adaptation uses
`yellow-thermonuclear-review` (skill) and `thermonuclear-reviewer` (agent) so a
user with both marketplaces installed sees no third ambiguous copy.

## Verification

To verify snapshot integrity against upstream at the locked SHA:

Run from the repository root. The path list below mirrors the three rows of
the Snapshotted-files table above — deliberately not `find`, so the check
can't sweep in unrelated repo paths (e.g. `AGENTS.md`, `plugins/...`) if run
from somewhere other than the snapshot directory.

```bash
set -euo pipefail
SHA=6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf
SNAP=RESEARCH/upstream-snapshots/$SHA
MANIFEST="$SNAP/MANIFEST.md"
# Portable SHA-256: prefer sha256sum (Linux), fall back to shasum -a 256 (macOS).
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 | cut -d' ' -f1; }
else
  echo "ERROR: neither sha256sum nor shasum is available" >&2
  exit 1
fi
# Single source: the Snapshotted-files table in this MANIFEST (path, blob, bytes).
# Both integrity and movement loops iterate this list; do not duplicate it.
mapfile -t rows < <(awk -F'|' '
  /^\| `/ {
    path=$2; blob=$3; bytes=$4
    gsub(/^ +| +$/, "", path); gsub(/`/, "", path)
    gsub(/^ +| +$/, "", blob); gsub(/`/, "", blob)
    gsub(/^ +| +$/, "", bytes)
    if (path ~ /\// && blob ~ /^[0-9a-f]{40}$/)
      print path "|" blob "|" bytes
  }
' "$MANIFEST")
if [ "${#rows[@]}" -eq 0 ]; then
  echo "ERROR: failed to parse Snapshotted-files table in $MANIFEST" >&2
  exit 1
fi
drift=0
checked=0
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
for row in "${rows[@]}"; do
  rel=${row%%|*}
  rest=${row#*|}
  expect_blob=${rest%%|*}
  expect_bytes=${rest#*|}
  if ! gh api "repos/cursor/plugins/contents/${rel}?ref=$SHA" \
      -H "Accept: application/vnd.github.raw" >"$tmp"; then
    echo "FETCH ERROR: $rel" >&2
    drift=1
    continue
  fi
  remote=$(sha256 < "$tmp")
  if ! local=$(sha256 < "$SNAP/$rel"); then
    echo "LOCAL READ ERROR: $SNAP/$rel" >&2
    drift=1
    continue
  fi
  if [ "$remote" != "$local" ]; then
    echo "DRIFT: $rel"
    drift=1
  fi
  got_blob=$(git hash-object "$SNAP/$rel")
  if [ "$got_blob" != "$expect_blob" ]; then
    echo "BLOB SHA DRIFT: $rel got $got_blob expected $expect_blob" >&2
    drift=1
  fi
  got_bytes=$(wc -c < "$SNAP/$rel" | tr -d ' ')
  if [ "$got_bytes" != "$expect_bytes" ]; then
    echo "BYTE COUNT DRIFT: $rel got $got_bytes expected $expect_bytes" >&2
    drift=1
  fi
  checked=$((checked + 1))
done
if [ "$checked" -ne "${#rows[@]}" ]; then
  echo "ERROR: checked $checked of ${#rows[@]} expected files" >&2
  drift=1
fi
[ "$drift" -eq 0 ] && echo "OK: snapshot matches upstream at $SHA"
exit "$drift"
```

To re-check for upstream movement **past** the locked SHA (the drift audit
proper, required if implementation slips more than a week past 2026-09-05):

```bash
set -euo pipefail
SHA=6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf
SNAP=RESEARCH/upstream-snapshots/$SHA
MANIFEST="$SNAP/MANIFEST.md"
mapfile -t rows < <(awk -F'|' '
  /^\| `/ {
    path=$2; blob=$3
    gsub(/^ +| +$/, "", path); gsub(/`/, "", path)
    gsub(/^ +| +$/, "", blob); gsub(/`/, "", blob)
    if (path ~ /\// && blob ~ /^[0-9a-f]{40}$/) print path
  }
' "$MANIFEST")
if [ "${#rows[@]}" -eq 0 ]; then
  echo "ERROR: failed to parse Snapshotted-files table in $MANIFEST" >&2
  exit 1
fi
moved=0
for p in "${rows[@]}"; do
  if ! n=$(gh api "repos/cursor/plugins/commits?path=$p&since=2026-05-28T16:19:24Z" --jq 'length'); then
    echo "FETCH ERROR: $p" >&2
    moved=1
    continue
  fi
  printf '%s\t%s commit(s) since pin\n' "$p" "$n"
  [ "$n" -eq 0 ] || moved=1
done
exit "$moved"
```
