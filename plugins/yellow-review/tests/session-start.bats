#!/usr/bin/env bats
# Tests for hooks/scripts/session-start.sh: the review-ledger notice. The
# hook reads only sidecars (and folds within budget), must always print
# valid JSON with continue:true, and must never print ledger text.

bats_require_minimum_version 1.5.0

load helpers/ledger-repo

HOOK="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/hooks/scripts/session-start.sh"

setup() {
  ledger_repo_init
  printf 'one\ntwo\nthree\nfour\n' >|a.sh
  BASE=$(commit_all base)
  export CLAUDE_PROJECT_DIR="$REPO"
}

hook() { run --separate-stderr bash "$HOOK"; }

@test "no repository or no ledger dir: bare continue" {
  CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR" hook
  [ "$status" -eq 0 ]
  [ "$output" = '{"continue": true}' ]
  hook
  [ "$output" = '{"continue": true}' ]
}

@test "counts pending and attention across PRs, with PR numbers only" {
  observe "$BASE" "[$(finding a.sh 1 '{"title":"SECRET-TITLE-TEXT"}'), $(finding a.sh 2 '{"owner":"human"}')]" >/dev/null
  LEDGER_PR=34 observe "$BASE" "[$(finding a.sh 3)]" >/dev/null
  hook
  [ "$status" -eq 0 ]
  printf '%s' "$output" | jq -e '.continue == true' >/dev/null
  msg=$(printf '%s' "$output" | jq -r '.systemMessage')
  [[ "$msg" == "[yellow-review] Review ledger: 2 pending, 1 need attention (PRs #12, #34). Run /review:triage 12." ]]
  [[ "$output" != *SECRET-TITLE-TEXT* ]]
  printf '%s' "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null
}

@test "fixed and dismissed records do not count even though the file is non-empty" {
  observe "$BASE" "[$(finding a.sh 1), $(finding a.sh 2)]" >/dev/null
  mapfile -t id < <(ids)
  transition "${id[0]}" dismissed --reason no >/dev/null
  transition "${id[1]}" applied >/dev/null
  transition "${id[1]}" applied --fix-sha "$BASE" >/dev/null
  transition "${id[1]}" fixed >/dev/null
  [ -s "$LEDGER_DIR/$LEDGER_PR.jsonl" ]
  hook
  [ "$output" = '{"continue": true}' ]
}

@test "an orphan sidecar without its ledger is ignored" {
  observe "$BASE" "[$(finding a.sh 1)]" >/dev/null
  mv "$LEDGER_DIR/$LEDGER_PR.jsonl" "$BATS_TEST_TMPDIR/"
  hook
  [ "$output" = '{"continue": true}' ]
}

@test "a stale or non-OPEN state names the PR as unverified instead of counting it" {
  observe "$BASE" "[$(finding a.sh 1)]" >/dev/null
  printf 'OPEN %s\n' "$(($(date +%s) - 8 * 24 * 3600))" >|"$LEDGER_DIR/$LEDGER_PR.state"
  hook
  [ "$(printf '%s' "$output" | jq -r '.systemMessage')" = "[yellow-review] Review ledger: 0 pending, 0 need attention; unverified: #12. Run /review:triage 12." ]
  printf 'MERGED %s\n' "$(date +%s)" >|"$LEDGER_DIR/$LEDGER_PR.state"
  hook
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"unverified: #12"* ]]
}

@test "a sidecar whose byte count no longer matches falls back to a fold" {
  observe "$BASE" "[$(finding a.sh 1), $(finding a.sh 2)]" >/dev/null
  id=$(ids | head -1)
  # append a dismissal behind the library's back: the sidecar still says 2
  printf '{"v":1,"type":"transition","finding_id":"%s","state":"dismissed"}\n' "$id" >>"$LEDGER_DIR/$LEDGER_PR.jsonl"
  hook
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *": 1 pending, 0 need attention (PRs #12)"* ]]
}

@test "a malformed sidecar is folded, or reported unknown when folding is impossible" {
  observe "$BASE" "[$(finding a.sh 1)]" >/dev/null
  printf 'garbage\n' >|"$LEDGER_DIR/$LEDGER_PR.pending"
  hook
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *": 1 pending"* ]]
  mkdir -p "$BATS_TEST_TMPDIR/notimeout"
  for b in git jq flock sed awk tr cut wc date basename; do ln -sf "$(command -v "$b")" "$BATS_TEST_TMPDIR/notimeout/$b"; done
  run --separate-stderr env PATH="$BATS_TEST_TMPDIR/notimeout" /bin/bash "$HOOK"
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"pending unknown: #12"* ]]
}

@test "a lock held by a writer gives pending unknown within budget" {
  observe "$BASE" "[$(finding a.sh 1)]" >/dev/null
  flock "$LEDGER_DIR/$LEDGER_PR.lock" sleep 5 3>&- &
  holder=$!
  sleep 0.3
  start=$(date +%s%N)
  hook
  elapsed_ms=$((($(date +%s%N) - start) / 1000000))
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
  [ "$elapsed_ms" -lt 3000 ]
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"pending unknown: #12"* ]]
}

@test "a 5 MB ledger with a held lock and a stale sidecar stays under 3 s and valid JSON" {
  observe "$BASE" "[$(finding a.sh 1)]" >/dev/null
  head -c 5200000 /dev/zero | tr '\0' 'x' | command fold -w 1000 | sed 's/^/{"v":1,"type":"note","pad":"/; s/$/"}/' >>"$LEDGER_DIR/$LEDGER_PR.jsonl"
  LEDGER_PR=34 observe "$BASE" "[$(finding a.sh 2)]" >/dev/null
  flock "$LEDGER_DIR/34.lock" sleep 5 3>&- &
  holder=$!
  sleep 0.3
  start=$(date +%s%N)
  hook
  elapsed_ms=$((($(date +%s%N) - start) / 1000000))
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
  [ "$elapsed_ms" -lt 3000 ]
  printf '%s' "$output" | jq -e '.continue == true and (.systemMessage | type == "string")' >/dev/null
}

@test "jq missing: still a bare continue" {
  mkdir -p "$BATS_TEST_TMPDIR/nojq"
  for b in git sed awk tr cut wc date basename; do ln -sf "$(command -v "$b")" "$BATS_TEST_TMPDIR/nojq/$b"; done
  run --separate-stderr env PATH="$BATS_TEST_TMPDIR/nojq" /bin/bash "$HOOK"
  [ "$output" = '{"continue": true}' ]
}
