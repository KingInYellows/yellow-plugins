#!/usr/bin/env bats
# Tests for pr-review-delta

bats_require_minimum_version 1.5.0

PLUGIN_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)"
SCRIPT="${PLUGIN_DIR}/skills/pr-review-workflow/scripts/pr-review-delta"
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

# The script runs the get-pr-comments next to itself and sources
# ../../../lib, so each test copies it into a fake plugin tree beside a stub
# that replays FAKE_RESULTS, one per call (the last repeats): "ok:<id,id>",
# "partial:<id,id>" (exit 3), "badjson", "ratelimit", "fail".
setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  FAKE_ROOT="${BATS_TEST_TMPDIR}/plugin"
  FAKE_SCRIPTS="${FAKE_ROOT}/skills/pr-review-workflow/scripts"
  mkdir -p "$FAKE_SCRIPTS"
  ln -s "${PLUGIN_DIR}/lib" "${FAKE_ROOT}/lib"
  cp "$SCRIPT" "$FAKE_SCRIPTS/pr-review-delta"
  DELTA="$FAKE_SCRIPTS/pr-review-delta"
  cat >"$FAKE_SCRIPTS/get-pr-comments" <<'EOS'
#!/bin/bash
n=$(( $(cat "$FAKE_STATE" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$n" >"$FAKE_STATE"
IFS='|' read -ra results <<<"$FAKE_RESULTS"
r="${results[$((n - 1))]:-${results[$((${#results[@]} - 1))]}}"
case "$r" in
  ok:*) jq -nc --arg s "${r#ok:}" '$s | split(",") | map(select(. != "") | {threadId: .})' ;;
  partial:*) jq -nc --arg s "${r#partial:}" '$s | split(",") | map(select(. != "") | {threadId: .})'
             echo "get-pr-comments: deadline reached" >&2; exit 3 ;;
  badjson) printf 'not json' ;;
  ratelimit) echo "Error: GitHub API rate limit exceeded. Wait and retry." >&2; exit 1 ;;
  *) echo "boom" >&2; exit 1 ;;
esac
EOS
  chmod +x "$FAKE_SCRIPTS/get-pr-comments"
  export FAKE_STATE="${BATS_TEST_TMPDIR}/fake_state"
  rm -f "$FAKE_STATE"
  export MOCK_GH_HEAD_OID="$SHA_A"
  REPO_DIR="${BATS_TEST_TMPDIR}/repo"
  git init -q "$REPO_DIR"
  cd "$REPO_DIR"
  IDS="${BATS_TEST_TMPDIR}/ids"
  RECORD_DIR="$REPO_DIR/.git/yellow-review/delta/owner__repo"
}

record() {
  printf "$1" >"$IDS"
  run "$DELTA" record owner/repo 7 "$IDS" "${2:-$SHA_A}"
}

@test "usage errors exit 2" {
  run "$DELTA"
  [ "$status" -eq 2 ]
  run "$DELTA" frob owner/repo 7
  [ "$status" -eq 2 ]
  run "$DELTA" check owner/repo
  [ "$status" -eq 2 ]
  run "$DELTA" check owner/repo 7x
  [ "$status" -eq 2 ]
  local slug
  for slug in owner 'own er/repo' 'owner/re/po' 'owner__x/repo' 'owner_/repo' 'owner/..' '/repo' 'owner/'; do
    run "$DELTA" check "$slug" 7
    [ "$status" -eq 2 ] || { echo "accepted: $slug"; false; }
  done
  run "$DELTA" record owner/repo 7 "$IDS"
  [ "$status" -eq 2 ]
}

@test "no record yet reads as new with every thread counted" {
  FAKE_RESULTS="ok:PRRT_a,PRRT_b" run "$DELTA" check owner/repo 7
  [ "$status" -eq 0 ]
  [ "$output" = "PR 7 state=new new_threads=2 head_changed=1" ]
}

