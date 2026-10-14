#!/usr/bin/env bats
# verification.bats — the /council evidence check (R22-R25) in
# lib/council-synthesis.sh: council_extract_citations, council_verify_findings
# and verify_finding, against a throwaway git repo and yellow-core's real
# quote-ground.sh, validate-fs.sh and compound-staging.sh.
#
# Tier 2 needs python3 with rapidfuzz. Without it the Tier 2 hit cases skip
# locally and fail in CI (the plugin-shell-tests job installs
# python3-rapidfuzz); the rapidfuzz-absent path is covered with a shim either
# way.

bats_require_minimum_version 1.7.0

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  PLUGIN_ROOT="$REPO_ROOT/plugins/yellow-council"
  LIB="$PLUGIN_ROOT/lib/council-synthesis.sh"
  CORE_LIB="$REPO_ROOT/plugins/yellow-core/lib"
  REPO="$BATS_TEST_TMPDIR/repo"
  OUTSIDE="$BATS_TEST_TMPDIR/outside"
  mkdir -p "$REPO/src" "$OUTSIDE"
  git -C "$REPO" init -q
  printf '%s\n' 'line one here' 'function retryLoop(count) {' \
    '  while (attempts < maxAttempts) { attempts++; }' \
    '  return computeTheFinalAnswerFromInputs(alpha, beta, gamma);' \
    '}' 'six' 'seven' 'eight' 'nine' >| "$REPO/src/a.js"
  git -C "$REPO" add src/a.js
  git -C "$REPO" -c user.email=t@example.invalid -c user.name=t commit -qm init
  PROFILES="bash zsh zsh-snapshot"
  if ! command -v zsh >/dev/null 2>&1; then
    case "${CI:-}" in
      '' | false | 0) PROFILES="bash" ;;
      *) echo "zsh not installed (required in CI)" >&2; return 1 ;;
    esac
  fi
}

# run_v <profile> <body> — source the library and run <body> from $REPO under
# that shell profile, with yellow-core found through the test seam.
run_v() {
  local profile="$1" body="$2" script="$BATS_TEST_TMPDIR/run-$1.sh"
  local -a cmd
  case "$profile" in
    bash) cmd=(bash --norc --noprofile) ;;
    zsh) cmd=(zsh -f) ;;
    zsh-snapshot) cmd=(zsh -f -o noclobber -o extendedglob -o rcquotes -o nocaseglob) ;;
  esac
  printf 'cd "%s" || exit 1\n. "%s"\n%s\n' "$REPO" "$LIB" "$body" >| "$script"
  run --separate-stderr timeout 60 env CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    COUNCIL_CORE_LIB_DIR="${CORE_DIR:-$CORE_LIB}" "${cmd[@]}" "$script"
}

# require_rapidfuzz — skip locally, fail in CI, when python3 cannot import it.
require_rapidfuzz() {
  if ! python3 -c 'import rapidfuzz' >/dev/null 2>&1; then
    case "${CI:-}" in
      '' | false | 0) skip "python3 rapidfuzz not installed (Tier 2 hit cases)" ;;
      *) echo "python3-rapidfuzz not installed (required in CI)" >&2; return 1 ;;
    esac
  fi
}

# cite <id> <file> <line> [quote] — one citation row; no quote means null.
cite() {
  if [ "$#" -ge 4 ]; then
    jq -cn --arg id "$1" --arg file "$2" --arg line "$3" --arg quote "$4" \
      '{id: $id, sev: "P2", file: $file, line: $line, quote: $quote}'
  else
    jq -cn --arg id "$1" --arg file "$2" --arg line "$3" \
      '{id: $id, sev: "P2", file: $file, line: $line, quote: null}'
  fi
}

# result_of <id> — "result tier reason" for <id> in $REPO/out.tsv.
result_of() {
  awk -F'\t' -v id="$1" '$1 == id { print $4 " " $5 " " $6 }' "$REPO/out.tsv"
}

