#!/usr/bin/env bats
# Tests for hooks/scripts/stop.sh — pure-shell Stop hook + disowned capture.

STOP_HOOK="$BATS_TEST_DIRNAME/../hooks/scripts/stop.sh"
CAPTURE_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/_stop-capture-subshell.sh"

bats_require_minimum_version 1.5.0

setup() {
  STAGING_TEST_HOME="$(mktemp -d)"
  export HOME="$STAGING_TEST_HOME"

  # Project dir + a fake transcript file.
  PROJECT_DIR=$(mktemp -d)
  TRANSCRIPT_FILE="$PROJECT_DIR/transcript.jsonl"
  SESSION_ID="bats-session-$$"
  : > "$TRANSCRIPT_FILE"
}

teardown() {
  if [ -n "${STAGING_TEST_HOME:-}" ] && [ -d "$STAGING_TEST_HOME" ]; then
    rm -rf "$STAGING_TEST_HOME"
  fi
  if [ -n "${PROJECT_DIR:-}" ] && [ -d "$PROJECT_DIR" ]; then
    rm -rf "$PROJECT_DIR"
  fi
}

# Derive the staging path the hook will write to.
_expected_staging_dir() {
  . "$BATS_TEST_DIRNAME/../lib/compound-staging.sh"
  local slug
  slug=$(cs_derive_project_slug "$PROJECT_DIR")
  cs_staging_dir_for_slug "$slug"
}

# Helper: build stdin JSON for the hook.
_hook_stdin() {
  jq -nc \
    --arg t "$TRANSCRIPT_FILE" \
    --arg s "$SESSION_ID" \
    --arg c "$PROJECT_DIR" \
    '{transcript_path: $t, session_id: $s, cwd: $c, stop_hook_active: false}'
}

# Helper: wait up to N seconds for a file to appear. `timeout` is in seconds.
# Polls every 100ms; converts seconds to deciseconds for the loop bound so
# the wait actually lasts the documented N seconds (the prior version
# counted iterations, waiting 10x less than intended).
_wait_for_file() {
  local path="$1" timeout="${2:-3}" elapsed=0
  local max_iters=$((timeout * 10))
  while [ ! -f "$path" ] && [ "$elapsed" -lt "$max_iters" ]; do
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  [ -f "$path" ]
}

# --- Recursion guard ---

@test "stop hook exits silently when COMPOUND_DRAIN_IN_PROGRESS=1" {
  STAGING=$(_expected_staging_dir)
  run env COMPOUND_DRAIN_IN_PROGRESS=1 bash "$STOP_HOOK" <<< "$(_hook_stdin)"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"continue": true'
  # No staging dir created.
  [ ! -d "$STAGING/pending" ]
}

# --- stop_hook_active guard ---

@test "stop hook exits when stop_hook_active is true" {
  STAGING=$(_expected_staging_dir)
  reentrant=$(jq -nc \
    --arg t "$TRANSCRIPT_FILE" --arg s "$SESSION_ID" --arg c "$PROJECT_DIR" \
    '{transcript_path: $t, session_id: $s, cwd: $c, stop_hook_active: true}')
  run bash "$STOP_HOOK" <<< "$reentrant"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"continue": true'
  [ ! -f "$STAGING/pending/$SESSION_ID.jsonl" ]
}

# --- Capture happy path ---

@test "stop hook captures transcript tail to pending JSONL" {
  printf 'line one\nline two with normal text\n' > "$TRANSCRIPT_FILE"
  STAGING=$(_expected_staging_dir)
  run bash "$STOP_HOOK" <<< "$(_hook_stdin)"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"continue": true'
  _wait_for_file "$STAGING/pending/$SESSION_ID.jsonl" 5
  # JSONL contains schema and session_id.
  jq -e '.schema == "1" and .session_id != ""' "$STAGING/pending/$SESSION_ID.jsonl"
}

@test "stop hook redacts secrets before writing JSONL" {
  printf 'config:\npassword=hunter2longvalue\nend\n' > "$TRANSCRIPT_FILE"
  STAGING=$(_expected_staging_dir)
  bash "$STOP_HOOK" <<< "$(_hook_stdin)" >/dev/null
  _wait_for_file "$STAGING/pending/$SESSION_ID.jsonl" 5
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  echo "$tail" | grep -q 'password=\[REDACTED\]'
  ! echo "$tail" | grep -q 'hunter2longvalue'
}

@test "stop hook redacts Bearer tokens" {
  printf 'header: Bearer abc123def456ghi789jkl0\n' > "$TRANSCRIPT_FILE"
  STAGING=$(_expected_staging_dir)
  bash "$STOP_HOOK" <<< "$(_hook_stdin)" >/dev/null
  _wait_for_file "$STAGING/pending/$SESSION_ID.jsonl" 5
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  echo "$tail" | grep -q 'Bearer \[REDACTED\]'
}

