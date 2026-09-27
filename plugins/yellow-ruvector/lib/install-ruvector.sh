#!/bin/false
# yellow-ruvector install primitives. Sourced by:
#   - bin/start-ruvector.sh              (synchronous correctness gate)
#   - hooks/scripts/prewarm.sh           (SessionStart pre-warmer)
#   - hooks/scripts/lib/resolve.sh       (read-only: data dir + entry path)
#   - commands/ruvector/{setup,status}.md
#
# Adapted from plugins/yellow-morph/lib/install-morphmcp.sh. Differences:
#   - CLAUDE_PLUGIN_DATA may be unset (older Claude Code, Cursor bridge);
#     fall back to ${XDG_DATA_HOME:-$HOME/.local/share}/yellow-ruvector.
#   - One install dir per lockfile hash (install-<hash12>) plus an atomic
#     `current` symlink, so a version bump never deletes node_modules from
#     under a running MCP server (ruvector's ONNX modules load lazily).
#   - npm ci runs with --ignore-scripts and passes proxy/CA settings through.
#
# This file MUST NOT set -e or call exit. Functions return non-zero on
# failure and print diagnostics to stderr. All names are prefixed
# yellow_ruvector_ to avoid collisions when sourced.

YELLOW_RUVECTOR_MODEL='all-MiniLM-L6-v2'

# yellow_ruvector_flat <text> — one line for display: control characters as
# spaces, dash runs shortened. Paths printed to a model-visible stream (the
# data dir, the plugin root) go through it, so none can forge a fence or an
# instruction line.
yellow_ruvector_flat() {
  printf '%s' "$1" | LC_ALL=C tr '\000-\037\177' ' ' | sed -E 's/-{3,}/--/g'
}

# Set RUVECTOR_DATA (and RUVECTOR_DATA_FALLBACK=1 when CLAUDE_PLUGIN_DATA is
# unset). Does not validate; see yellow_ruvector_validate_paths.
yellow_ruvector_data_dir() {
  if [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then
    RUVECTOR_DATA="$CLAUDE_PLUGIN_DATA"
    RUVECTOR_DATA_FALLBACK=0
  else
    RUVECTOR_DATA="${XDG_DATA_HOME:-${HOME:-/__unset__}/.local/share}/yellow-ruvector"
    RUVECTOR_DATA_FALLBACK=1
  fi
  export RUVECTOR_DATA RUVECTOR_DATA_FALLBACK
}

# yellow_ruvector_canon <abs-path> — portable stand-in for `realpath -m`
# (BSD/macOS lack -m): resolve symlinks in the longest existing ancestor with
# `cd -P`, then append the components that do not exist yet (a dangling
# symlink among them fails).
yellow_ruvector_canon() {
  local head="$1" tail=""
  case "$head" in /*) ;; *) return 1 ;; esac
  while [ ! -d "$head" ]; do
    # A dangling symlink is not a missing component: its target could
    # appear later, outside the prefix this lexical path passed. Refuse it.
    [ -L "$head" ] && return 1
    tail="/${head##*/}${tail}"
    head="${head%/*}"
    [ -n "$head" ] || head="/"
  done
  head=$(CDPATH= cd -P -- "$head" 2>/dev/null && pwd -P) || return 1
  printf '%s%s' "${head%/}" "$tail"
}