@test "the same IDs read as unchanged; a new ID reads as new with its count" {
  record 'PRRT_a\nPRRT_b\n'
  [ "$status" -eq 0 ]
  FAKE_RESULTS="ok:PRRT_b,PRRT_a" run "$DELTA" check owner/repo 7
  [ "$status" -eq 0 ]
  [ "$output" = "PR 7 state=unchanged new_threads=0 head_changed=0" ]
  rm -f "$FAKE_STATE"
  FAKE_RESULTS="ok:PRRT_a,PRRT_c,PRRT_d" MOCK_GH_HEAD_OID="$SHA_B" run "$DELTA" check owner/repo 7
  [ "$status" -eq 0 ]
  [ "$output" = "PR 7 state=new new_threads=2 head_changed=1" ]
}

@test "a resolved thread alone is not new, and a head change alone is reported but unchanged" {
  record 'PRRT_a\nPRRT_b\n'
  FAKE_RESULTS="ok:PRRT_a" MOCK_GH_HEAD_OID="$SHA_B" run "$DELTA" check owner/repo 7
  [ "$status" -eq 0 ]
  [ "$output" = "PR 7 state=unchanged new_threads=0 head_changed=1" ]
}

@test "an empty record set is valid: no threads is unchanged, any thread is new" {
  record ''
  [ "$status" -eq 0 ]
  FAKE_RESULTS="ok:" run "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=unchanged new_threads=0 head_changed=0" ]
  rm -f "$FAKE_STATE"
  FAKE_RESULTS="ok:PRRT_z" run "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=new new_threads=1 head_changed=0" ]
}

@test "a failed, truncated or unparseable fetch is unknown, never unchanged" {
  record 'PRRT_a\n'
  local r
  for r in fail "partial:PRRT_a" badjson "ok:PRRT_a,not-an-id"; do
    rm -f "$FAKE_STATE"
    FAKE_RESULTS="$r" run --separate-stderr "$DELTA" check owner/repo 7
    [ "$status" -eq 0 ]
    [ "$output" = "PR 7 state=unknown new_threads=0 head_changed=0" ] || { echo "$r: $output"; false; }
    [[ "$stderr" == *"pr-review-delta: PR 7: "* ]]
  done
  rm -f "$FAKE_STATE"
  FAKE_RESULTS="partial:PRRT_a" run --separate-stderr "$DELTA" check owner/repo 7
  [[ "$stderr" == *"thread list truncated"* ]]
}

@test "a failed PR lookup or an unreadable head is unknown" {
  record 'PRRT_a\n'
  FAKE_RESULTS="ok:PRRT_a" MOCK_GH_FAIL=1 run --separate-stderr "$DELTA" check owner/repo 7
  [ "$status" -eq 0 ]
  [ "$output" = "PR 7 state=unknown new_threads=0 head_changed=0" ]
  FAKE_RESULTS="ok:PRRT_a" MOCK_GH_HEAD_OID=nothex run --separate-stderr "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=unknown new_threads=0 head_changed=0" ]
  FAKE_RESULTS="ok:PRRT_a" MOCK_GH_PR_STATE=WEIRD run --separate-stderr "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=unknown new_threads=0 head_changed=0" ]
}

@test "a corrupt or symlinked record is unknown" {
  record 'PRRT_a\n'
  printf 'garbage\n' >>"$RECORD_DIR/7.seen"
  FAKE_RESULTS="ok:PRRT_a" run --separate-stderr "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=unknown new_threads=0 head_changed=0" ]
  printf 'not-a-header\nhead %s\n' "$SHA_A" >"$RECORD_DIR/7.seen"
  FAKE_RESULTS="ok:PRRT_a" run --separate-stderr "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=unknown new_threads=0 head_changed=0" ]
  record 'PRRT_a\n'
  mv "$RECORD_DIR/7.seen" "${BATS_TEST_TMPDIR}/real.seen"
  ln -s "${BATS_TEST_TMPDIR}/real.seen" "$RECORD_DIR/7.seen"
  FAKE_RESULTS="ok:PRRT_a" run --separate-stderr "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=unknown new_threads=0 head_changed=0" ]
}

