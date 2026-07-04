#!/usr/bin/env bash
# repo-profile.sh — git-SHA-keyed repo-orientation profile cache (tier3 C17).
#
# Cache I/O only: key derivation, freshness-checked get, atomic whole-object
# put. Profile DERIVATION lives in consumers (first adopter:
# /workflows:plan Phase 2). Protocol adapted from CE
# ce-plan/references/repo-profile-cache.md.
#
#   rp_get        → prints "HIT" + profile JSON | "MISS" + write path | "NO-CACHE"
#   rp_put <file> [expected-entry] → atomic tmp+mv whole-object write at the
#                   current key. Pass the write path printed by the earlier
#                   rp_get MISS as [expected-entry] so the write is rejected
#                   if HEAD moved between the get and the put (see rp_put).
#
# Hard rules:
#   - Single writer per key: one compute-and-atomic-write of the WHOLE
#     profile object per miss. NO consumer may patch subfields of an
#     existing entry — the periodic-rebuild-wipes-incremental-cache-state
#     bug shape is excluded by construction.
#   - Never cached: docs/solutions/ enumeration and question-specific
#     grounding. Consumers must re-derive those fresh on every run.
#   - Degradation: outside git / shallow clone / unwritable cache /
#     malformed entry / missing jq / no writable storage root (both
#     CLAUDE_PLUGIN_DATA and HOME unset) → NO-CACHE (exit 0). The cache is
#     an optimization, never a correctness dependency.
#
# Note: this file is intended to be sourced. It MUST NOT alter the
# caller's shell options (no top-level `set -e`, `set -u`,
# `set -o pipefail`) — consumers source it inline in command files.

