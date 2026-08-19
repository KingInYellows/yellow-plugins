#!/usr/bin/env bash
# Wrap empty-stdout ruvector PreToolUse commands so Cursor accepts them.
#
# `ruvector hooks init` (including --minimal) writes PreToolUse commands
# that end in `2>/dev/null || true` and print nothing. Cursor's
# Claude-plugin bridge requires a JSON permission object and blocks
# Shell / Edit when stdout is empty or invalid JSON.
#
# Usage:
#   bash repair-cursor-pretooluse.sh [--dry-run] [settings.json ...]
#
# An explicit path must be one of the two allowlisted settings files
# (exact string match); anything else is refused:
#   $HOME/.claude/settings.json
#   ${CLAUDE_PROJECT_DIR:-$PWD}/.claude/settings.json
# With no arguments both are repaired if they exist.
#
# Symlinks are handled by trust, not uniformly. The user-level file is
# followed to its target, so a dotfiles-managed config is repaired in place
# and stays linked. The project-level file must resolve to the real
# .claude/settings.json inside the project root — it can arrive with a
# cloned repo, so a symlinked settings.json or a symlinked .claude
# directory is refused rather than followed out of the project.
#
# Only PreToolUse commands matching the init-generated shape
# (`ruvector[@version] hooks pre-*` ending in `2>/dev/null [|| true]`)
# are wrapped. Hooks that already print a decision, git-ai, plugin hook
# scripts, and PostToolUse / SessionStart / Stop entries are left
# untouched. Re-running is a no-op.

set -euo pipefail

DRY_RUN=0
REQUESTED=()

usage() {
  printf 'Usage: %s [--dry-run] [settings.json ...]\n' "${0##*/}" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    --) shift; break ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      ;;
    *) REQUESTED+=("$1"); shift ;;
  esac
