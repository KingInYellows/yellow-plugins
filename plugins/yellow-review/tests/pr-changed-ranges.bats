#!/usr/bin/env bats
# Tests for pr-changed-ranges

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/pr-changed-ranges"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
}

@test "rejects missing and non-numeric arguments" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" abc
  [ "$status" -eq 2 ]
}

@test "prints PR-added new-side lines (not hunk context) per file across pages" {
  run "$SCRIPT" 7
  [ "$status" -eq 0 ]
  [[ "$output" == *"src/a.ts 2-2,31-31"* ]]
  [[ "$output" == *"src/new.ts 1-1"* ]]
  [[ "$output" == *"src/b.ts 7-7"* ]]
  [[ "$output" == *"docs/p2.md 2-2"* ]]
}

@test "deleted file has none and a file without a patch is unknown" {
  run "$SCRIPT" 7
  [[ "$output" == *"src/gone.ts none"* ]]
  [[ "$output" == *"img/logo.png unknown"* ]]
}

@test "paths that fail the character pattern are not listed" {
  run "$SCRIPT" 7
  [[ "$output" != *"one line"* ]]
}

@test "a failed fetch exits 1 with no rows" {
  MOCK_GH_FILES_FAIL=1 run --separate-stderr "$SCRIPT" 7
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$stderr" == *"could not list files"* ]]
}

@test "a file name with a newline cannot forge a row, even with a trailing newline" {
  MOCK_GH_FILES_FIXTURE=pr-files-newline-names.json run "$SCRIPT" 7
  [ "$status" -eq 0 ]
  [ "$output" = "src/clean.ts 1-1" ]
}