if [ -n "${_REPO_PROFILE_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
_REPO_PROFILE_LOADED=1

RP_SCHEMA_VERSION=1

# Storage root: ${CLAUDE_PLUGIN_DATA} (documented persistent per-plugin data
# directory, survives plugin updates) when set; ~/.cache fallback otherwise
# (credential-status.sh and yellow-ci precedent). Never /tmp — this is a
# persistent cache and /tmp retention is a documented data-residue concern.
# Non-zero return (caller treats as NO-CACHE) when both CLAUDE_PLUGIN_DATA
# and HOME are unset/empty, rather than falling back to /tmp.
rp_cache_root() {
  if [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then
    printf '%s/repo-profile' "$CLAUDE_PLUGIN_DATA"
  elif [ -n "${HOME:-}" ]; then
    printf '%s/.cache/yellow-plugins/repo-profile' "$HOME"
  else
    return 1
  fi
}

# Repo identity + working-state key. Prints "<root-sha> <head-sha>".
# Non-zero return (caller treats as NO-CACHE) when:
#   - not inside a git work tree
#   - shallow clone: `rev-list --max-parents=0` SUCCEEDS but returns the
#     shallow-boundary commit — a wrong-but-valid SHA whose value shifts
#     with clone depth. There is no error to trap, so the shallow check
#     must be proactive, not error-driven.
#   - any derivation step fails or returns empty (detached HEAD is fine —
#     rev-list traversal is identical)
# Multi-root repos (unrelated-history merges): the lexicographically first
# root is taken, deterministically, via LC_ALL=C sort.
rp_derive_key() {
  local root_sha head_sha
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "false" ] || return 1
  root_sha=$(git rev-list --max-parents=0 HEAD 2>/dev/null | LC_ALL=C sort | head -n 1)
  head_sha=$(git rev-parse HEAD 2>/dev/null)
  { [ -n "$root_sha" ] && [ -n "$head_sha" ]; } || return 1
  printf '%s %s' "$root_sha" "$head_sha"
}

# Conservative superset of profile-input paths. Matching a dirty or
# untracked-new path invalidates; dirty non-input paths do not.
# Over-invalidation is the accepted failure direction: it costs a
# re-derive, while under-invalidation would serve a stale profile.
_rp_input_regex() {
  printf '%s' \
'(^|/)(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|pyproject\.toml|poetry\.lock|requirements[^/]*\.txt|Dockerfile[^/]*)$|^(CLAUDE\.md|AGENTS\.md|GEMINI\.md|ARCHITECTURE\.md|README\.md|CONTRIBUTING\.md|STRATEGY\.md|LICENSE[^/]*)$|^docs/CONCEPTS\.md$|^\.github/workflows/|(^|/)\.claude-plugin/'
}

# Returns 0 (dirty) when at least one profile-input path appears in
# `git status --porcelain --untracked-files=all` (untracked new inputs
# invalidate too), and also when the status call itself fails — fail
# toward re-derivation, never toward serving a stale profile.
# Returns 1 (clean) otherwise.
rp_inputs_dirty() {
  local status_out
  status_out=$(git status --porcelain --untracked-files=all 2>/dev/null) || return 0
  [ -z "$status_out" ] && return 1
  # cut strips the two status columns + space. git double-quotes paths
  # containing unusual characters (spaces, backslashes, non-ASCII) — strip
  # the quotes so the $-anchored regex can match. Rename lines ("old ->
  # new") are split on " -> " so BOTH sides are tested: a rename AWAY from
  # an input name must invalidate too, since a staged rename does not move
  # HEAD (no next-head-sha-change to catch it later).
  printf '%s\n' "$status_out" | cut -c4- | tr -d '"' \
    | awk '{gsub(/ -> /, "\n"); print}' | grep -qE "$(_rp_input_regex)"
}

# rp_get — prints exactly one of:
#   HIT        followed by the profile JSON (fresh entry at current key)
#   MISS       followed by the write path (derive, then rp_put)
#   NO-CACHE   (cache unusable this run: derive fresh, skip put)
# Always exits 0 — the cache never blocks the caller.
rp_get() {
  local key root_sha head_sha entry entry_dir cache_root
  if ! command -v jq >/dev/null 2>&1; then
    printf 'NO-CACHE\n'
    return 0
  fi
  if ! key=$(rp_derive_key); then
    printf 'NO-CACHE\n'
    return 0
  fi
  if ! cache_root=$(rp_cache_root); then
    printf 'NO-CACHE\n'
    return 0
  fi
  root_sha=${key%% *}
  head_sha=${key##* }
  entry_dir="${cache_root}/${root_sha}"
  entry="${entry_dir}/${head_sha}.json"
  if [ -f "$entry" ] \
    && jq -e . "$entry" >/dev/null 2>&1 \
    && [ "$(jq -r '.profile_schema_version // empty' "$entry" 2>/dev/null)" = "$RP_SCHEMA_VERSION" ] \
    && ! rp_inputs_dirty; then
    printf 'HIT\n'
    cat "$entry"
    return 0
  fi
  if ! mkdir -p "$entry_dir" 2>/dev/null || [ ! -w "$entry_dir" ]; then
    printf 'NO-CACHE\n'
    return 0
  fi
  printf 'MISS\n%s\n' "$entry"
  return 0
}

# rp_put <json-file> [expected-entry] — validate and atomically install the
# WHOLE profile object at the current key (write .tmp in the same directory,
# then mv). Refuses to write when any profile-input path is dirty: an entry
# derived from transient dirty state would later be served as a false HIT
# once the tree is reverted to clean at the same HEAD. Non-zero on any
# failure; callers MUST treat failure as a skipped optimization, never an
# error.
#
# [expected-entry], if passed, MUST be the write path printed by the rp_get
# MISS call that triggered this derivation. rp_put re-derives the key from
# the CURRENT HEAD (not the one rp_get saw) and refuses the write when the
# re-derived entry path differs from [expected-entry] — HEAD moved between
# the get and this put, so the profile in hand was derived for a repo state
# that is no longer current and must not be written under the new key.
rp_put() {
  local src="${1:-}" expected="${2:-}" key root_sha head_sha entry entry_dir tmp cache_root
  { [ -n "$src" ] && [ -f "$src" ]; } || return 1
  command -v jq >/dev/null 2>&1 || return 1
  jq -e . "$src" >/dev/null 2>&1 || return 1
  [ "$(jq -r '.profile_schema_version // empty' "$src" 2>/dev/null)" = "$RP_SCHEMA_VERSION" ] || return 1
  key=$(rp_derive_key) || return 1
  rp_inputs_dirty && return 1
  cache_root=$(rp_cache_root) || return 1
  root_sha=${key%% *}
  head_sha=${key##* }
  entry_dir="${cache_root}/${root_sha}"
  entry="${entry_dir}/${head_sha}.json"
  { [ -n "$expected" ] && [ "$entry" != "$expected" ]; } && return 1
  mkdir -p "$entry_dir" 2>/dev/null || return 1
  chmod 700 "$entry_dir" 2>/dev/null || :
  tmp="${entry}.tmp.$$"
  cp "$src" "$tmp" 2>/dev/null || return 1
  mv -f "$tmp" "$entry" 2>/dev/null || { rm -f "$tmp"; return 1; }
  # Eviction: entries are only readable at their exact head-sha, so stale
  # sibling heads accumulate forever without this. Prune by mtime rather
  # than keep-only-current to avoid thrashing across concurrent worktrees
  # sharing a root but diverging heads.
  find "$entry_dir" -name '*.json' -mtime +30 -delete 2>/dev/null || :
}