# yellow_ruvector_system_dir <canonical-path> — true for an empty path, a
# path with . or .. components, or a system directory (or anything below
# one) that a data dir must never live in.
yellow_ruvector_system_dir() {
  case "/${1:-}/" in */../*|*/./*) return 0 ;; esac
  case "${1:-}" in
    ''|/|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/lib|/lib/*|/lib32|/lib32/*|/lib64|/lib64/*|/libx32|/libx32/*|/proc|/proc/*|/run|/run/*|/sbin|/sbin/*|/sys|/sys/*|/usr|/usr/*|/var|/var/*|/System|/System/*|/Library|/Library/*|/private/etc|/private/etc/*|/private/var|/private/var/*) return 0 ;;
  esac
  return 1
}

# Validate CLAUDE_PLUGIN_ROOT and the data dir. Canonicalizes both (GNU
# `realpath -m`, else yellow_ruvector_canon, so a symlinked ancestor cannot
# point outside the allowed prefixes) and rejects unexpected prefixes so
# cp / npm ci / rm -rf can never target /etc, /var, etc. With --data-only
# (the hooks) the plugin root's prefix is not checked.
yellow_ruvector_validate_paths() {
  if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    printf 'yellow-ruvector: CLAUDE_PLUGIN_ROOT unset\n' >&2
    return 1
  fi
  yellow_ruvector_data_dir

  # A path that cannot be canonicalized (e.g. it crosses a dangling
  # symlink on BSD/macOS) is refused: its lexical form could pass the prefix
  # checks below while the symlink later points outside them.
  local canonical
  if canonical=$(realpath -m -- "$CLAUDE_PLUGIN_ROOT" 2>/dev/null) \
     || canonical=$(yellow_ruvector_canon "$CLAUDE_PLUGIN_ROOT"); then
    CLAUDE_PLUGIN_ROOT="$canonical"
  elif [ "${1:-}" != --data-only ]; then
    printf 'yellow-ruvector: refusing — cannot canonicalize CLAUDE_PLUGIN_ROOT: %s\n' "$(yellow_ruvector_flat "$CLAUDE_PLUGIN_ROOT")" >&2
    return 1
  fi
  if canonical=$(realpath -m -- "$RUVECTOR_DATA" 2>/dev/null) \
     || canonical=$(yellow_ruvector_canon "$RUVECTOR_DATA"); then
    RUVECTOR_DATA="$canonical"
  else
    printf 'yellow-ruvector: refusing — cannot canonicalize the data dir: %s\n' "$(yellow_ruvector_flat "$RUVECTOR_DATA")" >&2
    return 1
  fi
  export CLAUDE_PLUGIN_ROOT RUVECTOR_DATA

  # Without GNU `realpath -m` (BSD/macOS) the paths stay raw, and a `..`
  # component would slip past the prefix checks below: refuse it outright.
  local p
  for p in "$CLAUDE_PLUGIN_ROOT" "$RUVECTOR_DATA"; do
    case "/${p}/" in
      */../*|*/./*)
        printf 'yellow-ruvector: refusing — path has a . or .. component: %s\n' "$(yellow_ruvector_flat "$p")" >&2
        return 1 ;;
    esac
  done

  local home_canonical="${HOME:-/__unset__}"
  if [ -n "${HOME:-}" ] && { canonical=$(realpath -m -- "$HOME" 2>/dev/null) \
       || canonical=$(yellow_ruvector_canon "$HOME"); }; then
    home_canonical="$canonical"
  fi

  # The documented XDG fallback may live outside HOME (XDG_DATA_HOME=/mnt/…):
  # allow exactly <canonical XDG_DATA_HOME>/yellow-ruvector when the user set
  # an absolute XDG_DATA_HOME that is not a system directory.
  local xdg_dir="/__unset__"
  if [ "${RUVECTOR_DATA_FALLBACK:-0}" = 1 ]; then
    case "${XDG_DATA_HOME:-}" in
      /*)
        if canonical=$(realpath -m -- "$XDG_DATA_HOME" 2>/dev/null) \
             || canonical=$(yellow_ruvector_canon "$XDG_DATA_HOME"); then
          yellow_ruvector_system_dir "$canonical" || xdg_dir="${canonical%/}/yellow-ruvector"
        fi ;;
    esac
  fi

  # Claude Code puts CLAUDE_PLUGIN_DATA under its config dir
  # (${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/data/<id>), which a relocated
  # config dir moves outside HOME: allow <canonical CLAUDE_CONFIG_DIR>/plugins/data/*
  # when CLAUDE_CONFIG_DIR is an absolute, non-system path.
  local cfg_data="/__unset__"
  if [ "${RUVECTOR_DATA_FALLBACK:-0}" = 0 ]; then
    case "${CLAUDE_CONFIG_DIR:-}" in
      /*)
        if canonical=$(realpath -m -- "$CLAUDE_CONFIG_DIR" 2>/dev/null) \
             || canonical=$(yellow_ruvector_canon "$CLAUDE_CONFIG_DIR"); then
          yellow_ruvector_system_dir "$canonical" || cfg_data="${canonical%/}/plugins/data"
        fi ;;
    esac
  fi

  case "$RUVECTOR_DATA" in
    "${HOME:-/__unset__}"/*|"${home_canonical}"/*|/tmp/*|/private/tmp/*|"$xdg_dir"|"$cfg_data"/?*) ;;
    *)
      printf 'yellow-ruvector: refusing — data dir outside HOME/tmp (and not under a non-system XDG_DATA_HOME or CLAUDE_CONFIG_DIR/plugins/data): %s\n' \
        "$(yellow_ruvector_flat "$RUVECTOR_DATA")" >&2
      return 1 ;;
  esac
  # --data-only (hooks): the plugin root is the running script's own
  # location, so only the data dir needs the prefix check.
  [ "${1:-}" = --data-only ] && return 0
  # Claude Code installs plugins under ${CLAUDE_CONFIG_DIR}/plugins/, which a
  # relocated config dir moves outside HOME: allow that subtree when
  # CLAUDE_CONFIG_DIR is an absolute, non-system path.
  local cfg_plugins="/__unset__"
  case "${CLAUDE_CONFIG_DIR:-}" in
    /*)
      if canonical=$(realpath -m -- "$CLAUDE_CONFIG_DIR" 2>/dev/null) \
           || canonical=$(yellow_ruvector_canon "$CLAUDE_CONFIG_DIR"); then
        yellow_ruvector_system_dir "$canonical" || cfg_plugins="${canonical%/}/plugins"
      fi ;;
  esac
  case "$CLAUDE_PLUGIN_ROOT" in
    "${HOME:-/__unset__}"/*|"${home_canonical}"/*|/tmp/*|/private/tmp/*|/usr/*|/opt/*|"$cfg_plugins"/?*) ;;
    *)
      printf 'yellow-ruvector: refusing — CLAUDE_PLUGIN_ROOT unexpected prefix: %s\n' \
        "$(yellow_ruvector_flat "$CLAUDE_PLUGIN_ROOT")" >&2
      return 1 ;;
  esac
  return 0
}

# Print the first 12 hex chars of the committed lockfile's sha256.
yellow_ruvector_lock_hash() {
  local lock="${CLAUDE_PLUGIN_ROOT}/package-lock.json" sum
  [ -f "$lock" ] || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    sum=$(sha256sum "$lock" 2>/dev/null) || return 1
  elif command -v shasum >/dev/null 2>&1; then
    sum=$(shasum -a 256 "$lock" 2>/dev/null) || return 1
  else
    return 1
  fi
  printf '%s' "${sum%% *}" | cut -c1-12
}

# yellow_ruvector_pinned_entry — the CLI entry of THIS plugin version's
# install (install-<hash of its own lockfile>), not whatever `current` points
# at: another session running a newer plugin may have moved `current`, and
# hooks and the server of one session must run the same ruvector.
# Fails unless the entry is a regular file reached through real directories
# (yellow_ruvector_install_ok), so nothing outside the data dir is ever run.
yellow_ruvector_pinned_entry() {
  local hash
  hash=$(yellow_ruvector_lock_hash) || return 1
  yellow_ruvector_install_ok "${RUVECTOR_DATA}/install-${hash}" || return 1
  printf '%s/install-%s/node_modules/ruvector/bin/cli.js' "$RUVECTOR_DATA" "$hash"
}

# yellow_ruvector_install_ok <install-dir> — the dir and every component down
# to bin/cli.js are real (non-symlink) directories and a regular file: a
# planted `install-<hash>` symlink or a linked node_modules/ruvector would
# otherwise make node run JavaScript outside the validated data dir.
yellow_ruvector_install_ok() {
  local d="$1" c
  for c in "$d" "$d/node_modules" "$d/node_modules/ruvector" "$d/node_modules/ruvector/bin"; do
    [ -d "$c" ] && [ ! -L "$c" ] || return 1
  done
  [ -f "$d/node_modules/ruvector/bin/cli.js" ] && [ ! -L "$d/node_modules/ruvector/bin/cli.js" ]
}

# Path of the installed CLI entry through the `current` symlink.
yellow_ruvector_entry() {
  printf '%s/current/node_modules/ruvector/bin/cli.js' "$RUVECTOR_DATA"
}

# yellow_ruvector_install_healthy — this version's install actually runs
# (`cli.js --version`, bounded): a tree that lost or corrupted a dependency
# while bin/cli.js survived is not healthy and gets reinstalled.
# $1 = seconds to allow (default 10; ~70 ms when healthy).
yellow_ruvector_install_healthy() {
  local entry
  entry=$(yellow_ruvector_pinned_entry) || return 1
  [ -f "$entry" ] || return 1
  yellow_ruvector_run_bounded "${1:-10}" node "$entry" --version >/dev/null 2>&1
}

# Returns 0 when an install is needed: no entry, or `current` does not point
# at the install dir for the committed lockfile. Fail-open (any error means
# "needs install").
yellow_ruvector_needs_install() {
  local hash target
  hash=$(yellow_ruvector_lock_hash) || return 0
  [ -f "$(yellow_ruvector_entry)" ] || return 0
  target=$(readlink "${RUVECTOR_DATA}/current" 2>/dev/null) || return 0
  [ "${target##*/}" != "install-${hash}" ]
}

