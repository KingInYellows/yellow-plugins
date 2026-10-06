#!/usr/bin/env bats
# Drives lib/quote-ground.sh from its real bash entry points.
# The quote is always stdin. A stand-in that reads argv, skips the
# length gate, or opens an unsafe path fails these cases.

QG="${BATS_TEST_DIRNAME}/../lib/quote-ground.sh"
Q26=abcdefghijklmnopqrstuvwxyz

setup() {
  BASE="$(mktemp -d)"
  PROJECT_ROOT="${BASE}/proj"
  mkdir -p "$PROJECT_ROOT/src"
  cd "$PROJECT_ROOT" || exit 1
}

teardown() {
  cd / || return 1
  if [ -n "${BASE:-}" ] && [ -d "$BASE" ]; then
    rm -rf "$BASE" || return 1
  fi
}

write_window() {
  : >src/a.txt
  local i
  for i in 01 02 03 04 05 06 07 08 09 10; do
    printf 'line-%s token-%s unique-body\n' "$i" "$i" >>src/a.txt
  done
}

line_quote() {
  printf 'line-%s token-%s unique-body' "$1" "$1"
}

# One batch row as JSON: id file line quote.
row() {
  jq -cn --arg id "$1" --arg file "$2" --argjson line "$3" --arg quote "$4" \
    '{id:$id,file:$file,line:$line,quote:$quote}'
}

# Sets TIMEOUT_BIN to timeout or gtimeout (stock macOS has neither), else skips.
need_timeout() {
  TIMEOUT_BIN=$(command -v timeout || command -v gtimeout || true)
  [ -n "$TIMEOUT_BIN" ] || skip "timeout/gtimeout not available"
}

# Milliseconds from a clock that exists on bash 4.4 and later.
now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local t=${EPOCHREALTIME/[.,]/}
    printf '%s' "$((t / 1000))"
  else
    printf '%s' "$((SECONDS * 1000))"
  fi
}

@test "quote-ground.sh refuses to be sourced" {
  run bash -c 'source "$1" && printf sourced-ok\n' bash "$QG"
  [ "$status" -ne 0 ]
  [[ "$output" != *sourced-ok* ]]
}

@test "check exits 2 when validate-fs.sh is missing" {
  local dir
  dir="$(mktemp -d)"
  cp "$QG" "$dir/quote-ground.sh"
  run bash "$dir/quote-ground.sh" check src/a.txt 1 3 <<<"$Q26"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  rm -rf "$dir"
}

@test "check exits 2 when compound-staging.sh is missing" {
  local dir
  dir="$(mktemp -d)"
  cp "$QG" "$dir/quote-ground.sh"
  cp "${BATS_TEST_DIRNAME}/../lib/validate-fs.sh" "$dir/validate-fs.sh"
  run bash "$dir/quote-ground.sh" check src/a.txt 1 3 <<<"$Q26"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  rm -rf "$dir"
}

@test "check exits 2 on usage and on a missing target file" {
  printf '%s\n' "$Q26" >src/a.txt
  run bash "$QG"
  [ "$status" -eq 2 ]
  run bash "$QG" check
  [ "$status" -eq 2 ]
  run bash "$QG" check src/a.txt
  [ "$status" -eq 2 ]
  run bash "$QG" check src/a.txt abc
  [ "$status" -eq 2 ]
  run bash "$QG" batch extra
  [ "$status" -eq 2 ]
  run bash "$QG" check src/missing.txt 1 3 <<<"$Q26"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
}

@test "check validates its arguments before it reads stdin" {
  need_timeout
  printf '%s\n' "$Q26" >src/a.txt
  run "$TIMEOUT_BIN" 5 bash "$QG" check src/a.txt abc </dev/zero
  [ "$status" -eq 2 ]
  run "$TIMEOUT_BIN" 5 bash "$QG" check src/a.txt 1 x </dev/zero
  [ "$status" -eq 2 ]
}

