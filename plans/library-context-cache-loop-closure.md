# Feature: library-context cache loop closure (tier2 + runtime writeback)

## Problem Statement

PRs #536-#538 shipped the context7 library-docs cache pipeline:

- **#537** — SessionStart pre-warm hook + `bin/lc-cache-lookup` reader for tier1
- **#538** — SKILL.md Step 1 + BPR inline updated to call `lc-cache-lookup` before MCP resolve

<!-- deepen-plan: codebase -->
> **Codebase:** PR #536 (the original library-context skill) merged to main
> via SQUASH, so `git log origin/main --oneline` doesn't show the original
> branch hashes; the SKILL.md/reference.md/BPR files ARE on main as a single
> squash commit. PRs #537 (cache hook + tier1 reader) and #538 (Step 1 + BPR
> cache-first wiring) are still in review. This plan builds on what #537
> shipped (`hooks/lib/context7-cache.sh`, `bin/lc-cache-lookup`, the bats
> suite at 29 tests) — those files exist on the #537 branch only. The new
> work in this plan needs to stack on top of #537 (or wait for it to merge).
<!-- /deepen-plan -->

Two ends of the loop remain unwired, both noted as out-of-scope in #538's PR
description:

1. **tier2 (doc content) cache** is reserved in the cache file schema but
   has no reader and no writer. SKILL.md Step 2 (`mcp__context7__query-docs`)
   always calls the MCP, even when the same `(library-id, topic)` was looked
   up earlier in the session or in a prior session.
2. **Runtime writeback** doesn't exist. The cache only fills via SessionStart
   pre-warm (5 libraries × every 24h). Any library not in the pre-warm set
   gets resolved-via-MCP every time, with the result discarded — no
   accumulating session memory. The cache promise ("amortize API quota")
   only delivers for the 5 pre-warmed libraries.

Both items together close the loop: the cache becomes a learn-as-you-go store
that gets warmer with use, not just a static snapshot from session start.

## Current State

- `plugins/yellow-research/hooks/lib/context7-cache.sh` — defines `_lc_lookup` (tier1 read), `_lc_should_skip`, `_lc_scan_lockfiles`, `_lc_resolve_library_id`, `_lc_atomic_write`, `_lc_lockfile_fingerprint`, `_lc_prewarm`. No tier2 functions. No runtime writers.
- `plugins/yellow-research/bin/lc-cache-lookup` — wrapper exposing `_lc_lookup` (tier1 read only).
- `plugins/yellow-research/skills/library-context/SKILL.md` — Step 1 reads tier1; Step 2 always calls MCP.
- `plugins/yellow-core/agents/research/best-practices-researcher.md` — inlined safe-chain block 1.1 reads tier1; 1.3 always calls MCP.
- Cache schema (in `${CLAUDE_PLUGIN_DATA}/context7-cache-<md5>.json`):
  - `tier1: { name: { library_id, fetched_at } }` — populated by pre-warm, read by lc-cache-lookup
  - `tier2: {}` — schema-reserved, never populated, never read
  - `tier2_max_entries`: 50 (constant `_LC_TIER1_TTL`=86400, no `_LC_TIER2_TTL` constant exists yet)
- Tests: 29 bats tests in `plugins/yellow-research/tests/context7-cache.bats`.

## Proposed Solution

Symmetric extension of the existing tier1 pattern to tier2 + add atomic
writers for both tiers exposed via new shell helpers. Agent body
instructions updated to call writers after successful MCP responses.

### Three new shell functions in the existing lib

- `_lc_lookup_docs(library_id, topic)` — tier2 reader. Echoes cached
  docs body on fresh hit, empty on miss/expired/missing. Always exit 0.
  Mirrors `_lc_lookup` shape exactly.
- `_lc_write_tier1(name, library_id)` — tier1 writer. Atomic merge:
  read cache JSON, add/update entry, write back via tmp + mv. Idempotent
  (re-writing the same entry is fine). Updates `fetched_at` to now.
- `_lc_write_tier2(library_id, topic, docs)` — tier2 writer. Atomic
  merge with eviction: cap at 50 entries (LRU by `fetched_at` — newest
  wins, oldest evicted when at cap). Body docs can be large (5-50KB)
  so the eviction matters for cache file size.

### Two new bin/ wrappers

