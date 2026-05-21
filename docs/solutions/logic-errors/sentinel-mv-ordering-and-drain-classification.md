---
title: 'Sentinel-before-mv ordering and three-way drain file classification'
date: 2026-05-20
category: logic-errors
track: bug
problem: >-
  Atomic rename + sentinel ordering creates unrecoverable ambiguous state when sentinel is written after mv;
  concurrent-drain file cleanup misclassifies stale crashed-drain orphans as protected in-flight files
tags:
  - crash-recovery
  - atomic-rename
  - sentinel
  - concurrent-drains
  - idempotency
  - pipeline
  - two-phase-commit
components:
  - plugins/yellow-core/agents/workflow/staging-promoter.md
  - plugins/yellow-core/agents/workflow/staging-reviewer.md
---

# Sentinel-before-mv ordering and three-way drain file classification

Two interacting design bugs found during PR #543 review rounds 1–3 on the
compound-staging pipeline. Both concern what happens when a drain crashes
mid-operation and a subsequent drain tries to recover.

---

## 1. Sentinel-before-mv: write the sentinel BEFORE the atomic rename

### Problem

The natural implementation order for an atomic "write then promote" operation is:

```bash
# WRONG ordering
mv "$TMP" "$FINAL_PATH"   # 1. make the file visible (atomic rename)
printf '...' > "$SENTINEL" # 2. record that it is done
```

This creates an **unrecoverable ambiguous state**. If the process crashes between
steps 1 and 2, the next drain invocation sees:

- `$FINAL_PATH` exists
- `$SENTINEL` does not exist

It cannot tell whether:

- (a) A prior drain promoted this entry and crashed before writing the sentinel
  — do NOT re-promote.
- (b) A different drain promoted a slug-colliding entry long ago, and this is a
  fresh collision — rename and promote as a new slug.

The filesystem contains identical evidence for both cases. Any decision the
recovery logic makes is wrong for one of them.

### Fix

Write the sentinel **before** the atomic rename:

```bash
# CORRECT ordering
printf '{"session_id":"%s","written_at":"%s"}\n' \
  "$SESSION_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$SENTINEL"                    # 1. sentinel exists BEFORE final path is visible
mv "$TMP_PATH" "$FINAL_PATH"       # 2. atomic promotion — now observable
```

The four observable states now map cleanly to exactly one interpretation:

| State | Meaning | Recovery action |
|---|---|---|
| No sentinel + no tmp + no final | Never started | Start fresh |
| No sentinel + tmp + no final | Crashed before sentinel write | Start fresh (retry from tmp) |
| Sentinel + tmp + no final | Crashed between sentinel and mv | Resume: retry `mv` (idempotent) |
| Sentinel + final | Done | Skip |
| ~~No sentinel + final~~ | **IMPOSSIBLE** under this ordering | If observed: manual intervention |

The "impossible" state (final exists, no sentinel) can still appear if someone
manually promoted a file outside the pipeline. Treat it as ambiguous and log a
warning rather than silently choosing a path.

### Why the reverse ordering cannot be fixed with just a lock

A lock prevents two drains from racing in steady state, but a crash releases
the lock. The crash-recovery path by definition runs outside the lock that
protected the original write. Ordering is the only property that survives a
crash.

### Sibling note: time-boundary alignment across phases (Pattern C)

When multiple phases share a "is this file in-flight?" judgment, they must use
the **same** constant for the age threshold. In the compound-staging pipeline,
both Phase 2 (dedup deletion) and Phase 4 (scoring age guard) use 300 seconds
(5 minutes) as the in-flight boundary. If Phase 2 used 60s while Phase 4 used
300s, files in the 60s–300s window would be deleted by Phase 2 but scored by
Phase 4 — two drains would see different "active" sets.

**Rule:** extract the shared threshold to a named constant at the top of the
script. Document which phases reference it and why the value was chosen.

```bash
# Shared threshold: align with Phase 4 in-flight age guard
IN_FLIGHT_AGE_SECONDS=300
```

---

## 2. Three-way file ownership classification in concurrent-drain cleanup

### Problem

Phase 2 of a multi-drain pipeline deletes hash-duplicate files from a shared
`processing/` directory. The first fix (Round 2) used a binary classification:

