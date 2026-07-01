# Feature: library-context cache loop closure (tier2 + runtime writeback)

> **Reviewed against `main` 2026-06-30.** All three foundation PRs merged;
> this plan is still unbuilt and valid. Staleness fixed in this pass:
> (1) the codebase note below (PRs now on main, no stacking); (2) Phase 3.1 +
> AC #12 (reference.md rewritten by RULE 13 — target text changed);
> (3) added a RULE 13 CI-gate constraint to Phase 2.3. See the changelog note
> at the end of this file.

## Problem Statement

PRs #536-#538 shipped the context7 library-docs cache pipeline:

- **#537** — SessionStart pre-warm hook + `bin/lc-cache-lookup` reader for tier1
- **#538** — SKILL.md Step 1 + BPR inline updated to call `lc-cache-lookup` before MCP resolve

<!-- deepen-plan: codebase (updated 2026-06-30) -->
> **Codebase (verified against `origin/main` 2026-06-30):** All three
> foundation PRs are now **merged to main** — `git log origin/main`:
> `ac8db1fc (#536)` canonical skill, `dbe1d70a (#537)` SessionStart pre-warm
> hook + tier1 reader, `253e453e (#538)` Step 1 cache-first wiring. The files
> this plan builds on (`hooks/lib/context7-cache.sh`, `bin/lc-cache-lookup`,
> `tests/context7-cache.bats` at **29 tests**) are all on main. **No stacking
> needed — branch this work directly off `main`.** One in-flight sibling to
> note: **RULE 13 context7 drift lint** (commit `b2fa9fba`, branch
> `agent/feat/rule-13-context7-drift-lint`) rewrote *other* sections of
> `reference.md` (retracted the deferred-lint promise + adoption backlog) but
> left the Cache section (lines ~124-149) untouched — no conflict with this
> plan's reference.md edits. If RULE 13 hasn't merged when you start, still
> branch off main and rebase; the two touch disjoint reference.md sections.
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

