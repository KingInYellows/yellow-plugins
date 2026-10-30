#!/usr/bin/env bats
# Tests for sync-blocking-comment (sticky blocking-threads PR comment)

bats_require_minimum_version 1.5.0

PLUGIN_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)"
SRC="${PLUGIN_DIR}/skills/pr-review-workflow/scripts/sync-blocking-comment"
MARKER='<!-- yellow-review:blocking-threads -->'

# Each test runs a copy of the script beside a stub get-pr-comments driven by
# SBC_THREADS / SBC_THREADS_RC, and a gh stub that answers the comment search
# with SBC_COMMENTS (a JSON array of comment nodes) and records each mutation.
setup() {
  ROOT="${BATS_TEST_TMPDIR}/plugin"
  mkdir -p "$ROOT/skills/pr-review-workflow/scripts" "$ROOT/lib" "${BATS_TEST_TMPDIR}/bin"
  cp "$SRC" "$ROOT/skills/pr-review-workflow/scripts/sync-blocking-comment"
  cp "${PLUGIN_DIR}/lib/resolve-gh.sh" "$ROOT/lib/resolve-gh.sh"
  SCRIPT="$ROOT/skills/pr-review-workflow/scripts/sync-blocking-comment"
  cat >"$ROOT/skills/pr-review-workflow/scripts/get-pr-comments" <<'STUB'
#!/bin/sh
printf '%s %s\n' "$*" "${YELLOW_REVIEW_FETCH_DEADLINE:-}" >"${BATS_TEST_TMPDIR}/comments_args"
[ -z "${SBC_THREADS_ERR:-}" ] || printf '%s\n' "$SBC_THREADS_ERR" >&2
printf '%s\n' "${SBC_THREADS:-[]}"
exit "${SBC_THREADS_RC:-0}"
STUB
  cat >"${BATS_TEST_TMPDIR}/bin/gh" <<'STUB'
#!/bin/sh
printf 'call\n' >>"${BATS_TEST_TMPDIR}/gh_calls"
body_file=""
for a in "$@"; do
  case "$a" in body=@*) body_file="${a#body=@}" ;; esac
done
case "$*" in
  *"BlockingCommentUpdate("*)
    cp "$body_file" "${BATS_TEST_TMPDIR}/posted_body"
    printf 'update\n' >"${BATS_TEST_TMPDIR}/mutation"
    printf '{"data":{"updateIssueComment":{"issueComment":{"id":"IC_old"}}}}\n' ;;
  *"BlockingCommentCreate("*)
    if [ -n "${SBC_CREATE_FAIL:-}" ]; then printf '%s\n' "$SBC_CREATE_FAIL" >&2; exit 1; fi
    cp "$body_file" "${BATS_TEST_TMPDIR}/posted_body"
    printf 'create\n' >"${BATS_TEST_TMPDIR}/mutation"
    printf '{"data":{"addComment":{"commentEdge":{"node":{"id":"IC_new"}}}}}\n' ;;
  *"BlockingComment("*)
    if [ -n "${SBC_SEARCH_FAIL:-}" ]; then printf '%s\n' "$SBC_SEARCH_FAIL" >&2; exit 1; fi
    jq -nc --argjson c "${SBC_COMMENTS:-[]}" --argjson more "${SBC_MORE:-false}" \
      '{data:{repository:{pullRequest:{id:"PR_1",headRefOid:"0123456789abcdef0123",comments:{pageInfo:{hasNextPage:$more,endCursor:"Y3Vyc29y"},nodes:$c}}}}}' ;;
  *) printf 'unexpected gh call: %s\n' "$*" >&2; exit 1 ;;
esac
STUB
  chmod +x "$ROOT/skills/pr-review-workflow/scripts/get-pr-comments" "${BATS_TEST_TMPDIR}/bin/gh"
  export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
  unset SBC_THREADS SBC_THREADS_RC SBC_THREADS_ERR SBC_COMMENTS SBC_MORE SBC_SEARCH_FAIL SBC_CREATE_FAIL YELLOW_REVIEW_BLOCKING_COMMENT
}

# thread <id> <path> <line> <login> [outdated]: one get-pr-comments thread.
thread() {
  jq -nc --arg id "$1" --arg p "$2" --argjson l "$3" --arg a "$4" --argjson o "${5:-false}" \
    '{threadId:$id,path:$p,line:(if $o then null else $l end),originalLine:$l,isOutdated:$o,
      comments:[{author:$a,body:"please fix @someone",url:("https://github.com/test/repo/pull/7#discussion_r" + $id)}]}'
}

gh_calls() {
  if [ -e "${BATS_TEST_TMPDIR}/gh_calls" ]; then wc -l <"${BATS_TEST_TMPDIR}/gh_calls" | tr -d ' '; else printf 0; fi
}

