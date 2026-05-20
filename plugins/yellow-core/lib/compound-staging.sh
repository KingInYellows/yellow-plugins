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

# Convert an ISO-8601 timestamp (e.g., 2026-05-19T12:34:56Z) to a Unix
# epoch on stdout. GNU `date -d` works on Linux; macOS/BSD needs the
# explicit `-jf` format spec. Returns "0" if both attempts fail so
# callers can numerically compare without a parse-error branch.
#
# Args:
#   $1 — ISO-8601 timestamp string
cs_iso_to_epoch() {
  local ts="$1"
  date -u -d "$ts" +%s 2>/dev/null \
    || date -ujf '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null \
    || printf '0'
}

# Atomic write: write to a sibling tmp file in the same dir, then rename.
# rename(2) is atomic when source and target are on the same filesystem,
# which is guaranteed because the tmp file lives in the same directory as
# the target (not under tmp/). The SessionStart reaper covers these sibling
# directories (pending/, processing/, and the staging root) with a
# -name '*.tmp.*' glob so orphan temp files are reaped on next session start.
# Pattern matches _lc_atomic_write
# (plugins/yellow-research/hooks/lib/context7-cache.sh:166-172).
#
# Permissions: writes are wrapped in `umask 077` so pending JSONL files
# (which contain post-redaction transcript fragments — potentially
# sensitive) and drain-budget state default to owner-only (0600) on
# multi-user systems (CI, shared dev boxes, WSL2 with non-default umask).
# The directory is also chmod'd to 0700 to keep listings private.
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
  chmod 700 -- "$dir" 2>/dev/null || true
  local tmp="${path}.tmp.$$"
  # Subshell scopes umask to the write only; sibling shell state untouched.
  ( umask 077; printf '%s' "$content" > "$tmp" ) 2>/dev/null \
    || { rm -f -- "$tmp" 2>/dev/null; return 1; }
  mv -- "$tmp" "$path" 2>/dev/null || { rm -f -- "$tmp" 2>/dev/null; return 1; }
}

# Redact secrets from stdin, write to stdout.
# Self-contained subset of yellow-ci's lib/redact.sh — the patterns Brad
# called out in the plan (D12): password=, token=, api_key=, secret=,
# Bearer, basic auth, plus the high-value vendor token prefixes and
# PEM key blocks. Streams sed directly to stdout (constant memory).
#
# Future consolidation: when yellow-ci's redact.sh is relocated to a
# shared yellow-core/lib/redact.sh, this wrapper can `. ` that file.
cs_redact_secrets() {
  # Use sed -E (ERE) for portable alternation `(a|b|c)` across GNU + BSD sed.
  # POSIX BRE `\|` is a GNU extension; BSD/macOS sed silently misses it.
  # Case-insensitive matching is achieved by enumerating both cases
  # explicitly in the keyword groups — the GNU `I` flag is non-portable.
  sed -E \
    -e 's/ghp_[A-Za-z0-9_]{36,255}/[REDACTED:github-token]/g' \
    -e 's/ghs_[A-Za-z0-9_]{36,255}/[REDACTED:github-token]/g' \
    -e 's/github_pat_[A-Za-z0-9_]{22,255}/[REDACTED:github-pat]/g' \
    -e 's/AKIA[0-9A-Z]{16}/[REDACTED:aws-access-key]/g' \
    -e 's/(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)[[:space:]]*[=:][[:space:]]*[A-Za-z0-9/+=]{40}/\1=[REDACTED:aws-secret]/g' \
    -e 's/sk-ant-api[A-Za-z0-9_-]{20,}/[REDACTED:anthropic-key]/g' \
    -e 's/sk-(admin|proj|svcacct)-[A-Za-z0-9_-]{20,}/[REDACTED:openai-key]/g' \
    -e 's/sk-[A-Za-z0-9]{48}/[REDACTED:openai-key]/g' \
    -e 's/xox[baprsu]-[A-Za-z0-9-]{10,}/[REDACTED:slack-token]/g' \
    -e 's/sk_live_[A-Za-z0-9]{24,}/[REDACTED:stripe-key]/g' \
    -e 's/rk_live_[A-Za-z0-9]{24,}/[REDACTED:stripe-key]/g' \
    -e 's/hf_[A-Za-z0-9]{20,}/[REDACTED:huggingface-token]/g' \
    -e 's/Bearer[[:space:]]+[A-Za-z0-9._-]{20,}/Bearer [REDACTED]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{10,500}\.eyJ[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,500}/[REDACTED:jwt]/g' \
    -e 's/dckr_pat_[A-Za-z0-9_-]{32,}/[REDACTED:docker-token]/g' \
    -e 's/npm_[A-Za-z0-9]{36}/[REDACTED:npm-token]/g' \
    -e 's,(https?)://[^:[:space:]]+:[^@[:space:]]+@,\1://[REDACTED:basic-auth]@,g' \
    -e 's/([?&])(token|api_key|secret|key|password|Token|API_KEY|Secret|Key|Password|TOKEN|SECRET|KEY|PASSWORD)=[^&[:space:]]*/\1\2=[REDACTED:url-param]/g' \
    -e '/-----BEGIN.*PRIVATE KEY-----/,/-----END.*PRIVATE KEY-----/c\
[REDACTED:ssh-key]' \
    -e 's/("(password|secret|token|api_key|credential|Password|Secret|Token|API_KEY|Credential|PASSWORD|SECRET|TOKEN|CREDENTIAL)"[[:space:]]*:[[:space:]]*")[^"]*"/\1[REDACTED]"/g' \
    -e "s/('(password|secret|token|api_key|credential|Password|Secret|Token|API_KEY|Credential|PASSWORD|SECRET|TOKEN|CREDENTIAL)'[[:space:]]*:[[:space:]]*')[^']*'/\\1[REDACTED]'/g" \
    -e 's/(password|secret|token|api_key|credential|Password|Secret|Token|API_KEY|Credential|PASSWORD|SECRET|TOKEN|CREDENTIAL)[[:space:]]*[=:][[:space:]]*[^[:space:]"'"'"']{4,}/\1=[REDACTED]/g' \
  || {
    printf '[yellow-core] compound-staging: redaction pipeline failed; suppressing output\n' >&2
    printf '[REDACTED: sanitization failed]\n'
    return 1
  }
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
    window_epoch=$(cs_iso_to_epoch "$window_start")
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
#   $2 — live auth route ("api"|"subscription"|"unknown"); preferred over the
#        persisted value so route switches take effect immediately. Falls back
#        to the persisted drain-budget.json auth_route when omitted.
cs_drain_budget_warn() {
  local staging="$1"
  local live_route="${2:-}"
  local current
  current=$(cs_read_drain_budget "$staging")
  local auth_route="$live_route"
  if [ -z "$auth_route" ]; then
    auth_route=$(printf '%s' "$current" | jq -r '.auth_route // "unknown"' 2>/dev/null)
  fi
  if [ "$auth_route" != "api" ]; then
    return 1
  fi
  local window_start
  window_start=$(printf '%s' "$current" | jq -r '.window_start_iso // ""' 2>/dev/null)
  if [ -n "$window_start" ]; then
    local now_epoch window_epoch
    now_epoch=$(date -u +%s 2>/dev/null) || now_epoch=0
    window_epoch=$(cs_iso_to_epoch "$window_start")
    # Window has rolled — persisted counter belongs to a past window; treat as fresh.
    if [ "$window_epoch" -gt 0 ] && [ $((now_epoch - window_epoch)) -ge 18000 ]; then
      return 1
    fi
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