# Lock owners are recorded as a pid plus, where ps reports it, that process's
# start time in <lock>/start.<pid> (written before the pid), so a pid the OS
# reused for an unrelated long-lived process never keeps a dead owner's lock
# alive. Without a recorded start time, kill -0 alone decides.
yellow_ruvector_pid_start() {
  ps -o lstart= -p "$1" 2>/dev/null | tr -s ' '
}

# yellow_ruvector_stamp_pid <lock-dir> <pid>
yellow_ruvector_stamp_pid() {
  local st
  st=$(yellow_ruvector_pid_start "$2")
  [ -n "$st" ] && printf '%s' "$st" > "$1/start.$2" 2>/dev/null
  return 0
}

# yellow_ruvector_pid_alive <lock-dir> <pid> — 0 when <pid> runs and is the
# process that took <lock-dir>.
yellow_ruvector_pid_alive() {
  local rec now
  kill -0 "$2" 2>/dev/null || return 1
  rec=$(cat "$1/start.$2" 2>/dev/null) || return 0
  [ -n "$rec" ] || return 0
  now=$(yellow_ruvector_pid_start "$2")
  [ -z "$now" ] || [ "$now" = "$rec" ]
}

# yellow_ruvector_unlock_dir <lock-dir> — remove a lock this shell owns.
yellow_ruvector_unlock_dir() {
  rm -f "$1/pid" "$1"/start.* 2>/dev/null
  rmdir "$1" 2>/dev/null
}

# Atomic mkdir lock with one stale-owner recovery, as in yellow-morph.
# $1 = max attempts (1s apart).
yellow_ruvector_acquire_install_lock() {
  local max_attempts="${1:-20}"
  local lock_dir="${RUVECTOR_DATA}/.install.lock"
  local stale_recovered=0 i owner_pid prev_invalid="unset"

  mkdir -p "$RUVECTOR_DATA" 2>/dev/null || return 1
  for ((i=1; i<=max_attempts; i++)); do
    if mkdir "$lock_dir" 2>/dev/null; then
      # A lock without a pid would be reclaimed by the next waiter while we
      # still work: give it up rather than hold it unrecorded.
      yellow_ruvector_stamp_pid "$lock_dir" "$$"
      if printf '%s' "$$" > "${lock_dir}/pid" 2>/dev/null; then
        return 0
      fi
      rm -rf -- "$lock_dir" 2>/dev/null
      return 1
    fi
    # A missing pid file (owner killed between mkdir and the pid write) reads
    # as empty and is judged like any other invalid pid: stale when it is
    # still missing on the next attempt.
    if [ "$stale_recovered" -eq 0 ] && [ -d "$lock_dir" ]; then
      owner_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
      case "$owner_pid" in
        '' | *[!0-9]* | 0)
          # A new owner writes its pid just after mkdir, so an invalid pid is
          # only stale when it is still the same, on the same lock generation
          # (inode + mtime), on the next attempt: a later owner caught in its
          # own mkdir-to-write window is a new generation, never a repeat.
          owner_pid="${owner_pid}@$(ls -di "$lock_dir" 2>/dev/null | awk '{print $1}')-$(yellow_ruvector_mtime "$lock_dir")"
          if [ "$owner_pid" = "$prev_invalid" ]; then
            owner_pid=${owner_pid%@*}
            printf 'yellow-ruvector: lock pid file invalid (got %q); clearing stale lock\n' "$owner_pid" >&2
            yellow_ruvector_reclaim_lock "$owner_pid"
            stale_recovered=1
            continue
          fi
          prev_invalid="$owner_pid"
          ;;
        *)
          prev_invalid="unset"
          if ! yellow_ruvector_pid_alive "$lock_dir" "$owner_pid"; then
            printf 'yellow-ruvector: stale lock owner PID %s no longer running; clearing\n' "$owner_pid" >&2
            yellow_ruvector_reclaim_lock "$owner_pid"
            stale_recovered=1
            continue
          fi
          ;;
      esac
    fi
    sleep 1
  done
  return 1
}