@test "rejects bad arguments with exit 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" test/repo 7
  [ "$status" -eq 2 ]
  for bad in noslash a/b/c 'own er/repo'; do
    run "$SCRIPT" "$bad" 7 unknown
    [ "$status" -eq 2 ]
  done
  run "$SCRIPT" test/repo 07 unknown
  [ "$status" -eq 2 ]
  run "$SCRIPT" test/repo 7 maybe
  [ "$status" -eq 2 ]
  run "$SCRIPT" --bogus test/repo 7 unknown
  [ "$status" -eq 2 ]
}

@test "a reasons file that is missing, a symlink or not an object is a usage error" {
  run "$SCRIPT" --reasons "${BATS_TEST_TMPDIR}/nope" test/repo 7 unknown
  [ "$status" -eq 2 ]
  printf '[]' >"${BATS_TEST_TMPDIR}/arr.json"
  run "$SCRIPT" --reasons "${BATS_TEST_TMPDIR}/arr.json" test/repo 7 unknown
  [ "$status" -eq 2 ]
  printf '{}' >"${BATS_TEST_TMPDIR}/obj.json"
  ln -s "${BATS_TEST_TMPDIR}/obj.json" "${BATS_TEST_TMPDIR}/link.json"
  run "$SCRIPT" --reasons "${BATS_TEST_TMPDIR}/link.json" test/repo 7 unknown
  [ "$status" -eq 2 ]
}

@test "enforced resolution and the off switch skip without calling gh" {
  run --separate-stderr "$SCRIPT" test/repo 7 enforced
  [ "$status" -eq 0 ]
  [ "$(jq -r .reason <<<"$output")" = enforced ]
  YELLOW_REVIEW_BLOCKING_COMMENT=0 run --separate-stderr "$SCRIPT" test/repo 7 not_enforced
  [ "$status" -eq 0 ]
  [ "$(jq -r .reason <<<"$output")" = disabled ]
  [ "$(gh_calls)" = 0 ]
  [ ! -e "${BATS_TEST_TMPDIR}/comments_args" ]
}

@test "no blocking threads and no comment yet writes nothing" {
  run --separate-stderr "$SCRIPT" test/repo 7 not_enforced
  [ "$status" -eq 0 ]
  [ "$(jq -c . <<<"$output")" = '{"action":"skipped","reason":"nothing-to-report","commentId":null,"blocking":0}' ]
  [ ! -e "${BATS_TEST_TMPDIR}/mutation" ]
}

@test "creates the comment with one row per blocking thread, outdated included" {
  SBC_THREADS="[$(thread PRRT_a src/a.js 12 alice),$(thread PRRT_b lib/b.sh 3 'coderabbitai' true)]"
  export SBC_THREADS
  run --separate-stderr "$SCRIPT" test/repo 7 not_enforced
  [ "$status" -eq 0 ]
  [ "$(jq -c . <<<"$output")" = '{"action":"created","reason":null,"commentId":"IC_new","blocking":2}' ]
  grep -q -- '--include-outdated test/repo 7 120' "${BATS_TEST_TMPDIR}/comments_args"
  body="${BATS_TEST_TMPDIR}/posted_body"
  [ "$(head -n 1 "$body")" = "$MARKER" ]
  grep -qF '| [thread](https://github.com/test/repo/pull/7#discussion_rPRRT_a) | `src/a.js:12` | `alice` | open |' "$body"
  grep -qF '| `lib/b.sh:3` | `coderabbitai` | open (outdated) |' "$body"
  grep -q 'does not require conversation resolution' "$body"
  grep -qF 'at `0123456789ab`' "$body"
}

@test "reviewer prose and mentions never reach the comment" {
  SBC_THREADS="[$(thread PRRT_a src/a.js 1 alice)]"
  export SBC_THREADS
  run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 0 ]
  ! grep -q 'please fix' "${BATS_TEST_TMPDIR}/posted_body"
  ! grep -q '@' "${BATS_TEST_TMPDIR}/posted_body"
  grep -q 'Could not confirm' "${BATS_TEST_TMPDIR}/posted_body"
}

@test "hostile path, login and URL values are neutralized" {
  t=$(jq -nc '{threadId:"PRRT_x",path:"a`b|c\nd<e>.js",line:1,isOutdated:false,
     comments:[{author:"evil|`@x",url:"javascript:alert(1)"}]}')
  SBC_THREADS="[$t]" run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 0 ]
  body="${BATS_TEST_TMPDIR}/posted_body"
  grep -qF '| PRRT_x | `abc de.js:1` | `evilx` | open |' "$body"
  ! grep -q 'javascript' "$body"
}

