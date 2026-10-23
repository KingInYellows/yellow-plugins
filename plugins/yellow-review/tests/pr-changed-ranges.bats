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

@test "consecutive added lines merge into one range" {
  MOCK_GH_FILES_FIXTURE=pr-files-ranges.json run "$SCRIPT" 7
  [ "$status" -eq 0 ]
  [[ "$output" == *"src/run.ts 2-4"* ]]
}

@test "a no-newline marker does not shift the next hunk's line numbers" {
  MOCK_GH_FILES_FIXTURE=pr-files-ranges.json run "$SCRIPT" 7
  [ "$status" -eq 0 ]
  [[ "$output" == *"src/nonl.ts 2-2,11-11"* ]]
}

@test "a response that is not a file array exits 1 with a parse error" {
  MOCK_GH_FILES_FIXTURE=pr-files-notarray.json run --separate-stderr "$SCRIPT" 7
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"could not parse the PR file list"* ]]
}

@test "a file name with a newline cannot forge a row, even with a trailing newline" {
  MOCK_GH_FILES_FIXTURE=pr-files-newline-names.json run "$SCRIPT" 7
  [ "$status" -eq 0 ]
  [ "$output" = "src/clean.ts 1-1" ]
}

@test "--previous prints one validated original path per renamed file and nothing else" {
  MOCK_GH_FILES_FIXTURE=pr-files-renames.json run --separate-stderr "$SCRIPT" --previous 7
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'src/old.ts\nlib/orig.ts')" ]
}

@test "--previous fails closed on a name with a newline: exit 1, no output, no forged record" {
  MOCK_GH_FILES_FIXTURE=pr-files-renames-newline.json run --separate-stderr "$SCRIPT" --previous 7
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$output" != *"victim.txt"* ]]
}

@test "--previous rejects a trailing newline, which a bare end anchor would accept" {
  printf '[{"filename":"lib/moved.ts","previous_filename":"lib/orig.ts\n","status":"renamed"}]' >| "$BATS_FIXTURE_DIR/pr-files-trailing.json"
  MOCK_GH_FILES_FIXTURE=pr-files-trailing.json run --separate-stderr "$SCRIPT" --previous 7
  rm -f "$BATS_FIXTURE_DIR/pr-files-trailing.json"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "a gh call killed by the timeout is a fetch failure with exit 1" {
  mkdir -p "${BATS_TEST_TMPDIR}/tobin"
  printf '#!/bin/sh\nexit 124\n' >| "${BATS_TEST_TMPDIR}/tobin/timeout"
  chmod +x "${BATS_TEST_TMPDIR}/tobin/timeout"
  PATH="${BATS_TEST_TMPDIR}/tobin:$PATH" run --separate-stderr "$SCRIPT" 7
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"could not list files"* ]]
}

@test "usage: --previous needs a numeric PR" {
  run "$SCRIPT" --previous
  [ "$status" -eq 2 ]
  run "$SCRIPT" --previous abc
  [ "$status" -eq 2 ]
}

@test "a PR whose every path is unsafe prints nothing, exits 0 and adds no unknown row" {
  MOCK_GH_FILES_FIXTURE=pr-files-unsafe.json run --separate-stderr "$SCRIPT" 7
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "--stack on a PR based on the default branch prints its own rows and skips the compare call" {
  run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 0 ]
  [[ "$output" == *"src/a.ts 2-2,31-31"* ]]
  [ ! -e "${BATS_TEST_TMPDIR}/mock_gh_compare_calls" ]
}

@test "--stack on a stacked PR prints the stack diff from the default branch to the head" {
  MOCK_GH_PULL_BASE=feature/lower run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 0 ]
  [[ "$output" == *".changeset/stack-fix.md 1-5"* ]]
  [[ "$output" == *"src/lower.ts 11-11"* ]]
  [[ "$output" == *"src/a.ts 2-2,31-31"* ]]
  grep -q 'compare/main...0123456789abcdef0123456789abcdef01234567' "${BATS_TEST_TMPDIR}/mock_gh_compare_calls"
}

@test "--stack fails closed on a compare listing of 300 files or one with no file list" {
  MOCK_GH_PULL_BASE=feature/lower MOCK_GH_COMPARE_FIXTURE=compare-response-300.json run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$stderr" == *"300 files or more"* ]]
  MOCK_GH_PULL_BASE=feature/lower MOCK_GH_COMPARE_FIXTURE=compare-response-nofiles.json run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "--stack refuses an unsafe base name or head before any compare call" {
  MOCK_GH_PULL_BASE='feat..x' run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"could not read the base"* ]]
  MOCK_GH_PULL_BASE='feat x' run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 1 ]
  MOCK_GH_PULL_BASE=feature/lower MOCK_GH_PULL_HEAD=HEAD run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 1 ]
  [ ! -e "${BATS_TEST_TMPDIR}/mock_gh_compare_calls" ]
}

@test "--stack: a failed compare call exits 1 with no rows" {
  MOCK_GH_PULL_BASE=feature/lower MOCK_GH_COMPARE_FAIL=1 run --separate-stderr "$SCRIPT" --stack 7
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$stderr" == *"could not compare"* ]]
}

@test "usage: --stack needs a numeric PR" {
  run "$SCRIPT" --stack
  [ "$status" -eq 2 ]
  run "$SCRIPT" --stack abc
  [ "$status" -eq 2 ]
}
