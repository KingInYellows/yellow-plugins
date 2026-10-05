#!/usr/bin/env bats
# Drives lib/quote-ground.sh from its real bash entry points.
# The quote is always stdin. A stand-in that reads argv, skips the
# length gate, or opens an unsafe path fails these cases.

QG="${BATS_TEST_DIRNAME}/../lib/quote-ground.sh"

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

@test "check refuses to be sourced" {
  run bash -c 'source "$1" && printf sourced-ok\n' bash "$QG"
  [ "$status" -ne 0 ]
  [[ "$output" != *sourced-ok* ]]
}

@test "check exits 2 when validate-fs.sh is missing" {
  local dir
  dir="$(mktemp -d)"
  cp "$QG" "$dir/quote-ground.sh"
  run bash "$dir/quote-ground.sh" check src/a.txt 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  rm -rf "$dir"
}

@test "check exits 2 when compound-staging.sh is not sourced" {
  local dir
  dir="$(mktemp -d)"
  cp "$QG" "$dir/quote-ground.sh"
  cp "${BATS_TEST_DIRNAME}/../lib/validate-fs.sh" "$dir/validate-fs.sh"
  run bash "$dir/quote-ground.sh" check src/a.txt 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  rm -rf "$dir"
}

@test "check exits 2 on usage and on a missing target file" {
  printf '%s\n' 'abcdefghijklmnopqrstuvwxyz' >src/a.txt
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
  run bash "$QG" check src/missing.txt 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
}

@test "check reads the quote from stdin, not from argv" {
  printf '%s\n' 'abcdefghijklmnopqrstuvwxyz' >src/a.txt
  run bash "$QG" check src/a.txt 1 3 'abcdefghijklmnopqrstuvwxyz' <<<"totally-different-quote-text"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/a.txt 1 3 'not-the-quote' <<<"abcdefghijklmnopqrstuvwxyz"
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
  token='ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD'
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
  printf '%s\n' 'abcdefghijklmnopqrstuvwxyz' >src/a.txt
  printf '%s\n' 'abcdefghijklmnopqrstuvwxyz' >"$BASE/outside.txt"
  ln -s "$BASE/outside.txt" src/escape
  mkdir -p src/adir
  printf '%s\n' 'abcdefghijklmnopqrstuvwxyz' >src/adir/hidden.txt
  home="$(mktemp -d)"
  printf '%s\n' 'abcdefghijklmnopqrstuvwxyz' >"$home/secret.txt"

  run bash "$QG" check ../outside.txt 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check "$PROJECT_ROOT/src/a.txt" 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  HOME="$home" run bash "$QG" check '~/secret.txt' 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/escape 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check src/adir 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check $'src/a\nb.txt' 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run bash "$QG" check $'src/a\rb.txt' 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  rm -rf "$home"
}

@test "batch reports every id and still grounds the safe sibling" {
  local payload
  printf '%s\n' 'short abcdefghijklmnopqrstuvwxyz' >src/a.txt
  printf '%s\n' 'short abcdefghijklmnopqrstuvwxyz' >"$BASE/outside.txt"
  payload="$(
    jq -cn --arg id short --arg file src/a.txt --argjson line 1 --arg quote short \
      '{id:$id,file:$file,line:$line,quote:$quote}'
    jq -cn --arg id bad --arg file ../outside.txt --argjson line 1 \
      --arg quote 'short abcdefghijklmnopqrstuvwxyz' \
      '{id:$id,file:$file,line:$line,quote:$quote}'
    jq -cn --arg id miss --arg file src/a.txt --argjson line 1 \
      --arg quote 'not-present-quote-body' \
      '{id:$id,file:$file,line:$line,quote:$quote}'
    jq -cn --arg id good --arg file src/a.txt --argjson line 1 \
      --arg quote abcdefghijklmnopqrstuvwxyz \
      '{id:$id,file:$file,line:$line,quote:$quote}'
  )"
  run bash "$QG" batch <<<"$payload"
  jq -e -s '
    length == 4
    and all(has("id") and has("result") and has("matched_line"))
    and (map(select(.id == "short"))[0].result == "too-short")
    and (map(select(.id == "bad"))[0].result == "unsafe-path")
    and (map(select(.id == "miss"))[0].result == "ungrounded")
    and (map(select(.id == "good"))[0].result == "grounded")
    and (map(select(.id == "good"))[0].matched_line == 1)
  ' <<<"$output" >/dev/null
}

