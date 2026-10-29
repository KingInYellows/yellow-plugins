#!/usr/bin/env bats
# Tests for apply-thread-actions: the batched Step 7 write phase. The three
# stage scripts are replaced by stubs next to a copy of the script, so the
# tests check ordering, fallbacks and stop rules, not GitHub calls.

bats_require_minimum_version 1.5.0

SRC="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/apply-thread-actions"

setup() {
  BIN="${BATS_TEST_TMPDIR}/bin"
  export STUB_DIR="${BATS_TEST_TMPDIR}/stub"
  export CALL_LOG="${BATS_TEST_TMPDIR}/calls.log"
  export TEXT_LOG="${BATS_TEST_TMPDIR}/text.log"
  mkdir -p "$BIN" "$STUB_DIR"
  : >"$CALL_LOG"
  : >"$TEXT_LOG"
  cp "$SRC" "$BIN/apply-thread-actions"
  cat >"$BIN/stage-stub" <<'STUB'
#!/bin/sh
name=$(basename "$0")
tid=""
for a in "$@"; do case "$a" in PRRT_*) tid=$a ;; esac; done
key=$name
[ "${1:-}" = "--find" ] && key=find
printf '%s' "$key" >>"$CALL_LOG"
for a in "$@"; do case "$a" in /*) printf ' <file>' ;; *) printf ' %s' "$a" ;; esac; done >>"$CALL_LOG"
printf '\n' >>"$CALL_LOG"
case "$key" in
  reply-pr-thread) { printf '%s %s: ' "$1" "$2"; cat "$3"; printf '\n'; } >>"$TEXT_LOG" ;;
  file-followup-issue) { printf 'issue %s: ' "$3"; cat "$4"; printf ' | '; cat "$5"; printf '\n'; } >>"$TEXT_LOG" ;;
esac
base="$STUB_DIR/$key.$tid"
n=$(cat "$base.n" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" >"$base.n"
rc=$(sed -n "${n}p" "$base.rc" 2>/dev/null)
[ -n "$rc" ] || rc=0
if [ -f "$base.out.$n" ]; then
  cat "$base.out.$n"
elif [ "$rc" -eq 0 ]; then
  case "$key" in
    reply-pr-thread) printf '{"replied":true,"commentId":"PRRC_1","threadId":"%s"}\n' "$tid" ;;
    resolve-pr-thread) printf '{"resolved":true,"threadId":"%s"}\n' "$tid" ;;
    handback-pr-thread) printf '{"handedBack":true,"commentId":"PRRC_2","threadId":"%s"}\n' "$tid" ;;
    find) printf '{"exists":false}\n' ;;
    file-followup-issue) printf '{"number":12,"url":"https://github.com/o/r/issues/12","created":true}\n' ;;
  esac
fi
[ -f "$base.err.$n" ] && cat "$base.err.$n" >&2
exit "$rc"
STUB
  chmod +x "$BIN/stage-stub"
  for s in file-followup-issue reply-pr-thread handback-pr-thread resolve-pr-thread; do
    ln -s stage-stub "$BIN/$s"
  done
  SCRIPT="$BIN/apply-thread-actions"
  PLAN="${BATS_TEST_TMPDIR}/plan.jsonl"
  RESULTS="${BATS_TEST_TMPDIR}/results.jsonl"
}

# stub_rc <stage> <threadId> <rc>...: exit codes for successive calls.
stub_rc() {
  local key=$1 tid=$2
  shift 2
  printf '%s\n' "$@" >"$STUB_DIR/$key.$tid.rc"
}

# stub_io <stage> <threadId> <call#> <out|err> <text>
stub_io() {
  printf '%s\n' "$5" >"$STUB_DIR/$1.$2.$4.$3"
}

# --- Usage and plan validation ---

@test "rejects a wrong argument count" {
  run "$SCRIPT" o/r 7 "$PLAN"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "rejects an invalid owner/repo and PR number" {
  : >"$PLAN"
  run "$SCRIPT" "o/r/x" 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 2 ]
  run "$SCRIPT" "o r" 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 2 ]
  run "$SCRIPT" o/r 07 "$PLAN" "$RESULTS"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --issue-cap x o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 2 ]
}

@test "rejects invalid plans before any write" {
  local bad
  for bad in \
    '{"threadId":"PRRT_a","disposition":"maybe"}' \
    '{"threadId":"bad","disposition":"fixed"}' \
    '{"threadId":"PRRT_a","disposition":"fixed","extra":1}' \
    '{"threadId":"PRRT_a","disposition":"fixed","issue":{"title":"t","body":"b"}}' \
    '{"threadId":"PRRT_a","disposition":"oos","reply":{"body":"tracked in {{issue}}"}}' \
    '{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":""}}' \
    '{"threadId":"PRRT_a","disposition":"fixed","resolve":"yes"}' \
    '{"threadId":"PRRT_a","disposition":"fixed","handback":true}' \
    '{"threadId":"PRRT_a","disposition":"fixed","resolve":false,"handback":true}' \
    '{"threadId":"PRRT_a","disposition":"fixed","resolve":true,"handback":"yes"}' \
    'not json'; do
    printf '%s\n' "$bad" >"$PLAN"
    run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
    [ "$status" -eq 2 ]
  done
  printf '%s\n' '{"threadId":"PRRT_a","disposition":"fixed"}' '{"threadId":"PRRT_a","disposition":"fixed"}' >"$PLAN"
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 2 ]
  [ ! -s "$CALL_LOG" ]
}

@test "refuses a symlinked results file" {
  : >"$PLAN"
  ln -s "${BATS_TEST_TMPDIR}/elsewhere" "$RESULTS"
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 2 ]
}

@test "an empty plan exits 0 with a zero summary" {
  : >"$PLAN"
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  [ "$output" = "apply threads=0 done=0 skipped=0 issues_created=0 stopped=none" ]
}

# --- Normal runs ---

@test "runs issue, reply, resolve per thread in plan order and fills {{issue}}" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"oos","issue":{"title":"Follow-up from PR #7: a.ts","body":"later"},"reply":{"body":"Out of scope for this PR; tracked in {{issue}}."},"resolve":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
{"threadId":"PRRT_c","disposition":"disagree","reply":{"body":"Not changing this: by design."}}
{"threadId":"PRRT_d","disposition":"unclear","resolve":true}
P
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  [ "${lines[${#lines[@]}-1]}" = "apply threads=4 done=4 skipped=0 issues_created=1 stopped=none" ]
  expected='file-followup-issue o/r 7 PRRT_a <file> <file>
reply-pr-thread PRRT_a oos <file>
resolve-pr-thread PRRT_a
reply-pr-thread PRRT_b fixed <file>
resolve-pr-thread PRRT_b
reply-pr-thread PRRT_c disagree <file>
resolve-pr-thread PRRT_d'
  [ "$(cat "$CALL_LOG")" = "$expected" ]
  grep -qxF 'PRRT_a oos: Out of scope for this PR; tracked in #12.' "$TEXT_LOG"
  [ "$(jq -r 'select(.threadId=="PRRT_a") | [.issue.status, (.issue.number|tostring), .reply.status, .resolve.status, .outcome] | join(",")' "$RESULTS")" = "filed,12,posted,resolved,complete" ]
  [ "$(jq -r 'select(.threadId=="PRRT_c") | [.reply.status, (.resolve|tostring)] | join(",")' "$RESULTS")" = "posted,null" ]
  [ "$(wc -l <"$RESULTS" | tr -d ' ')" -eq 4 ]
}

@test "an already-replied skip resolves only when the disposition matches" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
P
  stub_io reply-pr-thread PRRT_a 1 out '{"replied":false,"skipped":"already-replied","disposition":"fixed","threadId":"PRRT_a"}'
  stub_io reply-pr-thread PRRT_b 1 out '{"replied":false,"skipped":"already-replied","disposition":"disagree","threadId":"PRRT_b"}'
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  grep -qx 'resolve-pr-thread PRRT_a' "$CALL_LOG"
  ! grep -q 'resolve-pr-thread PRRT_b' "$CALL_LOG"
  [ "$(jq -r 'select(.threadId=="PRRT_b") | [.reply.status, .resolve.status, .resolve.postedAs] | join(",")' "$RESULTS")" = "skipped,withheld,disagree" ]
}

@test "a refused reply falls back to the plain text once" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234. see @someone","plain":"Fixed in abc1234."},"resolve":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234. see @someone"},"resolve":true}
P
  stub_rc reply-pr-thread PRRT_a 6 0
  stub_rc reply-pr-thread PRRT_b 6
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  grep -qxF 'PRRT_a fixed: Fixed in abc1234.' "$TEXT_LOG"
  grep -qx 'resolve-pr-thread PRRT_a' "$CALL_LOG"
  [ "$(jq -r 'select(.threadId=="PRRT_a") | [.reply.status, (.reply.plain|tostring), .outcome] | join(",")' "$RESULTS")" = "posted,true,complete" ]
  ! grep -q 'resolve-pr-thread PRRT_b' "$CALL_LOG"
  [ "$(jq -r 'select(.threadId=="PRRT_b") | [.reply.status, .resolve.status, .outcome] | join(",")' "$RESULTS")" = "refused,not-attempted,stopped" ]
}

@test "a refused issue is filed once with the plain title and body" {
  printf '%s\n' '{"threadId":"PRRT_a","disposition":"oos","issue":{"title":"T","body":"B @x"},"reply":{"body":"Out of scope; tracked in {{issue}}."},"resolve":true}' >"$PLAN"
  stub_rc file-followup-issue PRRT_a 6 0
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  grep -qxF 'issue PRRT_a: Follow-up from PR #7: review | Out of scope for PR #7.' "$TEXT_LOG"
  [ "$(jq -r '[.issue.status, (.issue.plain|tostring), .resolve.status] | join(",")' "$RESULTS")" = "filed,true,resolved" ]
}

@test "issue exit 7 posts the fixed Not filed reply as unclear and never resolves" {
  printf '%s\n' '{"threadId":"PRRT_a","disposition":"oos","issue":{"title":"T","body":"B"},"reply":{"body":"tracked in {{issue}}"},"resolve":true}' >"$PLAN"
  stub_rc file-followup-issue PRRT_a 7
  stub_io file-followup-issue PRRT_a 1 err 'reason=issues-disabled'
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  grep -qxF 'PRRT_a unclear: Not filed: follow-up issues cannot be created in this repository. Leaving open for a human.' "$TEXT_LOG"
  ! grep -q 'resolve-pr-thread' "$CALL_LOG"
  [ "$(jq -r '[.issue.status, .issue.reason, .finalDisposition, .resolve.status] | join(",")' "$RESULTS")" = "not-permitted,issues-disabled,unclear,withheld" ]
}

@test "the issue cap turns later oos threads unclear unless the issue already exists" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"oos","issue":{"title":"T","body":"B"},"reply":{"body":"tracked in {{issue}}"},"resolve":true}
{"threadId":"PRRT_b","disposition":"oos","issue":{"title":"T","body":"B"},"reply":{"body":"tracked in {{issue}}"},"resolve":true}
{"threadId":"PRRT_c","disposition":"oos","issue":{"title":"T","body":"B"},"reply":{"body":"tracked in {{issue}}"},"resolve":true}
P
  stub_io find PRRT_c 1 out '{"exists":true,"number":30,"url":"https://github.com/o/r/issues/30"}'
  run "$SCRIPT" --issue-cap 1 o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  grep -qxF 'PRRT_b unclear: Out of scope for this PR. The automatic follow-up issue limit for this run was reached, so no issue was filed. Leaving open.' "$TEXT_LOG"
  ! grep -q 'resolve-pr-thread PRRT_b' "$CALL_LOG"
  grep -qxF 'PRRT_c oos: tracked in #30' "$TEXT_LOG"
  grep -qx 'resolve-pr-thread PRRT_c' "$CALL_LOG"
  [ "$(grep -c '^file-followup-issue' "$CALL_LOG")" -eq 1 ]
  [ "${lines[${#lines[@]}-1]}" = "apply threads=3 done=3 skipped=0 issues_created=1 stopped=none" ]
}

@test "a failed dedupe check over the cap stops the thread instead of claiming no issue" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"oos","issue":{"title":"T","body":"B"},"reply":{"body":"tracked in {{issue}}"},"resolve":true}
{"threadId":"PRRT_b","disposition":"oos","issue":{"title":"T","body":"B"},"reply":{"body":"tracked in {{issue}}"},"resolve":true}
P
  stub_rc find PRRT_a 1
  run "$SCRIPT" --issue-cap 0 o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  ! grep -q 'PRRT_a' "$TEXT_LOG"
  [ "$(jq -r 'select(.threadId=="PRRT_a") | [.issue.status, (.issue.exit|tostring), .finalDisposition, .resolve.status, .outcome] | join(",")' "$RESULTS")" = "failed,1,unclear,not-attempted,stopped" ]
  grep -qxF 'PRRT_b unclear: Out of scope for this PR. The automatic follow-up issue limit for this run was reached, so no issue was filed. Leaving open.' "$TEXT_LOG"
}

@test "exit 3 on resolve records the reason and the next thread still runs" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
P
  stub_rc resolve-pr-thread PRRT_a 3
  stub_io resolve-pr-thread PRRT_a 1 err 'reason=permission'
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  [ "$(jq -r 'select(.threadId=="PRRT_a") | [.resolve.status, (.resolve.exit|tostring), .resolve.reason, .outcome] | join(",")' "$RESULTS")" = "failed,3,permission,stopped" ]
  grep -qx 'resolve-pr-thread PRRT_b' "$CALL_LOG"
}

# --- CodeRabbit hand-back ---

@test "a handback thread runs handback-pr-thread between the reply and the resolve" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true,"handback":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
P
  stub_io handback-pr-thread PRRT_a 1 out '{"handedBack":false,"skipped":"not-coderabbit","threadId":"PRRT_a"}'
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  expected='reply-pr-thread PRRT_a fixed <file>
handback-pr-thread PRRT_a
resolve-pr-thread PRRT_a
reply-pr-thread PRRT_b fixed <file>
resolve-pr-thread PRRT_b'
  [ "$(cat "$CALL_LOG")" = "$expected" ]
  [ "$(jq -r 'select(.threadId=="PRRT_a") | [.handback.status, .handback.reason, .resolve.status, .outcome] | join(",")' "$RESULTS")" = "skipped,not-coderabbit,resolved,complete" ]
  [ "$(jq -r 'select(.threadId=="PRRT_b") | .handback | tostring' "$RESULTS")" = "null" ]
}

@test "a failed hand-back still resolves the thread" {
  printf '%s\n' '{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true,"handback":true}' >"$PLAN"
  stub_rc handback-pr-thread PRRT_a 3
  stub_io handback-pr-thread PRRT_a 1 err 'reason=permission'
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  grep -qx 'resolve-pr-thread PRRT_a' "$CALL_LOG"
  [ "$(jq -r '[.handback.status, (.handback.exit|tostring), .handback.reason, .resolve.status, .outcome] | join(",")' "$RESULTS")" = "failed,3,permission,resolved,complete" ]
}

@test "a hand-back exit 4 stops the write phase before the resolve" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true,"handback":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
P
  stub_rc handback-pr-thread PRRT_a 4
  stub_io handback-pr-thread PRRT_a 1 err 'reason=rate-limit'
  run --separate-stderr "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 4 ]
  [ "$output" = "apply threads=2 done=1 skipped=0 issues_created=0 stopped=rate-limit" ]
  ! grep -q 'resolve-pr-thread' "$CALL_LOG"
  [ "$(jq -r 'select(.threadId=="PRRT_a") | [.handback.status, .handback.reason, (.resolve|tostring), .outcome] | join(",")' "$RESULTS")" = "failed,rate-limit,null,stopped" ]
  [ "$(jq -r 'select(.threadId=="PRRT_b") | .outcome' "$RESULTS")" = "not-attempted" ]
}

@test "a withheld resolve skips the hand-back too" {
  printf '%s\n' '{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true,"handback":true}' >"$PLAN"
  stub_io reply-pr-thread PRRT_a 1 out '{"replied":false,"skipped":"already-replied","disposition":"disagree","threadId":"PRRT_a"}'
  run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 0 ]
  ! grep -q 'handback-pr-thread' "$CALL_LOG"
  [ "$(jq -r '[(.handback|tostring), .resolve.status] | join(",")' "$RESULTS")" = "null,withheld" ]
}

# --- Stop rules ---

@test "exit 4 stops every later write and marks the rest not attempted" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
{"threadId":"PRRT_c","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
P
  stub_rc reply-pr-thread PRRT_b 4
  stub_io reply-pr-thread PRRT_b 1 err 'reason=timeout'
  run --separate-stderr "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"reason=timeout"* ]]
  [ "$output" = "apply threads=3 done=2 skipped=0 issues_created=0 stopped=timeout" ]
  ! grep -q 'PRRT_c' "$CALL_LOG"
  ! grep -q 'resolve-pr-thread PRRT_b' "$CALL_LOG"
  [ "$(jq -r 'select(.threadId=="PRRT_b") | [.reply.status, .reply.reason, .outcome] | join(",")' "$RESULTS")" = "failed,timeout,stopped" ]
  [ "$(jq -r 'select(.threadId=="PRRT_c") | [.outcome, .reason] | join(",")' "$RESULTS")" = "not-attempted,timeout" ]
}

@test "exit 4 with no reason line counts as a rate limit" {
  printf '%s\n' '{"threadId":"PRRT_a","disposition":"fixed","resolve":true}' >"$PLAN"
  stub_rc resolve-pr-thread PRRT_a 4
  run --separate-stderr "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"reason=rate-limit"* ]]
  [[ "$output" == *"stopped=rate-limit"* ]]
}

@test "a refusal's plain retry stays in the same stage under a zero budget" {
  printf '%s\n' '{"threadId":"PRRT_a","disposition":"oos","issue":{"title":"T","body":"B @x"},"reply":{"body":"tracked in {{issue}} @x","plain":"tracked in {{issue}}"},"resolve":true}' >"$PLAN"
  export YELLOW_REVIEW_APPLY_BUDGET=0
  stub_rc file-followup-issue PRRT_a 6 0
  stub_rc reply-pr-thread PRRT_a 6 0
  local runs=0
  while :; do
    runs=$((runs + 1))
    run "$SCRIPT" o/r 7 "$PLAN" "$RESULTS"
    [ "$status" -eq 0 ] && break
    [ "$status" -eq 5 ]
    [ "$runs" -lt 5 ]
  done
  [ "$runs" -eq 3 ]
  grep -qxF 'PRRT_a oos: tracked in #12' "$TEXT_LOG"
  [ "$(jq -r 'select(.outcome=="complete") | [.issue.status, (.issue.plain|tostring), .reply.status, (.reply.plain|tostring), .resolve.status] | join(",")' "$RESULTS")" = "filed,true,posted,true,resolved" ]
}

@test "the time budget stops between stages and a re-run finishes the plan" {
  cat >"$PLAN" <<'P'
{"threadId":"PRRT_a","disposition":"oos","issue":{"title":"T","body":"B"},"reply":{"body":"tracked in {{issue}}"},"resolve":true}
{"threadId":"PRRT_b","disposition":"fixed","reply":{"body":"Fixed in abc1234."},"resolve":true}
P
  # With a 0 s budget each run makes exactly one stage.
  export YELLOW_REVIEW_APPLY_BUDGET=0
  local runs=0
  while :; do
    runs=$((runs + 1))
    run "$SCRIPT" --issue-cap 1 o/r 7 "$PLAN" "$RESULTS"
    [ "$status" -eq 0 ] && break
    [ "$status" -eq 5 ]
    [[ "$output" == *"stopped=budget"* ]]
    [ "$runs" -lt 10 ]
  done
  [[ "$output" == *"issues_created=1"* ]]
  [ "$(jq -r 'select(.threadId=="PRRT_a" and .outcome=="complete") | [.issue.status, .resolve.status] | join(",")' "$RESULTS")" = "filed,resolved" ]
  # Each stage ran once: re-runs resume after the last finished stage.
  [ "$(cat "$CALL_LOG")" = "file-followup-issue o/r 7 PRRT_a <file> <file>
reply-pr-thread PRRT_a oos <file>
resolve-pr-thread PRRT_a
reply-pr-thread PRRT_b fixed <file>
resolve-pr-thread PRRT_b" ]
  grep -qxF 'PRRT_a oos: tracked in #12' "$TEXT_LOG"
  [ "$runs" -eq 5 ]
  [ "$(jq -r 'select(.threadId=="PRRT_b" and .outcome=="complete") | .resolve.status' "$RESULTS")" = "resolved" ]
}