# yellow_ruvector_mtime <path> — modification time in epoch seconds, portably
# (GNU `stat -c %Y`, BSD/macOS `stat -f %m`); prints nothing on failure.
yellow_ruvector_mtime() {
  stat -c %Y -- "$1" 2>/dev/null || stat -f %m -- "$1" 2>/dev/null
}

# yellow_ruvector_reclaim_lock <expected-pid> — remove the install lock only
# if it is still the same lock (same directory inode) carrying the pid judged
# stale and, for a real pid, that process is still gone. Each stale lock
# generation (pid + inode + mtime) is reclaimed at most once: the reclaimer
# must first create the marker .install.lock.reclaim.<pid>-<inode>-<mtime>
# (atomic mkdir), so two
# waiters that judged the same lock stale cannot both act, and a waiter can
# never delete the fresh lock that replaced it (different inode, or its
# marker already exists). Markers are left behind and pruned after 10
# minutes, long after any reclaimer that saw that generation has finished.
yellow_ruvector_reclaim_lock() {
  yellow_ruvector_reclaim_dir "${RUVECTOR_DATA}/.install.lock" "${1:-}"
}

# yellow_ruvector_reclaim_dir <lock-dir> <expected-pid> — the generation-safe
# reclaim above for any mkdir lock (the install lock, the model-cache lock).
# Markers sit next to the lock and are pruned after 10 minutes.
yellow_ruvector_reclaim_dir() {
  local lock_dir="$1" expected="${2:-}" ino mt marker
  # Cheap pre-check (no marker for a lock that is not stale).
  [ "$(cat "${lock_dir}/pid" 2>/dev/null)" = "$expected" ] || return 0
  case "$expected" in
    '' | *[!0-9]* | 0) ;;
    *) yellow_ruvector_pid_alive "$lock_dir" "$expected" && return 0 ;;
  esac
  ino=$(ls -di "$lock_dir" 2>/dev/null | awk '{print $1}')
  case "$ino" in ''|*[!0-9]*) return 0 ;; esac
  # Inodes are reused right away; inode + mtime identifies one generation.
  mt=$(yellow_ruvector_mtime "$lock_dir")
  case "$mt" in ''|*[!0-9]*) return 0 ;; esac
  find "${lock_dir%/*}" -maxdepth 1 -name "${lock_dir##*/}.reclaim.*" -type d -mmin +10 \
    -exec rmdir {} + 2>/dev/null
  marker="${lock_dir}.reclaim.$(printf '%s' "${expected:-none}" | tr -c '0-9A-Za-z' '_')-${ino}-${mt}"
  mkdir "$marker" 2>/dev/null || return 0
  [ "$(ls -di "$lock_dir" 2>/dev/null | awk '{print $1}')" = "$ino" ] || return 0
  [ "$(yellow_ruvector_mtime "$lock_dir")" = "$mt" ] || return 0
  [ "$(cat "${lock_dir}/pid" 2>/dev/null)" = "$expected" ] || return 0
  case "$expected" in
    '' | *[!0-9]* | 0) ;;
    *) yellow_ruvector_pid_alive "$lock_dir" "$expected" && return 0 ;;
  esac
  rm -rf -- "$lock_dir" 2>/dev/null
  return 0
}

# Idempotent; safe from traps and again before exec.
# yellow_ruvector_stop_warm — stop a running model warm-up (its whole process
# tree: TERM, then KILL after ~1s) and reap it. Called before the install
# lock is released, so a warm-up never outlives the lock that guards the
# model cache.
yellow_ruvector_stop_warm() {
  local pid="${_YR_WARM_PID:-}" i
  [ -n "$pid" ] || return 0
  _YR_WARM_PID=""
  kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null; return 0; }
  yellow_ruvector_stop_tree "$pid"
  return 0
}

# yellow_ruvector_stop_npm — stop an interrupted install's `npm ci` (its
# whole tree: TERM, then KILL after ~1s) and reap it before the lock goes.
yellow_ruvector_stop_npm() {
  local pid="${_YR_NPM_PID:-}" i
  [ -n "$pid" ] || return 0
  _YR_NPM_PID=""
  yellow_ruvector_stop_tree "$pid"
  return 0
}

# yellow_ruvector_stop_tree <pid> — TERM <pid> and its descendants, then
# KILL whatever of that tree is still running ~1s later, and reap <pid>.
# The tree is captured before TERM and escalation checks every member, not
# only <pid>: a wrapper that exits on TERM reparents a child that ignores
# it, and that child must not keep writing after the lock is released.
yellow_ruvector_stop_tree() {
  local pid="$1" tree p i alive
  tree=$(yellow_ruvector_tree "$pid")
  # shellcheck disable=SC2086
  kill -TERM $tree 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9 10; do
    alive=""
    for p in $tree; do yellow_ruvector_running "$p" && { alive=1; break; }; done
    [ -n "$alive" ] || break
    sleep 0.1
  done
  if [ -n "$alive" ]; then
    # Children forked since the capture are only found while <pid> lives.
    for p in $tree $(yellow_ruvector_tree "$pid"); do
      yellow_ruvector_running "$p" && kill -KILL "$p" 2>/dev/null
    done
  fi
  wait "$pid" 2>/dev/null
  return 0
}