@test "a closed or merged PR prints state=closed without fetching threads" {
  FAKE_RESULTS="ok:PRRT_a" MOCK_GH_PR_STATE=MERGED run "$DELTA" check owner/repo 7
  [ "$status" -eq 0 ]
  [ "$output" = "PR 7 state=closed new_threads=0 head_changed=0" ]
  [ ! -e "$FAKE_STATE" ]
  FAKE_RESULTS="ok:PRRT_a" MOCK_GH_PR_STATE=CLOSED run "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=closed new_threads=0 head_changed=0" ]
}

@test "a rate limit exits 4 and leaves that PR and the rest unknown" {
  FAKE_RESULTS="ok:PRRT_a" MOCK_GH_FAIL=ratelimit run --separate-stderr "$DELTA" check owner/repo 7 8
  [ "$status" -eq 4 ]
  [ "${lines[0]}" = "PR 7 state=unknown new_threads=0 head_changed=0" ]
  [ "${lines[1]}" = "PR 8 state=unknown new_threads=0 head_changed=0" ]
  [[ "$stderr" == *"reason=rate-limit"* ]]
  [ ! -e "$FAKE_STATE" ]
  FAKE_RESULTS="ok:PRRT_a|ratelimit" run --separate-stderr "$DELTA" check owner/repo 7 8 9
  [ "$status" -eq 4 ]
  [ "${lines[0]}" = "PR 7 state=new new_threads=1 head_changed=1" ]
  [ "${lines[1]}" = "PR 8 state=unknown new_threads=0 head_changed=0" ]
  [ "${lines[2]}" = "PR 9 state=unknown new_threads=0 head_changed=0" ]
  [ "$(cat "$FAKE_STATE")" = 2 ]
}

@test "several PRs print one line each, in argument order, from separate records" {
  record 'PRRT_a\n'
  FAKE_RESULTS="ok:PRRT_a|ok:PRRT_a" run "$DELTA" check owner/repo 007 8
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "PR 7 state=unchanged new_threads=0 head_changed=0" ]
  [ "${lines[1]}" = "PR 8 state=new new_threads=1 head_changed=1" ]
}