@test "check rejects a non-integer or hostile line and radius without running them" {
  local arg
  printf '%s\n' "$Q26" >src/a.txt
  for arg in 0 -1 007 1234567890 '1+1' 'a[$(touch pwned)]'; do
    run bash "$QG" check src/a.txt "$arg" 3 <<<"$Q26"
    [ "$status" -eq 2 ]
  done
  # A radius of 0 is valid (an exact-line match); every other value is not.
  for arg in -1 007 1234567890 '1+1' 'a[$(touch pwned)]'; do
    run bash "$QG" check src/a.txt 1 "$arg" <<<"$Q26"
    [ "$status" -eq 2 ]
  done
  [ ! -e pwned ]
}

@test "check reads the quote from stdin, not from argv" {
  printf '%s\n' "$Q26" >src/a.txt
  run bash "$QG" check src/a.txt 1 3 "$Q26" <<<"totally-different-quote-text"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/a.txt 1 3 'not-the-quote' <<<"$Q26"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "check grounds a substring inside the default radius and honors an explicit radius" {
  write_window
  run bash "$QG" check src/a.txt 5 <<<"$(line_quote 08)"
  [ "$status" -eq 0 ]
  [ "$output" = "8" ]
  run bash "$QG" check src/a.txt 5 <<<"$(line_quote 09)"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/a.txt 5 4 <<<"$(line_quote 09)"
  [ "$status" -eq 0 ]
  [ "$output" = "9" ]
}

@test "check matches each window edge and rejects the lines just outside" {
  write_window
  run bash "$QG" check src/a.txt 5 3 <<<"$(line_quote 02)"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
  run bash "$QG" check src/a.txt 5 3 <<<"$(line_quote 08)"
  [ "$status" -eq 0 ]
  [ "$output" = "8" ]
  run bash "$QG" check src/a.txt 5 3 <<<"$(line_quote 01)"
  [ "$status" -eq 1 ]
  run bash "$QG" check src/a.txt 5 3 <<<"$(line_quote 09)"
  [ "$status" -eq 1 ]
}

@test "check grounds a quote when the cited line is past EOF but the window still overlaps" {
  write_window
  run bash "$QG" check src/a.txt 12 3 <<<"$(line_quote 10)"
  [ "$status" -eq 0 ]
  [ "$output" = "10" ]
  run bash "$QG" check src/a.txt 100 3 <<<"$(line_quote 01)"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "check normalizes tabs, CRLF, and repeated spaces" {
  printf 'alpha\tbeta gamma delta\n' >src/a.txt
  run bash "$QG" check src/a.txt 1 0 <<<"alpha beta gamma delta"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
  printf 'alpha    beta gamma delta\r\n' >src/a.txt
  run bash "$QG" check src/a.txt 1 <<<"alpha beta gamma delta"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "check keeps backslashes and printf escapes literal" {
  printf '%s\n' 'keep printf "x\n" literal here' >src/a.txt
  run bash "$QG" check src/a.txt 1 3 <<<"keep printf \"x\\n\" literal here"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "a NUL byte in the cited window never grounds a quote that spans it" {
  printf 'abcd\0efgh\n' >src/a.txt
  run bash "$QG" check src/a.txt 1 <<<"abcdefgh"
  [ "$status" -eq 1 ]
  run bash "$QG" batch <<<"$(row nul src/a.txt 1 abcdefgh)"
  [ "$status" -eq 0 ]
  [ "$(jq -r .result <<<"$output")" = "ungrounded" ]
}

@test "check never grounds a quote that holds a NUL byte" {
  printf 'abcdefgh\n' >src/a.txt
  run bash -c 'printf "abcd\0efgh" | bash "$0" check src/a.txt 1' "$QG"
  [ "$status" -eq 1 ]
}

@test "check grounds non-ASCII text after space squeezing" {
  printf '%s\n' 'café    résumé token value' >src/a.txt
  run bash "$QG" check src/a.txt 1 <<<"café résumé token value"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "check never grounds a too-short quote, including a placeholder-only quote" {
  printf '%s\n' 'prefix abcdefg abcdefgh suffix' >src/a.txt
  run bash "$QG" check src/a.txt 1 3 <<<"abcdefg"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/a.txt 1 3 <<<"abcdefgh"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
  printf '%s\n' 'api_key=[REDACTED] plus trailing words' >src/a.txt
  run bash "$QG" check src/a.txt 1 3 <<<"[REDACTED]"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "check canonicalizes api_key=ghp_ placeholders before matching" {
  local token
  # Assembled from fragments so no secret scanner sees a whole token here.
  token='ghp_''abcdefghijklmnopqrstuvwxyz0123456789ABCD'
  printf '%s\n' "seen api_key=${token} in config" >src/a.txt
  run bash "$QG" check src/a.txt 1 3 <<<"seen api_key=[REDACTED] in config"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
  run bash "$QG" check src/a.txt 1 3 <<<"seen api_key=[REDACTED:github-token] in config"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
  printf '%s\n' "prefix ${token} suffix words" >src/b.txt
  run bash "$QG" check src/b.txt 1 3 <<<"prefix [REDACTED] suffix words"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "check rejects unsafe paths without grounding a quote that sits on the target" {
  local home
  printf '%s\n' "$Q26" >src/a.txt
  printf '%s\n' "$Q26" >"$BASE/outside.txt"
  ln -s "$BASE/outside.txt" src/escape
  mkdir -p src/adir
  printf '%s\n' "$Q26" >src/adir/hidden.txt
  home="$(mktemp -d)"
  printf '%s\n' "$Q26" >"$home/secret.txt"

  run bash "$QG" check ../outside.txt 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check "$PROJECT_ROOT/src/a.txt" 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  HOME="$home" run bash "$QG" check '~/secret.txt' 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/escape 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/adir 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check $'src/a\nb.txt' 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check $'src/a\rb.txt' 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  rm -rf "$home"
}

@test "check and batch ground a quote when a blank line sits inside the window" {
  printf 'alpha line one\n\nthe quoted target line\nomega\n' >src/a.txt
  run bash "$QG" check src/a.txt 3 <<<"the quoted target line"
  [ "$status" -eq 0 ]
  [ "$output" = "3" ]
  run bash "$QG" batch <<<"$(row b src/a.txt 3 'the quoted target line')"
  [ "$status" -eq 0 ]
  jq -e '.id == "b" and .result == "grounded" and .matched_line == 3' <<<"$output" >/dev/null
}

@test "an empty or blank quote is too-short and does not abort its sibling rows" {
  local payload
  printf 'alpha line one\n\nthe quoted target line\nomega\n' >src/a.txt
  run bash "$QG" check src/a.txt 3 <<<""
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  payload="$(
    row empty src/a.txt 3 ''
    row blank src/a.txt 3 '   '
    row good src/a.txt 3 'the quoted target line'
  )"
  run bash "$QG" batch <<<"$payload"
  [ "$status" -eq 0 ]
  jq -e -s '
    length == 3
    and (map(select(.id == "empty"))[0].result == "too-short")
    and (map(select(.id == "blank"))[0].result == "too-short")
    and (map(select(.id == "good"))[0].result == "grounded")
  ' <<<"$output" >/dev/null
}

@test "an empty file path is rejected without aborting the script" {
  run bash "$QG" check '' 1 3 <<<"$Q26"
  [ "$status" -ne 0 ]
  [[ "$output" != *"bad array subscript"* ]]
  run bash "$QG" batch <<<"$(row e '' 1 "$Q26")"
  [ "$status" -eq 0 ]
  jq -e '.id == "e" and .result != "grounded"' <<<"$output" >/dev/null
}

@test "check returns promptly for a very large radius or line number" {
  need_timeout
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  run "$TIMEOUT_BIN" 10 bash "$QG" check src/a.txt 1 999999999 <<<"a quote that is not in the file"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run "$TIMEOUT_BIN" 10 bash "$QG" check src/a.txt 3 999999999 <<<"the quoted target line"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
  run "$TIMEOUT_BIN" 10 bash "$QG" check src/a.txt 999999999 3 <<<"the quoted target line"
  [ "$status" -eq 1 ]
}

@test "check keeps later line numbers true across a private-key block" {
  local k
  k="-----BEGIN RSA PRIVATE"
  {
    printf 'before the key block\n'
    printf '%s KEY-----\n' "$k"
    printf 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n'
    printf '%s\n' '-----END RSA PRIVATE KEY-----'
    printf 'after the key block text\n'
  } >src/k.txt
  run bash "$QG" check src/k.txt 5 0 <<<"after the key block text"
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
  run bash "$QG" check src/k.txt 1 0 <<<"before the key block"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
  run bash "$QG" check src/k.txt 2 0 <<<"${k} KEY-----"
  [ "$status" -eq 1 ]
  run bash "$QG" batch <<<"$(row a src/k.txt 5 'after the key block text')"
  [ "$status" -eq 0 ]
  jq -e '.result == "grounded" and .matched_line == 5' <<<"$output" >/dev/null
}

@test "a literal private-key body row never grounds, even when the window starts inside the block" {
  local k body
  k="-----BEGIN RSA PRIVATE"
  body="MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"
  {
    printf 'before the key block\n'
    printf '%s KEY-----\n' "$k"
    printf '%s\n' "$body"
    printf '%s\n' '-----END RSA PRIVATE KEY-----'
    printf 'after the key block text\n'
  } >src/k.txt
  run bash "$QG" check src/k.txt 3 0 <<<"$body"
  [ "$status" -eq 1 ]
  run bash "$QG" check src/k.txt 3 3 <<<"$body"
  [ "$status" -eq 1 ]
  run bash "$QG" batch <<<"$(row a src/k.txt 3 "$body")"
  [ "$status" -eq 0 ]
  jq -e '.result == "ungrounded" and .matched_line == null' <<<"$output" >/dev/null
  run bash "$QG" check src/k.txt 5 3 <<<"after the key block text"
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
}

@test "a private-key block on one row does not swallow the rows after it" {
  {
    printf '%s %s\n' '-----BEGIN RSA PRIVATE KEY-----' 'AAAA-----END RSA PRIVATE KEY-----'
    printf 'the row after a one-line key block\n'
  } >src/k.txt
  run bash "$QG" check src/k.txt 2 0 <<<"the row after a one-line key block"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
}

@test "batch reports every id and still grounds the safe sibling" {
  local payload
  printf '%s\n' "short $Q26" >src/a.txt
  printf '%s\n' "short $Q26" >"$BASE/outside.txt"
  payload="$(
    row short src/a.txt 1 short
    row bad ../outside.txt 1 "short $Q26"
    row miss src/a.txt 1 'not-present-quote-body'
    row good src/a.txt 1 "$Q26"
  )"
  run bash "$QG" batch <<<"$payload"
  [ "$status" -eq 0 ]
  jq -e -s '
    length == 4
    and all(has("id") and has("result") and has("matched_line"))
    and (map(select(.id == "short"))[0].result == "too-short")
    and (map(select(.id == "bad"))[0].result == "unsafe-path")
    and (map(select(.id == "miss"))[0].result == "ungrounded")
    and (map(select(.id == "good"))[0].result == "grounded")
    and (map(select(.id == "good"))[0].matched_line == 1)
    and all(select(.result != "grounded") | .matched_line == null)
  ' <<<"$output" >/dev/null
}

@test "batch uses radius 3: window edges, a start clamp and a cited line past EOF" {
  local payload
  write_window
  payload="$(
    row in-low src/a.txt 5 "$(line_quote 02)"
    row in-high src/a.txt 5 "$(line_quote 08)"
    row out-low src/a.txt 5 "$(line_quote 01)"
    row out-high src/a.txt 5 "$(line_quote 09)"
    row clamp src/a.txt 1 "$(line_quote 04)"
    row past-eof src/a.txt 12 "$(line_quote 10)"
    row far-past src/a.txt 100 "$(line_quote 01)"
  )"
  run bash "$QG" batch <<<"$payload"
  [ "$status" -eq 0 ]
  jq -e -s '
    length == 7
    and (.[0].result == "grounded" and .[0].matched_line == 2)
    and (.[1].result == "grounded" and .[1].matched_line == 8)
    and (.[2].result == "ungrounded")
    and (.[3].result == "ungrounded")
    and (.[4].result == "grounded" and .[4].matched_line == 4)
    and (.[5].result == "grounded" and .[5].matched_line == 10)
    and (.[6].result == "ungrounded")
  ' <<<"$output" >/dev/null
}

@test "batch reports a missing file as ungrounded and an empty stdin as no rows" {
  printf '%s\n' "$Q26" >src/a.txt
  run bash "$QG" batch <<<"$(row gone src/missing.txt 1 "$Q26")"
  [ "$status" -eq 0 ]
  jq -e '.id == "gone" and .result == "ungrounded" and .matched_line == null' <<<"$output" >/dev/null
  run bash "$QG" batch </dev/null
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "an unreadable cited file exits 2 in check and in batch, never ungrounded" {
  [ "$(id -u)" -ne 0 ] || skip "root reads every file"
  printf '%s\n' "$Q26" >src/a.txt
  chmod 000 src/a.txt
  run bash "$QG" check src/a.txt 1 <<<"$Q26"
  [ "$status" -eq 2 ]
  run bash "$QG" batch <<<"$(row locked src/a.txt 1 "$Q26")"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
}

@test "a leading-hyphen path is unsafe even when the file exists" {
  printf '%s\n' "$Q26" >./-evidence.txt
  run bash "$QG" check -evidence.txt 1 3 <<<"$Q26"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "a file under a directory without search permission exits 2, not unsafe-path" {
  [ "$(id -u)" -ne 0 ] || skip "root searches every directory"
  mkdir -p src/locked
  printf '%s\n' "$Q26" >src/locked/a.txt
  chmod 000 src/locked
  run bash "$QG" check src/locked/a.txt 1 <<<"$Q26"
  chmod 755 src/locked
  [ "$status" -eq 2 ]
}

@test "a malformed row is ungrounded and does not affect its siblings" {
  local payload
  printf '%s\n' "$Q26" >src/a.txt
  payload="$(
    printf '%s\n' '{"id":"null-line","file":"src/a.txt","line":null,"quote":"'"$Q26"'"}'
    printf '%s\n' '{"id":"no-quote","file":"src/a.txt","line":1}'
    printf '%s\n' '{"id":"num-file","file":7,"line":1,"quote":"'"$Q26"'"}'
    printf '%s\n' '{"id":"nul-quote","file":"src/a.txt","line":1,"quote":"abc\u0000def"}'
    printf '%s\n' '{"id":"str-line","file":"src/a.txt","line":"1","quote":"'"$Q26"'"}'
    row good src/a.txt 1 "$Q26"
  )"
  run bash "$QG" batch <<<"$payload"
  [ "$status" -eq 0 ]
  jq -e -s '
    length == 6
    and all(.[0:4][]; .result == "ungrounded" and .matched_line == null)
    and (.[4].id == "str-line" and .[4].result == "grounded" and .[4].matched_line == 1)
    and (.[5].id == "good" and .[5].result == "grounded")
  ' <<<"$output" >/dev/null
}

@test "batch exits 2 with no result rows when a row is not JSON or has no usable id" {
  printf '%s\n' "$Q26" >src/a.txt
  run bash "$QG" batch <<<"$(row ok src/a.txt 1 "$Q26")"$'\n''not json'
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  run bash "$QG" batch <<<"$(row ok src/a.txt 1 "$Q26")"$'\n''{"file":"src/a.txt","line":1,"quote":"x"}'
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  run bash "$QG" batch <<<'{"id":"x\u0000y","file":"src/a.txt","line":1,"quote":"abcdefghij"}'
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  run bash "$QG" batch <<<'[1,2]'
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  # invalid UTF-8 in an id is rejected, and a malformed row's text stays off stderr
  run bash "$QG" batch < <(printf '{"id":"a\377b","file":"src/a.txt","line":1,"quote":"abcdefghij"}\n')
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  run bash "$QG" batch <<<'{"id":"x","file":"src/a.txt","line":1,"quote":"ghp_abcdefghijklmnopqrstuvwxyz0123456789"'
  [ "$status" -eq 2 ]
  [[ "$output" != *ghp_* ]]
}

@test "batch exits 2 when iconv is not on PATH and names that dependency" {
  local shim src cmd bash_bin
  shim="${BASE}/bin"
  bash_bin="$(command -v bash)"
  mkdir -p "$shim"
  for cmd in dirname jq; do
    src="$(command -v "$cmd")" || skip "$cmd is not installed"
    ln -s "$src" "$shim/$cmd"
  done
  printf '%s\n' "$Q26" >src/a.txt
  PATH="$shim" run "$bash_bin" "$QG" batch <<<"$(row ok src/a.txt 1 "$Q26")"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  [[ "$output" == *'batch requires iconv'* ]]
}

@test "batch rejects non-JSON numeric forms but accepts valid JSON numbers" {
  local lit
  printf '%s\n' "$Q26" >src/a.txt
  for lit in Infinity -Infinity NaN nan 01 1. .5 +1 1e 0x1; do
    run bash "$QG" batch <<<"{\"id\":$lit,\"file\":\"src/a.txt\",\"line\":1,\"quote\":\"$Q26\"}"
    [ "$status" -eq 2 ]
    [[ "$output" != *'"result"'* ]]
  done
  run bash "$QG" batch <<<"{\"id\":1,\"file\":\"src/a.txt\",\"line\":Infinity,\"quote\":\"$Q26\"}"
  [ "$status" -eq 2 ]
  for lit in 0 -0 7 1.5 -2.5e+3 1E5 true; do
    run bash "$QG" batch <<<"{\"id\":\"s\",\"file\":\"src/a.txt\",\"line\":1,\"quote\":\"Infinity 01 \\\"x\\\" $Q26\",\"n\":$lit}"
    [ "$status" -eq 0 ]
    [[ "$output" == *'"id":"s"'* ]]
  done
  run bash "$QG" batch <<<"{\"id\":42,\"file\":\"src/a.txt\",\"line\":1,\"quote\":\"$Q26\"}"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":42,'* ]]
}

@test "batch rejects a blank or whitespace-only line but accepts the final newline" {
  local a b
  printf '%s\n' "$Q26" >src/a.txt
  a="$(row a src/a.txt 1 "$Q26")"
  b="$(row b src/a.txt 1 "$Q26")"
  run bash "$QG" batch < <(printf '%s\n%s\n' "$a" "$b")
  [ "$status" -eq 0 ]
  [ "$(wc -l <<<"$output")" -eq 2 ]
  run bash "$QG" batch < <(printf '%s\n\n%s\n' "$a" "$b")
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  run bash "$QG" batch < <(printf '%s\n \t\r\n%s\n' "$a" "$b")
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
}

@test "batch keeps ids exactly, emits valid JSON for control characters, and preserves numeric id types" {
  local payload
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  payload="$(jq -cn '
    [42, "42", -7, "-dash", "ctl\u001fx", "b\bf\fz", "one\u0001two", "q\"uote\\slash"][]
    | {id: ., file: "src/a.txt", line: 2, quote: "the quoted target line"}
  ')"
  run bash "$QG" batch <<<"$payload"
  [ "$status" -eq 0 ]
  jq -e -s '
    length == 8
    and all(.result == "grounded" and .matched_line == 2)
    and (.[0].id == 42 and (.[0].id | type) == "number")
    and (.[1].id == "42" and (.[1].id | type) == "string")
    and (.[2].id == -7)
    and (.[3].id == "-dash")
    and (.[4].id == "ctl\u001fx")
    and (.[5].id == "b\bf\fz")
    and (.[6].id == "one\u0001two")
    and (.[7].id == "q\"uote\\slash")
  ' <<<"$output" >/dev/null
}

@test "batch handles a multi-line quote without disturbing its siblings" {
  local payload
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  payload="$(
    row multi src/a.txt 2 $'alpha line one\nthe quoted target line'
    row good src/a.txt 2 'the quoted target line'
  )"
  run bash "$QG" batch <<<"$payload"
  [ "$status" -eq 0 ]
  jq -e -s '
    length == 2
    and (.[0].id == "multi" and .[0].result == "ungrounded")
    and (.[1].id == "good" and .[1].result == "grounded" and .[1].matched_line == 2)
  ' <<<"$output" >/dev/null
}

@test "batch grounds under mawk as the awk on PATH" {
  local mawk shim
  mawk="$(command -v mawk)" || skip "mawk is not installed"
  shim="${BASE}/shim"
  mkdir -p "$shim"
  ln -s "$mawk" "$shim/awk"
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  PATH="$shim:$PATH" run bash "$QG" batch <<<"$(row m src/a.txt 2 'the quoted target line')"
  [ "$status" -eq 0 ]
  jq -e '.id == "m" and .result == "grounded" and .matched_line == 2' <<<"$output" >/dev/null
}

@test "a redaction failure exits 2 with no result in check and in batch" {
  local shim
  shim="${BASE}/shim"
  mkdir -p "$shim"
  printf '#!/bin/sh\nexit 1\n' >"$shim/sed"
  chmod +x "$shim/sed"
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  PATH="$shim:$PATH" run bash "$QG" check src/a.txt 2 <<<"the quoted target line"
  [ "$status" -eq 2 ]
  [[ "$output" != "2" ]]
  PATH="$shim:$PATH" run bash "$QG" batch <<<"$(row r src/a.txt 2 'the quoted target line')"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
}

@test "no run leaves a temp file behind, so unredacted text never reaches disk" {
  local tmp
  tmp="${BASE}/tmp"
  mkdir -p "$tmp"
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  TMPDIR="$tmp" run bash "$QG" check src/a.txt 2 <<<"the quoted target line"
  [ "$status" -eq 0 ]
  TMPDIR="$tmp" run bash "$QG" batch <<<"$(row t src/a.txt 2 'the quoted target line')"
  [ "$status" -eq 0 ]
  TMPDIR="$tmp" run bash "$QG" batch <<<'not json'
  [ "$status" -eq 2 ]
  [ -z "$(ls -A "$tmp")" ]
}

@test "batch of 100 findings across 20 files grounds every row within the deadline" {
  local f n id quote payload out start elapsed
  payload="${BASE}/payload.jsonl"
  out="${BASE}/out.jsonl"
  for f in $(seq 1 20); do
    : >"src/f${f}.txt"
    for n in 1 2 3 4 5; do
      printf 'f%02d-line%d token body xx\n' "$f" "$n" >>"src/f${f}.txt"
      id=$(printf 'f%02d-%d' "$f" "$n")
      quote=$(printf 'f%02d-line%d token body xx' "$f" "$n")
      row "$id" "src/f${f}.txt" "$n" "$quote" >>"$payload"
    done
  done
  start=$(now_ms)
  bash "$QG" batch <"$payload" >"$out"
  elapsed=$(($(now_ms) - start))
  jq -e -s '
    length == 100
    and all(.result == "grounded" and ((.matched_line | tostring) == (.id | split("-")[1])))
  ' <"$out" >/dev/null
  # The plan's deadline is 2 s; the clock here may only tick in whole seconds.
  if [ "$elapsed" -ge 2000 ]; then
    printf 'batch elapsed %s ms\n' "$elapsed" >&2
    return 1
  fi
}