# yellow_ruvector_running <pid> — <pid> exists and is not a zombie (an
# unreaped child still answers kill -0).
yellow_ruvector_running() {
  kill -0 "$1" 2>/dev/null || return 1
  case "$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')" in Z*) return 1 ;; esac
  return 0
}

yellow_ruvector_release_install_lock() {
  local lock_dir="${RUVECTOR_DATA}/.install.lock" owner
  yellow_ruvector_stop_warm
  yellow_ruvector_stop_npm
  yellow_ruvector_release_model_lock
  # Only the owner releases: a lock that now carries another pid belongs to
  # someone else. ($$ is the parent shell inside prewarm's subshell, whose
  # pid the parent writes into the lock; BASHPID is the subshell itself.)
  owner=$(cat "${lock_dir}/pid" 2>/dev/null) || return 0
  # _YR_LOCK_OWNER: the pid a background job was handed (prewarm).
  case "$owner" in
    "$$"|"${BASHPID:-$$}"|"${_YR_LOCK_OWNER:-__none__}") ;;
    *) return 0 ;;
  esac
  yellow_ruvector_unlock_dir "$lock_dir" || true
}

# yellow_ruvector_trap_release — release the install lock on exit; on INT or
# TERM release it and exit. A bare INT/TERM trap would resume the script
# after the handler, still installing while another session takes the lock.
yellow_ruvector_trap_release() {
  trap 'yellow_ruvector_release_install_lock' EXIT
  trap 'yellow_ruvector_release_install_lock; trap - EXIT; exit 130' INT
  trap 'yellow_ruvector_release_install_lock; trap - EXIT; exit 143' TERM
}

# Returns 0 when the lock is held by a live process (install in progress).
yellow_ruvector_install_in_progress() {
  local pid_file="${RUVECTOR_DATA}/.install.lock/pid" owner_pid
  [ -d "${RUVECTOR_DATA}/.install.lock" ] || return 1
  owner_pid=$(cat "$pid_file" 2>/dev/null)
  case "$owner_pid" in '' | *[!0-9]* | 0) return 1 ;; esac
  yellow_ruvector_pid_alive "${RUVECTOR_DATA}/.install.lock" "$owner_pid"
}

# Install the committed lockfile into install-<hash>, smoke-test it, swap
# `current`, and prune old installs. Caller holds the install lock.
yellow_ruvector_do_install() {
  local hash final tmp prev
  hash=$(yellow_ruvector_lock_hash) || {
    printf 'yellow-ruvector: cannot hash %s/package-lock.json\n' "$(yellow_ruvector_flat "$CLAUDE_PLUGIN_ROOT")" >&2
    return 1
  }
  final="${RUVECTOR_DATA}/install-${hash}"
  prev=$(readlink "${RUVECTOR_DATA}/current" 2>/dev/null || true)

  # Rolling back to a lockfile whose install dir is still here (the previous
  # install, possibly backing a live server): reuse it rather than deleting
  # node_modules from under that server.
  if [ -f "${final}/node_modules/ruvector/bin/cli.js" ] \
     && yellow_ruvector_install_healthy \
     && yellow_ruvector_run_bounded 20 node "${final}/node_modules/ruvector/bin/cli.js" mcp start --help >/dev/null 2>&1; then
    yellow_ruvector_swap_current "install-${hash}" || return 1
    yellow_ruvector_prune "install-${hash}" "${prev##*/}"
    return 0
  fi

  tmp="${RUVECTOR_DATA}/.install-${hash}.tmp.$$"
  rm -rf -- "$tmp" 2>/dev/null
  mkdir -p "$tmp" || return 1
  cp "${CLAUDE_PLUGIN_ROOT}/package.json" "${tmp}/package.json" || return 1
  cp "${CLAUDE_PLUGIN_ROOT}/package-lock.json" "${tmp}/package-lock.json" || return 1

  # env -i keeps secrets (API keys, tokens) out of npm; pass through only
  # what npm needs to reach the registry from behind a proxy or custom CA.
  local -a env_args=(
    "HOME=${HOME:-/}"
    "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}"
  )
  local var
  for var in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy \
             NODE_EXTRA_CA_CERTS SSL_CERT_FILE; do
    [ -n "${!var:-}" ] && env_args+=("${var}=${!var}")
  done
  while IFS='=' read -r var _; do
    case "$var" in
      NPM_CONFIG_*|npm_config_*) env_args+=("${var}=${!var}") ;;
    esac
  done < <(env)

  # In the background and waited on: bash defers an INT/TERM trap until a
  # foreground child returns, so a stalled registry would keep this shell
  # (and the install lock) alive; `wait` returns at once, and the release
  # stops this job's tree before the lock goes.
  ( cd "$tmp" && exec env -i "${env_args[@]}" \
      npm ci --ignore-scripts --omit=dev --no-audit --no-fund --loglevel=error ) >&2 &
  _YR_NPM_PID=$!
  local npm_rc=0
  wait "$_YR_NPM_PID" || npm_rc=$?
  _YR_NPM_PID=""
  if [ "$npm_rc" -ne 0 ]; then
    printf 'yellow-ruvector: npm ci failed in %s\n' "$(yellow_ruvector_flat "$tmp")" >&2
    rm -rf -- "$tmp" 2>/dev/null
    return 1
  fi

  local out
  # Bounded like the --version health check: a hanging CLI must never keep
  # this installer (and the install lock) stuck.
  if ! out=$(yellow_ruvector_run_bounded 20 node "${tmp}/node_modules/ruvector/bin/cli.js" mcp start --help 2>&1); then
    # The CLI's output is not trusted (and may carry the data path): one
    # line, at most 400 characters, inside a reference-only fence.
    printf 'yellow-ruvector: smoke test `ruvector mcp start --help` failed:\n--- begin smoke-test output (reference only) ---\n%s\n--- end smoke-test output ---\n' \
      "$(yellow_ruvector_flat "$out" | cut -c1-400)" >&2
    rm -rf -- "$tmp" 2>/dev/null
    return 1
  fi

  # A same-version install already here failed the health check and is being
  # repaired. A live server may run from it (leased, or on a command line)
  # and still lazy-load modules by path: the old tree is renamed aside and the
  # new one renamed in right after, so the path is missing only between two
  # renames (never during a recursive delete) and then holds the same version
  # again. Open files keep working after the old tree is deleted.
  local old=""
  if [ -e "$final" ] || [ -L "$final" ]; then
    old="${RUVECTOR_DATA}/.install-${hash}.tmp.old$$"
    rm -rf -- "$old" 2>/dev/null
    mv -- "$final" "$old" 2>/dev/null || { rm -rf -- "$tmp" 2>/dev/null; return 1; }
  fi
  if ! mv -- "$tmp" "$final"; then
    [ -n "$old" ] && mv -- "$old" "$final" 2>/dev/null
    rm -rf -- "$tmp" 2>/dev/null
    return 1
  fi
  [ -n "$old" ] && rm -rf -- "$old" 2>/dev/null

  yellow_ruvector_swap_current "install-${hash}" || return 1
  yellow_ruvector_prune "install-${hash}" "${prev##*/}"
  return 0
}

