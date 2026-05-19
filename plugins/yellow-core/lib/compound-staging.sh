#!/usr/bin/env bash
# yellow-core: compound-staging helper library.
#
# Source from yellow-core's Stop and SessionStart hooks (and their drained
# subshells) to manage the per-project compound-staging ledger described in
# plans/background-compounding-triggers.md.
#
# Usage:
#   . "${SCRIPT_DIR}/../../lib/compound-staging.sh"        # from hooks/scripts/
#   slug=$(cs_derive_project_slug "$cwd")
#   staging_dir=$(cs_staging_dir_for_slug "$slug")
#   cs_atomic_jsonl_write "$staging_dir/pending/$session_id.jsonl" "$json_line"
#
# Contract:
#   - Sourced library only — never invoked as a script.
#   - Functions exit non-zero on failure but do not abort the caller via set -e.
#   - Never echoes secrets; redact_secrets is the gate before any disk write.
#   - All disk writes are atomic (sibling tmp + rename in same filesystem).
#
# Note: this file MUST NOT set top-level shell options (no `set -e`, `set -u`,
# `set -o pipefail`) — doing so changes the caller's hook semantics and can
# block the required `{"continue": true}` emission.

# Idempotent source guard.
if [ -n "${_COMPOUND_STAGING_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
_COMPOUND_STAGING_LOADED=1

# Derive the per-project slug used as the staging-dir basename.
# Matches knowledge-compounder.md line 44 derivation exactly:
# git toplevel if inside a repo, otherwise $PWD. Slashes become hyphens so
# the result is a single filesystem component under ~/.claude/projects/.
#
# Args:
#   $1 — cwd (optional; defaults to $PWD). Caller should pass the hook's
#        parsed `.cwd` field so the slug matches Claude Code's project dir.
cs_derive_project_slug() {
  local cwd="${1:-$PWD}"
  local toplevel
  toplevel=$(cd -- "$cwd" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$toplevel" ]; then
    toplevel="$cwd"
  fi
  printf '%s' "$toplevel" | tr '/' '-'
}

# Resolve the staging directory path for a given project slug.
#
# Args:
#   $1 — project slug (from cs_derive_project_slug)
cs_staging_dir_for_slug() {
  local slug="$1"
  if [ -z "$slug" ]; then
    return 1
  fi
  printf '%s/.claude/projects/%s/compound-staging' "$HOME" "$slug"
}

# Atomic write: write to a sibling tmp file in the same dir, then rename.
# rename(2) is atomic when source and target are on the same filesystem,
# which is guaranteed because the tmp file lives in the same directory as
# the target. Pattern matches _lc_atomic_write
# (plugins/yellow-research/hooks/lib/context7-cache.sh:166-172).
#
# Args:
#   $1 — destination path
#   $2 — content (passed via printf %s; no trailing newline added)
cs_atomic_jsonl_write() {
  local path="$1" content="$2"
  if [ -z "$path" ]; then
    return 1
  fi
  local dir
  dir=$(dirname -- "$path")
  mkdir -p -- "$dir" 2>/dev/null || return 1
  local tmp="${path}.tmp.$$"
  printf '%s' "$content" > "$tmp" 2>/dev/null || { rm -f -- "$tmp" 2>/dev/null; return 1; }
  mv -- "$tmp" "$path" 2>/dev/null || { rm -f -- "$tmp" 2>/dev/null; return 1; }
}

# Redact secrets from stdin, write to stdout.
# Self-contained subset of yellow-ci's lib/redact.sh — the patterns Brad
# called out in the plan (D12): password=, token=, api_key=, secret=,
# Bearer, basic auth, plus the high-value vendor token prefixes and
# PEM key blocks. Streaming via sed (constant memory).
#
# Future consolidation: when yellow-ci's redact.sh is relocated to a
# shared yellow-core/lib/redact.sh, this wrapper can `. ` that file.
cs_redact_secrets() {
  local output
  output=$(sed \
    -e 's/ghp_[A-Za-z0-9_]\{36,255\}/[REDACTED:github-token]/g' \
    -e 's/ghs_[A-Za-z0-9_]\{36,255\}/[REDACTED:github-token]/g' \
    -e 's/github_pat_[A-Za-z0-9_]\{22,255\}/[REDACTED:github-pat]/g' \
    -e 's/AKIA[0-9A-Z]\{16\}/[REDACTED:aws-access-key]/g' \
    -e 's/Bearer[[:space:]]\+[A-Za-z0-9._-]\{20,\}/Bearer [REDACTED]/g' \
    -e 's/eyJ[A-Za-z0-9_-]\{10,500\}\.eyJ[A-Za-z0-9_-]\{10,500\}\.[A-Za-z0-9_-]\{10,500\}/[REDACTED:jwt]/g' \
    -e 's/dckr_pat_[A-Za-z0-9_-]\{32,\}/[REDACTED:docker-token]/g' \
    -e 's/npm_[A-Za-z0-9]\{36\}/[REDACTED:npm-token]/g' \
    -e 's/\(https\?\):\/\/[^:[:space:]]\+:[^@[:space:]]\+@/\1:\/\/[REDACTED:basic-auth]@/g' \
    -e 's/\([?&]\)\(token\|api_key\|secret\|key\|password\)=[^&[:space:]]*/\1\2=[REDACTED:url-param]/gI' \
    -e '/-----BEGIN.*PRIVATE KEY-----/,/-----END.*PRIVATE KEY-----/c\[REDACTED:ssh-key]' \
    -e 's/\(password\|secret\|token\|api_key\|credential\)[[:space:]]*[=:][[:space:]]*[^[:space:]"'"'"']\{4,\}/\1=[REDACTED]/gI' \
  ) || {
    printf '[yellow-core] compound-staging: redaction pipeline failed; suppressing output\n' >&2
    printf '[REDACTED: sanitization failed]\n'
    return 1
  }
  printf '%s\n' "$output"
}

# Read the drain-budget JSON file. Emits a single-line JSON object on stdout.
# Fail-open: missing or corrupted file returns the empty/zeroed object so the
# caller never blocks on a budget-state read.
#
# Args:
#   $1 — staging dir
cs_read_drain_budget() {
  local staging="$1"
  local path="${staging}/drain-budget.json"
  local empty='{"window_start_iso":"","drains_in_window":0,"last_drain_iso":"","auth_route":"unknown"}'
  if [ ! -f "$path" ]; then
    printf '%s' "$empty"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    printf '%s' "$empty"
    return 0
  fi
  local parsed
  parsed=$(jq -c '.' < "$path" 2>/dev/null) || {
    printf '%s' "$empty"
    return 0
  }
  printf '%s' "$parsed"
}

# Update the drain-budget JSON with a new drain event. 5h rolling window:
# if `now - window_start_iso > 5h`, reset window_start and drains_in_window=1;
# otherwise increment drains_in_window. Always update last_drain_iso to now.
# Atomic write via cs_atomic_jsonl_write.
#
# Args:
#   $1 — staging dir
#   $2 — auth route hint ("subscription" or "api")
cs_update_drain_budget() {
  local staging="$1" auth_route="${2:-unknown}"
  if [ -z "$staging" ]; then
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    return 1
  fi
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ) || return 1
  local now_epoch
  now_epoch=$(date -u +%s) || return 1
  local current
  current=$(cs_read_drain_budget "$staging")
  local window_start
  window_start=$(printf '%s' "$current" | jq -r '.window_start_iso // ""')
  local drains
  drains=$(printf '%s' "$current" | jq -r '.drains_in_window // 0')
  local reset=1
  if [ -n "$window_start" ]; then
    local window_epoch
    # Try GNU date first (Linux); fall back to BSD date (macOS).
    window_epoch=$(date -u -d "$window_start" +%s 2>/dev/null \
      || date -ujf '%Y-%m-%dT%H:%M:%SZ' "$window_start" +%s 2>/dev/null \
      || echo 0)
    if [ "$window_epoch" -gt 0 ] && [ $((now_epoch - window_epoch)) -lt 18000 ]; then
      reset=0
    fi
  fi
  local next
  if [ "$reset" -eq 1 ]; then
    next=$(jq -nc --arg ws "$now" --arg lt "$now" --arg ar "$auth_route" \
      '{window_start_iso: $ws, drains_in_window: 1, last_drain_iso: $lt, auth_route: $ar}')
  else
    next=$(jq -nc --argjson d "$drains" --arg lt "$now" --arg ar "$auth_route" --arg ws "$window_start" \
      '{window_start_iso: $ws, drains_in_window: ($d + 1), last_drain_iso: $lt, auth_route: $ar}')
  fi
  cs_atomic_jsonl_write "${staging}/drain-budget.json" "$next"
}

# Decide whether to surface a drain-budget warning. Under subscription auth,
# always returns 1 (false) — there is no hard ceiling. Under API-key route,
# returns 0 (true) when drains_in_window exceeds the soft threshold (default 8
# per 5h window, configurable via COMPOUND_DRAIN_API_THRESHOLD).
#
# Args:
#   $1 — staging dir
cs_drain_budget_warn() {
  local staging="$1"
  local current
  current=$(cs_read_drain_budget "$staging")
  local auth_route
  auth_route=$(printf '%s' "$current" | jq -r '.auth_route // "unknown"' 2>/dev/null)
  if [ "$auth_route" != "api" ]; then
    return 1
  fi
  local drains
  drains=$(printf '%s' "$current" | jq -r '.drains_in_window // 0' 2>/dev/null)
  local threshold="${COMPOUND_DRAIN_API_THRESHOLD:-8}"
  if [ "$drains" -ge "$threshold" ] 2>/dev/null; then
    return 0
  fi
  return 1
}

# Detect the auth route this drain will use. ANTHROPIC_API_KEY in env means
# `claude -p` will route to API billing; otherwise it uses the existing
# subscription OAuth token. Printed as a short string for logging.
cs_detect_auth_route() {
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    printf '%s' "api"
  else
    printf '%s' "subscription"
  fi
}