<!-- deepen-plan: codebase -->
> **Codebase (correction — plan bug):** `${YELLOW_RESEARCH_ROOT:-/nonexistent}`
> **does not exist anywhere in the repo** — `grep -rn YELLOW_RESEARCH_ROOT`
> returns only this plan file (here and in AC #7 / the Edge Cases note). There
> is no such env var in any shell script, agent, manifest, or lib. The
> **established cross-plugin precedent** — already used by the BPR inline for
> the tier1 reader (`best-practices-researcher.md:72,88`) and documented in
> `SKILL.md:70-73` + `reference.md` — is a **relative path off
> `${CLAUDE_PLUGIN_ROOT}`** with exit-127 absorption:
> `bash "${CLAUDE_PLUGIN_ROOT}/../yellow-research/bin/lc-cache-write" ... 2>/dev/null || true`.
> The `2>/dev/null || true` folds bash exit 127 (yellow-research absent) and
> runtime miss into the same empty branch. Use this exact form for the new
> `lc-cache-write` / `lc-cache-lookup-docs` BPR calls; drop
> `${YELLOW_RESEARCH_ROOT}` from the plan (see AC #7 correction below).
<!-- /deepen-plan -->

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

   <!-- deepen-plan: external -->
   > **Research:** Confirms the quoting-safety framing. Markdown doc bodies
   > contain backticks, `$`, `$(...)`, quotes, and literal newlines — all
   > shell-interpreted; embedded in argv they cause silent truncation,
   > unintended subshell execution, or injection if any call site uses `eval`.
   > Command-substitution (`$(...)`) also strips trailing newlines, corrupting
   > multi-line content before it reaches the function. **Prior art for the
   > file-path transport:** `git commit -F <file>`, `git apply < patch`,
   > `curl -K <cfg>`, `sed -f <script>`, `jq -f <filter>` — files are the Unix
   > transport for structured text; argv is for flags and short IDs.
   > Implementation notes: the caller `mktemp`s the doc file and passes the
   > path; the writer validates `[ -f "$DOC_FILE" ]` *before* any lock/write
   > and reads via `cat`/`jq --rawfile`. Sources: mina86.com ARG_MAX deep-dive;
   > dev.to atomic-writes.
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
> **Codebase (re-verified 2026-06-30):** The mutation form
> `.tier1[$n] = {library_id: ..., fetched_at: ...}` is load-bearing —
> `. + {tier1: ...}` would replace the whole tier1 object (clobbering existing
> entries). jq assignment `.[$k] = …` updates only that key and preserves all
> peer keys **and tier2** by jq semantics (guaranteed, not incidental). The
> shipped `_lc_prewarm` (`hooks/lib/context7-cache.sh:223-226`, `. + {($n):…}`
> from an in-memory `'{}'`) **rebuilds** the whole cache and resets `tier2: {}`
> every warm — a writeback must NOT copy that; it must read the existing file
> and mutate one key. **No read-modify-write JSON precedent exists in the
> repo:** the closest is `plugins/yellow-core/lib/compound-staging.sh:213-218`
> (`cs_update_drain_budget`), but that reads → rebuilds a single-level object
> with `jq -nc` → writes (safe only because it replaces the whole root). This
> plan's `.tier1[$n] =` mutate-one-key shape is genuinely new — add a code
> comment so it doesn't get "simplified" back to the additive form.
> **Reuse `_lc_log`:** the lib already defines `_lc_log()` at lines 34-36
> (`printf '[library-context-cache] %s\n' "$*" >&2`). New writers should call
> `_lc_log "Warning: …"` on write failure rather than a raw `printf`, matching
> the existing prefix.
<!-- /deepen-plan -->
- [ ] 1.4 Add `_lc_write_tier2(id, topic, docs)` function — atomic merge with LRU eviction. Use `jq` to insert/replace the new entry (`id|topic`) into tier2 with current `fetched_at`, then sort by `fetched_at` desc and take top `$_LC_TIER2_MAX_ENTRIES`. Updates to an existing key do not evict unrelated entries.

<!-- deepen-plan: external -->
> **Research (idiomatic jq LRU + upsert in one pass):** do the upsert and the
> eviction in a **single jq invocation** (inside the write), so there's no
> second read-modify cycle:
>
> ```bash
> jq --arg k "$KEY" --rawfile doc "$DOC_FILE" \
>    --argjson now "$(date +%s)" --argjson N "$_LC_TIER2_MAX_ENTRIES" '
>   .tier2[$k] = {docs: $doc, fetched_at: $now}
>   | if (.tier2 | length) > $N then
>       .tier2 |= (to_entries
>                  | sort_by(.value.fetched_at, .key)   # ascending; .key = deterministic tie-break
>                  | reverse | .[:$N] | from_entries)
>     else . end
> ' "$path" > "$tmp"
> ```
>
> Three pitfalls the research flags: (1) pass the cap as `--argjson N`
> (a **number**) — `--arg` makes it a string and `.[:$N]` then errors;
> (2) `sort_by` is **not guaranteed stable** across jq versions, so add the
> `.key` secondary sort key or ties evict non-deterministically; (3) gate the
> sort behind `if length > $N` so you don't pay `O(M log M)` on every write
> under the cap. `--rawfile doc "$DOC_FILE"` reads the doc body straight from
> the temp file into a JSON string (no argv/quoting hazard). Source: Perplexity
> deep-research synthesis, jq manual (`sort_by`, slicing).
<!-- /deepen-plan -->
- [ ] 1.5 Create `plugins/yellow-research/bin/lc-cache-lookup-docs` wrapper. Same shape as `lc-cache-lookup` — source the lib + call `_lc_lookup_docs`. Two args: `<library-id> <topic>`.
- [ ] 1.6 Create `plugins/yellow-research/bin/lc-cache-write` wrapper with subcommand dispatch (`tier1` / `tier2`). For tier2, read the docs body from the file path argument before calling `_lc_write_tier2`.
- [ ] 1.7 Make both new wrappers executable (`chmod +x`).

<!-- deepen-plan: codebase -->
> **Codebase (wrapper self-location + chmod gotcha):** the existing
> `bin/lc-cache-lookup` locates its lib via `BASH_SOURCE[0]` (line 20) —
> this is **correct** for a shell-script binary invoked as `bash path/to/x`.
> The repo's "no `BASH_SOURCE`" rule applies only to **markdown command
> files**, not shell scripts. New wrappers `lc-cache-lookup-docs` and
> `lc-cache-write` should copy that same `BASH_SOURCE[0]`-based `source` of
> `hooks/lib/context7-cache.sh`. For 1.7, the repo is `core.fileMode=false`
> (WSL2): `chmod +x` + `git add` silently keeps mode `100644` — record the
> exec bit with `git update-index --chmod=+x <file>` (see MEMORY.md
> "git core.fileMode=false chmod gotcha").
<!-- /deepen-plan -->

### Phase 2: SKILL.md + BPR consumer wiring

- [ ] 2.1 Update `plugins/yellow-research/skills/library-context/SKILL.md` Step 1: after the live `resolve-library-id` succeeds, add a writeback instruction (`bash ${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-write tier1 <name> <id>`).
- [ ] 2.2 Update SKILL.md Step 2: rewrite as cache-first symmetrically to Step 1. Lookup via `lc-cache-lookup-docs`; on miss, call MCP, then writeback via `lc-cache-write tier2` with the docs body in a temp file. Include cleanup of the temp file.
- [ ] 2.3 Update `plugins/yellow-core/agents/research/best-practices-researcher.md` inlined block: matching tier1 writeback after step 1.3 MCP call, and a new step that wraps the existing Step 2 with cache-first + writeback. Renumber if needed. **RULE 13 constraint (context7 drift lint):** verified in `scripts/validate-agent-authoring.js:447-470` — because this agent lists a context7 tool in `tools:`, `validate:agents` requires either `skills: [library-context]` **or** the exact body sentinel `context7 unavailable — falling back to` (literal em dash U+2014, matched body-only after frontmatter strip). BPR has it at `best-practices-researcher.md:83` (HTML-comment annotation) and `:99` (body prose — the load-bearing one). Do NOT remove or ASCII-ify either occurrence while editing. Status caveat: RULE 13 is committed on branch `agent/feat/rule-13-context7-drift-lint` (commit `b2fa9fba`) but **not yet on `origin/main`** — so the gate only fires once RULE 13 merges; keep the sentinel regardless so the work stays green whichever merges first.
- [ ] 2.4 Update the HTML annotation above the BPR inlined block to enumerate the (now growing) set of intentional deltas vs the canonical SKILL.md block.

### Phase 3: Reference + tests + validation

- [ ] 3.1 Update `reference.md` **"Cache" section** (anchor by text, not line number — RULE 13's merge status shifts the numbers; on the RULE 13 branch it's ~L124-149, on current `main` ~L163-171). tier2 is no longer reserved. Rewrite the tier2 line (search: `reserved for future lazy population on cache miss — not pre-warmed`) to describe active lazy population, and rewrite the paragraph (search: `The lc-cache-lookup reader only consults tier1` … `That round also needs to design a cache-write contract for runtime hits`) to document the now-shipped tier2 lookup/write API, the LRU-by-`fetched_at` eviction rule, and the runtime writeback contract. Note: RULE 13 already removed the old "Out of scope (future PR)" phrasing — that literal string no longer exists; target the "reserved for a future round" / "cache-write contract" sentences instead.
- [ ] 3.2 Add bats tests for `_lc_lookup_docs`: cache absent, fresh hit, miss, expired, corrupted JSON, empty args (mirror the existing tier1 lookup test set).
- [ ] 3.3 Add bats tests for `_lc_write_tier1`: writes new entry, updates existing entry (idempotent), doesn't clobber tier2.
- [ ] 3.4 Add bats tests for `_lc_write_tier2`: writes new entry, updates existing entry, evicts oldest when at 50-entry cap (fixture with 50 entries + write one more → confirm size stays 50 and oldest is gone).
- [ ] 3.5 Add bats tests for the `lc-cache-write` wrapper subcommand dispatch + the tier2 file-path arg handling.

<!-- deepen-plan: codebase -->
> **Codebase (bats conventions to mirror — `context7-cache.bats`, verified
> 2026-06-30, 29 tests):** `setup()` does `mktemp -d` → `TEST_TMP`, creates +
> exports `CLAUDE_PLUGIN_DATA="$TEST_TMP/plugin-data"` and
> `CLAUDE_PROJECT_DIR="$TEST_TMP/project"`, then sources the lib via
> `. "$BATS_TEST_DIRNAME/../hooks/lib/context7-cache.sh"`; `teardown()` does
> `rm -rf "$TEST_TMP"`. Stub API/clock with the existing eval-override helpers
> `_stub_resolve_returns` / `_stub_now_returns` (define analogous stubs for new
> writers). Fixtures are inline `printf`/heredoc into `$cache_path`. Wrapper
> tests call `bash "$BATS_TEST_DIRNAME/../bin/lc-cache-lookup-docs" …` /
> `.../bin/lc-cache-write …` (see the existing wrapper test block). For the
> 51-entry eviction test (3.4), build the 50-entry fixture with distinct
> `fetched_at` values so "oldest evicted" is deterministic.
>
> **Do NOT add a concurrent-write test:** no `.bats` in the repo exercises
> background-subshell race windows; it's out of convention and hard to write
> reliably. The "eventual consistency / last-writer-wins" trade-off is the
> documented standard (code + reference.md).
<!-- /deepen-plan -->
- [ ] 3.6 Run gates: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck` + `bats plugins/yellow-research/tests/`.

### Phase 4: Changeset + commit + submit

- [ ] 4.1 Add `.changeset/library-context-cache-loop-closure.md` — `yellow-research` minor (new helpers + new SKILL.md instructions) + `yellow-core` patch (BPR inlined block update).
- [ ] 4.2 LF normalize all touched files.
- [ ] 4.3 Branch **off `main`** (foundation PRs #536/#537/#538 all merged — no stacking on #537 needed). Commit via `gt commit -m "feat: ..."` and `gt submit --no-interactive`.

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

<!-- deepen-plan: external -->
> **Research (harden the example before copying it):** two things to fix in
> the snippet above. (1) `[ -f "$path" ] && existing=$(jq '.' "$path") || existing="$existing"`
> is the classic `A && B || C` trap — if the file exists but `jq` fails
> (corrupted/empty cache), it silently falls to the `|| existing="$existing"`
> branch, which self-assigns the *default-init* value (fine here) but the
> pattern is fragile; prefer an explicit `if [ -f "$path" ]; then existing=$(jq … ) || existing='{…default…}'; fi`.
> (2) This reads the file into a shell var *outside* any lock — under runtime
> writeback (per-MCP-call, not once/session) that widens the lost-update race.
> The canonical atomic-RMW pattern is `flock -x` around **mktemp-in-same-dir →
> re-read-inside-lock → jq → `mv -f`** (same filesystem ⇒ atomic `rename(2)`;
> never a `/tmp` temp, which crosses filesystems and loses atomicity). The plan
> deliberately accepts eventual-consistency/last-writer-wins instead of flock
> (Edge Cases + Design decision 4) — that's a defensible V1 call, but if
> stronger semantics are ever wanted, `flock` precedent exists at
> `plugins/yellow-debt/lib/validate.sh`. Sources: man7 `rename(2)`/`flock(1)`,
> dev.to atomic-writes, jq manual.
<!-- /deepen-plan -->

## Acceptance Criteria

1. `bash plugins/yellow-research/bin/lc-cache-lookup-docs "/facebook/react" "hooks"` returns the cached docs body on a tier2 hit, empty on miss; always exits 0.
2. `bash plugins/yellow-research/bin/lc-cache-write tier1 react "/facebook/react"` adds the entry to tier1 atomically and exits 0. Re-running with the same args updates `fetched_at` (idempotent).
3. `bash plugins/yellow-research/bin/lc-cache-write tier2 "/facebook/react" "hooks" /tmp/docs.md` reads the docs body from the file path arg and writes it to tier2 atomically; exits 0.
4. Tier2 eviction: with `_LC_TIER2_MAX_ENTRIES=50` entries already in tier2, writing the 51st evicts the entry with the lowest `fetched_at` — the cache file always has exactly 50 entries after the write.
5. Read TTLs honored: tier1 hits older than 24h return empty; tier2 hits older than 4h return empty.
6. SKILL.md Step 1 instructs writeback after live `resolve-library-id`; Step 2 instructs cache-first lookup + writeback after live `query-docs`.
7. BPR inlined block contains symmetric instructions wrapped in `${YELLOW_RESEARCH_ROOT:-/nonexistent}` probes so cross-plugin consumers gracefully skip when yellow-research absent.

   <!-- deepen-plan: codebase -->
   > **Codebase (AC correction):** `${YELLOW_RESEARCH_ROOT:-/nonexistent}`
   > does not exist in the repo (see the Proposed Solution correction above).
   > Restate this criterion as: *BPR writeback calls use
   > `bash "${CLAUDE_PLUGIN_ROOT}/../yellow-research/bin/lc-cache-write" … 2>/dev/null || true`
   > (and the `…/lc-cache-lookup-docs` reader likewise), so exit 127
   > (yellow-research absent) and any runtime error fold into the graceful
   > empty/skip branch* — matching the shipped tier1-reader precedent at
   > `best-practices-researcher.md:72,88`.
   <!-- /deepen-plan -->
8. Sentinel `context7 unavailable — falling back to` still present in BPR (2 occurrences unchanged).
9. `pnpm validate:schemas`, `pnpm test:unit`, `pnpm lint`, `pnpm typecheck` all pass.
10. `bats plugins/yellow-research/tests/context7-cache.bats` passes; new test count is roughly 35-40 (29 + ~6-10 new).
11. Changeset bumps `yellow-research` minor and `yellow-core` patch.
12. `reference.md`'s "Cache" section no longer frames tier2 as reserved: the "reserved for future lazy population … not pre-warmed" line and the "reserved for a future round … cache-write contract" paragraph (anchor by text — line numbers shift with RULE 13's merge status) are rewritten to describe active tier2 lookup/write + LRU eviction + the runtime writeback contract this PR implements. (RULE 13 already removed the older literal "Out of scope (future PR)" phrasing.)

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

<!-- deepen-plan: external -->
> **Research (deferred idea — stale-if-error):** `_lc_lookup_docs` in this plan
> returns empty on an expired (>4h) tier2 hit, forcing a fresh MCP call. A
> future enhancement is **stale-if-error**: on context7 429/timeout, serve the
> expired-but-present cached body instead of nothing (widen a max-staleness
> window, e.g. 24-48h, distinct from the 4h freshness TTL). This turns the
> cache into a rate-limit shock absorber against the shared anonymous
> context7/Upstash quota pool. Out of scope for V1 (changes the reader
> contract from "empty on expired" to "return stale + flag"); note as a
> follow-up. Source: Fastly stale-while-revalidate / stale-if-error.
<!-- /deepen-plan -->

## References

- PR #537: context7 SessionStart pre-warm hook + tier1 reader infrastructure — https://github.com/KingInYellows/yellow-plugins/pull/537
- PR #538: SKILL.md Step 1 + BPR cache-first wiring — https://github.com/KingInYellows/yellow-plugins/pull/538
- Cache lib: `plugins/yellow-research/hooks/lib/context7-cache.sh` (existing `_lc_lookup`, `_lc_atomic_write`, schema)
- Existing reader wrapper precedent: `plugins/yellow-research/bin/lc-cache-lookup`
- Atomic-rename pattern: `plugins/yellow-ci/hooks/scripts/session-start.sh:156-158`
- Context7 HTTP surface (already verified live): `GET https://context7.com/api/v1/search?query=<name>`, `GET https://context7.com/api/v1/<owner>/<repo>[?topic=<t>]`
- Followups plan source: `plans/library-context-followups.md` "Known Limitations" section
- RULE 13 context7 drift lint (in-flight sibling): commit `b2fa9fba`, `scripts/validate-agent-authoring.js` — new CI gate requiring the drift sentinel in context7-consuming agents (see Phase 2.3 constraint)

<!-- deepen-plan: external -->
> **Research sources (2026-06-30 deepen pass, Perplexity + Tavily):**
> - jq atomic RMW + LRU eviction idiom, `sort_by`/slice semantics —
>   [jq manual](https://jqlang.org/manual)
> - atomic rename + advisory locking — [`rename(2)`](https://man7.org/linux/man-pages/man2/rename.2.html),
>   [`flock(1)`](https://man7.org/linux/man-pages/man1/flock.1.html),
>   [atomic-writes walkthrough](https://dev.to/memattchung/writing-data-to-disk-transforming-brittle-code-to-robust-code-with-atomic-writes-5e3e)
> - `mktemp` same-dir requirement — [coreutils mktemp](https://gnu.org/s/coreutils/manual/html_node/mktemp-invocation.html);
>   ARG_MAX reality — [mina86 ARG_MAX](https://mina86.com/2021/the-real-arg-max-part-1)
> - cache TTL / stale-if-error / rate-limit strategy —
>   [Fastly stale-while-revalidate](https://www.fastly.com/blog/stale-while-revalidate-stale-if-error-available-today),
>   [Upstash QStash rate-limit headers](https://upstash.com/docs/qstash/api/api-ratelimiting),
>   [new context7 architecture (Upstash)](https://upstash.com/blog/new-context7)
<!-- /deepen-plan -->

## Review changelog

- **2026-06-30 — reviewed against `main`.** Plan verified still unbuilt and
  structurally valid: `context7-cache.sh` remains tier1-only (no
  `_lc_lookup_docs`/writers/`_LC_TIER2_*` constants), no `lc-cache-write` or
  `lc-cache-lookup-docs` wrappers exist, `context7-cache.bats` still at 29
  tests (AC #10's "29 + ~6-10" baseline holds). Changes this pass:
  1. Codebase note (Problem Statement) — corrected from "#537/#538 still in
     review, files on #537 branch only" to "all three merged to main
     (#536 `ac8db1fc`, #537 `dbe1d70a`, #538 `253e453e`); branch off main".
  2. Phase 4.3 — dropped the "stack on top of #537" instruction.
  3. Phase 3.1 + AC #12 — retargeted to the actual post-RULE-13 `reference.md`
     wording (`reference.md:140-149`, "reserved for a future round" /
     "cache-write contract"); the literal "Out of scope (future PR)" note RULE
     13 already deleted.
  4. Phase 2.3 — added the RULE 13 CI-gate constraint (preserve the em-dash
     drift sentinel in `best-practices-researcher.md`).
- **2026-06-30 — deepen-plan re-enrichment** (repo-research-analyst +
  research-conductor). Carried forward + enriched the prior 6 codebase
  annotations and added new codebase + external ones (14 total: 9 codebase,
  5 external). Highlights:
  - **Plan bug found & annotated:** `${YELLOW_RESEARCH_ROOT:-/nonexistent}`
    (Proposed Solution + AC #7) does not exist in the repo — corrected to the
    shipped `${CLAUDE_PLUGIN_ROOT}/../yellow-research/bin/… 2>/dev/null || true`
    precedent (`best-practices-researcher.md:72,88`).
  - Added the exact idiomatic jq LRU-upsert-in-one-pass (Phase 1.4),
    `--argjson N` number pitfall, and deterministic `.key` tie-break.
  - Confirmed no RMW-`.obj[$k]=` or LRU precedent in the repo (closest:
    `compound-staging.sh:213-218`, read→rebuild); `_lc_log()` already exists
    for the warn prefix.
  - Documented the exact `context7-cache.bats` conventions to mirror
    (setup/teardown, `_stub_*` eval helpers, wrapper-test shape).
  - New wrappers use `BASH_SOURCE[0]` self-location (allowed for shell
    binaries); `git update-index --chmod=+x` for the WSL2 fileMode gotcha.
  - Hardened the tier1 atomic-merge example (`A && B || C` trap;
    flock/mktemp-same-dir/re-read-inside-lock canonical pattern).
  - Added a stale-if-error follow-up to Known Limitations.
