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

own_hash() { sha256sum "$PLUGIN_ROOT/package-lock.json" | cut -c1-12; }

fake_install() {
  local h
  h=$(own_hash)
  mkdir -p "$DATA/install-$h/node_modules/ruvector/bin"
  : > "$DATA/install-$h/node_modules/ruvector/bin/cli.js"
  ln -sfn "install-$h" "$DATA/current"
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

@test "resolve_bin: uses node + this plugin version's install, never a global ruvector on PATH" {
  command -v node >/dev/null 2>&1 || skip "node not available"
  ruvector_major=$(node --version | sed 's/^v//' | cut -d. -f1)
  [ "$ruvector_major" -ge 20 ] || skip "node < 20 on this host"
  fake_install
  printf '#!/bin/sh\nexit 0\n' > "$STUBS/ruvector"
  chmod +x "$STUBS/ruvector"
  rs bash -c 'PATH="$2:$PATH"; unset RUVECTOR_BIN; . "$1"; ruvector_resolve_bin && printf "%s" "${RUVECTOR_CMD[*]}"' _ "$LIB" "$STUBS"
  [ "$status" -eq 0 ]
  [ "$output" = "node $DATA/install-$(own_hash)/node_modules/ruvector/bin/cli.js" ]
}

@test "resolve_bin: stays on this version's install when another session moved current" {
  command -v node >/dev/null 2>&1 || skip "node not available"
  ruvector_major=$(node --version | sed 's/^v//' | cut -d. -f1)
  [ "$ruvector_major" -ge 20 ] || skip "node < 20 on this host"
  fake_install
  mkdir -p "$DATA/install-newer/node_modules/ruvector/bin"
  : > "$DATA/install-newer/node_modules/ruvector/bin/cli.js"
  ln -sfn install-newer "$DATA/current"
  rs bash -c 'unset RUVECTOR_BIN; . "$1"; ruvector_resolve_bin && printf "%s" "${RUVECTOR_CMD[*]}"' _ "$LIB"
  [ "$status" -eq 0 ]
  [ "$output" = "node $DATA/install-$(own_hash)/node_modules/ruvector/bin/cli.js" ]
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
  echo x > "$WORK/f.txt"; git -C "$WORK" add f.txt
  git -C "$WORK" -c user.email=t@t -c user.name=t commit -q -m init
  mkdir "$WORK/.ruvector"
  git -C "$WORK" worktree add -q "$WORK/wt" -b heal
  rs bash -c '. "$1"; ruvector_heal_store "$2"' _ "$LIB" "$WORK/wt"
  [ "$status" -eq 0 ]
  [ -L "$WORK/wt/.ruvector" ]
  [ "$(cd "$WORK/wt/.ruvector" && pwd -P)" = "$(cd "$WORK/.ruvector" && pwd -P)" ]
}

@test "heal_store: a worktree of a bare repo never links to the bare repo's parent" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$WORK" init -q src
  git -C "$WORK/src" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  git clone -q --bare "$WORK/src" "$WORK/repos/foo.git"
  mkdir "$WORK/repos/.ruvector"
  git -C "$WORK/repos/foo.git" worktree add -q "$WORK/wtb" -b bare-wt
  rs bash -c '. "$1"; ruvector_heal_store "$2"' _ "$LIB" "$WORK/wtb"
  [ "$status" -eq 0 ]
  [ ! -e "$WORK/wtb/.ruvector" ]
}

@test "heal_store: a --separate-git-dir repo never links to the git dir's parent" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  mkdir -p "$WORK/meta" "$WORK/main"
  git -C "$WORK/main" init -q --separate-git-dir="$WORK/meta/.git"
  echo x > "$WORK/main/f.txt"
  git -C "$WORK/main" add f.txt
  git -C "$WORK/main" -c user.email=t@t -c user.name=t commit -q -m init
  mkdir "$WORK/meta/.ruvector"
  git -C "$WORK/main" worktree add -q "$WORK/wts" -b sep
  rs bash -c '. "$1"; ruvector_heal_store "$2"' _ "$LIB" "$WORK/wts"
  [ "$status" -eq 0 ]
  [ ! -e "$WORK/wts/.ruvector" ]
}

@test "heal_store: an empty --separate-git-dir repo never links to the git dir's parent" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  mkdir -p "$WORK/meta" "$WORK/main"
  git -C "$WORK/main" init -q --separate-git-dir="$WORK/meta/.git"
  git -C "$WORK/main" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  mkdir "$WORK/meta/.ruvector"
  git -C "$WORK/main" worktree add -q "$WORK/wte" -b sep-empty
  rs bash -c '. "$1"; ruvector_heal_store "$2"' _ "$LIB" "$WORK/wte"
  [ "$status" -eq 0 ]
  [ ! -e "$WORK/wte/.ruvector" ]
}

@test "heal_store: never replaces a real directory (warns instead)" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$WORK" init -q
  echo x > "$WORK/f.txt"; git -C "$WORK" add f.txt
  git -C "$WORK" -c user.email=t@t -c user.name=t commit -q -m init
  mkdir "$WORK/.ruvector"
  git -C "$WORK" worktree add -q "$WORK/wt" -b keep
  mkdir "$WORK/wt/.ruvector"
  run --separate-stderr env CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash -c '. "$1"; ruvector_heal_store "$2"' _ "$LIB" "$WORK/wt"
  [ "$status" -eq 0 ]
  [ -d "$WORK/wt/.ruvector" ] && [ ! -L "$WORK/wt/.ruvector" ]
  [[ "$stderr" == *"non-symlink path diverged"* ]]
}

@test "run_budgeted: bounds a command without GNU timeout (stock macOS)" {
  start=$(date +%s)
  # sh itself reports its killed child on stderr; hooks discard stderr.
  run --separate-stderr bash -c ". '$LIB'; TIMEOUT_CMD=''; out=\$(run_budgeted 0.3 sh -c 'echo hi; sleep 5'); rc=\$?; echo \"\$out|\$rc\""
  [ $(( $(date +%s) - start )) -le 3 ]
  [[ "$output" == "hi|"* ]]
  [[ "$output" != "hi|0" ]]
  run bash -c ". '$LIB'; TIMEOUT_CMD=''; run_budgeted 5 sh -c 'echo fast; exit 3'; echo \"rc=\$?\""
  [ "$output" = $'fast\nrc=3' ]
}

@test "run_bounded (install lib): bounds a command when timeout is unavailable" {
  mkdir -p "$STUBS/bin"
  for b in sh sleep kill cat pkill; do ln -s "$(command -v "$b")" "$STUBS/bin/$b"; done
  start=$(date +%s)
  run env PATH="$STUBS/bin" "$BASH" -c ". '$PLUGIN_ROOT/lib/install-ruvector.sh'; yellow_ruvector_run_bounded 0.3 sleep 5; echo \"rc=\$?\""
  [ $(( $(date +%s) - start )) -le 3 ]
  [[ "$output" == rc=* ]]
  [ "$output" != "rc=0" ]
}
