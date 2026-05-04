#!/bin/false
# yellow-morph install primitives. Sourced by:
#   - bin/start-morph.sh                 (synchronous correctness gate)
#   - hooks/scripts/prewarm-morph.sh     (SessionStart pre-warmer)
#   - commands/morph/setup.md            (manual /morph:setup)
#
# This file MUST NOT set -e or call exit — callers control termination so
# they can choose between bare exit (wrapper, setup command) and json_exit
# (SessionStart hook). Functions return 0 on success, non-zero on failure,
# and print diagnostics to stderr.
#
# All functions are prefixed yellow_morph_ to avoid namespace collisions
# when sourced into a long-lived shell.

# Validate that CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA are set and point
# at expected locations. Returns 1 if either is unset or has an unexpected
# prefix — defense in depth so cp / npm ci cannot write to /etc, /var, etc.
yellow_morph_validate_paths() {
  if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    printf 'yellow-morph: CLAUDE_PLUGIN_ROOT unset\n' >&2
    return 1
  fi
  if [ -z "${CLAUDE_PLUGIN_DATA:-}" ]; then
    printf 'yellow-morph: CLAUDE_PLUGIN_DATA unset\n' >&2
    return 1
  fi
  case "$CLAUDE_PLUGIN_DATA" in
    "${HOME:-/__unset__}"/*|/tmp/*) ;;
    *)
      printf 'yellow-morph: refusing — CLAUDE_PLUGIN_DATA outside HOME/tmp: %s\n' \
        "$CLAUDE_PLUGIN_DATA" >&2
      return 1 ;;
  esac
  case "$CLAUDE_PLUGIN_ROOT" in
    "${HOME:-/__unset__}"/*|/tmp/*|/usr/*|/opt/*) ;;
    *)
      printf 'yellow-morph: refusing — CLAUDE_PLUGIN_ROOT unexpected prefix: %s\n' \
        "$CLAUDE_PLUGIN_ROOT" >&2
      return 1 ;;
  esac
  return 0
}

# Returns 0 if morphmcp needs to be (re)installed, 1 if the cached install
# is in sync with the plugin's committed lockfile. Treats any diff failure
# (missing files, permission errors) as "needs install" — fail-open and
# safe.
yellow_morph_needs_install() {
  local entry="${CLAUDE_PLUGIN_DATA}/node_modules/@morphllm/morphmcp/dist/index.js"
  [ ! -f "$entry" ] && return 0
  ! diff -q "${CLAUDE_PLUGIN_ROOT}/package-lock.json" \
            "${CLAUDE_PLUGIN_DATA}/package-lock.json" >/dev/null 2>&1
}

# Try to acquire the atomic mkdir-based install lock. $1 = max retry count
# (1s sleep between attempts). Returns 0 on success, 1 on timeout.
#
# Stale-lock recovery: when mkdir fails with EEXIST, read the recorded
# owner PID from $LOCK_DIR/pid. If the owner is no longer alive (kill -0
# fails), clear the lock and retry once. This recovers from SIGKILL / OOM
# of a prior holder without requiring 20s of timeout-then-manual-cleanup
# on every subsequent install.
#
# Stale recovery happens at most once per call to bound the worst-case
# behavior: a directory that mkdir cannot create for unrelated reasons
# (permission denied, ENOSPC) does not loop forever.
yellow_morph_acquire_install_lock() {
  local max_attempts="${1:-20}"
  local lock_dir="${CLAUDE_PLUGIN_DATA}/.install.lock"
  local stale_recovered=0
  local i

  for ((i=1; i<=max_attempts; i++)); do
    if mkdir "$lock_dir" 2>/dev/null; then
      # Record owner PID — best-effort. Failure to write the PID file does
      # not invalidate the lock (we still hold the directory).
      printf '%s' "$$" > "${lock_dir}/pid" 2>/dev/null || true
      return 0
    fi

    if [ "$stale_recovered" -eq 0 ] && [ -f "${lock_dir}/pid" ]; then
      local owner_pid
      owner_pid=$(cat "${lock_dir}/pid" 2>/dev/null)
      if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then
        printf 'yellow-morph: stale lock owner PID %s no longer running; clearing\n' \
          "$owner_pid" >&2
        rm -f "${lock_dir}/pid" 2>/dev/null
        rmdir "$lock_dir" 2>/dev/null
        stale_recovered=1
        continue
      fi
    fi

    sleep 1
  done
  return 1
}

# Release the install lock. Idempotent — safe to call from EXIT/INT/TERM
# traps and again before exec.
yellow_morph_release_install_lock() {
  local lock_dir="${CLAUDE_PLUGIN_DATA}/.install.lock"
  rm -f "${lock_dir}/pid" 2>/dev/null
  rmdir "$lock_dir" 2>/dev/null || true
}

# Copy the manifest+lockfile from the plugin install into the data dir,
# then run `npm ci` with a sanitized environment. env -i denies ANY
# inherited secret (ANTHROPIC_API_KEY, GITHUB_TOKEN, etc.) to npm
# postinstall scripts — a tighter boundary than `unset MORPH_API_KEY`,
# which only blocks the one variable.
#
# HOME and PATH are required for npm to function. NPM_CONFIG_* are passed
# through when present so user-level npm config (registry, proxy, prefix)
# still applies. Caller is responsible for holding the install lock.
yellow_morph_do_install() {
  cp "${CLAUDE_PLUGIN_ROOT}/package.json" \
     "${CLAUDE_PLUGIN_DATA}/package.json"      || return 1
  cp "${CLAUDE_PLUGIN_ROOT}/package-lock.json" \
     "${CLAUDE_PLUGIN_DATA}/package-lock.json" || return 1

  local -a env_args=(
    "HOME=${HOME:-/}"
    "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}"
  )
  [ -n "${NPM_CONFIG_USERCONFIG:-}" ]   && env_args+=("NPM_CONFIG_USERCONFIG=$NPM_CONFIG_USERCONFIG")
  [ -n "${NPM_CONFIG_GLOBALCONFIG:-}" ] && env_args+=("NPM_CONFIG_GLOBALCONFIG=$NPM_CONFIG_GLOBALCONFIG")
  [ -n "${NPM_CONFIG_PREFIX:-}" ]       && env_args+=("NPM_CONFIG_PREFIX=$NPM_CONFIG_PREFIX")

  ( cd "$CLAUDE_PLUGIN_DATA" \
    && env -i "${env_args[@]}" \
       npm ci --no-audit --no-fund --loglevel=error )
}

# Remove copied manifest+lockfile after a failed install so the next run
# retries from a clean state instead of seeing an out-of-sync install.
yellow_morph_cleanup_failed_install() {
  rm -f "${CLAUDE_PLUGIN_DATA}/package.json" \
        "${CLAUDE_PLUGIN_DATA}/package-lock.json" 2>/dev/null
}