@test "batch of 100 findings across 20 files finishes in under 2 seconds" {
  local f n id quote payload out start end elapsed
  payload="$(mktemp)"
  out="$(mktemp)"
  for f in $(seq 1 20); do
    : >"src/f${f}.txt"
    for n in 1 2 3 4 5; do
      printf 'f%02d-line%d token body xx\n' "$f" "$n" >>"src/f${f}.txt"
      id=$(printf 'f%02d-%d' "$f" "$n")
      quote=$(printf 'f%02d-line%d token body xx' "$f" "$n")
      jq -cn --arg id "$id" --arg file "src/f${f}.txt" --argjson line "$n" --arg quote "$quote" \
        '{id:$id,file:$file,line:$line,quote:$quote}' >>"$payload"
    done
  done
  start=$(date +%s%N)
  bash "$QG" batch <"$payload" >"$out"
  end=$(date +%s%N)
  elapsed=$(((end - start) / 1000000))
  if [ "$elapsed" -ge 2000 ]; then
    printf 'batch elapsed %s ms\n' "$elapsed" >&2
    return 1
  fi
  jq -e -s '
    length == 100
    and all(.result == "grounded" and ((.matched_line | tostring) == (.id | split("-")[1])))
  ' <"$out" >/dev/null
  rm -f "$payload" "$out"
}

@test "check and batch ground a quote when a blank line sits inside the window" {
  printf 'alpha line one\n\nthe quoted target line\nomega\n' >src/a.txt
  run bash "$QG" check src/a.txt 3 <<<"the quoted target line"
  [ "$status" -eq 0 ]
  [ "$output" = "3" ]
  run bash "$QG" batch <<<'{"id":"b","file":"src/a.txt","line":3,"quote":"the quoted target line"}'
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
    printf '%s\n' '{"id":"empty","file":"src/a.txt","line":3,"quote":""}'
    printf '%s\n' '{"id":"blank","file":"src/a.txt","line":3,"quote":"   "}'
    printf '%s\n' '{"id":"good","file":"src/a.txt","line":3,"quote":"the quoted target line"}'
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
  run bash "$QG" check '' 1 3 <<<"abcdefghijklmnopqrstuvwxyz"
  [ "$status" -ne 0 ]
  [[ "$output" != *"bad array subscript"* ]]
  run bash "$QG" batch <<<'{"id":"e","file":"","line":1,"quote":"abcdefghijklmnopqrstuvwxyz"}'
  [ "$status" -eq 0 ]
  jq -e '.id == "e" and .result != "grounded"' <<<"$output" >/dev/null
}

@test "batch grounds under mawk as the awk on PATH" {
  local mawk shim
  mawk="$(command -v mawk)" || skip "mawk is not installed"
  shim="${BASE}/shim"
  mkdir -p "$shim"
  ln -s "$mawk" "$shim/awk"
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  PATH="$shim:$PATH" run bash "$QG" batch <<<'{"id":"m","file":"src/a.txt","line":2,"quote":"the quoted target line"}'
  [ "$status" -eq 0 ]
  jq -e '.id == "m" and .result == "grounded" and .matched_line == 2' <<<"$output" >/dev/null
}

@test "batch exits 2 with no result rows on a malformed row or a NUL in a field" {
  printf '%s\n' 'abcdefghijklmnopqrstuvwxyz' >src/a.txt
  run bash "$QG" batch <<<'{"id":"x","file":"src/a.txt","line":null,"quote":"abcdefghijklmnopqrstuvwxyz"}'
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  run bash "$QG" batch <<<'{"id":"x\u0000y","file":"src/a.txt","line":1,"quote":"abcdefghijklmnopqrstuvwxyz"}'
  [ "$status" -eq 2 ]
  [[ "$output" != *'"result"'* ]]
  run bash "$QG" batch <<<'{"id":"ok","file":"src/a.txt","line":1,"quote":"abcdefghijklmnopqrstuvwxyz"}
{"id":"x","file":"src/a.txt","quote":"abcdefghijklmnopqrstuvwxyz"}'
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

@test "check returns promptly for a very large radius or line number" {
  printf 'alpha line one\nthe quoted target line\nomega\n' >src/a.txt
  run timeout 10 bash "$QG" check src/a.txt 1 999999999 <<<"a quote that is not in the file"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  run timeout 10 bash "$QG" check src/a.txt 3 999999999 <<<"the quoted target line"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
  run timeout 10 bash "$QG" check src/a.txt 999999999 3 <<<"the quoted target line"
  [ "$status" -eq 1 ]
}