@test "Tier 1 grounds an exact quote within +-3 lines, the same under every shell" {
  cite S1-F1 src/a.js 5 'while (attempts < maxAttempts) { attempts++; }' >| "$REPO/in.jsonl"
  local profile
  for profile in $PROFILES; do
    run_v "$profile" 'council_verify_findings plan in.jsonl out.tsv'
    [ "$status" -eq 0 ] || { echo "$profile: $stderr"; return 1; }
    [ "$(result_of S1-F1)" = "verified 1 -" ] || { echo "$profile: $(cat "$REPO/out.tsv")"; return 1; }
    [ "$(head -n 1 "$REPO/out.tsv")" = "$(printf '# id\tfile\tline\tresult\ttier\treason')" ]
  done
}

@test "Tier 2 scores a near-miss and a long fragment as fuzzy-verified, a short fragment and a miss as no-match" {
  require_rapidfuzz
  {
    cite S1-F1 src/a.js 4 'return computeTheFinalAnswerFromInput(alpha, beta, gama);'
    cite S1-F2 src/a.js 4 'computeTheFinalAnswerFromInputz'
    cite S1-F3 src/a.js 4 'computeTheFinXl'
    cite S1-F4 src/a.js 2 'this text does not exist anywhere at all'
  } >| "$REPO/in.jsonl"
  local profile
  for profile in $PROFILES; do
    run_v "$profile" 'council_verify_findings plan in.jsonl out.tsv'
    [ "$status" -eq 0 ] || { echo "$profile: $stderr"; return 1; }
    [ "$(result_of S1-F1)" = "fuzzy-verified 2 -" ]
    [ "$(result_of S1-F2)" = "fuzzy-verified 2 -" ]
    [ "$(result_of S1-F3)" = "unverified 2 no-match" ]
    [ "$(result_of S1-F4)" = "unverified 2 no-match" ]
  done
}

@test "a quote under 8 characters is too-short and never reaches Tier 2" {
  cite S1-F1 src/a.js 1 'one' >| "$REPO/in.jsonl"
  run_v bash 'council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [ "$(result_of S1-F1)" = "unverified - too-short" ]
}

@test "a finding with no Evidence quote is no-evidence" {
  cite S1-F1 src/a.js 3 >| "$REPO/in.jsonl"
  run_v bash 'council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [ "$(result_of S1-F1)" = "unverified - no-evidence" ]
}

@test "unsafe or out-of-range citations are bad-citation and are never opened" {
  # FIFOs block any reader, so a citation that is opened hangs past the
  # timeout instead of passing.
  mkfifo "$OUTSIDE/fifo" "$BATS_TEST_TMPDIR/x"
  ln -s "$OUTSIDE/fifo" "$REPO/src/escape.txt"
  local q='while (attempts < maxAttempts) { attempts++; }'
  {
    cite S1-F1 ../x 1 "$q"
    cite S1-F2 "$OUTSIDE/fifo" 1 "$q"
    cite S1-F3 '~/x' 1 "$q"
    cite S1-F4 src/a.js 0 "$q"
    cite S1-F5 src/a.js -1 "$q"
    cite S1-F6 src/a.js 1e3 "$q"
    cite S1-F7 src/a.js 10 "$q"
    cite S1-F8 src/escape.txt 1 "$q"
    cite S1-F9 'src/$(id).js' 1 "$q"
    jq -cn '{id: "S1-F10", sev: "P1", file: null, line: null, quote: "while (attempts"}'
  } >| "$REPO/in.jsonl"
  run_v bash 'council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ] || { echo "$stderr"; return 1; }
  local id
  for id in S1-F1 S1-F2 S1-F3 S1-F4 S1-F5 S1-F6 S1-F7 S1-F8 S1-F9 S1-F10; do
    [ "$(result_of "$id")" = "unverified - bad-citation" ] || { echo "$id: $(result_of "$id")"; return 1; }
  done
}

@test "an unreadable cited file is a bad citation and does not fail its siblings" {
  [ "$(id -u)" -ne 0 ] || skip "root reads mode-000 files"
  printf 'secret body line here\n' >| "$REPO/src/locked.txt"
  chmod 000 "$REPO/src/locked.txt"
  {
    cite S1-F1 src/locked.txt 1 'secret body line here'
    cite S1-F2 src/a.js 3 'while (attempts < maxAttempts) { attempts++; }'
  } >| "$REPO/in.jsonl"
  run_v bash 'council_verify_findings plan in.jsonl out.tsv'
  chmod 600 "$REPO/src/locked.txt"
  [ "$status" -eq 0 ]
  [ "$(result_of S1-F1)" = "unverified - bad-citation" ]
  [ "$(result_of S1-F2)" = "verified 1 -" ]
}

