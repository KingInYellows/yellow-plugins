#!/usr/bin/env bash
# Context7 library docs cache helpers for yellow-research's SessionStart hook.
#
# Sourced — defines functions only, no top-level side effects.
#
# Two-tier cache at ${CLAUDE_PLUGIN_DATA}/context7-cache-<md5_of_project>.json:
#   tier1: name → {library_id, fetched_at}    (24h TTL, capped to top 5 libs)
#   tier2: id|topic → {docs, fetched_at}      (4h TTL, max 50 entries; populated lazily on demand, not by this prewarm)
#
# Context7 HTTP API surface verified 2026-05-17:
#   GET https://context7.com/api/v1/search?query=<name>
#     → JSON {results: [{id: "/owner/repo", title, ...}, ...]}
#   GET https://context7.com/api/v1/<owner>/<repo>[?topic=<t>]
#     → text/plain markdown docs body
#   Headers expose live quota: ratelimit-limit / ratelimit-remaining /
#   context7-quota-tier (= "anonymous" without auth).
#   Anonymous shares a global 200 req/hr pool. With Authorization: Bearer
#   <CONTEXT7_API_KEY> each key gets a dedicated quota.

# Idempotent: re-sourcing is a no-op (matches yellow-core lib/validate-fs.sh pattern).
[ -n "${_LC_CACHE_LOADED:-}" ] && return 0
_LC_CACHE_LOADED=1

_LC_API_BASE="${CONTEXT7_API_BASE:-https://context7.com/api/v1}"
_LC_TIER1_TTL=86400        # 24h
_LC_TIER2_TTL=14400         # 4h
_LC_TIER2_MAX_ENTRIES=50    # LRU cap by fetched_at
_LC_PREWARM_MAX=5           # max libraries resolved per session warm
_LC_CURL_TIMEOUT=3          # seconds per resolve call
_LC_LOCKFILES=(
  package.json
  package-lock.json pnpm-lock.yaml yarn.lock
  Cargo.lock go.sum requirements.txt
)

_lc_log() {
  printf '[library-context-cache] %s\n' "$*" >&2
}

_lc_md5() {
  if command -v md5sum >/dev/null 2>&1; then
    printf '%s' "$1" | md5sum | cut -c1-32
  elif command -v md5 >/dev/null 2>&1; then
    printf '%s' "$1" | md5 -q | cut -c1-32
  else
    # No md5 tool — sanitize and truncate to last 64 chars. Not
    # collision-proof, but bounded so the path stays valid.
    printf '%s' "$1" | tr '/' '_' | tail -c 64
  fi
}

_lc_now() {
  date +%s
}

_lc_cache_path() {
  [ -n "${CLAUDE_PLUGIN_DATA:-}" ] || return 1
  local project="${CLAUDE_PROJECT_DIR:-$PWD}"
  printf '%s/context7-cache-%s.json' "$CLAUDE_PLUGIN_DATA" "$(_lc_md5 "$project")"
}

