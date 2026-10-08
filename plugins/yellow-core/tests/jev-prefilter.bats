#!/usr/bin/env bats
# Tests for lib/jev-prefilter.sh and its call from
# hooks/scripts/_stop-capture-subshell.sh (shadow mode only).

CAPTURE_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/_stop-capture-subshell.sh"

setup() {
  TEST_HOME="$(mktemp -d)"
  export HOME="$TEST_HOME"
  PROJECT_DIR="$(mktemp -d)"
  TRANSCRIPT_FILE="$PROJECT_DIR/transcript.jsonl"
  SESSION_ID="bats-jev-$$"
  . "$BATS_TEST_DIRNAME/../lib/compound-staging.sh"
  STAGING="$(cs_staging_dir_for_slug "$(cs_derive_project_slug "$PROJECT_DIR")")"

  # Fake curl: records argv and the request body, prints a canned response
  # from $MOCK_JEV_RESPONSE plus the -w time line, or fails on demand.
  MOCK_BIN="$(mktemp -d)"
  export MOCK_JEV_LOG="$MOCK_BIN/argv.log"
  export MOCK_JEV_BODY="$MOCK_BIN/body.json"
  export MOCK_JEV_STDIN="$MOCK_BIN/stdin.txt"
  cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_JEV_LOG"
cat > "$MOCK_JEV_STDIN"
while [ $# -gt 0 ]; do
  if [ "$1" = "--data-binary" ]; then printf '%s' "$2" > "$MOCK_JEV_BODY"; shift; fi
  shift
done
[ "${MOCK_JEV_FAIL:-0}" = "1" ] && exit 22
printf '%s\n0.142' "$MOCK_JEV_RESPONSE"
MOCK
  chmod +x "$MOCK_BIN/curl"
  export PATH="$MOCK_BIN:$PATH"

  export MOCK_JEV_RESPONSE='{"model":"jev-1.13.0","answers":{"durable":{"type":"choice","choice":"trivial-qa","confidence":0.95,"probabilities":{"trivial-qa":0.96,"routine-edit":0.01,"durable-lesson":0.01,"decision-or-convention":0.01,"other":0.01}},"has_instruction":{"type":"noul","noul":0.04}},"usage":{"input_tokens":312,"output_tokens":20}}'

  {
    printf '%s\n' '{"type":"user","message":{"role":"user","content":"what does jq -r do?"}}'
    printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"It prints raw strings."},{"type":"tool_use","name":"Bash","input":{"command":"echo SECRET_TOOL_INPUT"}}]}}'
    printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"TOOL_RESULT_NOISE"}]}}'
    printf '%s\n' 'not json at all'
  } > "$TRANSCRIPT_FILE"
}

teardown() {
  rm -rf "$TEST_HOME" "$PROJECT_DIR" "$MOCK_BIN"
}

_capture() {
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT_FILE" "$SESSION_ID" "$STAGING" "$PROJECT_DIR"
}

@test "off by default: no Jev call, pending entry still written" {
  unset COMPOUND_JEV_PREFILTER
  TYPESAFE_API_KEY=test-key-123 _capture
  [ -f "$STAGING/pending/$SESSION_ID.jsonl" ]
  [ ! -f "$STAGING/jev-shadow.jsonl" ]
  [ ! -f "$MOCK_JEV_LOG" ]
}

@test "shadow mode without an API key stays off" {
  unset TYPESAFE_API_KEY
  COMPOUND_JEV_PREFILTER=shadow _capture
  [ -f "$STAGING/pending/$SESSION_ID.jsonl" ]
  [ ! -f "$STAGING/jev-shadow.jsonl" ]
  [ ! -f "$MOCK_JEV_LOG" ]
}

@test "shadow mode logs a decision and leaves the pending entry unchanged" {
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  [ -f "$STAGING/pending/$SESSION_ID.jsonl" ]
  jq -e '.transcript_tail | contains("TOOL_RESULT_NOISE")' "$STAGING/pending/$SESSION_ID.jsonl"
  [ "$(wc -l < "$STAGING/jev-shadow.jsonl")" -eq 1 ]
  jq -e --arg sid "$SESSION_ID" '
    .session_id == $sid and .durable == "trivial-qa" and .would_skip == true
    and .model == "jev-1.13.0" and .latency_s == 0.142 and .input_tokens == 312
    and (.content_hash | length) == 64' "$STAGING/jev-shadow.jsonl"
}

@test "shadow log holds no transcript text" {
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  ! grep -q 'jq -r' "$STAGING/jev-shadow.jsonl"
  ! grep -q 'raw strings' "$STAGING/jev-shadow.jsonl"
}

@test "request sends only user and assistant text, with the pinned model" {
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  jq -e '.model == "jev-1.13.0"' "$MOCK_JEV_BODY"
  state=$(jq -r '.state' "$MOCK_JEV_BODY")
  [[ "$state" == *"user: what does jq -r do?"* ]]
  [[ "$state" == *"assistant: It prints raw strings."* ]]
  [[ "$state" != *"TOOL_RESULT_NOISE"* ]]
  [[ "$state" != *"SECRET_TOOL_INPUT"* ]]
  jq -e '.questions.durable.type == "choice" and .questions.has_instruction.type == "noul"' "$MOCK_JEV_BODY"
}

@test "API key is passed on stdin, never in curl argv" {
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  ! grep -q 'test-key-123' "$MOCK_JEV_LOG"
  grep -q 'Authorization: Bearer test-key-123' "$MOCK_JEV_STDIN"
}

@test "a standing-behaviour request is never marked skippable" {
  export MOCK_JEV_RESPONSE='{"model":"jev-1.13.0","answers":{"durable":{"type":"choice","choice":"trivial-qa","confidence":0.97},"has_instruction":{"type":"noul","noul":0.81}}}'
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  jq -e '.would_skip == false and .has_instruction == 0.81' "$STAGING/jev-shadow.jsonl"
}

@test "low confidence is never marked skippable" {
  export MOCK_JEV_RESPONSE='{"model":"jev-1.13.0","answers":{"durable":{"type":"choice","choice":"routine-edit","confidence":0.4},"has_instruction":{"type":"noul","noul":0.01}}}'
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  jq -e '.would_skip == false' "$STAGING/jev-shadow.jsonl"
}

@test "curl failure fails open: no log line, pending entry written" {
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 MOCK_JEV_FAIL=1 _capture
  [ -f "$STAGING/pending/$SESSION_ID.jsonl" ]
  [ ! -s "$STAGING/jev-shadow.jsonl" ]
}

@test "malformed response fails open: no log line" {
  export MOCK_JEV_RESPONSE='{"error":"overloaded"}'
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  [ -f "$STAGING/pending/$SESSION_ID.jsonl" ]
  [ ! -s "$STAGING/jev-shadow.jsonl" ]
}

@test "transcript with no dialogue makes no call" {
  printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","content":"x"}]}}' > "$TRANSCRIPT_FILE"
  COMPOUND_JEV_PREFILTER=shadow TYPESAFE_API_KEY=test-key-123 _capture
  [ ! -f "$MOCK_JEV_LOG" ]
}
