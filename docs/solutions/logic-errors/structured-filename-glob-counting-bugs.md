---
title: 'Structured Filename Glob Counting Bugs'
date: 2026-02-25
category: 'logic-errors'
---

# Structured Filename Glob Counting Bugs

## Problem

Shell scripts that count or filter files by structured filename components —
formats like `{id}-{status}-{severity}-{slug}-{hash}.md` — have two related
failure modes when using glob patterns:

### Fast-path/fallback hybrid causes silent undercounting

When a script uses a filename glob as a fast path and only falls back to
frontmatter grep if the fast path returns 0 results, files that do NOT follow
the naming convention are silently excluded whenever any file matches the fast
path. The fallback never runs.

```bash
# WRONG — hybrid approach silently skips files outside the glob match
count=$(ls *-pending-critical-*.md 2>/dev/null | wc -l)
if [ "$count" -eq 0 ]; then
  # Fallback to frontmatter grep — only runs if glob found nothing
  count=$(grep -rl 'status: pending' . | wc -l)
fi
```

If even one file matches the glob, `count` is set from glob results only.
Files that store status in frontmatter (not filename) are never counted.

### Glob double-counting from slug content overlap

The glob `*-pending-critical-*.md` matches `pending-critical` anywhere in the
filename, not just in the status-severity position. A file named:

```
001-ready-critical-fix-pending-critical-issue-abc.md
```

matches BOTH `*-pending-critical-*.md` AND `*-ready-critical-*.md` — counting
as both pending-critical and ready-critical, inflating both counts.

## Detection

Look for scripts that:

1. Use multiple globs with overlapping keyword subsets (e.g.,
   `*-pending-*` and `*-ready-*`) to count mutually exclusive states
2. Combine a glob fast path with a frontmatter grep fallback
3. Count files by structured filename components without anchoring to the
   component's position in the format

## Fix

Iterate all files exactly once using a bash regex anchored to the structured
format's field positions. The `[[ =~ ]]` operator with an anchored pattern
eliminates both bugs simultaneously:

```bash
# File format: {id}-{status}-{severity}-{slug}.md
# Anchor to positions: ^[0-9]+-(status)-(severity)-
count_pending_critical=0
count_ready_high=0

for f in *.md; do
  base="${f%.md}"
  if [[ "$base" =~ ^[0-9]+-(pending|ready)-(critical|high)- ]]; then
    status="${BASH_REMATCH[1]}"
    severity="${BASH_REMATCH[2]}"
    if [ "$status" = "pending" ] && [ "$severity" = "critical" ]; then
      (( count_pending_critical++ ))
    elif [ "$status" = "ready" ] && [ "$severity" = "high" ]; then
      (( count_ready_high++ ))
    fi
  fi
done
```

Key properties of this approach:

- **Single pass:** Each file is evaluated exactly once — no double-counting
- **Anchored:** `^[0-9]+-` pins status/severity to their structural positions,
  not slug content
- **Unified approach:** No fast-path/fallback split — all files go through the
  same logic
- **Capture groups:** `${BASH_REMATCH[1]}` and `${BASH_REMATCH[2]}` extract
  the matched fields for further dispatch without re-parsing

## Prevention

When writing scripts that count or filter by structured filename components:

1. **Never combine a glob fast path with a grep fallback** — pick one approach
   and apply it to all files uniformly
2. **Never use unanchored globs for mutually exclusive states** — `*-pending-*`
   is not exclusive; it matches `pending` anywhere in the slug
3. **Use bash regex with `^` anchoring** for structured filename formats —
   anchor to the field's position in the format string, not just its content
4. **Derive field values from `BASH_REMATCH`** rather than re-parsing to avoid
   inconsistency

Timeout budgets for hooks that iterate files must account for the worst-case
code path (O(N) single-pass iteration), not the best-case (glob on an empty
or small directory). Budget at least 3s per 1000 files for disk-resident
directories on WSL2.