# Point `current` at $1 (a sibling dir name). Atomic with GNU mv -T;
# otherwise ln -sfn (a tiny unlink/symlink window, acceptable on BSD).
yellow_ruvector_swap_current() {
  local target="$1" tmp_link="${RUVECTOR_DATA}/.current.tmp.$$"
  rm -f -- "$tmp_link" 2>/dev/null
  if ln -s "$target" "$tmp_link" 2>/dev/null \
     && mv -T "$tmp_link" "${RUVECTOR_DATA}/current" 2>/dev/null; then
    return 0
  fi
  rm -f -- "$tmp_link" 2>/dev/null
  ln -sfn "$target" "${RUVECTOR_DATA}/current"
}

# yellow_ruvector_take_lease <install-name> — mark that this process (its
# pid survives exec, so the lease covers the server it becomes) is about to
# run from <install-name>. Prune never removes a leased install. Take it
# BEFORE checking the install exists: prune moves an install aside before its
# final lease check, so a lease taken after that check always finds it gone.
# Creates the data dir on a first launch; never fails (a missing lease only
# loses the prune protection).
yellow_ruvector_take_lease() {
  mkdir -p "$RUVECTOR_DATA" 2>/dev/null && yellow_ruvector_write_lease "${RUVECTOR_DATA}/.lease.${1}.$$" "$$"
  return 0
}

# yellow_ruvector_write_lease <lease-file> <pid> — the lease holds <pid>'s
# start time (empty where ps cannot report it), so a pid the OS reuses for
# an unrelated process never keeps an old install from being pruned.
yellow_ruvector_write_lease() {
  yellow_ruvector_pid_start "$2" > "$1" 2>/dev/null
  return 0
}

# yellow_ruvector_lease_live <lease-file> <pid> — 0 when <pid> runs and is
# the process that took the lease (as yellow_ruvector_pid_alive for locks).
yellow_ruvector_lease_live() {
  local rec now
  kill -0 "$2" 2>/dev/null || return 1
  rec=$(cat "$1" 2>/dev/null) || return 0
  [ -n "$rec" ] || return 0
  now=$(yellow_ruvector_pid_start "$2")
  [ -z "$now" ] || [ "$now" = "$rec" ]
}

# yellow_ruvector_leased <install-name> — 0 when a live process holds a lease
# on it. Leases of dead (or reused) pids are removed on the way.
yellow_ruvector_leased() {
  local l pid rc=1
  for l in "${RUVECTOR_DATA}/.lease.${1}."*; do
    [ -e "$l" ] || continue
    pid=${l##*.}
    case "$pid" in ''|*[!0-9]*) rm -f -- "$l" 2>/dev/null; continue ;; esac
    if yellow_ruvector_lease_live "$l" "$pid"; then rc=0; else rm -f -- "$l" 2>/dev/null; fi
  done
  return $rc
}

# Remove install dirs other than $1 (current) and $2 (previous), plus stale
# temp dirs from crashed installs. Caller holds the install lock. An install
# dir named on a live process's command line is kept too: the launcher execs
# the resolved install-<hash> path, and a long-running MCP server still
# lazy-loads modules from it after later upgrades move `current`. So is a
# leased one (a launcher between its install check and exec, not yet in ps):
# the dir is moved aside first and restored if a lease shows up by then.
yellow_ruvector_prune() {
  local keep_current="$1" keep_prev="${2:-}" d name in_use l aside
  # Drop leases of processes that are gone.
  for l in "${RUVECTOR_DATA}"/.lease.*; do
    [ -e "$l" ] || continue
    case "${l##*.}" in ''|*[!0-9]*) rm -f -- "$l" 2>/dev/null; continue ;; esac
    yellow_ruvector_lease_live "$l" "${l##*.}" || rm -f -- "$l" 2>/dev/null
  done
  # -ww: untruncated arguments (BSD/macOS ps otherwise cuts at the terminal
  # width and could hide the /install-<hash>/ part of a live server's path).
  in_use=$(ps -Aww -o args= 2>/dev/null || ps -A -o args= 2>/dev/null || true)
  for d in "${RUVECTOR_DATA}"/install-* "${RUVECTOR_DATA}"/.install-*.tmp.*; do
    [ -e "$d" ] || continue
    name="${d##*/}"
    [ "$name" = "$keep_current" ] && continue
    [ -n "$keep_prev" ] && [ "$name" = "$keep_prev" ] && continue
    case "$in_use" in *"/${name}/"*) continue ;; esac
    case "$name" in
      install-*)
        yellow_ruvector_leased "$name" && continue
        aside="${RUVECTOR_DATA}/.${name}.tmp.prune$$"
        mv -- "$d" "$aside" 2>/dev/null || continue
        if yellow_ruvector_leased "$name"; then
          mv -- "$aside" "$d" 2>/dev/null || rm -rf -- "$aside" 2>/dev/null
          continue
        fi
        d=$aside ;;
    esac
    rm -rf -- "$d" 2>/dev/null
  done
  return 0
}