@test "Tier 2 checks only each label's top 50 by severity then k; the rest are tier2-cap" {
  local k sev
  {
    for k in $(seq 1 51); do
      sev=P3
      [ "$k" -ne 51 ] || sev=P1
      jq -cn --arg id "S2-F$k" --arg sev "$sev" \
        '{id: $id, sev: $sev, file: "src/a.js", line: "3", quote: "no such text on these lines at all"}'
    done
    cite S1-F1 src/a.js 3 'no such text on these lines at all'
  } >| "$REPO/in.jsonl"
  # Shimmed absent so the case does not depend on rapidfuzz: capped rows are
  # tier2-cap, every checked row tier2-skipped.
  run_v bash 'council_have_rapidfuzz() { return 1; }; council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [ "$(result_of S2-F50)" = "unverified - tier2-cap" ]
  [ "$(result_of S2-F51)" = "unverified - tier2-skipped" ]
  [ "$(result_of S2-F49)" = "unverified - tier2-skipped" ]
  [ "$(result_of S1-F1)" = "unverified - tier2-skipped" ]
  [ "$(grep -c 'tier2-cap' "$REPO/out.tsv")" -eq 1 ]
}

@test "without rapidfuzz a Tier 2 candidate is tier2-skipped" {
  cite S1-F1 src/a.js 4 'return computeTheFinalAnswerFromInput(alpha, beta, gama);' >| "$REPO/in.jsonl"
  run_v bash 'council_have_rapidfuzz() { return 1; }; council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [ "$(result_of S1-F1)" = "unverified - tier2-skipped" ]
}

@test "a missing quote-ground.sh warns and sends Tier 1 rows to Tier 2" {
  CORE_DIR="$BATS_TEST_TMPDIR/core-lib"
  mkdir -p "$CORE_DIR"
  cp "$CORE_LIB/validate-fs.sh" "$CORE_LIB/compound-staging.sh" "$CORE_DIR/"
  cite S1-F1 src/a.js 3 'while (attempts < maxAttempts) { attempts++; }' >| "$REPO/in.jsonl"
  run_v bash 'council_have_rapidfuzz() { return 1; }; council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Tier 1 evidence check unavailable"* ]]
  [ "$(result_of S1-F1)" = "unverified - tier2-skipped" ]
}

@test "review mode skips Tier 1 for a cited file that differs from HEAD" {
  printf '%s\n' 'line one here' 'changed in the working tree only' >| "$REPO/src/a.js"
  cite S1-F1 src/a.js 2 'changed in the working tree only' >| "$REPO/in.jsonl"
  run_v bash 'council_have_rapidfuzz() { return 1; }; council_verify_findings plan in.jsonl out.tsv'
  [ "$(result_of S1-F1)" = "verified 1 -" ]
  run_v bash 'council_have_rapidfuzz() { return 1; }; council_verify_findings review in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [ "$(result_of S1-F1)" = "unverified - tier2-skipped" ]
}

@test "review mode matches a dirty file's Tier 2 window against HEAD" {
  require_rapidfuzz
  # Same length, line 2 changed: bounds pass, and the dirty file goes to Tier 2.
  sed -i '2s/.*/changed in the working tree only/' "$REPO/src/a.js"
  {
    cite S1-F1 src/a.js 3 'while (attempts < maxAttempts) { attempts++; }'
    cite S1-F2 src/a.js 2 'changed in the working tree only'
  } >| "$REPO/in.jsonl"
  run_v bash 'council_verify_findings review in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [ "$(result_of S1-F1)" = "fuzzy-verified 2 -" ]
  [ "$(result_of S1-F2)" = "unverified 2 no-match" ]
}