@test "statuses come from the reasons file's fixed vocabulary" {
  SBC_THREADS="[$(thread PRRT_a a 1 u),$(thread PRRT_b b 2 u),$(thread PRRT_c c 3 u)]"
  export SBC_THREADS
  printf '{"PRRT_a":"disagree","PRRT_b":"<script>","PRRT_z":"unclear"}' >"${BATS_TEST_TMPDIR}/r.json"
  run --separate-stderr "$SCRIPT" --reasons "${BATS_TEST_TMPDIR}/r.json" test/repo 7 unknown
  [ "$status" -eq 0 ]
  body="${BATS_TEST_TMPDIR}/posted_body"
  grep -qF '`a:1` | `u` | disagree |' "$body"
  grep -qF '`b:2` | `u` | open |' "$body"
  grep -qF '`c:3` | `u` | open |' "$body"
  ! grep -q 'script' "$body"
}

@test "an existing marker comment by the viewer is edited in place" {
  SBC_THREADS="[$(thread PRRT_a a 1 u)]"
  SBC_COMMENTS=$(jq -nc --arg m "$MARKER" '[
    {id:"IC_other",viewerDidAuthor:false,body:($m + "\nforged")},
    {id:"IC_quote",viewerDidAuthor:true,body:("see " + $m)},
    {id:"IC_old",viewerDidAuthor:true,body:($m + "\nold list")}]')
  export SBC_THREADS SBC_COMMENTS
  run --separate-stderr "$SCRIPT" test/repo 7 not_enforced
  [ "$status" -eq 0 ]
  [ "$(jq -r .action <<<"$output")" = updated ]
  [ "$(jq -r .commentId <<<"$output")" = IC_old ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mutation")" = update ]
}

@test "an identical body is left unchanged" {
  SBC_THREADS="[$(thread PRRT_a a 1 u)]"
  export SBC_THREADS
  run --separate-stderr "$SCRIPT" test/repo 7 not_enforced
  [ "$status" -eq 0 ]
  SBC_COMMENTS=$(jq -nc --rawfile b "${BATS_TEST_TMPDIR}/posted_body" '[{id:"IC_old",viewerDidAuthor:true,body:$b}]')
  export SBC_COMMENTS
  rm -f "${BATS_TEST_TMPDIR}/mutation"
  run --separate-stderr "$SCRIPT" test/repo 7 not_enforced
  [ "$status" -eq 0 ]
  [ "$(jq -c . <<<"$output")" = '{"action":"unchanged","reason":null,"commentId":"IC_old","blocking":1}' ]
  [ ! -e "${BATS_TEST_TMPDIR}/mutation" ]
}

@test "once every thread is resolved the comment says so" {
  SBC_COMMENTS=$(jq -nc --arg m "$MARKER" '[{id:"IC_old",viewerDidAuthor:true,body:($m + "\nold")}]')
  export SBC_COMMENTS
  run --separate-stderr "$SCRIPT" test/repo 7 not_enforced
  [ "$status" -eq 0 ]
  [ "$(jq -r .action <<<"$output")" = updated ]
  grep -q 'No open review threads block merge' "${BATS_TEST_TMPDIR}/posted_body"
}

@test "more than 50 threads are capped with a count" {
  all=$(for i in $(seq 1 53); do thread "PRRT_$i" f "$i" u; done | jq -sc .)
  SBC_THREADS="$all" run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 0 ]
  [ "$(grep -c '^| \[thread\]' "${BATS_TEST_TMPDIR}/posted_body")" = 50 ]
  grep -q 'and 3 more' "${BATS_TEST_TMPDIR}/posted_body"
}

@test "a partial or failed thread fetch writes nothing" {
  SBC_THREADS="[$(thread PRRT_a a 1 u)]" SBC_THREADS_RC=3 run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 1 ]
  SBC_THREADS_RC=1 run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 1 ]
  [ ! -e "${BATS_TEST_TMPDIR}/mutation" ]
  [ "$(gh_calls)" = 0 ]
}

@test "a rate-limited thread fetch exits 4 with reason=rate-limit" {
  SBC_THREADS_RC=1 SBC_THREADS_ERR='Error: GitHub API rate limit exceeded. Wait and retry.' \
    run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
}

@test "gh failures map to the documented exit codes" {
  SBC_THREADS="[$(thread PRRT_a a 1 u)]"
  export SBC_THREADS
  SBC_SEARCH_FAIL='HTTP 403: API rate limit exceeded' run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
  SBC_SEARCH_FAIL='HTTP 401: Bad credentials' run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 7 ]
  SBC_CREATE_FAIL='HTTP 403: Resource not accessible by integration' run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 3 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=permission'
}

@test "the comment search stops at its page cap without writing" {
  SBC_THREADS="[$(thread PRRT_a a 1 u)]" SBC_MORE=true run --separate-stderr "$SCRIPT" test/repo 7 unknown
  [ "$status" -eq 0 ]
  [ "$(jq -r .reason <<<"$output")" = too-many-comments ]
  [ "$(gh_calls)" = 3 ]
  [ ! -e "${BATS_TEST_TMPDIR}/mutation" ]
}
