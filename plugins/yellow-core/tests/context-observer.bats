#!/usr/bin/env bats
# Tests for the opt-in context observer as a unit: lib/context-observer.py
# (statusline pass-through + record writer), lib/context-observer.sh
# (co_read_observation), and lib/context-observer-setup.py (the
# /statusline:setup Step 5b installer). Scenario IDs (T09..T11) refer to
# docs/testing/session-continuity-acceptance.md; R-ids refer to
# plans/specs/session-continuity-foundation.md.
#
# Fixtures are real statusline payloads captured from the client version
# named by their directory under fixtures/statusline/ (see its README.md);
# the newest version directory is used. Every test runs with tests/mocks
# prepended to PATH so any claude / gt / gh / curl call is recorded (R2).

bats_require_minimum_version 1.5.0

OBS="$BATS_TEST_DIRNAME/../lib/context-observer.py"
SETUP_PY="$BATS_TEST_DIRNAME/../lib/context-observer-setup.py"

setup() {
  command -v python3 >/dev/null 2>&1 || skip "python3 not installed"
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  export PATH="$BATS_TEST_DIRNAME/mocks:$PATH"
  export MOCK_FORBIDDEN_LOG="$(mktemp)"
  TEST_HOME="$(mktemp -d)"
  export HOME="$TEST_HOME"
  unset CLAUDE_CONFIG_DIR YELLOW_CONTEXT_WATERMARK CO_STALENESS_SECONDS \
    CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME CONTEXT_OBSERVER_DEBUG
  # shellcheck source=../lib/compound-staging.sh
  . "$BATS_TEST_DIRNAME/../lib/compound-staging.sh"
  # shellcheck source=../lib/context-observer.sh
  . "$BATS_TEST_DIRNAME/../lib/context-observer.sh"
  FIX=$(find "$BATS_TEST_DIRNAME/fixtures/statusline" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)
  [ -n "$FIX" ] || { echo "no statusline fixture directory" >&2; return 1; }
  PROJECT="$TEST_HOME/project"
  mkdir -p "$PROJECT"
  PROJECT=$(cd "$PROJECT" && pwd -P)
}

teardown() {
  if [ -f "${MOCK_FORBIDDEN_LOG:-}" ]; then
    if [ -s "$MOCK_FORBIDDEN_LOG" ]; then
      echo "forbidden commands were invoked:" >&2
      cat "$MOCK_FORBIDDEN_LOG" >&2
      rm -f "$MOCK_FORBIDDEN_LOG"
      return 1
    fi
    rm -f "$MOCK_FORBIDDEN_LOG"
  fi
  if [ -n "${TEST_HOME:-}" ] && [ -d "$TEST_HOME" ]; then
    chmod -R u+w "$TEST_HOME" 2>/dev/null
    rm -rf "$TEST_HOME"
  fi
  return 0
}

# A host-shaped payload: the mid-session fixture with session, directories and
# remaining percentage replaced. $2 is a JSON value (number, string or null).
payload() {
  local sid="$1" remaining="$2"
  jq -c --arg sid "$sid" --arg dir "$PROJECT" --argjson r "$remaining" '
    .session_id = $sid | .cwd = $dir | .workspace.project_dir = $dir
    | .context_window.remaining_percentage = $r
    | .context_window.used_percentage = (if ($r | type) == "number" then 100 - $r else null end)' \
    "$FIX/mid-session.json"
}

observe() {
  payload "$1" "$2" | python3 "$OBS" >/dev/null
}

record_for() {
  printf '%s/.claude/projects/%s/context-observations/%s.json' "$HOME" "$(printf '%s' "$PROJECT" | tr '/' '-')" "$1"
}

iso_ago() {
  python3 -c 'import sys, datetime; print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=int(sys.argv[1]))).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$1"
}

set_observed_at() {
  local file="$1" ts="$2"
  jq --arg ts "$ts" '.observed_at = $ts' "$file" > "$file.new" && mv "$file.new" "$file"
}

