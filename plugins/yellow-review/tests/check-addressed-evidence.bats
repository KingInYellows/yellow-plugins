#!/usr/bin/env bats
# Tests for check-addressed-evidence

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/check-addressed-evidence"

setup() {
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  REPO="$BATS_TEST_TMPDIR/repo"
  git init -q -b main "$REPO"
  cd "$REPO"
  git config user.email test@test.com
  git config user.name Test
  mkdir -p src .changeset
  seq 1 40 >| src/a.ts
  seq 1 12 >| src/lower.ts
  seq 1 5 >| .changeset/fix.md
  seq 1 3 >| src/other.ts
  git add -A
  git commit -q -m init
  # The PR changed src/a.ts lines 10-12; its stack below also changed
  # src/lower.ts line 11 and added the changeset.
  printf 'src/a.ts 10-12\nsrc/other.ts none\n' >| "$BATS_TEST_TMPDIR/pr"
  printf 'src/a.ts 10-12\nsrc/lower.ts 11-11\n.changeset/fix.md 1-5\nsrc/other.ts none\n' >| "$BATS_TEST_TMPDIR/stack"
  P="$BATS_TEST_TMPDIR/proposals.jsonl"
}

# row <threadId> <evidence> <path|null> <line|null> <outdated> <strict>
row() {
  jq -nc --arg t "$1" --arg e "$2" --argjson p "$3" --argjson l "$4" \
    --argjson o "$5" --argjson s "$6" \
    '{threadId:$t, evidence:$e, path:$p, line:$l, startLine:null,
      originalLine:$l, originalStartLine:null, isOutdated:$o, strict:$s}' >> "$P"
}

verdict() { printf '%s\n' "$output" | jq -r --arg t "$1" 'select(.threadId == $t) | if .ok then "ok " + .basis else "no " + .reason end'; }

@test "a bot thread may cite its own file at any line" {
  row T1 src/a.ts:30 '"src/a.ts"' 11 false false
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$status" -eq 0 ]
  [ "$(verdict T1)" = "ok thread-file" ]
}

@test "a line-anchored thread may cite another file only on a line the stack changed" {
  row T1 src/lower.ts:11 '"src/a.ts"' 11 false false
  row T2 src/lower.ts:3 '"src/a.ts"' 11 false false
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" --stack-ranges-from "$BATS_TEST_TMPDIR/stack" "$P"
  [ "$status" -eq 0 ]
  [ "$(verdict T1)" = "ok changed-line" ]
  [ "$(verdict T2)" = "no evidence path not this thread's file" ]
}

@test "without the stack capture a lower PR's line is not evidence" {
  row T1 src/lower.ts:11 '"src/a.ts"' 11 false false
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$(verdict T1)" = "no evidence path not this thread's file" ]
}

@test "a review-level thread may cite a changeset added lower in the stack" {
  row T1 .changeset/fix.md:2 null null false false
  row T2 src/other.ts:1 null null false false
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" --stack-ranges-from "$BATS_TEST_TMPDIR/stack" "$P"
  [ "$status" -eq 0 ]
  [ "$(verdict T1)" = "ok stack-file" ]
  [ "$(verdict T2)" = "ok pr-file" ]
}

@test "an outdated thread citing a file outside the PR and stack is refused" {
  row T1 src/lower.ts:2 '"src/a.ts"' null true false
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$(verdict T1)" = "no evidence path not changed by this PR or its stack" ]
}

@test "malformed, missing and out-of-range evidence is refused without echoing it" {
  row T1 'src/a.ts' '"src/a.ts"' 11 false false
  row T2 '../etc/passwd:1' '"src/a.ts"' 11 false false
  row T3 'src/-x.ts:1' '"src/a.ts"' 11 false false
  row T4 'src/a.ts:0' '"src/a.ts"' 11 false false
  row T5 'src/nope.ts:1' null null false false
  row T6 'src/a.ts:41' '"src/a.ts"' 11 false false
  row T7 'src:1' null null false false
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$status" -eq 0 ]
  [ "$(verdict T1)" = "no evidence malformed" ]
  [ "$(verdict T2)" = "no evidence malformed" ]
  [ "$(verdict T3)" = "no evidence malformed" ]
  [ "$(verdict T4)" = "no evidence malformed" ]
  [ "$(verdict T5)" = "no evidence path not at HEAD" ]
  [ "$(verdict T6)" = "no evidence line past end of file" ]
  [ "$(verdict T7)" = "no evidence path not at HEAD" ]
  [[ "$output" != *passwd* ]]
}