# Returns 0 when the ONNX model files are already in ruvector's disk cache
# (${RUVECTOR_CACHE_DIR:-$HOME}/.ruvector/models/<model>/, see ruvector
# dist/core/onnx/loader.js _diskCacheDir).
yellow_ruvector_model_fingerprint() {
  local dir="${RUVECTOR_CACHE_DIR:-${HOME:-/tmp}}/.ruvector/models/${YELLOW_RUVECTOR_MODEL}"
  [ -s "${dir}/model.onnx" ] && [ -s "${dir}/tokenizer.json" ] || return 1
  # cksum (POSIX CRC + size) authenticates content, not just length: a
  # same-size corrupted or replaced file no longer matches.
  printf '%s:%s' "$(cksum < "${dir}/model.onnx" | awk '{print $1 "-" $2}')" \
    "$(cksum < "${dir}/tokenizer.json" | awk '{print $1 "-" $2}')"
}

# True when the model files exist AND a warm-up verified these exact files
# (a 384-dimensional embed; the sizes are recorded in the data dir). Present
# but unverified files (an interrupted download) count as not cached: the
# auto embedder would fall back to hash on them and stamp a fresh store.
yellow_ruvector_model_cached() {
  local fp
  fp=$(yellow_ruvector_model_fingerprint) || return 1
  [ -n "${RUVECTOR_DATA:-}" ] && [ "$(cat "${RUVECTOR_DATA}/model-verified" 2>/dev/null)" = "$fp" ]
}

# Model-cache lock. ruvector downloads the model through fixed file names in
# ${RUVECTOR_CACHE_DIR:-$HOME}/.ruvector/models/, which every data root (and
# every plugin ID) shares, so the per-data-dir install lock cannot serialize
# downloads: this lock lives next to the cache. Its pid file names the
# warm-up job itself while it runs, so the lock is live exactly as long as a
# download can be writing.
yellow_ruvector_model_lock_dir() {
  printf '%s/.ruvector/models/.yellow-ruvector-warm.lock' "${RUVECTOR_CACHE_DIR:-${HOME:-/tmp}}"
}

# yellow_ruvector_model_lock_busy — 0 when a live process holds it.
yellow_ruvector_model_lock_busy() {
  local d pid
  d=$(yellow_ruvector_model_lock_dir)
  [ -d "$d" ] || return 1
  pid=$(cat "$d/pid" 2>/dev/null)
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  yellow_ruvector_pid_alive "$d" "$pid"
}

# yellow_ruvector_acquire_model_lock [secs] — wait up to secs (default 10).
# A lock whose pid is dead, or that has no valid pid after 60s, is cleared.
yellow_ruvector_acquire_model_lock() {
  local d secs="${1:-10}" i=0 pid mt
  case "$secs" in ''|*[!0-9]*) secs=10 ;; esac
  d=$(yellow_ruvector_model_lock_dir)
  mkdir -p "${d%/*}" 2>/dev/null || return 1
  while :; do
    if mkdir "$d" 2>/dev/null; then
      yellow_ruvector_stamp_pid "$d" "${_YR_LOCK_OWNER:-${BASHPID:-$$}}"
      if printf '%s' "${_YR_LOCK_OWNER:-${BASHPID:-$$}}" > "$d/pid" 2>/dev/null; then
        _YR_MODEL_LOCK=${_YR_LOCK_OWNER:-${BASHPID:-$$}}
        return 0
      fi
      rmdir "$d" 2>/dev/null
      return 1
    fi
    pid=$(cat "$d/pid" 2>/dev/null)
    case "$pid" in
      ''|*[!0-9]*)
        mt=$(yellow_ruvector_mtime "$d")
        case "$mt" in ''|*[!0-9]*) ;; *)
          # Generation-safe (see yellow_ruvector_reclaim_dir): two waiters
          # that judged the same lock stale cannot both clear it, and
          # neither can clear the lock a successor took in the meantime.
          # Retry at once only when the lock is gone; a reclaim that could
          # not remove it (read-only parent, marker taken) falls through to
          # the bounded wait instead of spinning.
          [ $(( $(date +%s) - mt )) -gt 60 ] && { yellow_ruvector_reclaim_dir "$d" "$pid"; [ -d "$d" ] || continue; } ;;
        esac ;;
      *)
        yellow_ruvector_pid_alive "$d" "$pid" || { yellow_ruvector_reclaim_dir "$d" "$pid"; [ -d "$d" ] || continue; } ;;
    esac
    [ "$i" -lt $((secs * 10)) ] || return 1
    i=$((i + 1))
    sleep 0.1
  done
}

# yellow_ruvector_release_model_lock — only a holder, and only while the
# lock still names the pid this shell last wrote (its own, or the download
# job's): once a waiter has cleared a dead job's lock and taken it, the
# successor's lock is left alone.
yellow_ruvector_release_model_lock() {
  local d mine="${_YR_MODEL_LOCK:-}"
  [ -n "$mine" ] || return 0
  _YR_MODEL_LOCK=""
  d=$(yellow_ruvector_model_lock_dir)
  [ "$(cat "$d/pid" 2>/dev/null)" = "$mine" ] || return 0
  yellow_ruvector_unlock_dir "$d"
  return 0
}

