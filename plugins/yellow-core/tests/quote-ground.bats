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
  cd / || true
  if [ -n "${BASE:-}" ] && [ -d "$BASE" ]; then
    rm -rf "$BASE"
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
  [ "$elapsed" -lt 2000 ]
  jq -e -s '
    length == 100
    and all(.result == "grounded" and ((.matched_line | tostring) == (.id | split("-")[1])))
  ' <"$out" >/dev/null
  rm -f "$payload" "$out"
}