- `bin/lc-cache-lookup-docs <library-id> <topic>` — exposes `_lc_lookup_docs`
- `bin/lc-cache-write <tier> <args...>` — single binary with subcommand:
  - `lc-cache-write tier1 <name> <library-id>` → calls `_lc_write_tier1`
  - `lc-cache-write tier2 <library-id> <topic> <docs-file>` → reads docs
    body from file (avoids shell argv size limits — docs can be 50KB+),
    calls `_lc_write_tier2`

### SKILL.md Step 1 + 2 + BPR inline updated

Both steps gain a post-MCP writeback instruction so the cache fills as
the agent uses context7. Pseudo-flow:

```text
Step 1 — Library ID resolution:
  cached_id = lc-cache-lookup <name>
  if cached_id non-empty: use it
  else:
    id = mcp__context7__resolve-library-id <name>
    if id resolved: bash lc-cache-write tier1 <name> <id>  ← NEW
    use id

Step 2 — Document lookup:
  cached_docs = lc-cache-lookup-docs <library-id> <topic>  ← NEW
  if cached_docs non-empty: use it                          ← NEW
  else:
    docs = mcp__context7__query-docs <library-id> <topic>
    if docs returned: write docs to temp file, then
                      bash lc-cache-write tier2 <library-id> <topic> <tmpfile>  ← NEW
    use docs
```

Cross-plugin (BPR) inline gets the same updates with the
`${YELLOW_RESEARCH_ROOT:-/nonexistent}` probe pattern.

### Design decisions

1. **Subcommand writer** (`lc-cache-write <tier>`) over two separate
   binaries (`lc-cache-write-tier1` / `lc-cache-write-tier2`) — keeps
   the consumer-facing surface smaller (one path to remember). Internal
   dispatch in the wrapper.
2. **Tier2 docs passed via file path**, not as argv. Markdown docs can
   exceed `ARG_MAX` on some systems (~128KB on Linux, 256KB on macOS).
   File-path argument scales arbitrarily and matches how `curl -K` works.

   <!-- deepen-plan: codebase -->
   > **Codebase:** ARG_MAX on this WSL2 system is **3,200,000 bytes**
   > (`getconf ARG_MAX`), not 128KB. The 128KB figure is the historical
   > per-exec data limit for hardened/older kernels; modern Linux defaults
   > are much higher. **The file-path interface is still the right design,
   > but for quoting-safety reasons** (multi-line docs bodies with embedded
   > quotes, backslashes, NUL-ish chars are fragile as argv) — not ARG_MAX.
   > Update the rationale in the `reference.md` cache-API documentation to
   > "file-path arg avoids shell quoting hazards" rather than "exceeds
   > ARG_MAX." No existing repo helper takes file-path args for large data;
   > this introduces a new pattern. The interface is still correct.
   <!-- /deepen-plan -->
3. **LRU eviction by `fetched_at`** (not write-count or access-count) —
   simplest to implement in bash + jq; sufficient for the 50-entry cap.
4. **Writebacks are advisory, never blocking** — if the writer fails
   (disk full, permission denied, jq error), the agent's MCP call has
   already succeeded; the cache just doesn't get the entry. Same
   "silent skip" behavior as the readers.
5. **No tier2 TTL eviction during read** — `_lc_lookup_docs` enforces
   the 4h TTL on read by checking `fetched_at`. Expired entries linger
   in the file until evicted by LRU on next write.

## Implementation Plan

### Phase 1: Library functions + bin wrappers

- [ ] 1.1 Add `_LC_TIER2_TTL=14400` and `_LC_TIER2_MAX_ENTRIES=50` constants to `plugins/yellow-research/hooks/lib/context7-cache.sh`.
- [ ] 1.2 Add `_lc_lookup_docs(id, topic)` function — mirror `_lc_lookup` shape; key is `"$id|$topic"` (matches schema doc in reference.md).
- [ ] 1.3 Add `_lc_write_tier1(name, id)` function — atomic-merge pattern (read JSON → add entry → write tmp + mv). Use `jq` to merge cleanly without race-clobbering tier2 entries.