@test "a strict thread cannot cite its own anchor or an unchanged line" {
  row T1 src/a.ts:11 '"src/a.ts"' 11 false true
  row T2 src/a.ts:30 '"src/a.ts"' 11 false true
  row T3 src/a.ts:12 '"src/a.ts"' 11 false true
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$status" -eq 0 ]
  [ "$(verdict T1)" = "no evidence on the thread's own lines" ]
  [ "$(verdict T2)" = "no evidence line not changed by this PR or its stack" ]
  [ "$(verdict T3)" = "ok changed-line" ]
}

@test "a strict thread's multi-line and original anchors both count as its own lines" {
  jq -nc '{threadId:"T1", evidence:"src/a.ts:10", path:"src/a.ts", line:12, startLine:11,
           originalLine:10, originalStartLine:10, isOutdated:false, strict:true}' >> "$P"
  jq -nc '{threadId:"T2", evidence:"src/a.ts:12", path:"src/a.ts", line:12, startLine:11,
           originalLine:null, originalStartLine:null, isOutdated:false, strict:true}' >> "$P"
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$(verdict T1)" = "no evidence on the thread's own lines" ]
  [ "$(verdict T2)" = "no evidence on the thread's own lines" ]
}

@test "a strict thread cannot cite a file a cluster edited this run" {
  row T1 src/lower.ts:11 null null false true
  printf 'src/lower.ts\n' >| "$BATS_TEST_TMPDIR/modified"
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" --stack-ranges-from "$BATS_TEST_TMPDIR/stack" --modified-from "$BATS_TEST_TMPDIR/modified" "$P"
  [ "$(verdict T1)" = "no evidence file edited this run" ]
}

@test "a strict review-level thread may cite a line the stack changed" {
  row T1 src/lower.ts:11 null null false true
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" --stack-ranges-from "$BATS_TEST_TMPDIR/stack" "$P"
  [ "$(verdict T1)" = "ok changed-line" ]
}

@test "an unknown or none range proves no line" {
  printf 'src/a.ts unknown\n' >| "$BATS_TEST_TMPDIR/pr"
  row T1 src/a.ts:20 null null false true
  row T2 src/other.ts:1 null null false true
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$(verdict T1)" = "no evidence line not changed by this PR or its stack" ]
  [ "$(verdict T2)" = "no evidence path not changed by this PR or its stack" ]
}

@test "an invalid proposals file is refused whole with exit 2 and no output" {
  row T1 src/a.ts:30 '"src/a.ts"' 11 false false
  row T1 src/a.ts:31 '"src/a.ts"' 11 false false
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  printf '{"threadId":"T1","evidence":"src/a.ts:1"}\n' >| "$P"
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$status" -eq 2 ]
  printf 'not json\n' >| "$P"
  run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$status" -eq 2 ]
}

@test "usage errors exit 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  row T1 src/a.ts:30 '"src/a.ts"' 11 false false
  run "$SCRIPT" "$P"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/missing" "$P"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --bogus x "$P"
  [ "$status" -eq 2 ]
}

@test "outside a git work tree exits 1" {
  row T1 src/a.ts:30 '"src/a.ts"' 11 false false
  cd "$BATS_TEST_TMPDIR"
  mkdir -p plain && cd plain
  GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR" run --separate-stderr "$SCRIPT" --ranges-from "$BATS_TEST_TMPDIR/pr" "$P"
  [ "$status" -eq 1 ]
}