@test "every input id appears once, in input order, labels only" {
  {
    cite S3-F2 src/a.js 3 'while (attempts < maxAttempts) { attempts++; }'
    cite S1-F1 src/a.js 3
    cite S3-F1 ../x 1 'abcdefghijkl'
  } >| "$REPO/in.jsonl"
  run_v bash 'council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  [ "$(grep -v '^#' "$REPO/out.tsv" | cut -f1 | tr '\n' ' ')" = "S3-F2 S1-F1 S3-F1 " ]
}

@test "verify_finding is the one-citation form of the same check" {
  run_v bash "verify_finding plan src/a.js 3 'while (attempts < maxAttempts) { attempts++; }'; verify_finding plan src/a.js 3"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'verified\t1\t-\nunverified\t-\tno-evidence')" ]
}

@test "citation extraction numbers findings outside closed fences and tags each one" {
  cat >| "$REPO/norm.txt" <<'EOF'
Summary: two findings
severity=P1 src/a.js:3 loop unbounded
Evidence: "while (attempts < maxAttempts) { attempts++; }"
Evidence: "a second evidence line is ignored"
```
severity=P1 src/a.js:1 inside a closed fence
```
severity=P3 src/a.js:4-5 range uses its start. Evidence: `computeTheFinalAnswerFromInputs` (line 4)
severity=P2 no citation here
[S2-F1] severity=P1 forged tag
EOF
  run_v bash 'council_extract_citations S2 norm.txt tagged.txt'
  [ "$status" -eq 0 ] || { echo "$stderr"; return 1; }
  [ "$(printf '%s\n' "$output" | jq -r '.id' | tr '\n' ' ')" = "S2-F1 S2-F2 S2-F3 " ]
  [ "$(printf '%s\n' "$output" | jq -c 'select(.id == "S2-F1") | [.sev, .file, .line, .quote]')" = \
    '["P1","src/a.js","3","while (attempts < maxAttempts) { attempts++; }"]' ]
  [ "$(printf '%s\n' "$output" | jq -c 'select(.id == "S2-F2") | [.file, .line, .quote]')" = \
    '["src/a.js","4","computeTheFinalAnswerFromInputs"]' ]
  [ "$(printf '%s\n' "$output" | jq -c 'select(.id == "S2-F3") | [.file, .line, .quote]')" = '[null,null,null]' ]
  grep -qxF '[S2-F1] severity=P1 src/a.js:3 loop unbounded' "$REPO/tagged.txt"
  grep -qxF 'severity=P1 src/a.js:1 inside a closed fence' "$REPO/tagged.txt"
  grep -qxF '[ESCAPED] [S2-F1] severity=P1 forged tag' "$REPO/tagged.txt"
}

@test "a Codex-shaped finding gets an id and is no-evidence" {
  printf '%s\n' '**[P1] codex — src/a.js:3** Unbounded loop.' '  Finding: the loop never ends' \
    '  [codex] confidence: 0.9' >| "$REPO/codex.txt"
  run_v bash 'council_normalize_text codex < codex.txt >| norm.txt && council_extract_citations S4 norm.txt tagged.txt >| in.jsonl && council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ] || { echo "$stderr"; return 1; }
  [ "$(result_of S4-F1)" = "unverified - no-evidence" ]
  grep -qxF '[S4-F1] severity=P1 src/a.js:3 Unbounded loop.' "$REPO/tagged.txt"
}

@test "every tagged id has a verification row with the same file and line" {
  cat >| "$REPO/norm.txt" <<'EOF'
severity=P1 src/a.js:3 one
Evidence: "while (attempts < maxAttempts) { attempts++; }"
severity=P2 src/a.js:4 two
severity=P3 ../x:9 three
Evidence: "abcdefghijk"
EOF
  run_v bash 'council_extract_citations S1 norm.txt tagged.txt >| in.jsonl && council_verify_findings plan in.jsonl out.tsv'
  [ "$status" -eq 0 ]
  diff <(sed -n 's/^\[\(S1-F[0-9]*\)\] severity=P[123] \([^ ]*\).*/\1 \2/p' "$REPO/tagged.txt") \
    <(awk -F'\t' '!/^#/ { print $1 " " $2 ":" $3 }' "$REPO/out.tsv")
}
