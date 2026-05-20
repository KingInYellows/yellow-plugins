---
title: 'Two-phase commit idempotency patterns: threshold gates, sentinel identity, and per-phase guards'
date: 2026-05-20
category: logic-errors
track: bug
problem: 'Three independent idempotency failures in background pipeline agents: pre-lock work unreachable past threshold gates, session-ambiguous sentinels causing cross-session corruption, and missing per-phase resume guards producing duplicate writes'
tags:
  - idempotency
  - two-phase-commit
  - background-agents
  - crash-recovery
  - sentinel
  - pipeline
components:
  - plugins/yellow-core/agents/workflow/staging-promoter.md
  - plugins/yellow-core/hooks/scripts/session-start.sh
---

# Two-phase commit idempotency patterns

Three design-level findings from the compound-staging PR stack (PRs #543,
#547, review rounds 3 and 4). Each is a distinct failure mode in multi-phase
background work that resumes after crashes. Grouped because they interact: a
system that gets any one wrong will produce duplicate writes, leaked recovery
paths, or cross-session data corruption.

---

## 1. Pre-lock recovery work that needs the lock is silently unreachable when threshold gates short-circuit before lock acquisition

### Problem

A common pattern in background pipeline dispatchers:

```bash
PENDING_COUNT=$(count_pending_entries)
if [ "$PENDING_COUNT" -eq 0 ]; then
  json_exit   # nothing to do
fi

acquire_lock
# ... do work ...
```

A recovery path was added to handle crashed `processing/` entries that need
to be requeued. The recovery runs under the lock. But the recovery is only
needed when `processing/` has orphaned files — which can happen even when
`PENDING_COUNT` is zero (a crash can leave an entry in `processing/` with
nothing remaining in the input queue).

The threshold gate (`PENDING_COUNT -eq 0 → json_exit`) fires before the lock
is acquired and before any check of `processing/`. The recovery path is never
reached in exactly the case it was designed for.

### Fix

The threshold gate must be aware of every reason the script needs to proceed.
When there is a `REQUEUE_ONLY` recovery case, promote it to a first-class
dispatch condition:

```bash
PENDING_COUNT=$(count_pending_entries)
ORPHANED_COUNT=$(count_orphaned_processing_entries)

if [ "$PENDING_COUNT" -eq 0 ] && [ "$ORPHANED_COUNT" -eq 0 ]; then
  json_exit   # truly nothing to do
fi

acquire_lock

if [ "$ORPHANED_COUNT" -gt 0 ] && [ "$PENDING_COUNT" -eq 0 ]; then
  REQUEUE_ONLY=1
fi
# ... rest of dispatch logic ...
```

**General principle:** When adding lock-protected work for a case that the
existing threshold gate does not dispatch for, extend the threshold gate to
know about that case — do not rely on code below the gate being reached
in that case.

### Detection

Audit dispatchers for this structure: threshold gate → lock acquisition →
recovery logic. Ask: can the recovery case arise when the threshold gate would
have short-circuited? If yes, the gate needs to be extended.

---

## 2. Two-phase commit sentinels need session-scoped identity to avoid cross-session collision

### Problem

A sentinel file (e.g., `.promote-done`) was used as an empty presence check to
detect whether a two-phase write had completed, enabling crash-resume logic to
skip Phase 2:

```bash
if [ -f "$STAGING_DIR/$SLUG/.promote-done" ]; then
  RESUMING_AFTER_CRASH=1   # phase 2 already done, skip
fi
```

Two entries can produce the same 60-character slug after sanitization (e.g.,
different sessions with long similar titles). When Session A's sentinel
(`.promote-done`) already exists and Session B generates the same slug, Session
B's crash-resume logic sees the sentinel and skips Phase 2 — silently skipping
a write that Session B needed to do. Or worse, Session B writes its content
over Session A's doc, then discovers the sentinel and considers itself done,
leaving a corrupted mix.

### Fix

Write the sentinel as a JSON file containing session identity, not as an empty
presence marker:

```bash
# Write sentinel with session context
printf '{"session_id":"%s","written_at":"%s"}\n' \
  "$SESSION_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$STAGING_DIR/$SLUG/.promote-done"
```

```bash
# Resume guard — require session_id match
if [ -f "$STAGING_DIR/$SLUG/.promote-done" ]; then
  STORED_SESSION="$(jq -r '.session_id // ""' "$STAGING_DIR/$SLUG/.promote-done")"
  if [ "$STORED_SESSION" = "$SESSION_ID" ]; then
    RESUMING_AFTER_CRASH=1
  else
    # Different session — this slug collision is a separate entry
    RESUMING_AFTER_CRASH=0
  fi
fi
```

**General principle:** A sentinel that signals "this work is done" must encode
enough identity to distinguish "this session's work is done" from "some other
session with a colliding key did its work." File presence alone is never
sufficient when the key space can collide.

### What identity to include

At minimum: `session_id` (the Claude session or drain invocation ID). Optionally
`written_at` (ISO 8601 UTC) for debugging and log correlation. Do not include
the slug itself — the slug is what collided and is not useful as a
disambiguator.

---

## 3. Every phase of a multi-phase operation needs its own idempotency guard — not just Phase 1

### Problem

A crash-resume system had a `RESUMING_AFTER_CRASH` flag that correctly skipped
Phase 2 (the expensive doc write) when detected. Phase 3 (MEMORY.md append)
had no equivalent guard:

```bash
if [ "$RESUMING_AFTER_CRASH" -eq 0 ]; then
  # Phase 2: write solution doc
  write_solution_doc
fi

# Phase 3: append MEMORY.md entry  ← no guard
append_memory_entry
```

A crash after Phase 3 completed but before the processing file was deleted
caused the next drain invocation to detect a crash, set
`RESUMING_AFTER_CRASH=1`, skip Phase 2 (correct), but re-run Phase 3 —
appending a duplicate MEMORY.md entry.

### Fix

Each phase needs its own idempotency check. For MEMORY.md appends, the natural
idempotency key is the solution doc path (already written in Phase 2):

```bash
# Phase 3: append MEMORY.md entry — idempotent on SOLUTION_PATH
if grep -qF "$SOLUTION_PATH" "$MEMORY_FILE" 2>/dev/null; then
  log "Phase 3 already done for $SOLUTION_PATH, skipping"
else
  append_memory_entry
fi
```

**General pattern for N-phase operations:**

| Phase | How to check idempotency |
|---|---|
| Phase 1: parse / score | sentinel file with session_id (see finding 2) |
| Phase 2: write doc | check file exists at target path |
| Phase 3: write index / append | grep for a unique anchor (path, session_id, slug) |
| Phase N: cleanup / delete | check source artifact is already absent |

**Rule:** the check for phase N must use something that phase N itself writes
(or deletes), not something from a prior phase. Using Phase 2's sentinel to
gate Phase 3 only catches the "Phase 2 not done yet" case — it cannot detect
"Phase 3 already done, Phase 2 sentinel not yet cleaned up."

---

## Compound prevention checklist

For any multi-phase background pipeline:

- [ ] Threshold gate covers ALL cases that need the lock — not just the "normal
      work" case. Recovery paths that run under the lock are enumerated at the
      gate.
- [ ] Every sentinel that signals phase completion includes `session_id` (or
      equivalent unique identity). No empty-file sentinels where key collisions
      are possible.
- [ ] Every phase has its own idempotency check. The check is based on what
      that phase writes, not on a prior phase's sentinel.
- [ ] Crash-resume test plan: simulate a crash after each phase and verify the
      next run produces the correct output exactly once.

## Sources

- PR #543 review rounds 3 and 4, compound-staging stack
- PR #547 review round 3, compound-staging stack
- `plugins/yellow-core/agents/workflow/staging-promoter.md`
- `plugins/yellow-core/hooks/scripts/session-start.sh`