@test "stop hook writes content_hash for dedup" {
  printf 'consistent input\n' > "$TRANSCRIPT_FILE"
  STAGING=$(_expected_staging_dir)
  bash "$STOP_HOOK" <<< "$(_hook_stdin)" >/dev/null
  _wait_for_file "$STAGING/pending/$SESSION_ID.jsonl" 5
  hash=$(jq -r '.content_hash' "$STAGING/pending/$SESSION_ID.jsonl")
  # sha256 is 64 hex chars.
  [ "${#hash}" -eq 64 ]
}

# --- Performance ---

@test "stop hook returns within 500ms (parent only)" {
  STAGING=$(_expected_staging_dir)
  # date +%s%N is GNU-only; %N outputs a literal 'N' on BSD/macOS.
  # Use Python 3 for millisecond precision when available; fall back to whole
  # seconds with a coarser 5-second bound so the test stays meaningful on
  # both platforms.
  if command -v python3 >/dev/null 2>&1; then
    start=$(python3 -c 'import time; print(int(time.monotonic() * 1000))')
    bash "$STOP_HOOK" <<< "$(_hook_stdin)" >/dev/null
    end=$(python3 -c 'import time; print(int(time.monotonic() * 1000))')
    elapsed_ms=$(( end - start ))
    [ "$elapsed_ms" -lt 500 ]
  else
    start=$(date +%s)
    bash "$STOP_HOOK" <<< "$(_hook_stdin)" >/dev/null
    end=$(date +%s)
    elapsed_s=$(( end - start ))
    [ "$elapsed_s" -lt 5 ]
  fi
}

# --- Capture subshell standalone ---

@test "capture subshell handles missing transcript gracefully" {
  STAGING=$(_expected_staging_dir)
  bash "$CAPTURE_SCRIPT" "/nonexistent/transcript.jsonl" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  # Should still write a JSONL with empty transcript_tail.
  [ -f "$STAGING/pending/$SESSION_ID.jsonl" ]
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  [ "$tail" = "" ]
}

@test "capture keeps user and assistant records and drops attachments" {
  STAGING=$(_expected_staging_dir)
  {
    printf '%s\n' '{"type":"attachment","attachment":{"type":"prompt_snapshot","systemPrompt":["SYSTEM_PROMPT_NOISE"],"tools":[{"name":"TOOL_SCHEMA_NOISE"}]}}'
    printf '%s\n' '{"type":"user","message":{"role":"user","content":"USER_DIALOGUE"}}'
    printf '%s\n' '{"type":"queue-operation","operation":"enqueue"}'
    printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ASSISTANT_DIALOGUE"}]}}'
    printf '%s\n' 'plain text line'
  } > "$TRANSCRIPT_FILE"
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  echo "$tail" | grep -q 'USER_DIALOGUE'
  echo "$tail" | grep -q 'ASSISTANT_DIALOGUE'
  echo "$tail" | grep -q 'plain text line'
  run ! grep -q 'SYSTEM_PROMPT_NOISE' <<< "$tail"
  run ! grep -q 'TOOL_SCHEMA_NOISE' <<< "$tail"
  run ! grep -q 'queue-operation' <<< "$tail"
}

@test "capture keeps the last 100 dialogue records past interleaved attachments" {
  STAGING=$(_expected_staging_dir)
  for i in $(seq 1 150); do
    printf '{"type":"user","message":{"role":"user","content":"msg-%03d"}}\n' "$i"
    printf '%s\n' '{"type":"attachment","attachment":{"type":"prompt_snapshot","systemPrompt":["x"]}}'
  done > "$TRANSCRIPT_FILE"
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  [ "$(printf '%s\n' "$tail" | wc -l)" -eq 100 ]
  echo "$tail" | grep -q 'msg-150'
  echo "$tail" | grep -q 'msg-051'
  run ! grep -q 'msg-050' <<< "$tail"
  run ! grep -q 'prompt_snapshot' <<< "$tail"
}

@test "capture scans past 1000 lines when non-dialogue records bury the dialogue" {
  STAGING=$(_expected_staging_dir)
  {
    for i in $(seq 1 50); do
      printf '{"type":"user","message":{"role":"user","content":"msg-%03d"}}\n' "$i"
    done
    for _ in $(seq 1 3000); do
      printf '%s\n' '{"type":"progress","data":{"type":"hook_progress"}}'
    done
  } > "$TRANSCRIPT_FILE"
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  [ "$(printf '%s\n' "$tail" | wc -l)" -eq 50 ]
  grep -q 'msg-001' <<< "$tail"
  grep -q 'msg-050' <<< "$tail"
  run ! grep -q 'hook_progress' <<< "$tail"
}