@test "check starts no PR after its deadline" {
  mkdir -p "${BATS_TEST_TMPDIR}/stubs"
  # Calls 1 and 2 (start, first PR) see t=1000, later calls t=1500.
  cat >"${BATS_TEST_TMPDIR}/stubs/date" <<'EOS'
#!/bin/sh
n=$(( $(cat "$DATE_STATE" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$n" >"$DATE_STATE"
[ "$n" -le 2 ] && echo 1000 || echo 1500
EOS
  chmod +x "${BATS_TEST_TMPDIR}/stubs/date"
  export DATE_STATE="${BATS_TEST_TMPDIR}/date_state"
  PATH="${BATS_TEST_TMPDIR}/stubs:$PATH" FAKE_RESULTS="ok:PRRT_a" run --separate-stderr "$DELTA" check owner/repo 7 8
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "PR 7 state=new new_threads=1 head_changed=1" ]
  [ "${lines[1]}" = "PR 8 state=unknown new_threads=0 head_changed=0" ]
  [[ "$stderr" == *"PR 8: deadline"* ]]
}

@test "record refuses a bad thread ID or head sha and writes nothing" {
  record 'PRRT_a\nPRRT_b;rm -rf\n'
  [ "$status" -eq 2 ]
  [ ! -e "$RECORD_DIR/7.seen" ]
  record 'PRRT_a\nnot-an-id\n'
  [ "$status" -eq 2 ]
  local sha
  for sha in "${SHA_A^^}" abc "${SHA_A}0" "g${SHA_A:1}"; do
    record 'PRRT_a\n' "$sha"
    [ "$status" -eq 2 ] || { echo "accepted sha $sha"; false; }
  done
  [ ! -e "$RECORD_DIR/7.seen" ]
  run "$DELTA" record owner/repo x7 "$IDS" "$SHA_A"
  [ "$status" -eq 2 ]
}

@test "record refuses a symlinked record directory or record file" {
  mkdir -p "$REPO_DIR/.git/yellow-review/delta" "${BATS_TEST_TMPDIR}/elsewhere"
  ln -s "${BATS_TEST_TMPDIR}/elsewhere" "$RECORD_DIR"
  record 'PRRT_a\n'
  [ "$status" -eq 1 ]
  [ -z "$(ls -A "${BATS_TEST_TMPDIR}/elsewhere")" ]
  rm "$RECORD_DIR"
  rm -rf "$REPO_DIR/.git/yellow-review/delta"
  ln -s "${BATS_TEST_TMPDIR}/elsewhere" "$REPO_DIR/.git/yellow-review/delta"
  record 'PRRT_a\n'
  [ "$status" -eq 1 ]
  [ -z "$(ls -A "${BATS_TEST_TMPDIR}/elsewhere")" ]
  rm "$REPO_DIR/.git/yellow-review/delta"
  record 'PRRT_a\n'
  [ "$status" -eq 0 ]
  mv "$RECORD_DIR/7.seen" "${BATS_TEST_TMPDIR}/target"
  ln -s "${BATS_TEST_TMPDIR}/target" "$RECORD_DIR/7.seen"
  record 'PRRT_b\n'
  [ "$status" -eq 1 ]
  [ "$(tail -n 1 "${BATS_TEST_TMPDIR}/target")" = "PRRT_a" ]
}

@test "record round trip: atomic replace, private directories, CRLF and blank lines ignored" {
  record 'PRRT_b\r\n\r\nPRRT_a\nPRRT_a\n'
  [ "$status" -eq 0 ]
  [ "$output" = "recorded PR 7 threads=2" ]
  [ "$(cat "$RECORD_DIR/7.seen")" = "$(printf 'yellow-review-delta 1\nhead %s\nPRRT_a\nPRRT_b' "$SHA_A")" ]
  [ "$(stat -c %a "$RECORD_DIR")" = 700 ]
  [ "$(stat -c %a "$REPO_DIR/.git/yellow-review/delta")" = 700 ]
  [ -z "$(find "$RECORD_DIR" -name '.*' -type f)" ]
  inode=$(stat -c %i "$RECORD_DIR/7.seen")
  record 'PRRT_c\n' "$SHA_B"
  [ "$status" -eq 0 ]
  [ "$(cat "$RECORD_DIR/7.seen")" = "$(printf 'yellow-review-delta 1\nhead %s\nPRRT_c' "$SHA_B")" ]
  # Replaced by rename, not rewritten in place.
  [ "$(stat -c %i "$RECORD_DIR/7.seen")" != "$inode" ]
  FAKE_RESULTS="ok:PRRT_c" MOCK_GH_HEAD_OID="$SHA_B" run "$DELTA" check owner/repo 7
  [ "$output" = "PR 7 state=unchanged new_threads=0 head_changed=0" ]
}

@test "the record lives in the common git dir, keyed by lowercased owner and repo" {
  record 'PRRT_a\n'
  git -C "$REPO_DIR" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false commit -q --allow-empty -m init
  git -C "$REPO_DIR" worktree add -q "${BATS_TEST_TMPDIR}/wt" 2>/dev/null
  cd "${BATS_TEST_TMPDIR}/wt"
  FAKE_RESULTS="ok:PRRT_a" run "$DELTA" check Owner/Repo 7
  [ "$output" = "PR 7 state=unchanged new_threads=0 head_changed=0" ]
}
