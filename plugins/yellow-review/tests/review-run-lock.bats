#!/usr/bin/env bats
# Tests for review-run-lock (the review side of yellow-core's review-run lock).

bats_require_minimum_version 1.5.0

SCRIPT="$BATS_TEST_DIRNAME/../skills/pr-review-workflow/scripts/review-run-lock"
CORE_LIB="$BATS_TEST_DIRNAME/../../yellow-core/lib/compound-staging.sh"

setup() {
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
  REPO="$BATS_TEST_TMPDIR/repo"
  git init -q "$REPO"
  cd "$REPO" || return 1
  top=$(git rev-parse --show-toplevel)
  STAGING="$HOME/.claude/projects/$(printf '%s' "$top" | tr '/' '-')/compound-staging"
}

holder_of() { printf '%s' "${1#holder=}"; }

@test "acquire prints holder=none when the checkout has no staging dir" {
  run --separate-stderr "$SCRIPT" acquire
  [ "$status" -eq 0 ]
  [ "$output" = "holder=none" ]
  [ ! -e "$HOME/.claude" ]
  run "$SCRIPT" release none
  [ "$status" -eq 0 ]
}

@test "acquire and release create and remove one holder; yellow-core sees it live" {
  mkdir -p "$STAGING/pending"
  run --separate-stderr "$SCRIPT" acquire
  [ "$status" -eq 0 ]
  h=$(holder_of "$output")
  [ -f "$h" ]
  [[ "$h" == "$STAGING/.review-run-lock/run."* ]]
  # shellcheck disable=SC1090
  . "$CORE_LIB"
  cs_review_lock_live "$STAGING"
  run "$SCRIPT" release "$h"
  [ "$status" -eq 0 ]
  [ ! -e "$STAGING/.review-run-lock" ]
  run cs_review_lock_live "$STAGING"
  [ "$status" -eq 1 ]
}

@test "nested runs hold separate holders; the lock stays until the last release" {
  mkdir -p "$STAGING"
  a=$(holder_of "$("$SCRIPT" acquire)")
  b=$(holder_of "$("$SCRIPT" acquire)")
  [ "$a" != "$b" ]
  "$SCRIPT" release "$b"
  [ -f "$a" ]
  . "$CORE_LIB"
  cs_review_lock_live "$STAGING"
  "$SCRIPT" release "$a"
  [ ! -e "$STAGING/.review-run-lock" ]
}

@test "acquire reaps a holder older than two hours" {
  mkdir -p "$STAGING/.review-run-lock"
  old="$STAGING/.review-run-lock/run.old123"
  printf 'pid=1 start=1\n' > "$old"
  touch -d '3 hours ago' "$old"
  h=$(holder_of "$("$SCRIPT" acquire)")
  [ ! -e "$old" ]
  [ -f "$h" ]
}

@test "release and refresh refuse a path outside this checkout's lock dir (exit 2)" {
  mkdir -p "$STAGING"
  printf 'keep\n' > "$BATS_TEST_TMPDIR/victim"
  run --separate-stderr "$SCRIPT" release "$BATS_TEST_TMPDIR/victim"
  [ "$status" -eq 2 ]
  [ -f "$BATS_TEST_TMPDIR/victim" ]
  run --separate-stderr "$SCRIPT" release "$STAGING/.review-run-lock/run.x/../../pending"
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" refresh "$BATS_TEST_TMPDIR/victim"
  [ "$status" -eq 2 ]
}

@test "refresh touches the holder" {
  mkdir -p "$STAGING"
  h=$(holder_of "$("$SCRIPT" acquire)")
  touch -d '90 minutes ago' "$h"
  run "$SCRIPT" refresh "$h"
  [ "$status" -eq 0 ]
  [ -z "$(find "$h" -mmin +5)" ]
}

@test "a symlinked lock dir is refused (exit 1)" {
  mkdir -p "$STAGING" "$BATS_TEST_TMPDIR/elsewhere"
  ln -s "$BATS_TEST_TMPDIR/elsewhere" "$STAGING/.review-run-lock"
  run --separate-stderr "$SCRIPT" acquire
  [ "$status" -eq 1 ]
  [ -z "$(ls -A "$BATS_TEST_TMPDIR/elsewhere")" ]
}

@test "drain-live reports a fresh drain lock and ignores a stale one" {
  mkdir -p "$STAGING"
  run "$SCRIPT" drain-live
  [ "$output" = "drain=idle" ]
  mkdir "$STAGING/.drain-lock"
  run "$SCRIPT" drain-live
  [ "$output" = "drain=live" ]
  touch -d '45 minutes ago' "$STAGING/.drain-lock"
  run "$SCRIPT" drain-live
  [ "$output" = "drain=idle" ]
}

@test "usage errors exit 2" {
  run --separate-stderr "$SCRIPT"
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" release
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT" acquire extra
  [ "$status" -eq 2 ]
}