# --- T09: pass-through and recording (R19) -----------------------------------

@test "T09: every fixture round-trips byte-for-byte and exits 0" {
  local n=0 f
  for f in "$FIX"/*.json; do
    n=$((n + 1))
    python3 "$OBS" < "$f" > "$TEST_HOME/out"
    cmp "$f" "$TEST_HOME/out"
  done
  [ "$n" -ge 4 ]
}

@test "T09: mid-session records the payload's context numbers and the reader returns them" {
  local sid top record
  sid=$(jq -r '.session_id' "$FIX/mid-session.json")
  top=$(jq -r '.workspace.project_dir // .cwd' "$FIX/mid-session.json")
  python3 "$OBS" < "$FIX/mid-session.json" >/dev/null
  record=$(co_observation_path "$sid" "$top")
  [ -f "$record" ]
  jq -e --slurpfile p "$FIX/mid-session.json" '
    .observer_format == 1 and .session_id == $p[0].session_id
    and .context_window.remaining_percentage == $p[0].context_window.remaining_percentage
    and .context_window.used_percentage == $p[0].context_window.used_percentage
    and .context_window.context_window_size == $p[0].context_window.context_window_size
    and .context_window.current_usage_null == false
    and (.transcript_present | type == "boolean")' "$record" >/dev/null
  run co_read_observation "$sid" "$top"
  echo "$output" | jq -e --slurpfile p "$FIX/mid-session.json" \
    '.remaining_percentage == $p[0].context_window.remaining_percentage' >/dev/null
}

@test "T09: the startup payload (null usage and percentages) records current_usage_null and reads as unknown" {
  local f="$FIX/startup-null.json" sid top record
  jq -e '.context_window.current_usage == null and .context_window.remaining_percentage == null' "$f" >/dev/null
  sid=$(jq -r '.session_id' "$f")
  top=$(jq -r '.workspace.project_dir // .cwd' "$f")
  python3 "$OBS" < "$f" >/dev/null
  record=$(co_observation_path "$sid" "$top")
  jq -e '.context_window.current_usage_null == true and .context_window.remaining_percentage == null' "$record" >/dev/null
  run co_read_observation "$sid" "$top"
  [ "$output" = "unknown" ]
}

@test "T09: missing session id and malformed input write nothing but still pass through" {
  local f
  for f in "$FIX/missing-session.json" "$FIX/malformed.json"; do
    python3 "$OBS" < "$f" > "$TEST_HOME/out"
    cmp "$f" "$TEST_HOME/out"
  done
  [ -z "$(find "$HOME/.claude" -type f 2>/dev/null)" ]
}

@test "T09: hostile session ids write nothing" {
  local sid
  for sid in '../escape' 'a/b' '' 'x y' "$(printf 'a%.0s' $(seq 1 129))"; do
    payload "$sid" 61 | python3 "$OBS" >/dev/null
  done
  [ -z "$(find "$HOME/.claude" -type f 2>/dev/null)" ]
  [ ! -e "$HOME/escape.json" ]
}

@test "T09: the observer's slug equals cs_derive_project_slug for a git toplevel" {
  git -C "$PROJECT" init --quiet
  observe slug-check 61
  [ -f "$HOME/.claude/projects/$(cs_derive_project_slug "$PROJECT")/context-observations/slug-check.json" ]
}

# --- T09: reader unknown rules (R20) -----------------------------------------

@test "R20: staleness window: 600 s old is unknown, 60 s old is fresh, a 30 s window rejects it" {
  observe stale 61
  set_observed_at "$(record_for stale)" "$(iso_ago 600)"
  run co_read_observation stale "$PROJECT"
  [ "$output" = "unknown" ]
  set_observed_at "$(record_for stale)" "$(iso_ago 60)"
  run co_read_observation stale "$PROJECT"
  echo "$output" | jq -e '.remaining_percentage == 61' >/dev/null
  CO_STALENESS_SECONDS=30 run co_read_observation stale "$PROJECT"
  [ "$output" = "unknown" ]
}

@test "R20: a record for another session, a missing record, or an unknown session is unknown" {
  observe mine 61
  cp "$(record_for mine)" "$(record_for theirs)"
  run co_read_observation theirs "$PROJECT"
  [ "$output" = "unknown" ]
  run co_read_observation nobody "$PROJECT"
  [ "$output" = "unknown" ]
  run co_read_observation unknown "$PROJECT"
  [ "$output" = "unknown" ]
}

@test "R20: out-of-range, string and null percentages are unknown, never 0" {
  local r
  for r in 101 -1 '"61"' null; do
    observe "range" "$r"
    run co_read_observation range "$PROJECT"
    [ "$output" = "unknown" ]
    [[ "$output" != *0* ]]
  done
}

@test "R20: a malformed or wrong-format record is unknown" {
  observe shape 61
  printf 'not json' > "$(record_for shape)"
  run co_read_observation shape "$PROJECT"
  [ "$output" = "unknown" ]
  observe shape 61
  jq '.observer_format = 2' "$(record_for shape)" > "$TEST_HOME/r" && mv "$TEST_HOME/r" "$(record_for shape)"
  run co_read_observation shape "$PROJECT"
  [ "$output" = "unknown" ]
}

# --- T10: advisory watermark and atomicity (R19, R21) ------------------------

@test "T10: ten identical samples below the watermark count one crossing" {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do observe adv 30; done
  jq -e '.advisory.crossings == 1 and .advisory.last_state == "below" and .advisory.watermark_remaining == 50' \
    "$(record_for adv)" >/dev/null
}

@test "T10: above, below, above, below counts two crossings" {
  observe adv 70; observe adv 30; observe adv 70; observe adv 30
  jq -e '.advisory.crossings == 2' "$(record_for adv)" >/dev/null
}

@test "T10: a null sample between two below samples does not add a crossing" {
  observe adv 30; observe adv null; observe adv 30
  jq -e '.advisory.crossings == 1 and .advisory.last_state == "below"' "$(record_for adv)" >/dev/null
}

@test "T10: YELLOW_CONTEXT_WATERMARK moves the watermark; invalid values fall back to 50" {
  YELLOW_CONTEXT_WATERMARK=80 observe wm 61
  jq -e '.advisory.watermark_remaining == 80 and .advisory.last_state == "below" and .advisory.crossings == 1' \
    "$(record_for wm)" >/dev/null
  YELLOW_CONTEXT_WATERMARK=abc observe wm2 61
  jq -e '.advisory.watermark_remaining == 50 and .advisory.last_state == "above"' "$(record_for wm2)" >/dev/null
}

@test "T10: the observer prints nothing extra on a crossing" {
  observe quiet 70
  payload quiet 30 > "$TEST_HOME/in"
  run --separate-stderr python3 "$OBS" < "$TEST_HOME/in"
  [ "$status" -eq 0 ]
  [ "$output" = "$(cat "$TEST_HOME/in")" ]
  [ -z "$stderr" ]
  jq -e '.advisory.crossings == 1' "$(record_for quiet)" >/dev/null
}

@test "T10: a writer killed before the rename leaves the previous record intact" {
  local killer
  killer=$(command -v timeout || command -v gtimeout || true)
  [ -n "$killer" ] || skip "timeout/gtimeout not available"
  observe killed 70
  cp "$(record_for killed)" "$TEST_HOME/before"
  payload killed 30 > "$TEST_HOME/in"
  CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME=5 run "$killer" -s KILL 1 python3 "$OBS" < "$TEST_HOME/in"
  cmp "$TEST_HOME/before" "$(record_for killed)"
  run co_read_observation killed "$PROJECT"
  echo "$output" | jq -e '.remaining_percentage == 70' >/dev/null
}

@test "T10: concurrent writers leave one complete record" {
  payload race 40 > "$TEST_HOME/a"
  payload race 20 > "$TEST_HOME/b"
  python3 "$OBS" < "$TEST_HOME/a" >/dev/null &
  python3 "$OBS" < "$TEST_HOME/b" >/dev/null &
  wait
  jq -e '.session_id == "race" and (.context_window.remaining_percentage == 40 or .context_window.remaining_percentage == 20)' \
    "$(record_for race)" >/dev/null
  [ "$(find "$(dirname "$(record_for race)")" -name '*.json' | wc -l | tr -d ' ')" -eq 1 ]
}

@test "T10: an unwritable config dir still passes stdout through and exits 0" {
  export CLAUDE_CONFIG_DIR="$TEST_HOME/readonly"
  mkdir -p "$CLAUDE_CONFIG_DIR"
  chmod 500 "$CLAUDE_CONFIG_DIR"
  run --separate-stderr python3 "$OBS" < "$FIX/mid-session.json"
  [ "$status" -eq 0 ]
  [ "$output" = "$(cat "$FIX/mid-session.json")" ]
  [ -z "$stderr" ]
}

@test "R22: the observer stays under the 100 ms budget on the largest fixture" {
  local largest best
  largest=$(ls -S "$FIX"/*.json | head -n 1)
  best=$(python3 - "$OBS" "$largest" <<'PY'
import subprocess, sys, time
obs, fixture = sys.argv[1], sys.argv[2]
data = open(fixture, "rb").read()
runs = []
for _ in range(5):
    start = time.perf_counter()
    subprocess.run([sys.executable, obs], input=data, stdout=subprocess.DEVNULL, check=True)
    runs.append((time.perf_counter() - start) * 1000)
print("%.1f" % min(runs))
PY
)
  echo "# observer best of 5 on $(basename "$largest"): ${best} ms" >&3
  python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) < 100 else 1)' "$best"
}

# --- T11: setup opt-in (R18, R2) ---------------------------------------------

# Settings with keys that must survive untouched, plus the yellow statusline
# script the composition pipes into.
seed_settings() {
  local command="$1"
  SETTINGS="$TEST_HOME/.claude/settings.json"
  STATUSLINE="$TEST_HOME/.claude/yellow-statusline.py"
  OBS_DEST="$TEST_HOME/.claude/yellow-context-observer.py"
  mkdir -p "$TEST_HOME/.claude"
  printf 'import sys\nprint("RENDER", len(sys.stdin.read()))\n' > "$STATUSLINE"
  if [ "$command" = "none" ]; then
    printf '{\n  "hooks": {"Stop": []},\n  "autoCompactEnabled": false\n}\n' > "$SETTINGS"
  else
    jq -n --arg c "$command" '{hooks: {Stop: []}, autoCompactEnabled: false, autoCompactWindow: 3,
      statusLine: {type: "command", command: $c, padding: 0}}' > "$SETTINGS"
  fi
  cp "$SETTINGS" "$TEST_HOME/settings.orig"
}

setup_py() {
  local sub="$1"; shift
  if [ "$sub" = "install" ]; then
    python3 "$SETUP_PY" install --settings "$SETTINGS" --observer-src "$OBS" \
      --observer-dest "$OBS_DEST" --statusline "$STATUSLINE" "$@"
  else
    python3 "$SETUP_PY" plan --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE" "$@"
  fi
}

@test "T11: plan writes nothing" {
  seed_settings "bash ~/custom.sh"
  run --separate-stderr setup_py plan
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "install" and .existing_command == "bash ~/custom.sh"' >/dev/null
  cmp "$SETTINGS" "$TEST_HOME/settings.orig"
  [ ! -e "$OBS_DEST" ]
  [ -z "$(find "$TEST_HOME/.claude" -name '*.backup*')" ]
}

@test "T11: install with no statusLine composes the observer ahead of the yellow statusline" {
  seed_settings none
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  jq -e --arg c "python3 $OBS_DEST | python3 $STATUSLINE" '.statusLine.command == $c and .statusLine.type == "command"' "$SETTINGS" >/dev/null
  diff <(jq 'del(.statusLine)' "$TEST_HOME/settings.orig") <(jq 'del(.statusLine)' "$SETTINGS")
}

@test "T11: install over the yellow statusline composes the pipeline and it renders" {
  seed_settings "python3 $TEST_HOME/.claude/yellow-statusline.py"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  jq -e --arg c "python3 $OBS_DEST | python3 $STATUSLINE" '.statusLine.command == $c' "$SETTINGS" >/dev/null
  run bash -c "$(jq -r '.statusLine.command' "$SETTINGS")" < "$FIX/mid-session.json"
  [ "$output" = "RENDER $(wc -c < "$FIX/mid-session.json" | tr -d ' ')" ]
}

@test "T11: install over a custom command keeps it, backs up settings, and changes only statusLine.command" {
  seed_settings "bash ~/custom.sh"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  jq -e --arg c "python3 $OBS_DEST | bash ~/custom.sh" '.statusLine.command == $c and .statusLine.padding == 0' "$SETTINGS" >/dev/null
  diff <(jq 'del(.statusLine)' "$TEST_HOME/settings.orig") <(jq 'del(.statusLine)' "$SETTINGS")
  jq -e '.hooks == {Stop: []} and .autoCompactEnabled == false and .autoCompactWindow == 3' "$SETTINGS" >/dev/null
  cmp "$TEST_HOME/settings.orig" "$SETTINGS.pre-observer.backup"
  [ -x "$OBS_DEST" ]
  cmp "$OBS" "$OBS_DEST"
}

@test "T11: a compound custom command is wrapped so the payload still reaches it" {
  seed_settings "cat > $TEST_HOME/seen && echo done"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  jq -e --arg c "python3 $OBS_DEST | ( cat > $TEST_HOME/seen && echo done )" '.statusLine.command == $c' "$SETTINGS" >/dev/null
  run bash -c "$(jq -r '.statusLine.command' "$SETTINGS")" < "$FIX/mid-session.json"
  [ "$output" = "done" ]
  cmp "$FIX/mid-session.json" "$TEST_HOME/seen"
}

@test "T11: a second install is already-installed and changes nothing" {
  seed_settings "bash ~/custom.sh"
  setup_py install >/dev/null
  cp "$SETTINGS" "$TEST_HOME/after-first"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "already-installed"' >/dev/null
  cmp "$TEST_HOME/after-first" "$SETTINGS"
  [ "$(find "$TEST_HOME/.claude" -name 'settings.json.pre-observer.backup*' | wc -l | tr -d ' ')" -eq 1 ]
}

@test "T11: JSONC, invalid JSON and a missing statusline script are refused with no write" {
  seed_settings none
  printf '{\n  // comment\n  "a": 1\n}\n' > "$SETTINGS"
  cp "$SETTINGS" "$TEST_HOME/jsonc"
  run --separate-stderr setup_py install
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.action == "error" and (.reason | contains("JSONC"))' >/dev/null
  cmp "$TEST_HOME/jsonc" "$SETTINGS"

  printf '{"a": ' > "$SETTINGS"
  run --separate-stderr setup_py install
  [ "$status" -eq 1 ]
  [ "$(cat "$SETTINGS")" = '{"a": ' ]

  seed_settings none
  rm -f "$STATUSLINE"
  run --separate-stderr setup_py install
  [ "$status" -eq 1 ]
  cmp "$TEST_HOME/settings.orig" "$SETTINGS"
  [ ! -e "$OBS_DEST" ]
}

@test "T11: a tilde observer path is expanded before it is quoted into the command" {
  seed_settings "bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" plan --settings "$SETTINGS" \
    --observer-dest '~/.claude/yellow-context-observer.py' --statusline "$STATUSLINE"
  echo "$output" | jq -e --arg c "python3 $HOME/.claude/yellow-context-observer.py | bash ~/custom.sh" '.proposed_command == $c' >/dev/null
}
