---
title: 'Periodic Rebuild Wipes Incremental Writeback State (Snapshot vs. Accumulator)'
date: 2026-07-01
category: logic-errors
track: bug
problem: 'A periodic full-rebuild of a persisted cache silently discards fields owned by a co-located incremental writeback function on every rebuild cycle'
tags:
  - cache-invalidation
  - periodic-rebuild
  - incremental-writeback
  - prewarm
  - tier-cache
  - silent-data-loss
  - bash
  - jq
  - yellow-research
---

# Periodic Rebuild Wipes Incremental Writeback State (Snapshot vs. Accumulator)

## Problem

**General pattern first:** when a periodic "rebuild from scratch" routine
and an incremental "writeback" routine both persist state into the same
structure, the rebuild routine must read-and-preserve every field the
writeback routine owns — otherwise each rebuild silently discards whatever
the writeback accumulated since the last rebuild. This is a "periodic
snapshot vs. incremental accumulator" interaction bug, not specific to any
one cache.

**Concrete instance:** `plugins/yellow-research/hooks/lib/context7-cache.sh`
has `_lc_prewarm()`, a SessionStart-triggered function that rebuilds the
whole context7 cache file roughly every 24h (skip-if-fresh via
`_lc_should_skip`). PR #598 added `_lc_write_tier1`/`_lc_write_tier2`,
incremental writeback functions that add/update single entries in the same
cache file after live MCP calls, called from many separate agent
invocations throughout a session.

`_lc_prewarm`'s rebuild step hardcoded the tier2 field:

```bash
cache=$(jq -n --argjson w "$now" --argjson t1 "$tier1" --argjson fp "$fp" \
  '{schema: "1", warmed_at: $w, lockfile_fingerprint: $fp, tier1: $t1, tier2: {}}')
```

Every time `_lc_prewarm` ran (each session where the 24h TTL had expired),
it discarded every tier2 doc-content entry that `_lc_write_tier2` had
accumulated since the last rewarm — even entries written minutes earlier in
the same session, if the SessionStart hook happened to fire the rebuild
partway through. The bug was silent: no error, no log, just an empty
`tier2: {}` where accumulated cache entries used to be.

## Symptoms

- Tier2 cache "never seems to warm up" across sessions, despite runtime
  writeback firing correctly within a session.
- `jq '.tier2 | length'` on the cache file unexpectedly returns 0 shortly
  after a SessionStart, even though writeback calls succeeded earlier.
- No error surfaces anywhere — the writeback functions all return exit 0
  and the rebuild function also returns exit 0. Nothing looks broken until
  someone inspects the cache file's actual contents across a rewarm
  boundary.

## What Didn't Work

Reviewing only the new writeback functions (`_lc_write_tier1`,
`_lc_write_tier2`) in isolation. Both were correct in isolation — each
does read-existing-or-default, jq mutate-one-key, atomic write. The bug
was in a third function (`_lc_prewarm`) that predates the writeback
addition and was never revisited when writeback was introduced. Unit tests
for the writers passed; the missing coverage was an integration-shaped
test (rebuild-after-incremental-write), not a unit test of either function
alone.

## Solution

`_lc_prewarm` now reads the existing cache's tier2 field before rebuilding,
and threads it through into the new cache object instead of hardcoding an
empty object:

```bash
local existing_tier2='{}'
if [ -f "$cache_path" ]; then
  existing_tier2=$(jq '.tier2 // {}' "$cache_path" 2>/dev/null) || existing_tier2='{}'
fi

local cache
cache=$(jq -n --argjson w "$now" --argjson t1 "$tier1" --argjson fp "$fp" --argjson t2 "$existing_tier2" \
  '{schema: "1", warmed_at: $w, lockfile_fingerprint: $fp, tier1: $t1, tier2: $t2}')
```

A companion finding in the same review pass: both `_lc_write_tier1` and
`_lc_write_tier2`'s corrupted-cache-JSON fallback silently reset to the
default empty schema with no log line — a narrower instance of the same
"silent state loss" root cause, just triggered by a parse failure instead
of a rebuild. Fixed by calling `_lc_log` with a warning before falling
back:

```bash
existing=$(jq '.' "$path" 2>/dev/null) || {
  _lc_log "Warning: existing cache at $path failed to parse; resetting to empty (prior tier1/tier2 entries discarded)"
  existing="$_LC_DEFAULT_CACHE"
}
```

## Why This Works

The rebuild function's job is narrowly "refresh the fields I own"
(`tier1`, `warmed_at`, `lockfile_fingerprint`), not "reconstruct the whole
file." Reading the current file's `tier2` field first and passing it
through preserves the other function's ownership boundary — the rebuild
never has to know *how* tier2 entries got there, only that it must not
clobber them. The 4h tier2 TTL already bounds staleness on the read side
(`_lc_lookup_docs`), so carrying forward possibly-stale tier2 entries
across a tier1 rewarm is safe; a stale entry simply misses on next lookup
and gets re-fetched.

## Prevention

- **When adding an incremental writeback function alongside an existing
  periodic-rebuild function that touches the same persisted structure,**
  audit every field the rebuild writes and confirm it either (a) owns that
  field exclusively, or (b) reads-and-preserves it from the current file
  before rebuilding. Do this even when the rebuild function's code hasn't
  changed — the bug is in the *interaction*, not in either function alone.
- **Test rebuild-after-incremental-write, not each function in isolation.**
  A bats test seeding a cache file with accumulated writeback state, then
  calling the rebuild function and asserting the writeback state survives,
  catches this class of bug directly. Testing each writer/rebuild function
  against an empty or freshly-written cache misses the interaction
  entirely.
- **Never silently reset shared persisted state on a parse failure.** Log
  before falling back to a default, even when the fallback itself is
  correct — a corrupted-cache reset that discards real accumulated state
  deserves an operator-visible signal, the same way a rebuild-wipe does.
- Grep for other rebuild-shaped functions (`_lc_prewarm` is one instance)
  whenever a new incremental writer is added to the same store — the
  pattern recurs any time a scheduled/periodic operation and an ad-hoc
  incremental operation share a destination.

## Related

- [Bash Pipe + head Exit-Code Masking in Presence Guards](bash-pipe-head-exit-code-masking.md) — a different class of silent-failure bug (guard clause never fires), same broader theme of failures with no operator-visible signal.