# Look up a library name in the tier1 cache. Echoes the cached library_id
# on a fresh hit, nothing on miss/stale/missing. Always exits 0 — callers
# treat empty output as "no cache hit, resolve via context7".
#
# Consumer contract: agents that have library-context preloaded (or
# inlined) should call this helper before invoking
# mcp__context7__resolve-library-id, so the pre-warmed cache actually
# reduces API quota usage. Without this lookup, the SessionStart prewarm
# burns quota for nothing.
_lc_lookup() {
  local name="$1"
  [ -n "$name" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local path
  path=$(_lc_cache_path 2>/dev/null) || return 0
  [ -f "$path" ] || return 0

  local fetched_at age
  fetched_at=$(jq -r --arg n "$name" '.tier1[$n].fetched_at // 0' "$path" 2>/dev/null) || return 0
  [ "$fetched_at" -gt 0 ] 2>/dev/null || return 0
  age=$(( $(_lc_now) - fetched_at ))
  [ "$age" -lt "$_LC_TIER1_TTL" ] || return 0

  jq -r --arg n "$name" '.tier1[$n].library_id // empty' "$path" 2>/dev/null
}

# Look up a (library-id, topic) pair in the tier2 cache. Echoes the cached
# docs body on a fresh hit, nothing on miss/stale/missing. Always exits 0 —
# mirrors _lc_lookup's contract exactly.
_lc_lookup_docs() {
  local id="$1" topic="$2"
  [ -n "$id" ] && [ -n "$topic" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local path
  path=$(_lc_cache_path 2>/dev/null) || return 0
  [ -f "$path" ] || return 0

  local key="${id}|${topic}"
  local fetched_at age
  fetched_at=$(jq -r --arg k "$key" '.tier2[$k].fetched_at // 0' "$path" 2>/dev/null) || return 0
  [ "$fetched_at" -gt 0 ] 2>/dev/null || return 0
  age=$(( $(_lc_now) - fetched_at ))
  [ "$age" -lt "$_LC_TIER2_TTL" ] || return 0

  jq -r --arg k "$key" '.tier2[$k].docs // empty' "$path" 2>/dev/null
}

# Returns 0 if cache exists AND tier1 entries are fresh AND lockfile fingerprint
# matches (skip prewarm). Returns non-zero if cache is missing, stale, or any
# lockfile mtime changed since the cache was written.
_lc_should_skip() {
  local path
  path=$(_lc_cache_path) || return 1
  [ -f "$path" ] || return 1
  local warmed_at
  warmed_at=$(jq -r '.warmed_at // 0' "$path" 2>/dev/null) || return 1
  local age=$(( $(_lc_now) - warmed_at ))
  [ "$age" -lt "$_LC_TIER1_TTL" ] || return 1
  # Also invalidate if any lockfile mtime changed since cache was written.
  local stored_fp current_fp
  stored_fp=$(jq -r '.lockfile_fingerprint // {} | tojson' "$path" 2>/dev/null) || return 1
  current_fp=$(_lc_lockfile_fingerprint | jq -r 'tojson' 2>/dev/null) || return 1
  [ "$stored_fp" = "$current_fp" ]
}

# Scan project manifests and lockfiles; output deduped library names, top N.
# Manifest files (package.json, requirements.txt) are scanned first so direct
# dependencies appear before transitive lockfile entries. Deduplication
# preserves first-occurrence order (awk !seen) rather than sorting
# alphabetically, so direct deps surface before @babel/helper-* noise.
_lc_scan_lockfiles() {
  local project="${CLAUDE_PROJECT_DIR:-$PWD}"
  {
    [ -f "$project/package.json" ] && jq -r '
      (.dependencies // {}) + (.devDependencies // {}) | keys[]
    ' "$project/package.json" 2>/dev/null
    [ -f "$project/requirements.txt" ] && \
      sed -nE 's/^([a-zA-Z][a-zA-Z0-9_.-]*).*/\1/p' "$project/requirements.txt" 2>/dev/null
    [ -f "$project/Cargo.lock" ] && \
      sed -nE 's/^name = "(.+)"$/\1/p' "$project/Cargo.lock" 2>/dev/null
    [ -f "$project/package-lock.json" ] && jq -r '
      (.packages // {}) | to_entries[]
      | select(.key | startswith("node_modules/"))
      | .key | sub("^node_modules/"; "")
      | select(
          (contains("/") | not) or
          (startswith("@") and (split("/") | length == 2))
        )
    ' "$project/package-lock.json" 2>/dev/null
    [ -f "$project/pnpm-lock.yaml" ] && \
      sed -nE "s/^  '?([a-zA-Z@][a-zA-Z0-9@/_-]*)'?:/\1/p" "$project/pnpm-lock.yaml" 2>/dev/null
    [ -f "$project/yarn.lock" ] && \
      sed -nE 's/^"?(@?[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)?)@.*/\1/p' "$project/yarn.lock" 2>/dev/null
    [ -f "$project/go.sum" ] && awk '{print $1}' "$project/go.sum" 2>/dev/null
  } | grep -v '^$' | awk '!seen[$0]++' | head -n "$_LC_PREWARM_MAX"
}

# Resolve a library name → context7 library ID via HTTP.
# Echoes the id (e.g. "/facebook/react") on success, nothing on failure.
_lc_resolve_library_id() {
  local name="$1"
  local encoded
  encoded=$(printf '%s' "$name" | jq -sRr @uri) || return 1

  local response
  if [ -n "${CONTEXT7_API_KEY:-}" ]; then
    # Pass the bearer token via a temp curl config file (not argv) to avoid
    # credential exposure in process listings (ps/proc).
    local _cfg
    _cfg=$(mktemp) || return 1
    chmod 600 "$_cfg" || { rm -f "$_cfg"; return 1; }
    # shellcheck disable=SC2064
    trap "rm -f '$_cfg'" RETURN
    printf 'header = "Authorization: Bearer %s"\n' "${CONTEXT7_API_KEY}" >"$_cfg"
    response=$(curl -sS --max-time "$_LC_CURL_TIMEOUT" \
      -K "$_cfg" \
      "${_LC_API_BASE}/search?query=${encoded}" 2>/dev/null) || return 1
  else
    response=$(curl -sS --max-time "$_LC_CURL_TIMEOUT" \
      "${_LC_API_BASE}/search?query=${encoded}" 2>/dev/null) || return 1
  fi

  printf '%s' "$response" | jq -r '.results[0].id // empty' 2>/dev/null
}

# Atomic write: tmp file in same dir + mv (matches yellow-ci session-start.sh:156-158).
_lc_atomic_write() {
  local path="$1" content="$2"
  mkdir -p "$(dirname "$path")" 2>/dev/null || return 1
  local tmp="${path}.tmp.$$"
  printf '%s' "$content" > "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$path" || { rm -f "$tmp"; return 1; }
}

_LC_DEFAULT_CACHE='{"schema":"1","warmed_at":0,"lockfile_fingerprint":{},"tier1":{},"tier2":{}}'

# Runtime writeback for tier1 — adds/updates one (name -> library_id) entry.
# Re-reads the cache file on every call (never a caller-held snapshot) to
# minimize the multi-writer race window; atomic-mv still means last writer
# wins for the whole file (accepted eventual-consistency trade-off, see
# reference.md). Advisory only: write failures are logged and swallowed —
# the caller's MCP round-trip already succeeded, so a failed writeback must
# never block it. Always exits 0.
_lc_write_tier1() {
  local name="$1" id="$2"
  command -v jq >/dev/null 2>&1 || return 0
  [ -n "$name" ] && [ -n "$id" ] || return 0

  local path
  path=$(_lc_cache_path 2>/dev/null) || return 0

  local now
  now=$(_lc_now)

  local existing="$_LC_DEFAULT_CACHE"
  if [ -f "$path" ]; then
    existing=$(jq '.' "$path" 2>/dev/null) || {
      _lc_log "Warning: existing cache at $path failed to parse; resetting to empty (prior tier1/tier2 entries discarded)"
      existing="$_LC_DEFAULT_CACHE"
    }
  fi

  local updated
  # Mutate-one-key (.tier1[$n] = …), NOT `. + {tier1: …}` — the additive form
  # would replace the whole tier1 object and reset tier2. (_lc_prewarm uses
  # the additive form safely only because it rebuilds the whole cache once
  # per session from a fresh in-memory object — do not copy that shape here.)
  updated=$(printf '%s' "$existing" | jq \
    --arg n "$name" --arg i "$id" --argjson t "$now" \
    '.tier1[$n] = {library_id: $i, fetched_at: $t}') || {
    _lc_log "Warning: tier1 writeback failed (jq merge error) for $name"
    return 0
  }

  _lc_atomic_write "$path" "$updated" || _lc_log "Warning: tier1 writeback failed (atomic write error) for $name"
  return 0
}

# Runtime writeback for tier2 — adds/updates one (library-id|topic -> docs)
# entry, then evicts oldest-by-fetched_at entries in a single jq pass once
# the cache exceeds _LC_TIER2_MAX_ENTRIES. Same re-read-on-every-call and
# advisory-only contract as _lc_write_tier1. Always exits 0.
_lc_write_tier2() {
  local id="$1" topic="$2" docs="$3"
  command -v jq >/dev/null 2>&1 || return 0
  [ -n "$id" ] && [ -n "$topic" ] && [ -n "$docs" ] || return 0

  local path
  path=$(_lc_cache_path 2>/dev/null) || return 0

  local now
  now=$(_lc_now)

  local existing="$_LC_DEFAULT_CACHE"
  if [ -f "$path" ]; then
    existing=$(jq '.' "$path" 2>/dev/null) || {
      _lc_log "Warning: existing cache at $path failed to parse; resetting to empty (prior tier1/tier2 entries discarded)"
      existing="$_LC_DEFAULT_CACHE"
    }
  fi

  local key="${id}|${topic}"
  local updated
  # Single-pass upsert + LRU eviction. `.key` is a deterministic tie-break
  # since sort_by is not guaranteed stable across jq versions; the
  # `if length > $n` guard skips the O(M log M) sort on every write while
  # under the cap. $n MUST be --argjson (a number) — --arg makes it a
  # string and `.[:$n]` errors on a non-numeric slice bound.
  updated=$(printf '%s' "$existing" | jq \
    --arg k "$key" --arg d "$docs" --argjson t "$now" --argjson n "$_LC_TIER2_MAX_ENTRIES" \
    '.tier2[$k] = {docs: $d, fetched_at: $t}
     | if (.tier2 | length) > $n then
         .tier2 |= (to_entries
                    | sort_by(.value.fetched_at, .key)
                    | reverse | .[:$n] | from_entries)
       else . end') || {
    _lc_log "Warning: tier2 writeback failed (jq merge error) for $key"
    return 0
  }

  _lc_atomic_write "$path" "$updated" || _lc_log "Warning: tier2 writeback failed (atomic write error) for $key"
  return 0
}

# Build the lockfile fingerprint object for invalidation tracking.
_lc_lockfile_fingerprint() {
  local project="${CLAUDE_PROJECT_DIR:-$PWD}"
  local fp='{}'
  local f mtime
  for f in "${_LC_LOCKFILES[@]}"; do
    if [ -f "$project/$f" ]; then
      mtime=$(stat -c '%Y' "$project/$f" 2>/dev/null || stat -f %m "$project/$f" 2>/dev/null || echo 0)
      fp=$(printf '%s' "$fp" | jq --arg k "$f" --argjson v "$mtime" '. + {($k): $v}')
    fi
  done
  printf '%s' "$fp"
}

# Main: skip-if-fresh, scan lockfiles, resolve top N, write atomic.
# Never fails — always returns 0. Errors logged to stderr.
_lc_prewarm() {
  command -v curl >/dev/null 2>&1 || return 0
  command -v jq   >/dev/null 2>&1 || return 0

  local cache_path
  cache_path=$(_lc_cache_path) || {
    _lc_log "Warning: CLAUDE_PLUGIN_DATA unset; skipping context7 cache warm"
    return 0
  }

  if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
    _lc_log "Warning: CLAUDE_PROJECT_DIR unset; using PWD ($PWD) as cache key seed"
  fi

  if _lc_should_skip; then
    return 0
  fi

  local names
  names=$(_lc_scan_lockfiles)
  if [ -z "$names" ]; then
    _lc_log "No lockfile found; skipping context7 cache warm"
    return 0
  fi

  local tier1='{}'
  local now id
  local count=0
  now=$(_lc_now)
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    id=$(_lc_resolve_library_id "$name") || continue
    [ -z "$id" ] && continue
    tier1=$(printf '%s' "$tier1" | jq \
      --arg n "$name" --arg i "$id" --argjson t "$now" \
      '. + {($n): {library_id: $i, fetched_at: $t}}')
    count=$((count + 1))
  done <<< "$names"

  if [ "$count" -eq 0 ]; then
    _lc_log "Warning: all context7 resolves failed; skipping cache write to allow retry next session"
    return 0
  fi

  local fp
  fp=$(_lc_lockfile_fingerprint)

  # Preserve any tier2 entries accumulated via runtime writeback — this
  # rewarm only refreshes tier1; hardcoding tier2: {} here would silently
  # wipe doc-content cache entries every ~24h re-warm.
  local existing_tier2='{}'
  if [ -f "$cache_path" ]; then
    existing_tier2=$(jq '.tier2 // {}' "$cache_path" 2>/dev/null) || existing_tier2='{}'
  fi

  local cache
  cache=$(jq -n --argjson w "$now" --argjson t1 "$tier1" --argjson fp "$fp" --argjson t2 "$existing_tier2" \
    '{schema: "1", warmed_at: $w, lockfile_fingerprint: $fp, tier1: $t1, tier2: $t2}')

  if _lc_atomic_write "$cache_path" "$cache"; then
    _lc_log "Warmed context7 cache: $count libraries → $cache_path"
  fi
}