done
while [ $# -gt 0 ]; do
  REQUESTED+=("$1")
  shift
done

# Allowlist — the only settings files this script may rewrite. An explicit
# argument must match one of these exactly, so a caller-supplied path can
# never select an arbitrary writable settings.json.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"
ALLOWED=(
  "${HOME}/.claude/settings.json"
  "${PROJECT_DIR}/.claude/settings.json"
)

PATHS=()
if [ "${#REQUESTED[@]}" -eq 0 ]; then
  for allowed_path in "${ALLOWED[@]}"; do
    if [ -e "$allowed_path" ]; then
      PATHS+=("$allowed_path")
    fi
  done
else
  for requested_path in "${REQUESTED[@]}"; do
    match=0
    for allowed_path in "${ALLOWED[@]}"; do
      if [ "$requested_path" = "$allowed_path" ]; then
        match=1
        break
      fi
    done
    if [ "$match" -eq 0 ]; then
      printf 'Refusing settings path outside the allowlist: %s\n' \
        "$requested_path" >&2
      printf 'Allowed: %s\n' "${ALLOWED[@]}" >&2
      exit 1
    fi
    PATHS+=("$requested_path")
  done
fi

if [ "${#PATHS[@]}" -eq 0 ]; then
  printf 'No settings.json found. Nothing to repair.\n'
  exit 0
fi

command -v jq >/dev/null 2>&1 || {
  printf 'jq is required.\n' >&2
  exit 1
}

resolve_path() {
  node -p 'require("fs").realpathSync(process.argv[1])' "$1" 2>/dev/null
}

SUFFIX='; printf '\''%s\n'\'' '\''{"continue":true,"permission":"allow"}'\'''

# Single source of truth for "this command needs wrapping", shared by the
# count pass and the rewrite pass so the two can never disagree.
#
# The clauses pin the init-generated shape at BOTH ends:
#
#   1. The command must START with the ruvector invocation (bare, an
#      absolute path, or behind `npx` with any leading flags). Anchoring
#      matters: an unanchored substring match also hits a custom hook that
#      prints its own decision first and then calls ruvector, e.g.
#      `printf '{"permission": "allow"}'; npx ruvector hooks pre-command …`
#      — wrapping that would put two JSON documents on stdout and get the
#      tool blocked, the exact failure this script exists to prevent.
#   2. It must END in the terminal `2>/dev/null [|| true]` redirection,
#      which is why its stdout is empty.
#   3. It must not mention `permission` at all. Deliberately broader than
#      matching the exact payload: a hand-written decision may use any
#      spacing (`{"permission": "allow"}`), and skipping one command too
#      many only leaves it for the user to fix, whereas wrapping one too
#      many corrupts working stdout.
NEEDS_WRAP_DEF='
  def needs_wrap:
    (type == "string")
    and test("^\\s*(npx\\s+(-\\S+\\s+)*)?(\\S*/)?ruvector(@\\S+)?\\s+hooks\\s+pre-")
    and test("2>/dev/null\\s*(\\|\\|\\s*true)?\\s*$")
    and (test("permission") | not);
'

# Count PreToolUse ruvector commands that still need wrapping.
count_needs_wrap() {
  jq -r "$NEEDS_WRAP_DEF"'
    [(.hooks.PreToolUse // [])[]
      | (.hooks // [])[]
      | select(.command | needs_wrap)
    ] | length
  ' "$1"
}

# Wrap those commands in place. Other hook events and non-ruvector
# commands (git-ai, plugin scripts) are preserved byte-for-byte.
wrap_file() {
  jq --arg suffix "$SUFFIX" "$NEEDS_WRAP_DEF"'
    if (.hooks.PreToolUse | type) != "array" then .
    else
      .hooks.PreToolUse |= map(
        if (.hooks | type) != "array" then .
        else
          .hooks |= map(
            if (.command | needs_wrap)
            then .command = (.command + $suffix)
            else .
            end
          )
        end
      )
    end
  ' "$1"
}

total_changed=0
for settings_path in "${PATHS[@]}"; do
  if [ ! -e "$settings_path" ]; then
    printf 'Skipping missing file: %s\n' "$settings_path"
    continue
  fi

  # Symlink policy splits on who controls the link.
  target_path="$settings_path"
  if [ "$settings_path" = "${ALLOWED[0]}" ]; then
    # User-level file. A dotfiles-managed settings.json is often a symlink,
    # and writing a temp file + `mv` at the link path would replace the link
    # with a regular file, leaving the managed target unrepaired and silently
    # detached. Follow it. This grants an attacker nothing: planting this
    # link already requires write access to $HOME/.claude.
    if [ -L "$settings_path" ]; then
      target_path="$(resolve_path "$settings_path")" || target_path=""
      if [ -z "$target_path" ] || [ ! -f "$target_path" ]; then
        printf 'Could not resolve symlink, leaving untouched: %s\n' \
          "$settings_path" >&2
        exit 1
      fi
    fi
  else
    # Project-level file. This one can arrive with a cloned repo, so every
    # path component is attacker-controlled: a symlinked settings.json — or
    # a symlinked .claude DIRECTORY, where the leaf is an ordinary file and
    # an `-L` test on it sees nothing — would otherwise land the rewrite on
    # a foreign file. Require the whole path to resolve to the real
    # .claude/settings.json inside the project root.
    #
    # Resolve the project ROOT and append the literal suffix. Resolving
    # "${PROJECT_DIR}/.claude" instead would follow a hostile link and then
    # compare it against itself, passing vacuously. Both sides are resolved
    # so legitimate system symlinks (macOS /var -> /private/var, symlinked
    # homes) do not false-positive.
    resolved_settings="$(resolve_path "$settings_path")" || resolved_settings=""
    resolved_root="$(resolve_path "$PROJECT_DIR")" || resolved_root=""
    if [ -z "$resolved_settings" ] || [ -z "$resolved_root" ] \
       || [ "$resolved_settings" != "${resolved_root}/.claude/settings.json" ]; then
      printf 'Refusing project settings path that resolves outside the project: %s\n' \
        "$settings_path" >&2
      printf 'Resolved to: %s\n' "${resolved_settings:-<unresolved>}" >&2
      exit 1
    fi
    target_path="$resolved_settings"
  fi

  if [ ! -f "$target_path" ]; then
    printf 'Skipping non-regular file: %s\n' "$settings_path"
    continue
  fi
  if ! jq -e . "$target_path" >/dev/null 2>&1; then
    printf 'Invalid JSON, leaving untouched: %s\n' "$settings_path" >&2
    exit 1
  fi

  needs="$(count_needs_wrap "$target_path")"
  if [ "$needs" = "0" ]; then
    printf 'OK (no unsafe PreToolUse ruvector commands): %s\n' "$settings_path"
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'Would wrap %s PreToolUse command(s) in %s\n' "$needs" "$settings_path"
    total_changed=$((total_changed + needs))
    continue
  fi

  backup="${target_path}.bak-ruvector-cursor"
  # `cp` writes THROUGH a symlinked destination. Since /ruvector:setup runs
  # this repair automatically, a cloned repo could ship a project
  # settings.json plus a backup path symlinked at any user-writable file and
  # have setup clobber it. Only overwrite a plain regular file.
  if [ -L "$backup" ] || { [ -e "$backup" ] && [ ! -f "$backup" ]; }; then
    printf 'Refusing unsafe backup destination (not a regular file): %s\n' \
      "$backup" >&2
    exit 1
  fi
  cp -p -- "$target_path" "$backup"

  # Seed the temp file from the target before writing: mktemp creates it
  # 0600, and `mv` would install that over an ordinary 0644 / shared 0664
  # settings.json, making it unreadable to other users. `cp -p` copies the
  # mode and ownership; the `>` redirect then replaces the contents without
  # touching the mode.
  tmp="$(mktemp "${target_path}.XXXXXX")"
  cp -p -- "$target_path" "$tmp"
  wrap_file "$target_path" > "$tmp"
  mv -- "$tmp" "$target_path"

  printf 'Wrapped %s PreToolUse command(s) in %s\n' "$needs" "$settings_path"
  printf 'Backup: %s\n' "$backup"
  total_changed=$((total_changed + needs))
done

if [ "$total_changed" -gt 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '\nRe-run without --dry-run to apply. Start a new Cursor agent session after applying.\n'
  else
    printf '\nStart a new Cursor agent session so the repaired PreToolUse hooks are loaded.\n'
  fi
fi
