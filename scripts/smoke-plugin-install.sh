#!/usr/bin/env bash
#
# smoke-plugin-install.sh — runtime install smoke harness for the yellow-plugins
# marketplace.
#
# Proves every plugin in .claude-plugin/marketplace.json is installable in a
# DISPOSABLE, fully-isolated Claude Code environment without touching the real
# ~/.claude, the real plugin cache, real credentials, or real marketplace
# config.
#
# Isolation: every `claude` invocation runs under a temp HOME + CLAUDE_CONFIG_DIR
# + XDG_* rooted in a mktemp directory. Verified 2026-06-02 that CLAUDE_CONFIG_DIR
# relocates BOTH the config AND the plugin install cache
# (<TMP>/.claude/plugins/cache/...), and that the real `claude plugin list` /
# `marketplace list` are byte-identical before and after a full isolated install.
# T1 additionally asserts that invariant at runtime and aborts loudly if the real
# state ever changes. See docs/runtime-install-smoke.md.
#
# Tiers:
#   T0 (validate) — `claude plugin validate plugins/<name>` (bundled validator,
#                   no network, no auth, no install). Gates on NON-strict exit 0;
#                   runs --strict as advisory only (every plugin ships a root
#                   CLAUDE.md, which --strict flags as a warning-as-error).
#   T1 (install)  — isolated `marketplace add <repo>` + `plugin install
#                   <name>@<marketplace> --scope user` into the temp cache.
#
# What this PROVES: each manifest passes the *bundled* Claude Code validator and
#   installs from the LOCAL checkout into an isolated cache without credentials.
# What it does NOT prove: acceptance by the *remote* validator invoked when a
#   user installs from the *published GitHub* marketplace — that path can diverge
#   from local schemas (see CLAUDE.md) and remains a manual pre-release gate.
#   MCP servers are NOT started by install (they start on session-enable), so
#   credential-bearing plugins install safely here without credentials.
#
# Usage:
#   scripts/smoke-plugin-install.sh [options]
#
# Options:
#   --plugin <name>   Only smoke this one plugin (repeatable is not supported;
#                     pass once). Must be a plugin in the marketplace.
#   --tier <0|1>      0 = validate only (fast, no install). 1 = install only.
#                     Omit to run BOTH tiers (default).
#   --dry-run         Print the plan (marketplace name, plugins, isolation
#                     scheme) and exit 0 WITHOUT invoking claude or creating
#                     temp dirs.
#   --keep-temp       Do not delete the temp isolation dir; print its path.
#   --ci              Treat an absent `claude` CLI as a hard skip (exit 2)
#                     instead of a soft local skip (exit 0).
#   -h, --help        Print this help and exit 0.
#
# Exit codes:
#   0  all selected checks passed, OR claude CLI absent in local mode (soft skip).
#   1  one or more selected checks failed.
#   2  claude CLI absent and --ci was passed (hard skip), or a usage error, or
#      the real-state isolation invariant was violated (safety abort).
#
# Note: -e is intentionally omitted — per-plugin failures are aggregated into a
# summary table rather than aborting the whole run on the first failure.
set -uo pipefail

# ----------------------------------------------------------------------------
# Resolve repo root from the script location (works regardless of CWD).
# ----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKETPLACE_JSON="$REPO_ROOT/.claude-plugin/marketplace.json"

# ----------------------------------------------------------------------------
# Defaults / arg parsing.
# ----------------------------------------------------------------------------
ONLY_PLUGIN=""
TIER=""          # "" = both, "0" = validate only, "1" = install only
DRY_RUN=0
KEEP_TEMP=0
CI_MODE=0

print_usage() {
  cat <<'EOF'
smoke-plugin-install.sh — runtime install smoke for the yellow-plugins marketplace.

Proves every plugin installs in a disposable, fully-isolated Claude Code
environment (temp HOME + CLAUDE_CONFIG_DIR + XDG_*) without touching the real
~/.claude, plugin cache, or credentials. See docs/runtime-install-smoke.md.

Usage: scripts/smoke-plugin-install.sh [options]

Options:
  --plugin <name>   Only smoke this one plugin (must be in the marketplace).
  --tier <0|1>      0 = validate only; 1 = install only; omit = both (default).
  --dry-run         Print the plan and exit 0 without invoking claude.
  --keep-temp       Keep the temp isolation dir and print its path.
  --ci              Absent claude CLI is a hard skip (exit 2), not a soft skip.
  -h, --help        Print this help and exit 0.

Exit codes: 0 all passed / soft skip; 1 a check failed; 2 hard skip, usage
error, or real-state isolation invariant violated (safety abort).
EOF
}