<!-- deepen-plan: codebase -->
> **Codebase:** The mutation form `.tier1[$n] = {library_id: ..., fetched_at: ...}`
> is load-bearing — `. + {tier1: ...}` would replace the whole tier1 object
> (clobbering existing entries). The existing `_lc_prewarm` at lines 218-222
> of `hooks/lib/context7-cache.sh` builds tier1 from scratch with that
> additive form, but a writeback must *mutate* an existing entry-set, not
> rebuild. Add a code comment explaining this so the pattern doesn't get
> "simplified" later. No existing read-modify-write JSON pattern elsewhere in
> the repo — this introduces a new (sound) shape.
<!-- /deepen-plan -->
- [ ] 1.4 Add `_lc_write_tier2(id, topic, docs)` function — atomic merge with LRU eviction. Use `jq` to insert/replace the new entry (`id|topic`) into tier2 with current `fetched_at`, then sort by `fetched_at` desc and take top `$_LC_TIER2_MAX_ENTRIES`. Updates to an existing key do not evict unrelated entries.
- [ ] 1.5 Create `plugins/yellow-research/bin/lc-cache-lookup-docs` wrapper. Same shape as `lc-cache-lookup` — source the lib + call `_lc_lookup_docs`. Two args: `<library-id> <topic>`.
- [ ] 1.6 Create `plugins/yellow-research/bin/lc-cache-write` wrapper with subcommand dispatch (`tier1` / `tier2`). For tier2, read the docs body from the file path argument before calling `_lc_write_tier2`.
- [ ] 1.7 Make both new wrappers executable (`chmod +x`).

### Phase 2: SKILL.md + BPR consumer wiring

- [ ] 2.1 Update `plugins/yellow-research/skills/library-context/SKILL.md` Step 1: after the live `resolve-library-id` succeeds, add a writeback instruction (`bash ${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-write tier1 <name> <id>`).
- [ ] 2.2 Update SKILL.md Step 2: rewrite as cache-first symmetrically to Step 1. Lookup via `lc-cache-lookup-docs`; on miss, call MCP, then writeback via `lc-cache-write tier2` with the docs body in a temp file. Include cleanup of the temp file.
- [ ] 2.3 Update `plugins/yellow-core/agents/research/best-practices-researcher.md` inlined block: matching tier1 writeback after step 1.3 MCP call, and a new step that wraps the existing Step 2 with cache-first + writeback. Renumber if needed.
- [ ] 2.4 Update the HTML annotation above the BPR inlined block to enumerate the (now growing) set of intentional deltas vs the canonical SKILL.md block.

### Phase 3: Reference + tests + validation

- [ ] 3.1 Update `reference.md`: tier2 is no longer "reserved" — document the lookup/write API and the LRU eviction rule. Remove the "Out of scope (future PR)" note about tier2 and runtime writeback.
- [ ] 3.2 Add bats tests for `_lc_lookup_docs`: cache absent, fresh hit, miss, expired, corrupted JSON, empty args (mirror the existing tier1 lookup test set).
- [ ] 3.3 Add bats tests for `_lc_write_tier1`: writes new entry, updates existing entry (idempotent), doesn't clobber tier2.
- [ ] 3.4 Add bats tests for `_lc_write_tier2`: writes new entry, updates existing entry, evicts oldest when at 50-entry cap (fixture with 50 entries + write one more → confirm size stays 50 and oldest is gone).
- [ ] 3.5 Add bats tests for the `lc-cache-write` wrapper subcommand dispatch + the tier2 file-path arg handling.