@test "capture widening scan stops at the last 100 dialogue records" {
  STAGING=$(_expected_staging_dir)
  {
    for i in $(seq 1 150); do
      printf '{"type":"assistant","message":{"role":"assistant","content":"msg-%03d"}}\n' "$i"
    done
    for _ in $(seq 1 2500); do
      printf '%s\n' '{"type":"attachment","attachment":{"type":"prompt_snapshot"}}'
    done
  } > "$TRANSCRIPT_FILE"
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  [ "$(printf '%s\n' "$tail" | wc -l)" -eq 100 ]
  grep -q 'msg-051' <<< "$tail"
  grep -q 'msg-150' <<< "$tail"
  run ! grep -q 'msg-050' <<< "$tail"
}

@test "buried dialogue from two sessions stages distinct content hashes" {
  STAGING=$(_expected_staging_dir)
  for sid in sess-a sess-b; do
    {
      printf '{"type":"user","message":{"role":"user","content":"only-%s"}}\n' "$sid"
      for _ in $(seq 1 1500); do
        printf '%s\n' '{"type":"queue-operation","operation":"enqueue"}'
      done
    } > "$TRANSCRIPT_FILE"
    bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$sid" "$STAGING" "$PROJECT_DIR"
  done
  jq -r '.transcript_tail' "$STAGING/pending/sess-a.jsonl" | grep -q 'only-sess-a'
  jq -r '.transcript_tail' "$STAGING/pending/sess-b.jsonl" | grep -q 'only-sess-b'
  hash_a=$(jq -r '.content_hash' "$STAGING/pending/sess-a.jsonl")
  hash_b=$(jq -r '.content_hash' "$STAGING/pending/sess-b.jsonl")
  [ -n "$hash_a" ] && [ "$hash_a" != "$hash_b" ]
}

@test "capture writes an entry for a tail larger than one argv string" {
  STAGING=$(_expected_staging_dir)
  big=$(head -c 200000 /dev/zero | tr '\0' 'a')
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\n' "$big" > "$TRANSCRIPT_FILE"
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  [ -f "$STAGING/pending/$SESSION_ID.jsonl" ]
  jq -e '(.transcript_tail | length) > 90000 and (.transcript_tail | length) <= 98304' \
    "$STAGING/pending/$SESSION_ID.jsonl"
}

@test "capture caps the tail by bytes and keeps the newest whole records" {
  STAGING=$(_expected_staging_dir)
  big=$(head -c 60000 /dev/zero | tr '\0' 'a')
  for i in 1 2 3; do
    printf '{"type":"user","message":{"role":"user","content":"rec-%d %s"}}\n' "$i" "$big"
  done > "$TRANSCRIPT_FILE"
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  [ "$(printf '%s\n' "$tail" | wc -l)" -eq 1 ]
  grep -q 'rec-3' <<< "$tail"
  run ! grep -q 'rec-2' <<< "$tail"
}

@test "capture redacts before the byte cap so a cut cannot strip a secret label" {
  STAGING=$(_expected_staging_dir)
  pad=$(head -c 120000 /dev/zero | tr '\0' 'a')
  val=$(head -c 40 /dev/zero | tr '\0' 'S')
  # Built from parts so secret scanners do not flag the fixture.
  label="pass""word"
  # The label sits just before the 96 KiB cut; the value lands after it.
  printf '{"type":"user","message":{"role":"user","content":"%s %s=%s%s"}}\n' \
    "$pad" "$label" "$val" "$(head -c 98261 /dev/zero | tr '\0' 'b')" > "$TRANSCRIPT_FILE"
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  run ! grep -q 'SSSSSSSSSS' <<< "$tail"
}

@test "capture falls back to the raw tail without attachments when jq filtering fails" {
  STAGING=$(_expected_staging_dir)
  shim="$PROJECT_DIR/shim"
  mkdir -p "$shim"
  real_jq=$(command -v jq)
  printf '#!/usr/bin/env bash\ncase "$*" in *fromjson*) exit 1 ;; esac\nexec %s "$@"\n' "$real_jq" > "$shim/jq"
  chmod +x "$shim/jq"
  {
    printf '%s\n' '{"type":"attachment","attachment":{"type":"prompt_snapshot","systemPrompt":["SYSTEM_PROMPT_NOISE"]}}'
    printf '%s\n' '{"type":"user","message":{"role":"user","content":"USER_DIALOGUE"}}'
  } > "$TRANSCRIPT_FILE"
  PATH="$shim:$PATH" bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
  tail=$(jq -r '.transcript_tail' "$STAGING/pending/$SESSION_ID.jsonl")
  grep -q 'USER_DIALOGUE' <<< "$tail"
  run ! grep -q 'SYSTEM_PROMPT_NOISE' <<< "$tail"
}