die_usage() {
  printf '[smoke] usage error: %s\n' "$1" >&2
  printf '[smoke] run with --help for options.\n' >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --plugin)
      if [ -z "${2:-}" ] || printf '%s' "${2:-}" | grep -q '^--'; then
        die_usage "--plugin requires a plugin name"
      fi
      ONLY_PLUGIN="$2"; shift 2 ;;
    --tier)
      case "${2:-}" in
        0|1) TIER="$2"; shift 2 ;;
        *) die_usage "--tier must be 0 or 1" ;;
      esac ;;
    --dry-run) DRY_RUN=1; shift ;;
    --keep-temp) KEEP_TEMP=1; shift ;;
    --ci) CI_MODE=1; shift ;;
    -h|--help) print_usage; exit 0 ;;
    *) die_usage "unknown argument: $1" ;;
  esac
done

# ----------------------------------------------------------------------------
# Read marketplace name + plugin inventory from marketplace.json.
# node is a repo dev dependency and is always present in this monorepo.
# ----------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  printf '[smoke] Error: node is required to parse %s\n' "$MARKETPLACE_JSON" >&2
  exit 2
fi
if [ ! -f "$MARKETPLACE_JSON" ]; then
  printf '[smoke] Error: marketplace manifest not found: %s\n' "$MARKETPLACE_JSON" >&2
  exit 2
fi

MARKETPLACE_NAME="$(node -e 'const m=require(process.argv[1]); process.stdout.write(String(m.name||""))' "$MARKETPLACE_JSON" 2>/dev/null)"
if [ -z "$MARKETPLACE_NAME" ]; then
  printf '[smoke] Error: could not read marketplace .name from %s\n' "$MARKETPLACE_JSON" >&2
  exit 2
fi

# Newline-separated plugin names, sorted for stable output.
ALL_PLUGINS="$(node -e 'const m=require(process.argv[1]); (m.plugins||[]).map(p=>p.name).filter(Boolean).sort().forEach(n=>console.log(n))' "$MARKETPLACE_JSON" 2>/dev/null)"
if [ -z "$ALL_PLUGINS" ]; then
  printf '[smoke] Error: no plugins found in %s\n' "$MARKETPLACE_JSON" >&2
  exit 2
fi

# Apply --plugin filter (validate membership + name shape).
if [ -n "$ONLY_PLUGIN" ]; then
  case "$ONLY_PLUGIN" in
    *[!a-z0-9-]*) die_usage "invalid plugin name: $ONLY_PLUGIN" ;;
  esac
  if ! printf '%s\n' "$ALL_PLUGINS" | grep -qx "$ONLY_PLUGIN"; then
    printf '[smoke] Error: plugin "%s" is not in %s\n' "$ONLY_PLUGIN" "$MARKETPLACE_NAME" >&2
    exit 2
  fi
  PLUGINS="$ONLY_PLUGIN"
else
  PLUGINS="$ALL_PLUGINS"
fi

PLUGIN_COUNT="$(printf '%s\n' "$PLUGINS" | grep -c .)"

# ----------------------------------------------------------------------------
# Plan header / dry-run.
# ----------------------------------------------------------------------------
tier_label() {
  case "$TIER" in
    0) printf 'T0 validate-only' ;;
    1) printf 'T1 install-only' ;;
    *) printf 'T0 validate + T1 install' ;;
  esac
}

printf '=== yellow-plugins runtime install smoke ===\n'
printf 'marketplace : %s\n' "$MARKETPLACE_NAME"
printf 'repo        : %s\n' "$REPO_ROOT"
printf 'plugins     : %s\n' "$PLUGIN_COUNT"
printf 'tiers       : %s\n' "$(tier_label)"
printf 'isolation   : temp HOME + CLAUDE_CONFIG_DIR + XDG_* (real ~/.claude untouched)\n'

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n[dry-run] would smoke the following plugins:\n'
  printf '%s\n' "$PLUGINS" | sed 's/^/  - /'
  printf '\n[dry-run] no claude invocation, no temp dirs created. Exiting 0.\n'
  exit 0