# yellow_ruvector_run_bounded <secs> <cmd...> — run <cmd> for at most <secs>
# (fractions allowed). Uses GNU timeout when it supports --kill-after;
# otherwise (stock macOS) a background watcher sends TERM (to the command
# and its children), then KILL 1s later. The watcher's stdio goes to
# /dev/null so a caller's $(...) is not held open by it.
yellow_ruvector_run_bounded() {
  local secs="$1" pid watcher rc=0 t
  shift
  for t in timeout gtimeout; do
    if command -v "$t" >/dev/null 2>&1 && "$t" --kill-after=0.1 0.1 true >/dev/null 2>&1; then
      "$t" --kill-after=1 "$secs" "$@"
      return
    fi
  done
  "$@" &
  pid=$!
  # The watcher marks when it fires (in a private mktemp dir), so the caller
  # knows to let it finish escalating even when the timed command exited 0
  # after handling TERM while a descendant ignored it.
  local flag
  flag=$(mktemp -d "${TMPDIR:-/tmp}/rvwatch.XXXXXX" 2>/dev/null) || flag=""
  # The tree is captured when the time is up: once the command exits, its
  # children are reparented and no longer found under its pid.
  ( sleep "$secs"; [ -n "$flag" ] && : > "$flag/fired"; tree=$(yellow_ruvector_tree "$pid")
    # shellcheck disable=SC2086
    kill -TERM $tree 2>/dev/null
    sleep 1
    # shellcheck disable=SC2086
    kill -KILL $tree $(yellow_ruvector_tree "$pid") 2>/dev/null ) \
    </dev/null >/dev/null 2>&1 &
  watcher=$!
  wait "$pid" 2>/dev/null || rc=$?
  # Killed by the watcher (a signal status): let it finish escalating to
  # KILL on the children it captured, so none outlives this call.
  if { [ "$rc" -gt 128 ] || { [ -n "$flag" ] && [ -e "$flag/fired" ]; }; } \
     && kill -0 "$watcher" 2>/dev/null; then
    wait "$watcher" 2>/dev/null
  else
    kill "$watcher" 2>/dev/null
  fi
  # Timed out even if the command then exited 0 (it handled TERM): report
  # it as GNU timeout does, so a caller never takes cut-off output as a
  # success.
  [ -n "$flag" ] && [ -e "$flag/fired" ] && rc=124
  [ -n "$flag" ] && rm -rf -- "$flag" 2>/dev/null
  return "$rc"
}

# yellow_ruvector_tree <pid> — <pid> and all its descendants (pgrep -P).
yellow_ruvector_tree() {
  local c
  printf '%s\n' "$1"
  for c in $(pgrep -P "$1" 2>/dev/null); do yellow_ruvector_tree "$c"; done
}

# Download/load the ONNX model once via `ruvector embed text`, which never
# touches a .ruvector store. It exits 0 even on failure, so judge success by
# the "Dimension: 384" line. $1 = optional time limit in seconds.
# The warm-up runs as a background job of this shell (not inside $(...),
# where bash defers traps until the child exits): its pid is kept in
# _YR_WARM_PID so a TERM/INT trap, via the lock release, stops and reaps it
# at once instead of leaving it writing the cache after the lock is gone.
yellow_ruvector_warm_model() {
  local secs="${1:-}" entry out fp tmp
  entry=$(yellow_ruvector_pinned_entry) || return 1
  [ -f "$entry" ] || return 1
  # Serialize with every other warm-up sharing this model cache. One
  # deadline covers both: time spent waiting for the lock comes out of the
  # warm-up's own bound, so the caller's budget is never spent twice.
  local t0=$SECONDS
  yellow_ruvector_acquire_model_lock "${secs:-60}" || return 1
  if [ -n "$secs" ]; then
    secs=$(( secs - (SECONDS - t0) ))
    [ "$secs" -ge 1 ] || { yellow_ruvector_release_model_lock; return 1; }
  fi
  tmp=$(mktemp "${TMPDIR:-/tmp}/rv-warm.XXXXXX") || { yellow_ruvector_release_model_lock; return 1; }
  if [ -n "$secs" ]; then
    ( cd "${TMPDIR:-/tmp}" && yellow_ruvector_run_bounded "$secs" node "$entry" embed text "warmup" ) >"$tmp" 2>&1 &
  else
    ( cd "${TMPDIR:-/tmp}" && exec node "$entry" embed text "warmup" ) >"$tmp" 2>&1 &
  fi
  _YR_WARM_PID=$!
  # The lock now names the download itself.
  yellow_ruvector_stamp_pid "$(yellow_ruvector_model_lock_dir)" "$_YR_WARM_PID"
  printf '%s' "$_YR_WARM_PID" > "$(yellow_ruvector_model_lock_dir)/pid" 2>/dev/null \
    && _YR_MODEL_LOCK=$_YR_WARM_PID
  wait "$_YR_WARM_PID" 2>/dev/null
  _YR_WARM_PID=""
  out=$(cat "$tmp" 2>/dev/null); rm -f "$tmp"
  yellow_ruvector_release_model_lock
  printf '%s' "$out" | grep -q 'Dimension: 384' || return 1
  # Record which files were verified (see yellow_ruvector_model_cached).
  fp=$(yellow_ruvector_model_fingerprint) || return 1
  [ -n "${RUVECTOR_DATA:-}" ] && printf '%s' "$fp" > "${RUVECTOR_DATA}/model-verified" 2>/dev/null
  return 0
}
