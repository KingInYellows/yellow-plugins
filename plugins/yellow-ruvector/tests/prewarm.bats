#!/usr/bin/env bats
# prewarm.bats — the SessionStart prewarm hook's install decision. npm is
# stubbed to record that a (re)install was attempted; nothing is fetched.

bats_require_minimum_version 1.5.0

SRC_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup() {
  command -v node >/dev/null || skip "node not installed"
  export HOME="$BATS_TEST_TMPDIR/home"
  # The plugin root must pass validate_paths (under HOME or /tmp).
  PLUGIN_ROOT="$BATS_TEST_TMPDIR/plugin"
  mkdir -p "$PLUGIN_ROOT"
  cp -R "$SRC_ROOT/lib" "$SRC_ROOT/hooks" "$SRC_ROOT/package.json" "$SRC_ROOT/package-lock.json" "$PLUGIN_ROOT/"
  HOOK="$PLUGIN_ROOT/hooks/scripts/prewarm.sh"
  LIB="$PLUGIN_ROOT/lib/install-ruvector.sh"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data"
  mkdir -p "$HOME" "$CLAUDE_PLUGIN_DATA" "$BATS_TEST_TMPDIR/bin"
  printf '#!/bin/sh\n: > "%s/npm-called"\nexit 1\n' "$BATS_TEST_TMPDIR" > "$BATS_TEST_TMPDIR/bin/npm"
  chmod +x "$BATS_TEST_TMPDIR/bin/npm"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  hash=$(bash -c '. "$1"; yellow_ruvector_lock_hash' _ "$LIB")
  [ -n "$hash" ]
  mkdir -p "$CLAUDE_PLUGIN_DATA/install-$hash/node_modules/ruvector/bin"
  ln -s "install-$hash" "$CLAUDE_PLUGIN_DATA/current"
  models="$HOME/.ruvector/models/all-MiniLM-L6-v2"
  mkdir -p "$models"
  printf 'x' > "$models/model.onnx"; printf '{}' > "$models/tokenizer.json"
  bash -c '. "$1"; yellow_ruvector_data_dir; yellow_ruvector_model_fingerprint > "$RUVECTOR_DATA/model-verified"' _ "$LIB"
}

cli() { printf '%s\n' "$1" > "$CLAUDE_PLUGIN_DATA/install-$hash/node_modules/ruvector/bin/cli.js"; }

# Wait up to $1 seconds for the background job to call npm.
npm_called_within() {
  local i
  for i in $(seq 1 $(( $1 * 10 ))); do
    [ -e "$BATS_TEST_TMPDIR/npm-called" ] && return 0
    sleep 0.1
  done
  return 1
}

@test "a healthy install with a verified model is left alone" {
  cli 'console.log("0.3.3")'
  run bash "$HOOK" </dev/null
  [ "$status" -eq 0 ]
  ! npm_called_within 1 || false
}

@test "an install whose entry no longer runs is reinstalled" {
  cli 'process.exit(1)'
  run bash "$HOOK" </dev/null
  [ "$status" -eq 0 ]
  npm_called_within 5
}

@test "with the hash embedder selected, an uncached model is not warmed" {
  cli 'console.log("0.3.3")'
  rm -f "$CLAUDE_PLUGIN_DATA/model-verified"
  RUVECTOR_EMBEDDER=hash run bash "$HOOK" </dev/null
  [ "$status" -eq 0 ]
  # The fast path exits without taking the install lock.
  [ ! -e "$CLAUDE_PLUGIN_DATA/.install.lock" ]
  RUVECTOR_ONNX=0 run bash "$HOOK" </dev/null
  [ ! -e "$CLAUDE_PLUGIN_DATA/.install.lock" ]
}

@test "session-start skips recall until the ONNX model is verified (never races prewarm)" {
  proj="$BATS_TEST_TMPDIR/proj"; mkdir -p "$proj/.ruvector"
  cli "require('fs').writeFileSync('$BATS_TEST_TMPDIR/recall-ran', ''); console.log('0.3.3')"
  SS="$PLUGIN_ROOT/hooks/scripts/session-start.sh"
  rm -f "$CLAUDE_PLUGIN_DATA/model-verified"
  run bash -c 'cd "$1" && printf "{\"cwd\":\"%s\"}" "$1" | CLAUDE_PROJECT_DIR="$1" bash "$2"' _ "$proj" "$SS"
  [ "$status" -eq 0 ]
  [ ! -e "$BATS_TEST_TMPDIR/recall-ran" ]
  # Once verified (as prewarm's warm-up records it), recall runs.
  bash -c '. "$1"; yellow_ruvector_data_dir; yellow_ruvector_model_fingerprint > "$RUVECTOR_DATA/model-verified"' _ "$LIB"
  run bash -c 'cd "$1" && printf "{\"cwd\":\"%s\"}" "$1" | CLAUDE_PROJECT_DIR="$1" bash "$2"' _ "$proj" "$SS"
  [ "$status" -eq 0 ]
  [ -e "$BATS_TEST_TMPDIR/recall-ran" ]
}

@test "the background job releases the lock it was handed, even without BASHPID (bash 3.2)" {
  cli 'console.log("0.3.3")'
  rm -f "$CLAUDE_PLUGIN_DATA/model-verified"
  # BASHPID unset stands in for macOS's bash 3.2; the warm-up fails fast.
  run bash -c 'unset BASHPID; . "$1"' _ "$HOOK" </dev/null
  [ "$status" -eq 0 ]
  for _ in $(seq 1 50); do [ -e "$CLAUDE_PLUGIN_DATA/.install.lock" ] || break; sleep 0.1; done
  [ ! -e "$CLAUDE_PLUGIN_DATA/.install.lock" ]
}

@test "the background job never takes over a lock its parent did not hand it" {
  cli 'console.log("0.3.3")'
  rm -f "$CLAUDE_PLUGIN_DATA/model-verified"
  sleep 30 & foreign=$!
  # The hook parent dies right after spawning the job, and before writing
  # the job's pid, a concurrent launcher reclaims the lock and names itself.
  FOREIGN=$foreign run bash -c 'disown() { printf "%s" "$FOREIGN" > "$CLAUDE_PLUGIN_DATA/.install.lock/pid"; exit 0; }; . "$1"' _ "$HOOK" </dev/null
  [ "$status" -eq 0 ]
  sleep 4
  [ "$(cat "$CLAUDE_PLUGIN_DATA/.install.lock/pid" 2>/dev/null)" = "$foreign" ]
  kill "$foreign" 2>/dev/null || true
}

@test "a live installer's lock ends prewarm at once, inside its 5s hook timeout" {
  # A CLI that ignores TERM would hold the health probe for its full budget
  # plus the KILL grace, and the lock wait would come on top.
  cli "process.on('SIGTERM', () => {}); setTimeout(() => {}, 10000);"
  rm -f "$CLAUDE_PLUGIN_DATA/model-verified"
  sleep 31 & holder=$!
  bash -c '. "$1"; yellow_ruvector_data_dir; mkdir "$RUVECTOR_DATA/.install.lock"
    yellow_ruvector_stamp_pid "$RUVECTOR_DATA/.install.lock" "$2"
    printf %s "$2" > "$RUVECTOR_DATA/.install.lock/pid"' _ "$LIB" "$holder"
  start=$(date +%s%N)
  run bash "$HOOK" < /dev/null
  elapsed=$(( ($(date +%s%N) - start) / 1000000 ))
  kill "$holder" 2>/dev/null || true
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' >/dev/null
  [ "$elapsed" -lt 1500 ]
  [ ! -e "$BATS_TEST_TMPDIR/npm-called" ]
}