```bash
# Round 2 approach — too broad
if set_contains "$MOVED_THIS_DRAIN_FILE" "$f"; then
  rm "$f"          # this drain moved it → safe to delete
else
  :                # not this drain → skip (protect concurrent drains)
fi
```

This correctly protects files a concurrent drain holds. But it also protects
**stale orphan files** left by a drain that crashed — files that no live drain
holds and that will never be cleaned up otherwise. A crashed prior drain leaving
two same-hash files in `processing/` produces duplicate solution promotions on
subsequent drain invocations.

### The third state

Binary "this-drain vs not-this-drain" misses the abandoned class:

| Classification | Condition | Correct action |
|---|---|---|
| **This-drain** | File is in `MOVED_THIS_DRAIN_FILE` set | Delete (this drain owns it) |
| **In-flight** | Not this-drain AND mtime < threshold | Skip (concurrent drain holds it) |
| **Stale orphan** | Not this-drain AND mtime >= threshold | Delete (crashed prior drain left it) |

### Fix

```bash
IN_FLIGHT_AGE_SECONDS=300
NOW=$(date +%s)

for f in processing/*.jsonl; do
  [ -f "$f" ] || continue

  if set_contains "$MOVED_THIS_DRAIN_FILE" "$f"; then
    rm "$f"
    log "dedup: deleted this-drain duplicate: $f"
    continue
  fi

  # Portable stat: Linux | BSD/macOS | fallback
  # Fallback is printf '0' (epoch 0), NOT date +%s. A stat failure means
  # mtime is unknown — treating age as 0 (now) would classify the file as
  # in-flight and protect it indefinitely, masking the real problem. Epoch 0
  # makes FILE_AGE enormous, so the file is treated as stale and cleaned up
  # (fail-closed: unknown mtime → stale → remove, not in-flight → keep).
  FILE_MTIME=$(stat -c '%Y' "$f" 2>/dev/null \
    || stat -f '%m' "$f" 2>/dev/null \
    || printf '0')
  FILE_AGE=$(( NOW - FILE_MTIME ))

  if [ "$FILE_AGE" -lt "$IN_FLIGHT_AGE_SECONDS" ]; then
    log "dedup: skipping in-flight file (age ${FILE_AGE}s, concurrent drain): $f"
  else
    rm "$f"
    log "dedup: deleted stale orphan (age ${FILE_AGE}s, crashed prior drain): $f"
  fi
done
```

### Why the age boundary works

The threshold is intentionally the same value used by Phase 4's in-flight age
guard (see sibling note in section 1). A file older than the threshold that is
not owned by this drain was either:

- Never picked up (anomalous — also safe to delete after threshold), or
- Left by a crashed prior drain that held the lock but never completed.

In both cases, no live drain is processing it. Deletion is safe.

### General principle

When deciding cleanup ownership in any pipeline with multiple concurrent workers:

> **Always ask: what is the state of a file that belongs to neither this worker
> nor any currently active worker?**

The answer is always a third category — the abandoned/crashed-prior-actor state.
Binary "mine vs not-mine" loses it. Enumerate all three before writing cleanup
logic.

---

## Prevention checklist

For any pipeline with atomic promotion and concurrent workers:

- [ ] Sentinel is written **before** `mv`/rename, never after.
- [ ] The four post-sentinel-ordering states (see table above) are documented
      in a comment near the write path.
- [ ] File cleanup uses three-way classification: this-actor / in-flight /
      stale orphan. The age threshold is a named constant.
- [ ] The in-flight age threshold is the same constant referenced by any
      phase that also makes an in-flight judgment.
- [ ] Portable `stat` dual-form is used for mtime: `stat -c '%Y' 2>/dev/null || stat -f '%m' 2>/dev/null`.
- [ ] Log lines distinguish all three cleanup cases (include file age and
      reason string).

## Sources

- PR #543 review rounds 1–3, compound-staging stack
- `plugins/yellow-core/agents/workflow/staging-promoter.md`
- `plugins/yellow-core/agents/workflow/staging-reviewer.md`
- Related: `docs/solutions/logic-errors/two-phase-commit-idempotency-patterns.md`