fi

# ----------------------------------------------------------------------------
# claude CLI presence (soft skip locally, hard skip under --ci).
# ----------------------------------------------------------------------------
# CLAUDE_BIN may be overridden (e.g. by tests) to force the absent-CLI path
# deterministically, independent of PATH.
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  if [ "$CI_MODE" -eq 1 ]; then
    printf '\n[smoke] claude CLI not found; --ci set -> hard skip (exit 2).\n' >&2
    exit 2
  fi
  printf '\n[smoke] claude CLI not found; skipping runtime smoke (exit 0). Install the\n'
  printf '        Claude Code CLI to run the install tiers locally.\n'
  exit 0
fi

# Optional timeout wrapper (timeout/gtimeout if present, else run directly).
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"; fi
_t() { # _t <seconds> <cmd...>
  local secs="$1"; shift
  if [ -n "$TIMEOUT_BIN" ]; then "$TIMEOUT_BIN" "$secs" "$@"; else "$@"; fi
}

# ----------------------------------------------------------------------------
# Temp isolation env.
# ----------------------------------------------------------------------------
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/yp-smoke.XXXXXX")"
cleanup() {
  # shellcheck disable=SC2317  # reached via the EXIT trap, not inline.
  if [ "$KEEP_TEMP" -eq 1 ]; then
    printf '\n[smoke] --keep-temp set; isolation dir retained at: %s\n' "$TMP_ROOT"
  else
    rm -rf "$TMP_ROOT" 2>/dev/null || true
  fi
}
# EXIT only: bash runs the EXIT trap when the shell exits on SIGINT/SIGTERM too,
# so trapping INT/TERM separately is redundant — and harmful here, since cleanup
# does not exit, so an INT-trapped handler would delete TMP_ROOT then let the
# script resume against a now-missing temp dir.
trap cleanup EXIT

# Run a claude command fully isolated to the temp dir.
run_isolated() { # run_isolated <seconds> <claude args...>
  local secs="$1"; shift
  HOME="$TMP_ROOT" \
  CLAUDE_CONFIG_DIR="$TMP_ROOT/.claude" \
  XDG_CONFIG_HOME="$TMP_ROOT/.config" \
  XDG_DATA_HOME="$TMP_ROOT/.local/share" \
  XDG_CACHE_HOME="$TMP_ROOT/.cache" \
  XDG_STATE_HOME="$TMP_ROOT/.local/state" \
    _t "$secs" "$@"
}

# Read-only snapshot of the REAL marketplace + plugin lists, joined with a US
# (\037) separator. Returns non-zero if EITHER read fails so a failed snapshot
# can never be silently compared as "unchanged" against an equally-failed later
# snapshot (which would let the isolation invariant pass on error output).
snapshot_real_state() {
  local mkt plugins
  mkt="$(_t 30 "$CLAUDE_BIN" plugin marketplace list 2>&1)" || return 1
  plugins="$(_t 30 "$CLAUDE_BIN" plugin list 2>&1)" || return 1
  printf '%s\037%s' "$mkt" "$plugins"
}

# ----------------------------------------------------------------------------
# Results accumulation.
# ----------------------------------------------------------------------------
FAILURES=0
SUMMARY=""   # "plugin|t0|t1" rows
record() { SUMMARY="${SUMMARY}${1}|${2}|${3}"$'\n'; }

run_tier0=1; run_tier1=1
[ "$TIER" = "1" ] && run_tier0=0
[ "$TIER" = "0" ] && run_tier1=0

# ----------------------------------------------------------------------------
# T1 pre-flight: fingerprint REAL state (read-only) so we can assert it is
# untouched after the isolated installs.
# ----------------------------------------------------------------------------
REAL_STATE_BEFORE=""
REAL_SNAPSHOT_TAKEN=0
if [ "$run_tier1" -eq 1 ]; then
  if ! REAL_STATE_BEFORE="$(snapshot_real_state)"; then
    printf '[smoke] Error: could not snapshot real marketplace/plugin state before T1.\n' >&2
    exit 2
  fi
  REAL_SNAPSHOT_TAKEN=1
  printf '\n[smoke] T1 pre-flight: snapshotted real marketplace + plugin lists for the\n'
  printf '        isolation invariant (real state must be identical afterward).\n'
  # Register the local marketplace inside the temp env once.
  if ! run_isolated 90 "$CLAUDE_BIN" plugin marketplace add "$REPO_ROOT" >/dev/null 2>&1; then
    printf '[smoke] Error: isolated marketplace-add failed; cannot run T1.\n' >&2
    run_tier1=0
    FAILURES=$((FAILURES + 1))
  fi
