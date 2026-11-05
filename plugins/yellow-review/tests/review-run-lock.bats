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

# holder_of <acquire output>: the token on its holder= line.
holder_of() { printf '%s\n' "$1" | sed -n 's/^holder=//p'; }

# Portable "minutes ago" mtime (BSD touch has no -d).
age_minutes() {
  touch -t "$(date -d "-$2 minutes" +%Y%m%d%H%M 2>/dev/null || date -v "-$2M" +%Y%m%d%H%M)" "$1"
}

@test "acquire creates the staging dir when yellow-core has not staged here yet" {
  run --separate-stderr "$SCRIPT" acquire
  [ "$status" -eq 0 ]
  h=$(holder_of "$output")
  [[ "$h" =~ ^run\.[A-Za-z0-9]{6}$ ]]
  [ -f "$STAGING/.review-run-lock/$h" ]
  [[ "$output" == *$'\n'"drain=idle" ]]
  # A drain that starts staging later in the run sees the holder.
  . "$CORE_LIB"
  cs_review_lock_live "$STAGING"
  run "$SCRIPT" release "$h"
  [ "$status" -eq 0 ]
  run "$SCRIPT" release none
  [ "$status" -eq 0 ]
}

@test "acquire prints holder=none for a symlinked staging dir and writes nothing there" {
  mkdir -p "$BATS_TEST_TMPDIR/elsewhere" "$(dirname "$STAGING")"
  ln -s "$BATS_TEST_TMPDIR/elsewhere" "$STAGING"
  run --separate-stderr "$SCRIPT" acquire
  [ "$status" -eq 0 ]
  [ "$(holder_of "$output")" = none ]
  [ -z "$(ls -A "$BATS_TEST_TMPDIR/elsewhere")" ]
}

@test "acquire reports a live drain alongside the holder" {
  mkdir -p "$STAGING/.drain-lock"
  run --separate-stderr "$SCRIPT" acquire
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\n'"drain=live" ]]
}

@test "acquire and release create and remove one holder; yellow-core sees it live" {
  mkdir -p "$STAGING/pending"
  run --separate-stderr "$SCRIPT" acquire
  [ "$status" -eq 0 ]
  h=$(holder_of "$output")
  [ -f "$STAGING/.review-run-lock/$h" ]
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
  [ -f "$STAGING/.review-run-lock/$a" ]
  . "$CORE_LIB"
  cs_review_lock_live "$STAGING"
  "$SCRIPT" release "$a"
  [ ! -e "$STAGING/.review-run-lock" ]
}

@test "acquire reaps a holder older than two hours" {
  mkdir -p "$STAGING/.review-run-lock"
  old="$STAGING/.review-run-lock/run.old123"
  printf 'pid=1 start=1\n' > "$old"
  age_minutes "$old" 180
  h=$(holder_of "$("$SCRIPT" acquire)")
  [ ! -e "$old" ]
  [ -f "$STAGING/.review-run-lock/$h" ]
}

@test "release and refresh take only a run.XXXXXX token, never a path (exit 2)" {
  mkdir -p "$STAGING"
  printf 'keep\n' > "$BATS_TEST_TMPDIR/victim"
  for bad in "$BATS_TEST_TMPDIR/victim" "$STAGING/.review-run-lock/run.abc123" '../run.abc123' 'run.ab/c12' 'run.$(id)'; do
    run --separate-stderr "$SCRIPT" release "$bad"
    [ "$status" -eq 2 ] || { echo "accepted: $bad" >&2; return 1; }
    run --separate-stderr "$SCRIPT" refresh "$bad"
    [ "$status" -eq 2 ]
  done
  [ -f "$BATS_TEST_TMPDIR/victim" ]
}

@test "refresh touches the holder" {
  mkdir -p "$STAGING"
  h=$(holder_of "$("$SCRIPT" acquire)")
  age_minutes "$STAGING/.review-run-lock/$h" 90
  run "$SCRIPT" refresh "$h"
  [ "$status" -eq 0 ]
  [ -z "$(find "$STAGING/.review-run-lock/$h" -mmin +5)" ]
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
  age_minutes "$STAGING/.drain-lock" 45
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
