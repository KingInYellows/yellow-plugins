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

  # Stub staging-reviewer agent so the dispatch guard passes — the real
  # agent lands in stack item #2. The guard honors this override only
  # under bats (BATS_VERSION set).
  STAGING_REVIEWER_STUB="$STUB_DIR/staging-reviewer.md"
  printf '%s\n' '---' 'name: staging-reviewer' '---' 'stub' > "$STAGING_REVIEWER_STUB"
  export COMPOUND_STAGING_REVIEWER_AGENT="$STAGING_REVIEWER_STUB"

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
  unset COMPOUND_STAGING_REVIEWER_AGENT
}

_stdin_json() {
  jq -nc --arg c "$PROJECT_DIR" '{cwd: $c}'
}

# Wait briefly for the drain subshell to start the stub. `timeout` is in
# seconds (matches _wait_for_file). Polls every 100ms; converts to
# deciseconds for the loop bound so the wait actually lasts N seconds.
_wait_for_stub() {
  local timeout="${1:-3}" elapsed=0
  local max_iters=$((timeout * 10))
  while [ ! -f "$STUB_MARKER" ] && [ "$elapsed" -lt "$max_iters" ]; do
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

# --- Drain model pin ---

# Wait for the drain subshell to log the claude exit status and release
# .drain-lock, so the next run in the same test can dispatch again.
_wait_for_drain_done() {
  local i=0
  while [ "$i" -lt 30 ]; do
    if grep -qs 'drain claude exited' "$STAGING"/drain-logs/*.log \
      && [ ! -d "$STAGING/.drain-lock" ]; then
      return 0
    fi
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

@test "session-start pins the drain to haiku by default and logs the exit status" {
  _plant_pending 5
  run env -u COMPOUND_DRAIN_MODEL bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  _wait_for_drain_done
  grep -q -- '--model haiku ' "$STUB_MARKER"
  grep -q -- '--max-turns 50' "$STUB_MARKER"
  run grep -q -- '--bare' "$STUB_MARKER"
  [ "$status" -eq 1 ]
  grep -q 'drain claude exited 0' "$STAGING"/drain-logs/*.log
  run grep -q 'COMPOUND_DRAIN_MODEL rejected' "$STAGING"/drain-logs/*.log
  [ "$status" -eq 1 ]
}

@test "session-start warns when the drain exits 0 but leaves every entry in pending/" {
  # The default stub exits 0 without touching pending/ — the shape of a
  # lead that answers without dispatching staging-reviewer.
  _plant_pending 5
  run env -u COMPOUND_DRAIN_MODEL bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  _wait_for_drain_done
  grep -q 'drain claude exited 0' "$STAGING"/drain-logs/*.log
  grep -q 'WARNING drain left all 5 dispatched entries in pending/' "$STAGING"/drain-logs/*.log
}

@test "session-start logs how many entries the drain took from pending/" {
  _plant_pending 5
  # A stub that does what staging-reviewer's Phase 1 does: move every
  # pending entry to processing/.
  cat > "$STUB_BIN" <<STUB
#!/usr/bin/env bash
printf 'invoked with args: %s\n' "\$*" > "$STUB_MARKER"
mkdir -p "$STAGING/processing"
mv -- "$STAGING"/pending/*.jsonl "$STAGING/processing/"
printf '{"result": "stub", "is_error": false}\n'
STUB
  run env -u COMPOUND_DRAIN_MODEL bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  _wait_for_drain_done
  grep -q 'drain took 5 of 5 dispatched entries from pending/' "$STAGING"/drain-logs/*.log
  run grep -q 'WARNING drain left' "$STAGING"/drain-logs/*.log
  [ "$status" -eq 1 ]
}

@test "session-start honours COMPOUND_DRAIN_MODEL" {
  _plant_pending 5
  run env COMPOUND_DRAIN_MODEL=sonnet bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  _wait_for_drain_done
  grep -q -- '--model sonnet ' "$STUB_MARKER"
  run grep -q 'COMPOUND_DRAIN_MODEL rejected' "$STAGING"/drain-logs/*.log
  [ "$status" -eq 1 ]
}

@test "session-start honours a full claude-* COMPOUND_DRAIN_MODEL" {
  _plant_pending 5
  run env COMPOUND_DRAIN_MODEL=claude-haiku-5-5 bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  _wait_for_drain_done
  grep -q -- '--model claude-haiku-5-5 ' "$STUB_MARKER"
  run grep -q 'COMPOUND_DRAIN_MODEL rejected' "$STAGING"/drain-logs/*.log
  [ "$status" -eq 1 ]
}

@test "session-start rejects invalid COMPOUND_DRAIN_MODEL values, logs it and falls back to haiku" {
  _plant_pending 5
  local value
  for value in 'x; rm' 'claude-x; rm' '' 'claude-' 'claude-opus--5' \
    'claude-opus-5-' '--dangerously-skip-permissions' 'gpt-5' 'sonnett'; do
    rm -f "$STUB_MARKER" "$STAGING"/drain-logs/*.log
    run env COMPOUND_DRAIN_MODEL="$value" bash "$SS_HOOK" <<< "$(_stdin_json)"
    [ "$status" -eq 0 ]
    _wait_for_drain_done
    grep -q -- '--model haiku ' "$STUB_MARKER"
    grep -q 'COMPOUND_DRAIN_MODEL rejected' "$STAGING"/drain-logs/*.log
    # The untrusted value never reaches argv or the log.
    run grep -q -e 'dangerously' -e 'x; rm' -e 'gpt' "$STUB_MARKER"
    [ "$status" -eq 1 ]
    run grep -q -e 'dangerously' -e 'x; rm' -e 'gpt' "$STAGING"/drain-logs/*.log
    [ "$status" -eq 1 ]
  done
}

@test "both drain claude -p branches pass --model \"\$DRAIN_MODEL\"" {
  # The suite only exercises the host's branch (timeout present), so pin
  # the no-timeout branch statically: every `-p "$DRAIN_PROMPT"` line must
  # be followed directly by the --model line.
  run grep -c -- '-p "$DRAIN_PROMPT"' "$SS_HOOK"
  [ "$output" -eq 2 ]
  run awk 'prev ~ /-p "\$DRAIN_PROMPT"/ && /--model "\$DRAIN_MODEL"/ { n++ }
    { prev = $0 } END { print n + 0 }' "$SS_HOOK"
  [ "$output" -eq 2 ]
}

@test "session-start does NOT dispatch at count=4" {
  _plant_pending 4
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  sleep 0.5
  # No dispatch because count<5 and entries are fresh (mtime ~now).
  [ ! -f "$STUB_MARKER" ]
}

# --- P1 guard: staging-reviewer agent absent ---

@test "session-start defers drain when staging-reviewer agent is absent" {
  _plant_pending 5
  export COMPOUND_STAGING_REVIEWER_AGENT="$STUB_DIR/no-such-agent.md"
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"continue": true'
  sleep 0.5
  # Guard short-circuits before dispatch; the stub claude is never invoked.
  [ ! -f "$STUB_MARKER" ]
  # Entries remain in pending/ for a future drain once the agent ships.
  [ -f "$STAGING/pending/s1.jsonl" ]
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
  # cs_atomic_jsonl_write creates sibling .tmp.PID files in the destination
  # directory (pending/, processing/, or STAGING root for drain-budget.json).
  # The reaper scans those locations, NOT a separate tmp/ subdir.
  mkdir -p "$STAGING/pending" "$STAGING/processing"
  touch "$STAGING/pending/orphan.jsonl.tmp.123"
  touch "$STAGING/processing/orphan.jsonl.tmp.456"
  touch "$STAGING/drain-budget.json.tmp.789"
  for f in \
    "$STAGING/pending/orphan.jsonl.tmp.123" \
    "$STAGING/processing/orphan.jsonl.tmp.456" \
    "$STAGING/drain-budget.json.tmp.789"; do
    touch -t "$(date -d '90 minutes ago' +%Y%m%d%H%M 2>/dev/null \
      || date -v-90M +%Y%m%d%H%M)" "$f"
  done
  bash "$SS_HOOK" <<< "$(_stdin_json)" >/dev/null
  [ ! -f "$STAGING/pending/orphan.jsonl.tmp.123" ]
  [ ! -f "$STAGING/processing/orphan.jsonl.tmp.456" ]
  [ ! -f "$STAGING/drain-budget.json.tmp.789" ]
}

# --- Output contract ---

@test "session-start always outputs {continue: true} JSON" {
  run bash "$SS_HOOK" <<< "$(_stdin_json)"
  echo "$output" | jq -e '.continue == true' >/dev/null
}

# --- Concurrency safety ---

@test "session-start does not requeue processing/ entries when drain lock is held" {
  # Simulates a concurrent SessionStart firing while another drain holds the
  # lock: the requeue loop must be skipped (otherwise it could race the
  # active drain's mv operations and produce duplicate pending entries).
  mkdir -p "$STAGING/pending" "$STAGING/processing"
  touch "$STAGING/processing/crashed.jsonl"
  touch -t "$(date -d '90 minutes ago' +%Y%m%d%H%M 2>/dev/null \
    || date -v-90M +%Y%m%d%H%M)" "$STAGING/processing/crashed.jsonl"
  # Lock held by a "concurrent drain" (fresh mtime so it's NOT reaped as
  # stale by the >30min reaper, and is treated as active).
  mkdir "$STAGING/.drain-lock"

  bash "$SS_HOOK" <<< "$(_stdin_json)" >/dev/null

  # Lock survives (only the concurrent owner should release it).
  [ -d "$STAGING/.drain-lock" ]
  # Crashed entry stays in processing/ — was NOT requeued.
  [ -f "$STAGING/processing/crashed.jsonl" ]
  [ ! -f "$STAGING/pending/crashed.jsonl" ]
}

@test "session-start parent-side trap releases drain-lock on early-exit before dispatch" {
  # If the parent exits between acquiring the lock and handing it to the
  # subshell (e.g., staging-reviewer agent missing), the parent's EXIT
  # trap must release the lock so the next SessionStart isn't blocked for
  # 30 minutes by the stale-lock reaper.
  mkdir -p "$STAGING/pending"
  for i in 1 2 3 4 5; do
    touch "$STAGING/pending/entry-$i.jsonl"
  done
  # Point at a non-existent staging-reviewer agent file so the parent
  # exits via the "agent not yet deployed" path AFTER acquiring the lock.
  COMPOUND_STAGING_REVIEWER_AGENT="/nonexistent/staging-reviewer.md" \
    bash "$SS_HOOK" <<< "$(_stdin_json)" >/dev/null

  # Lock should have been released by the parent's EXIT trap, not orphaned.
  [ ! -d "$STAGING/.drain-lock" ]
}
