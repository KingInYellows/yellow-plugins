#!/usr/bin/env bats
# resolve.bats — hooks/scripts/lib/resolve.sh: project-root resolution, the
# plugin-managed binary (and the RUVECTOR_BIN test seam), the Node floor,
# and the worktree store heal.

bats_require_minimum_version 1.5.0

LIB="$BATS_TEST_DIRNAME/../hooks/scripts/lib/resolve.sh"
PLUGIN_ROOT="$BATS_TEST_DIRNAME/.."

setup() {
  WORK="$BATS_TEST_TMPDIR/work"
  DATA="$BATS_TEST_TMPDIR/data"
  STUBS="$BATS_TEST_TMPDIR/stubs"
  mkdir -p "$WORK" "$DATA" "$STUBS"
}

# Run a snippet with resolve.sh sourced. Extra env via `env` prefix args.
rs() {
  run env CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CLAUDE_PLUGIN_DATA="$DATA" "$@"
}

fake_install() {
  mkdir -p "$DATA/install-abc/node_modules/ruvector/bin"
  : > "$DATA/install-abc/node_modules/ruvector/bin/cli.js"
  ln -sfn install-abc "$DATA/current"
}

@test "resolve_root: git toplevel from a subdirectory" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$WORK" init -q
  mkdir -p "$WORK/a/b"
  rs bash -c '. "$1"; ruvector_resolve_root "$2"' _ "$LIB" "$WORK/a/b"
  [ "$status" -eq 0 ]
  [ "$(cd "$output" && pwd -P)" = "$(cd "$WORK" && pwd -P)" ]
}

@test "resolve_root: outside git falls back to CLAUDE_PROJECT_DIR, then the start dir" {
  rs bash -c '. "$1"; CLAUDE_PROJECT_DIR="$3" ruvector_resolve_root "$2"' _ "$LIB" "$WORK" "/project/dir"
  [ "$output" = "/project/dir" ]
  rs bash -c 'unset CLAUDE_PROJECT_DIR; . "$1"; ruvector_resolve_root "$2"' _ "$LIB" "$WORK"
  [ "$output" = "$WORK" ]
}

@test "resolve_bin: RUVECTOR_BIN seam wins and must be executable" {
  printf '#!/bin/sh\nexit 0\n' > "$STUBS/rv"
  chmod +x "$STUBS/rv"
  rs bash -c '. "$1"; RUVECTOR_BIN="$2" ruvector_resolve_bin && printf "%s" "${RUVECTOR_CMD[*]}"' _ "$LIB" "$STUBS/rv"
  [ "$status" -eq 0 ]
  [ "$output" = "$STUBS/rv" ]
  chmod -x "$STUBS/rv"
  rs bash -c '. "$1"; RUVECTOR_BIN="$2" ruvector_resolve_bin' _ "$LIB" "$STUBS/rv"
  [ "$status" -ne 0 ]
}

@test "resolve_bin: uses node + the current install, never a global ruvector on PATH" {
  command -v node >/dev/null 2>&1 || skip "node not available"
  ruvector_major=$(node --version | sed 's/^v//' | cut -d. -f1)
  [ "$ruvector_major" -ge 20 ] || skip "node < 20 on this host"
  fake_install
  printf '#!/bin/sh\nexit 0\n' > "$STUBS/ruvector"
  chmod +x "$STUBS/ruvector"
  rs bash -c 'PATH="$2:$PATH"; unset RUVECTOR_BIN; . "$1"; ruvector_resolve_bin && printf "%s" "${RUVECTOR_CMD[*]}"' _ "$LIB" "$STUBS"
  [ "$status" -eq 0 ]
  [ "$output" = "node $DATA/current/node_modules/ruvector/bin/cli.js" ]
}

@test "resolve_bin: fails without an install, and while an install is in progress" {
  command -v node >/dev/null 2>&1 || skip "node not available"
  rs bash -c 'unset RUVECTOR_BIN; . "$1"; ruvector_resolve_bin' _ "$LIB"
  [ "$status" -ne 0 ]
  fake_install
  mkdir -p "$DATA/.install.lock"
  sleep 30 &
  owner=$!
  printf '%s' "$owner" > "$DATA/.install.lock/pid"
  rs bash -c 'unset RUVECTOR_BIN; . "$1"; ruvector_resolve_bin' _ "$LIB"
  kill "$owner" 2>/dev/null || true
  [ "$status" -ne 0 ]
}

@test "node_ok: requires Node 20 or later" {
  printf '#!/bin/sh\necho v18.19.0\n' > "$STUBS/node"
  chmod +x "$STUBS/node"
  rs bash -c 'PATH="$2:$PATH"; . "$1"; ruvector_node_ok' _ "$LIB" "$STUBS"
  [ "$status" -ne 0 ]
  printf '#!/bin/sh\necho v20.0.0\n' > "$STUBS/node"
  rs bash -c 'PATH="$2:$PATH"; . "$1"; ruvector_node_ok' _ "$LIB" "$STUBS"
  [ "$status" -eq 0 ]
}

@test "heal_store: links a linked worktree's missing .ruvector to the main store" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$WORK" init -q
  git -C "$WORK" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  mkdir "$WORK/.ruvector"
  git -C "$WORK" worktree add -q "$WORK/wt" -b heal
  rs bash -c '. "$1"; ruvector_heal_store "$2"' _ "$LIB" "$WORK/wt"
  [ "$status" -eq 0 ]
  [ -L "$WORK/wt/.ruvector" ]
  [ "$(cd "$WORK/wt/.ruvector" && pwd -P)" = "$(cd "$WORK/.ruvector" && pwd -P)" ]
}

@test "heal_store: never replaces a real directory (warns instead)" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$WORK" init -q
  git -C "$WORK" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  mkdir "$WORK/.ruvector"
  git -C "$WORK" worktree add -q "$WORK/wt" -b keep
  mkdir "$WORK/wt/.ruvector"
  run --separate-stderr env CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash -c '. "$1"; ruvector_heal_store "$2"' _ "$LIB" "$WORK/wt"
  [ "$status" -eq 0 ]
  [ -d "$WORK/wt/.ruvector" ] && [ ! -L "$WORK/wt/.ruvector" ]
  [[ "$stderr" == *"non-symlink path diverged"* ]]
}