fi

# ----------------------------------------------------------------------------
# Per-plugin tiers.
# ----------------------------------------------------------------------------
while IFS= read -r plugin; do
  [ -n "$plugin" ] || continue
  plugin_dir="$REPO_ROOT/plugins/$plugin"
  t0="-"; t1="-"

  # --- T0: bundled validator (non-strict gate, --strict advisory) ---
  if [ "$run_tier0" -eq 1 ]; then
    if run_isolated 45 "$CLAUDE_BIN" plugin validate "$plugin_dir" >/dev/null 2>&1; then
      if run_isolated 45 "$CLAUDE_BIN" plugin validate "$plugin_dir" --strict >/dev/null 2>&1; then
        t0="PASS"
      else
        t0="PASS(warn)"   # non-strict ok; --strict flagged the root-CLAUDE.md warning
      fi
    else
      t0="FAIL"
      FAILURES=$((FAILURES + 1))
    fi
  fi

  # --- T1: isolated install from the local marketplace ---
  if [ "$run_tier1" -eq 1 ]; then
    if run_isolated 120 "$CLAUDE_BIN" plugin install "${plugin}@${MARKETPLACE_NAME}" --scope user >/dev/null 2>&1; then
      # Anchor the name to non-identifier boundaries so a similarly-named
      # plugin (e.g. "${plugin}-extra") can't satisfy the check via substring.
      if run_isolated 30 "$CLAUDE_BIN" plugin list 2>/dev/null | grep -qE "(^|[^A-Za-z0-9_-])${plugin}([^A-Za-z0-9_-]|\$)"; then
        t1="PASS"
      else
        t1="FAIL(absent)"   # install reported success but plugin not listed
        FAILURES=$((FAILURES + 1))
      fi
    else
      t1="FAIL"
      FAILURES=$((FAILURES + 1))
    fi
  fi

  printf '  %-22s  T0=%-11s T1=%s\n' "$plugin" "$t0" "$t1"
  record "$plugin" "$t0" "$t1"
done <<< "$PLUGINS"

# ----------------------------------------------------------------------------
# T1 post-flight: assert REAL state is byte-identical (safety invariant).
# Gated on REAL_SNAPSHOT_TAKEN, not run_tier1: if the isolated marketplace-add
# failed (run_tier1 flipped to 0 above) we still snapshotted real state first,
# so we must verify that the failed-and-isolated add did not leak into it.
# ----------------------------------------------------------------------------
if [ "$REAL_SNAPSHOT_TAKEN" -eq 1 ]; then
  if ! REAL_STATE_AFTER="$(snapshot_real_state)"; then
    printf '\n[smoke] Error: could not snapshot real marketplace/plugin state after T1.\n' >&2
    exit 2
  fi
  if [ "$REAL_STATE_BEFORE" = "$REAL_STATE_AFTER" ]; then
    printf '\n[smoke] isolation invariant OK: real ~/.claude marketplace + plugin lists unchanged.\n'
  else
    printf '\n[smoke] SAFETY ABORT: real ~/.claude state CHANGED during the smoke run.\n' >&2
    printf '        The isolation env failed to contain an install. Inspect manually.\n' >&2
    exit 2
  fi
fi

# ----------------------------------------------------------------------------
# Summary + exit code.
# ----------------------------------------------------------------------------
printf '\n=== summary (%d plugin(s), tiers: %s) ===\n' "$PLUGIN_COUNT" "$(tier_label)"
printf '%s' "$SUMMARY" | while IFS='|' read -r p a b; do
  [ -n "$p" ] && printf '  %-22s  T0=%-11s T1=%s\n' "$p" "$a" "$b"
done

if [ "$FAILURES" -gt 0 ]; then
  printf '\n[smoke] %d check(s) FAILED.\n' "$FAILURES" >&2
  exit 1
fi
printf '\n[smoke] all selected checks passed.\n'
exit 0
