#!/usr/bin/env bats
# Tests for check-resolve-text (credential refusal for text posted elsewhere)

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/check-resolve-text"

setup() {
  A="$BATS_TEST_TMPDIR/a.txt"
  B="$BATS_TEST_TMPDIR/b.txt"
  printf 'Out of scope: retry policy belongs in the client.\n' >| "$A"
  printf 'Follow-up from PR #7: src/a.ts\n' >| "$B"
}

@test "clean text exits 0" {
  run "$SCRIPT" "$A" "$B"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a credential shape in any file exits 2 and names it" {
  printf 'use AKIAABCDEFGHIJKLMNOP\n' >| "$B"
  run --separate-stderr "$SCRIPT" "$A" "$B"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"$B"* ]]
}

@test "a private key block exits 2" {
  printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "no arguments exits 2; a missing file exits 1" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" "$BATS_TEST_TMPDIR/nope"
  [ "$status" -eq 1 ]
}
