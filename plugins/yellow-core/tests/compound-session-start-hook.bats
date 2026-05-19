#!/usr/bin/env bats
# Tests for hooks/scripts/session-start.sh — drain dispatcher.

SS_HOOK="$BATS_TEST_DIRNAME/../hooks/scripts/session-start.sh"

setup() {
  STAGING_TEST_HOME="$(mktemp -d)"
  export HOME="$STAGING_TEST_HOME"

  PROJECT_DIR=$(mktemp -d)

  # Stub for `claude -p`: a script that records its invocation to a marker file.
  STUB_DIR=$(mktemp -d)
  STUB_MARKER="$STUB_DIR/claude-invoked"
  STUB_BIN="$STUB_DIR/claude"
  cat > "$STUB_BIN" <<'STUB'
#!/usr/bin/env bash
# Record that we were invoked and exit fast.
printf 'invoked with args: %s\n' "$*" > "$STUB_MARKER_PATH"
printf '{"result": "stub", "is_error": false}\n'
exit 0
STUB
  sed -i "s|\$STUB_MARKER_PATH|$STUB_MARKER|g" "$STUB_BIN" 2>/dev/null \
    || sed -i.bak "s|\$STUB_MARKER_PATH|$STUB_MARKER|g" "$STUB_BIN"
  rm -f "$STUB_BIN.bak"
  chmod +x "$STUB_BIN"

  export COMPOUND_DRAIN_CMD="$STUB_BIN"

  # Resolve the staging dir the hook will use.
  . "$BATS_TEST_DIRNAME/../lib/compound-staging.sh"
  PROJECT_SLUG=$(cs_derive_project_slug "$PROJECT_DIR")
  STAGING="$(cs_staging_dir_for_slug "$PROJECT_SLUG")"
}

teardown() {
  for d in "$STAGING_TEST_HOME" "$PROJECT_DIR" "$STUB_DIR"; do
    if [ -n "${d:-}" ] && [ -d "$d" ]; then
      rm -rf "$d"
    fi
  done
  unset COMPOUND_DRAIN_CMD
}

_stdin_json() {
  jq -nc --arg c "$PROJECT_DIR" '{cwd: $c}'
}

# Wait briefly for the drain subshell to start the stub.
_wait_for_stub() {
  local timeout="${1:-3}" elapsed=0
  while [ ! -f "$STUB_MARKER" ] && [ "$elapsed" -lt "$timeout" ]; do
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
}

# Plant N pending entries with current mtime.
_plant_pending() {
  local n="$1"
  mkdir -p "$STAGING/pending"
  for i in $(seq 1 "$n"); do
    printf '{"schema":"1","session_id":"s%s","transcript_tail":"x"}\n' "$i" \
      > "$STAGING/pending/s$i.jsonl"
  done
}

# --- Recursion guard ---

@test "session-start exits silently when COMPOUND_DRAIN_IN_PROGRESS=1" {
  _plant_pending 10
  run env COMPOUND_DRAIN_IN_PROGRESS=1 bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"continue": true'
  sleep 0.5
  [ ! -f "$STUB_MARKER" ]
}

# --- First-run fast exit ---

@test "session-start fast-exits when pending dir missing" {
  # No staging dir created yet.
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"continue": true'
  sleep 0.3
  [ ! -f "$STUB_MARKER" ]
}

# --- Zero pending ---

@test "session-start does not dispatch when no pending entries" {
  mkdir -p "$STAGING/pending"
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  sleep 0.3
  [ ! -f "$STUB_MARKER" ]
}

# --- Threshold: count ---

@test "session-start dispatches when count >= 5" {
  _plant_pending 5
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"continue": true'
  _wait_for_stub 3
  [ -f "$STUB_MARKER" ]
}

@test "session-start does NOT dispatch at count=4" {
  _plant_pending 4
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  sleep 0.5
  # No dispatch because count<5 and entries are fresh (mtime ~now).
  [ ! -f "$STUB_MARKER" ]
}

# --- Threshold: age ---

@test "session-start dispatches when single entry > 48h old" {
  _plant_pending 1
  # Backdate by 49 hours.
  touch -t "$(date -d '49 hours ago' +%Y%m%d%H%M 2>/dev/null \
    || date -v-49H +%Y%m%d%H%M)" "$STAGING/pending/s1.jsonl"
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  _wait_for_stub 3
  [ -f "$STUB_MARKER" ]
}

# --- Drain lock ---

@test "session-start respects existing .drain-lock" {
  _plant_pending 5
  mkdir -p "$STAGING/.drain-lock"
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  sleep 0.5
  [ ! -f "$STUB_MARKER" ]
  # Lock untouched.
  [ -d "$STAGING/.drain-lock" ]
}

@test "session-start reaps a stale .drain-lock (>30min) and dispatches" {
  _plant_pending 5
  mkdir -p "$STAGING/.drain-lock"
  # Backdate lock by 35 minutes.
  touch -t "$(date -d '35 minutes ago' +%Y%m%d%H%M 2>/dev/null \
    || date -v-35M +%Y%m%d%H%M)" "$STAGING/.drain-lock"
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  _wait_for_stub 3
  [ -f "$STUB_MARKER" ]
}

# --- PII TTL reaper ---

@test "session-start reaps pending entries older than 7 days" {
  _plant_pending 1
  touch -t "$(date -d '10 days ago' +%Y%m%d%H%M 2>/dev/null \
    || date -v-10d +%Y%m%d%H%M)" "$STAGING/pending/s1.jsonl"
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  # The TTL reaper deleted s1.jsonl; with 0 pending afterwards, no dispatch.
  [ ! -f "$STAGING/pending/s1.jsonl" ]
}

# --- Crashed processing/ retry ---

@test "session-start requeues crashed processing entries > 1h old" {
  mkdir -p "$STAGING/pending" "$STAGING/processing"
  printf '{"schema":"1","session_id":"crashed","transcript_tail":"x"}\n' \
    > "$STAGING/processing/crashed.jsonl"
  touch -t "$(date -d '2 hours ago' +%Y%m%d%H%M 2>/dev/null \
    || date -v-2H +%Y%m%d%H%M)" "$STAGING/processing/crashed.jsonl"
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  # File moved from processing/ to pending/.
  [ -f "$STAGING/pending/crashed.jsonl" ]
  [ ! -f "$STAGING/processing/crashed.jsonl" ]
}

# --- Orphan tmp reaper ---

@test "session-start reaps orphan tmp files > 60min old" {
  mkdir -p "$STAGING/pending" "$STAGING/tmp"
  touch "$STAGING/tmp/orphan.jsonl.tmp.123"
  touch -t "$(date -d '90 minutes ago' +%Y%m%d%H%M 2>/dev/null \
    || date -v-90M +%Y%m%d%H%M)" "$STAGING/tmp/orphan.jsonl.tmp.123"
  bash "$SS_HOOK" <<< "$(_stdin_json)" >/dev/null
  [ ! -f "$STAGING/tmp/orphan.jsonl.tmp.123" ]
}

# --- Output contract ---

@test "session-start always outputs {continue: true} JSON" {
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  echo "$output" | jq -e '.continue == true' >/dev/null
}