<!-- deepen-plan: codebase -->
> **Codebase:** No `.bats` file in the repo currently tests concurrent writes
> (background subshells, race windows). Don't add a concurrent-write test in
> this PR — out of repo convention and non-trivial to write reliably. The
> "eventual consistency" trade-off is documented in code+reference.md; that's
> the existing standard.
<!-- /deepen-plan -->
- [ ] 3.6 Run gates: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck` + `bats plugins/yellow-research/tests/`.

### Phase 4: Changeset + commit + submit

- [ ] 4.1 Add `.changeset/library-context-cache-loop-closure.md` — `yellow-research` minor (new helpers + new SKILL.md instructions) + `yellow-core` patch (BPR inlined block update).
- [ ] 4.2 LF normalize all touched files.
- [ ] 4.3 Commit via `gt commit -m "feat: ..."` and `gt submit --no-interactive`.

## Technical Details

### Files to modify

- `plugins/yellow-research/hooks/lib/context7-cache.sh` — add 3 functions + 2 constants
- `plugins/yellow-research/skills/library-context/SKILL.md` — add writebacks to Step 1 + 2
- `plugins/yellow-research/skills/library-context/reference.md` — promote tier2 from reserved to active; remove "out of scope" note
- `plugins/yellow-core/agents/research/best-practices-researcher.md` — symmetric updates in inlined block
- `plugins/yellow-research/tests/context7-cache.bats` — ~6-10 new tests

### Files to create

- `plugins/yellow-research/bin/lc-cache-lookup-docs` — tier2 reader wrapper
- `plugins/yellow-research/bin/lc-cache-write` — tier1+tier2 writer wrapper with subcommand
- `.changeset/library-context-cache-loop-closure.md`

### Cache file shape after this PR

Same schema as today; tier2 just stops being empty:

```json
{
  "schema": "1",
  "warmed_at": 1779000000,
  "lockfile_fingerprint": { "package-lock.json": 1778999000 },
  "tier1": {
    "react": { "library_id": "/facebook/react", "fetched_at": 1779000000 }
  },
  "tier2": {
    "/facebook/react|hooks": {
      "docs": "# React Hooks\n\nuseState ...",
      "fetched_at": 1779000500
    }
  }
}
```

### Atomic merge example (tier1 write)

```bash
_lc_write_tier1() {
  local name="$1" id="$2"
  local path; path=$(_lc_cache_path) || return 0
  command -v jq >/dev/null 2>&1 || return 0
  [ -n "$name" ] && [ -n "$id" ] || return 0

  local now; now=$(_lc_now)
  local existing='{"schema":"1","warmed_at":0,"lockfile_fingerprint":{},"tier1":{},"tier2":{}}'
  [ -f "$path" ] && existing=$(jq '.' "$path" 2>/dev/null) || existing="$existing"

  local updated
  updated=$(printf '%s' "$existing" | jq \
    --arg n "$name" --arg i "$id" --argjson t "$now" \
    '.tier1[$n] = {library_id: $i, fetched_at: $t}')

  _lc_atomic_write "$path" "$updated"
}
```

## Acceptance Criteria

1. `bash plugins/yellow-research/bin/lc-cache-lookup-docs "/facebook/react" "hooks"` returns the cached docs body on a tier2 hit, empty on miss; always exits 0.
2. `bash plugins/yellow-research/bin/lc-cache-write tier1 react "/facebook/react"` adds the entry to tier1 atomically and exits 0. Re-running with the same args updates `fetched_at` (idempotent).
3. `bash plugins/yellow-research/bin/lc-cache-write tier2 "/facebook/react" "hooks" /tmp/docs.md` reads the docs body from the file path arg and writes it to tier2 atomically; exits 0.
4. Tier2 eviction: with `_LC_TIER2_MAX_ENTRIES=50` entries already in tier2, writing the 51st evicts the entry with the lowest `fetched_at` — the cache file always has exactly 50 entries after the write.
5. Read TTLs honored: tier1 hits older than 24h return empty; tier2 hits older than 4h return empty.
6. SKILL.md Step 1 instructs writeback after live `resolve-library-id`; Step 2 instructs cache-first lookup + writeback after live `query-docs`.
7. BPR inlined block contains symmetric instructions wrapped in `${YELLOW_RESEARCH_ROOT:-/nonexistent}` probes so cross-plugin consumers gracefully skip when yellow-research absent.
8. Sentinel `context7 unavailable — falling back to` still present in BPR (2 occurrences unchanged).
9. `pnpm validate:schemas`, `pnpm test:unit`, `pnpm lint`, `pnpm typecheck` all pass.
10. `bats plugins/yellow-research/tests/context7-cache.bats` passes; new test count is roughly 35-40 (29 + ~6-10 new).
11. Changeset bumps `yellow-research` minor and `yellow-core` patch.
12. `reference.md`'s "Out of scope (future PR)" note for tier2 + runtime writeback is removed; the cache schema section reflects active tier2 usage.

## Edge Cases (handle in code)

- **Concurrent writes from two sessions** — atomic-mv pattern means last writer wins for the whole cache file. With tier2 entries arriving from multiple parallel agents, some entries could be lost in a write race. Acceptable for V1 (eventual consistency; next session's writeback fills the gap). Document the trade-off in `reference.md`.

  <!-- deepen-plan: codebase -->
  > **Codebase:** This race already exists in shipped `_lc_prewarm` — two
  > parallel SessionStarts pass `_lc_should_skip`, both resolve, both write
  > via atomic-mv; second wins the whole file. The shipped code has no
  > comments about it. **For runtime writeback the race is more frequent**
  > because writes happen per-MCP-call, not once per session. Two specifics
  > to bake into implementation: (1) `_lc_write_tier1` / `_lc_write_tier2`
  > MUST re-read the cache file inside the function body (not from a snapshot
  > passed by caller) to minimize the race window; (2) log to stderr on
  > write failure per `credential-status.sh` line 135 convention
  > (`printf '[library-context-cache] Warning: ...' >&2`) rather than fully
  > silent. The plan's "silent skip" should be "stderr warn + return 0".
  > `flock` precedent exists at `plugins/yellow-debt/lib/validate.sh:100-105`
  > if you want stronger semantics — but eventual consistency is fine here.
  <!-- /deepen-plan -->
- **Docs body containing the field-separator pipe character** in the tier2 key — `id|topic`. Library IDs are `/owner/repo` (no pipes); topics are short keywords. Unlikely but possible. Use a safer separator (e.g., `\x1F` unit separator) OR document the constraint.

  <!-- deepen-plan: codebase -->
  > **Codebase:** Topics in practice are NOT bounded to single tokens. SKILL.md
  > line 182 references `"hooks 18.3.1"` (multi-word with version); code-researcher
  > line 55 instructs "rewrite the topic into a concise keyword-form query
  > (≤50 words)" — e.g., `"Redis eviction policy production configuration"`.
  > Spaces are certain; pipes unlikely but possible (e.g., `"react-dom | react"`).
  > No precedent for safer key encoding (`\x1F`, base64, hash) anywhere in
  > the repo's shell scripts. **V1 mitigation:** document the constraint in
  > `reference.md` as a "tier2 key format" subsection — topics MUST NOT
  > contain `|`. Agents are the only callers and you control the authoring
  > rules. Deeper fix (array-of-pairs JSON keyed by index) is a follow-up.
  <!-- /deepen-plan -->
- **Disk full during atomic write** — `_lc_atomic_write` already handles failure with rm-on-error. The writer functions return 0 anyway (writeback failures never block the agent).
- **Cache file grows uncapped between sessions** — tier2 max 50 entries × ~5KB avg = ~250KB max. tier1 is also capped by pre-warm size + writeback additions. If tier1 grows without bound (writes never expire entries before TTL), add a tier1 LRU eviction in a follow-up; for V1 tier1 stays uncapped on the assumption that lockfile-pinned project sizes are bounded.
- **Empty docs body from MCP** — `query-docs` returning empty (rare; usually an error) shouldn't be cached. Writer must skip when docs body is empty.

## Known Limitations / Follow-Ups

- **`_lc_atomic_write` tmp-naming uses `$$`, not `mktemp`** — pre-existing
  shipped code in `hooks/lib/context7-cache.sh`. `credential-status.sh`
  uses `mktemp "${target}.tmp.XXXXXX"` with PID fallback (safer — avoids
  collision if the same PID is reused rapidly). Not introduced by this
  plan; flag as a small follow-up tightening for the atomic-write helper.
- **No cache invalidation API for the agent** — if an agent learns that a cached tier1 entry is stale (e.g., context7 returns an error referencing the cached ID), there's no way to evict that single entry. TTL is the only recourse. Defer cache-poison handling to a future PR if it becomes an issue.
- **Tier2 separator collision** — `id|topic` keying is fragile if topics ever contain `|`. Mitigation in V1: SKILL.md instructs callers to constrain topic to keyword form (single token, no special chars). Stronger fix would be array-of-pairs JSON instead of object-keyed; defer.
- **`/research:setup` doesn't surface tier2 health** — the existing PR-B (#537) follow-up note about adding cache health to `/research:setup` covers this too. Defer.

## References

- PR #537: context7 SessionStart pre-warm hook + tier1 reader infrastructure — https://github.com/KingInYellows/yellow-plugins/pull/537
- PR #538: SKILL.md Step 1 + BPR cache-first wiring — https://github.com/KingInYellows/yellow-plugins/pull/538
- Cache lib: `plugins/yellow-research/hooks/lib/context7-cache.sh` (existing `_lc_lookup`, `_lc_atomic_write`, schema)
- Existing reader wrapper precedent: `plugins/yellow-research/bin/lc-cache-lookup`
- Atomic-rename pattern: `plugins/yellow-ci/hooks/scripts/session-start.sh:156-158`
- Context7 HTTP surface (already verified live): `GET https://context7.com/api/v1/search?query=<name>`, `GET https://context7.com/api/v1/<owner>/<repo>[?topic=<t>]`
- Followups plan source: `plans/library-context-followups.md` "Known Limitations" section
