#!/usr/bin/env bats
# Tests for the opt-in context observer as a unit: lib/context-observer.py
# (statusline pass-through + record writer), lib/context-observer.sh
# (co_read_observation), and lib/statusline-settings.py (the
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
SETUP_PY="$BATS_TEST_DIRNAME/../lib/statusline-settings.py"

setup() {
  command -v python3 >/dev/null 2>&1 || skip "python3 not installed"
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  export PATH="$BATS_TEST_DIRNAME/mocks:$PATH"
  export MOCK_FORBIDDEN_LOG="$(mktemp)"
  TEST_HOME="$(mktemp -d)"
  export HOME="$TEST_HOME"
  unset CLAUDE_CONFIG_DIR YELLOW_CONTEXT_WATERMARK CO_REASON_FILE \
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

# The observer stage statusline-settings.py composes for observer path $1
# (test paths need no shell quoting).
obs_stage() {
  printf '{ command -v python3 >/dev/null && [ -r %s ] && exec python3 %s; exec cat; }' "$1" "$1"
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
  local sid record
  sid=$(jq -r '.session_id' "$FIX/mid-session.json")
  python3 "$OBS" < "$FIX/mid-session.json" >/dev/null
  record=$(co_find_record "$sid")
  [ -f "$record" ]
  jq -e --slurpfile p "$FIX/mid-session.json" '
    .observer_format == 1 and .session_id == $p[0].session_id
    and .context_window.remaining_percentage == $p[0].context_window.remaining_percentage
    and .context_window.used_percentage == $p[0].context_window.used_percentage
    and .context_window.context_window_size == $p[0].context_window.context_window_size
    and .context_window.current_usage_null == false
    and (.transcript_present | type == "boolean")' "$record" >/dev/null
  run --separate-stderr co_read_observation "$sid"
  echo "$output" | jq -e --slurpfile p "$FIX/mid-session.json" \
    '.remaining_percentage == $p[0].context_window.remaining_percentage' >/dev/null
}

@test "T09: the startup payload (null usage and percentages) records current_usage_null and reads as unknown" {
  local f="$FIX/startup-null.json" sid record
  jq -e '.context_window.current_usage == null and .context_window.remaining_percentage == null' "$f" >/dev/null
  sid=$(jq -r '.session_id' "$f")
  python3 "$OBS" < "$f" >/dev/null
  record=$(co_find_record "$sid")
  jq -e '.context_window.current_usage_null == true and .context_window.remaining_percentage == null' "$record" >/dev/null
  run --separate-stderr co_read_observation "$sid"
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

@test "R20: staleness window: 600 s old is unknown, 60 s old is fresh, the 300 s boundary holds" {
  observe stale 61
  set_observed_at "$(record_for stale)" "$(iso_ago 600)"
  run --separate-stderr co_read_observation stale
  [ "$output" = "unknown" ]
  set_observed_at "$(record_for stale)" "$(iso_ago 60)"
  run --separate-stderr co_read_observation stale
  echo "$output" | jq -e '.remaining_percentage == 61' >/dev/null
  set_observed_at "$(record_for stale)" "$(iso_ago 290)"
  run --separate-stderr co_read_observation stale
  echo "$output" | jq -e '.remaining_percentage == 61' >/dev/null
  set_observed_at "$(record_for stale)" "$(iso_ago 310)"
  run --separate-stderr co_read_observation stale
  [ "$output" = "unknown" ]
}

@test "R20: a record for another session, a missing record, or an unknown session is unknown" {
  observe mine 61
  cp "$(record_for mine)" "$(record_for theirs)"
  run --separate-stderr co_read_observation theirs
  [ "$output" = "unknown" ]
  run --separate-stderr co_read_observation nobody
  [ "$output" = "unknown" ]
  run --separate-stderr co_read_observation unknown
  [ "$output" = "unknown" ]
}

@test "R20: out-of-range, string and null percentages are unknown, never 0" {
  local r
  for r in 101 -1 '"61"' null; do
    observe "range" "$r"
    run --separate-stderr co_read_observation range
    [ "$output" = "unknown" ]
    [[ "$output" != *0* ]]
  done
}

@test "R20: a newline planted in observed_at cannot smuggle a forged object" {
  observe spoof 61
  jq --arg ts "$(iso_ago 0)" '.observed_at = ($ts + "\n{\"remaining_percentage\":50,\"note\":\"IGNORE PREVIOUS\"}")' \
    "$(record_for spoof)" > "$TEST_HOME/r" && mv "$TEST_HOME/r" "$(record_for spoof)"
  run --separate-stderr co_read_observation spoof
  [ "$output" = "unknown" ]
}

@test "R20: a malformed or wrong-format record is unknown" {
  observe shape 61
  printf 'not json' > "$(record_for shape)"
  run --separate-stderr co_read_observation shape
  [ "$output" = "unknown" ]
  observe shape 61
  jq '.observer_format = 2' "$(record_for shape)" > "$TEST_HOME/r" && mv "$TEST_HOME/r" "$(record_for shape)"
  run --separate-stderr co_read_observation shape
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
  run --separate-stderr co_read_observation killed
  echo "$output" | jq -e '.remaining_percentage == 70' >/dev/null
  # At most one orphan data file, and no lock file exists any more.
  [ "$(find "$(dirname "$(record_for killed)")" -name '*.tmp' | wc -l | tr -d ' ')" -eq 0 ]
  [ "$(find "$(dirname "$(record_for killed)")" -name '*.part' | wc -l | tr -d ' ')" -le 1 ]
}

@test "T10: SIGTERM mid-write unwinds, removes the temp file and keeps the previous record" {
  local killer
  killer=$(command -v timeout || command -v gtimeout || true)
  [ -n "$killer" ] || skip "timeout/gtimeout not available"
  observe termed 70
  cp "$(record_for termed)" "$TEST_HOME/before"
  payload termed 30 > "$TEST_HOME/in"
  CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME=5 run "$killer" -s TERM 1 python3 "$OBS" < "$TEST_HOME/in"
  cmp "$TEST_HOME/before" "$(record_for termed)"
  [ -z "$(find "$(dirname "$(record_for termed)")" -name '*.tmp' -o -name '*.part')" ]
}

@test "T10: a stale orphan data file is swept and a fresh one is left alone" {
  local dir
  observe orphan 70
  dir=$(dirname "$(record_for orphan)")
  printf '{"partial' > "$dir/.orphan.999999.part"
  printf '{"partial' > "$dir/.orphan.999998.part"
  python3 -c 'import os, sys, time; t = time.time() - 60; os.utime(sys.argv[1], (t, t))' "$dir/.orphan.999999.part"
  observe orphan 30
  jq -e '.context_window.remaining_percentage == 30' "$(record_for orphan)" >/dev/null
  [ ! -e "$dir/.orphan.999999.part" ]
  [ -e "$dir/.orphan.999998.part" ]
}

@test "T10: through the installed command, the next stage sees EOF before the record write finishes" {
  local start eof cmd
  # The next stage copies the payload, then records when it saw EOF.
  seed_settings "cat > $TEST_HOME/out; python3 -c 'import time; print(time.time())' > $TEST_HOME/eof"
  setup_py install >/dev/null
  cmd=$(jq -r '.statusLine.command' "$SETTINGS")
  [[ "$cmd" == "$(obs_stage "$OBS_DEST") | "* ]]
  payload eof 61 > "$TEST_HOME/in"
  start=$(python3 -c 'import time; print(time.time())')
  CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME=3 bash -c "$cmd" < "$TEST_HOME/in"
  eof=$(cat "$TEST_HOME/eof")
  cmp "$TEST_HOME/in" "$TEST_HOME/out"
  python3 -c 'import sys; sys.exit(0 if float(sys.argv[2]) - float(sys.argv[1]) < 2 else 1)' "$start" "$eof"
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

@test "R22: the observer stays near its 100 ms latency target on the largest fixture (limit 250 ms, 1000 ms on CI)" {
  # The limit only catches gross regressions (a subprocess, a network call);
  # the measured best of five is printed below. A shared CI runner gets a
  # looser limit, and CONTEXT_OBSERVER_LATENCY_LIMIT_MS overrides both. Each
  # run uses its own session id, so every timed run writes a record instead
  # of taking the unchanged-sample early return; the script checks each one.
  local largest best limit
  limit=${CONTEXT_OBSERVER_LATENCY_LIMIT_MS:-$([ -n "${CI:-}" ] && echo 1000 || echo 250)}
  largest=$(ls -S "$FIX"/*.json | head -n 1)
  best=$(python3 - "$OBS" "$largest" <<'PY'
import glob, json, os, subprocess, sys, time
obs, fixture = sys.argv[1], sys.argv[2]
payload = json.load(open(fixture, "rb"))
records = os.path.join(os.environ["HOME"], ".claude", "projects", "*", "context-observations")
runs = []
for n in range(5):
    sid = payload["session_id"] = "r22-%d" % n
    data = json.dumps(payload).encode()
    start = time.perf_counter()
    subprocess.run([sys.executable, obs], input=data, stdout=subprocess.DEVNULL, check=True)
    runs.append((time.perf_counter() - start) * 1000)
    found = glob.glob(os.path.join(records, sid + ".json"))
    record = json.load(open(found[0])) if len(found) == 1 else {}
    if record.get("session_id") != sid or record.get("context_window", {}).get(
            "remaining_percentage") != payload["context_window"]["remaining_percentage"]:
        sys.exit("run %d wrote no complete record" % n)
print("%.1f" % min(runs))
PY
)
  { echo "# observer best of 5 on $(basename "$largest"): ${best} ms (limit ${limit} ms)" >&3; } 2>/dev/null || true
  python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) < float(sys.argv[2]) else 1)' "$best" "$limit"
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

@test "T11: install and plan with no statusLine are refused, so remove can always restore what was there" {
  seed_settings none
  run --separate-stderr setup_py plan
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error_code == "statusline_missing"' >/dev/null
  run --separate-stderr setup_py install
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error_code == "statusline_missing"' >/dev/null
  cmp "$TEST_HOME/settings.orig" "$SETTINGS"
  [ ! -e "$OBS_DEST" ]
  [ -z "$(find "$TEST_HOME/.claude" -name '*.backup*')" ]
}

@test "T11: install over the yellow statusline composes the pipeline and it renders" {
  seed_settings "python3 $TEST_HOME/.claude/yellow-statusline.py"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  jq -e --arg c "$(obs_stage "$OBS_DEST") | python3 $STATUSLINE" '.statusLine.command == $c' "$SETTINGS" >/dev/null
  run bash -c "$(jq -r '.statusLine.command' "$SETTINGS")" < "$FIX/mid-session.json"
  [ "$output" = "RENDER $(wc -c < "$FIX/mid-session.json" | tr -d ' ')" ]
}

@test "T11: install over a custom command keeps it, backs up settings, and changes only statusLine.command" {
  seed_settings "bash ~/custom.sh"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  jq -e --arg c "$(obs_stage "$OBS_DEST") | bash ~/custom.sh" '.statusLine.command == $c and .statusLine.padding == 0' "$SETTINGS" >/dev/null
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
  jq -e --arg c "$(obs_stage "$OBS_DEST") | ("$'\n'"cat > $TEST_HOME/seen && echo done"$'\n'")" '.statusLine.command == $c' "$SETTINGS" >/dev/null
  run bash -c "$(jq -r '.statusLine.command' "$SETTINGS")" < "$FIX/mid-session.json"
  [ "$output" = "done" ]
  cmp "$FIX/mid-session.json" "$TEST_HOME/seen"
}

@test "T11: a compound command ending in a comment still parses and renders after composition" {
  seed_settings "cat > $TEST_HOME/seen && echo done # my statusline"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  bash -n -c "$(jq -r '.statusLine.command' "$SETTINGS")"
  run bash -c "$(jq -r '.statusLine.command' "$SETTINGS")" < "$FIX/mid-session.json"
  [ "$output" = "done" ]
}

@test "T11: a symlinked settings.json is updated through the link" {
  seed_settings "bash ~/custom.sh"
  mkdir -p "$TEST_HOME/dotfiles"
  mv "$SETTINGS" "$TEST_HOME/dotfiles/settings.json"
  ln -s "$TEST_HOME/dotfiles/settings.json" "$SETTINGS"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  [ -L "$SETTINGS" ]
  jq -e --arg c "$(obs_stage "$OBS_DEST") | bash ~/custom.sh" '.statusLine.command == $c' "$TEST_HOME/dotfiles/settings.json" >/dev/null
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
  echo "$output" | jq -e '.error_code == "statusline_missing"' >/dev/null
  cmp "$TEST_HOME/settings.orig" "$SETTINGS"
  [ ! -e "$OBS_DEST" ]
}

@test "T11: a tilde observer path is expanded before it is quoted into the command" {
  seed_settings "bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" plan --settings "$SETTINGS" \
    --observer-dest '~/.claude/yellow-context-observer.py' --statusline "$STATUSLINE"
  echo "$output" | jq -e --arg c "$(obs_stage "$HOME/.claude/yellow-context-observer.py") | bash ~/custom.sh" '.proposed_command == $c' >/dev/null
}

# --- review round 2 (PR #912): observer ------------------------------------

@test "T09: a session id with a trailing newline writes nothing" {
  payload x 61 | jq -c '.session_id = "valid123\n"' | python3 "$OBS" >/dev/null
  [ -z "$(find "$HOME/.claude" -type f 2>/dev/null)" ]
}

@test "T09: without workspace.project_dir the record is keyed by cwd" {
  payload cwdonly 61 | jq -c 'del(.workspace)' | python3 "$OBS" >/dev/null
  [ -f "$(record_for cwdonly)" ]
}

@test "T09: a downstream that closes early still gets exit 0 and a record" {
  payload pipe 61 > "$TEST_HOME/in"
  python3 "$OBS" < "$TEST_HOME/in" | true
  [ "${PIPESTATUS[0]}" -eq 0 ]
  jq -e '.context_window.remaining_percentage == 61' "$(record_for pipe)" >/dev/null
}

@test "T09: an unsafe workspace.project_dir writes nothing outside projects/" {
  local dir
  for dir in '..' 'relative/dir'; do
    jq -c --arg dir "$dir" '.session_id = "unsafe-dir" | .cwd = $dir | .workspace.project_dir = $dir
      | .context_window.remaining_percentage = 61 | .context_window.used_percentage = 39' \
      "$FIX/mid-session.json" | python3 "$OBS" >/dev/null
  done
  [ -z "$(find "$HOME/.claude" -type f 2>/dev/null)" ]
}

@test "T10: an unchanged sample is not rewritten until the record is REWRITE_AFTER_SECONDS old" {
  local recent old
  observe steady 61
  recent=$(iso_ago 30)
  set_observed_at "$(record_for steady)" "$recent"
  observe steady 61
  jq -e --arg ts "$recent" '.observed_at == $ts' "$(record_for steady)" >/dev/null
  old=$(iso_ago 90)
  set_observed_at "$(record_for steady)" "$old"
  observe steady 61
  jq -e --arg ts "$old" '.observed_at != $ts' "$(record_for steady)" >/dev/null
  observe steady 40
  jq -e '.context_window.remaining_percentage == 40' "$(record_for steady)" >/dev/null
}

@test "T10: the recording deadline bounds a hung write and keeps the previous record" {
  local start elapsed
  observe slow 70
  cp "$(record_for slow)" "$TEST_HOME/before"
  payload slow 30 > "$TEST_HOME/in"
  start=$(date +%s)
  CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME=8 \
    python3 "$OBS" < "$TEST_HOME/in" > "$TEST_HOME/out"
  elapsed=$(( $(date +%s) - start ))
  [ "$elapsed" -lt 6 ]
  cmp "$TEST_HOME/in" "$TEST_HOME/out"
  cmp "$TEST_HOME/before" "$(record_for slow)"
  [ -z "$(find "$(dirname "$(record_for slow)")" -name '*.tmp' -o -name '*.part')" ]
}

@test "the observer prints its usage for --help instead of reading stdin" {
  run --separate-stderr python3 "$OBS" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"opt-in context observer"* ]]
  [ -z "$(find "$HOME/.claude" -type f 2>/dev/null)" ]
}

# --- review round 2: reader --------------------------------------------------

@test "R20: with records under two project directories the newest one wins" {
  local other
  observe twice 70
  other="$HOME/.claude/projects/-elsewhere/context-observations"
  mkdir -p "$other"
  jq '.context_window.remaining_percentage = 20' "$(record_for twice)" > "$other/twice.json"
  touch -d '2 minutes ago' "$(record_for twice)" 2>/dev/null \
    || python3 -c 'import os, sys, time; t = time.time() - 120; os.utime(sys.argv[1], (t, t))' "$(record_for twice)"
  run --separate-stderr co_read_observation twice
  echo "$output" | jq -e '.remaining_percentage == 20' >/dev/null
}

@test "R20: CONTEXT_OBSERVER_DEBUG=1 says why the reading is unknown" {
  CONTEXT_OBSERVER_DEBUG=1 run --separate-stderr co_read_observation nobody
  [ "$output" = "unknown" ]
  [[ "$stderr" == *"no record for this session"* ]]
  run --separate-stderr co_read_observation nobody
  [ -z "$stderr" ]
}

# --- review round 2: setup helper -------------------------------------------

@test "T11: every result carries the same eight keys, with error_code on refusals" {
  local keys='["action","backup","error_code","existing_command","observer","proposed_command","reason","settings"]'
  seed_settings "bash ~/custom.sh"
  run --separate-stderr setup_py plan
  echo "$output" | jq -e --argjson k "$keys" 'keys == $k and .error_code == null' >/dev/null
  printf '[1, 2]\n' > "$SETTINGS"
  run --separate-stderr setup_py install
  [ "$status" -eq 1 ]
  echo "$output" | jq -e --argjson k "$keys" 'keys == $k and .error_code == "settings_not_object"' >/dev/null
  printf '{"statusLine": "python3 x"}\n' > "$SETTINGS"
  run --separate-stderr setup_py install
  echo "$output" | jq -e '.error_code == "statusline_not_object"' >/dev/null
  seed_settings "bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" install --settings "$SETTINGS" --observer-src "$TEST_HOME/missing.py" \
    --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error_code == "observer_src_missing"' >/dev/null
  cmp "$TEST_HOME/settings.orig" "$SETTINGS"
  [ ! -e "$OBS_DEST" ]
}

@test "T11: a usage error is JSON with exit 2, and --help lists every subcommand" {
  run --separate-stderr python3 "$SETUP_PY" bogus
  [ "$status" -eq 2 ]
  echo "$output" | jq -e '.action == "error" and .error_code == "usage"' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"statusline"* && "$output" == *"plan"* && "$output" == *"install"* && "$output" == *"remove"* ]]
}

@test "T11: a second install over changed settings keeps the first backup and adds a numbered one" {
  seed_settings "bash ~/custom.sh"
  setup_py install >/dev/null
  jq '.statusLine.command = "bash ~/other.sh" | .extra = 1' "$SETTINGS" > "$TEST_HOME/s" && mv "$TEST_HOME/s" "$SETTINGS"
  cp "$SETTINGS" "$TEST_HOME/second.orig"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  cmp "$TEST_HOME/settings.orig" "$SETTINGS.pre-observer.backup"
  cmp "$TEST_HOME/second.orig" "$SETTINGS.pre-observer.backup.2"
}

@test "T11: a missing or outdated observer copy is reported by plan and refreshed by install" {
  seed_settings "bash ~/custom.sh"
  setup_py install >/dev/null
  cp "$SETTINGS" "$TEST_HOME/installed"
  rm -f "$OBS_DEST"
  run --separate-stderr setup_py plan --observer-src "$OBS"
  echo "$output" | jq -e '.action == "refresh"' >/dev/null
  run --separate-stderr setup_py install
  echo "$output" | jq -e '.action == "refreshed"' >/dev/null
  cmp "$OBS" "$OBS_DEST"
  printf '# old copy\n' > "$OBS_DEST"
  run --separate-stderr setup_py install
  echo "$output" | jq -e '.action == "refreshed"' >/dev/null
  cmp "$OBS" "$OBS_DEST"
  cmp "$TEST_HOME/installed" "$SETTINGS"
}

@test "T11: remove restores the wrapped command, simple or compound, and backs up settings" {
  local cmd
  for cmd in "bash ~/custom.sh" "cat > /dev/null && echo done # note"; do
    seed_settings "$cmd"
    setup_py install >/dev/null
    run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$OBS_DEST"
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.action == "removed" and (.backup | type == "string")' >/dev/null
    jq -e --arg c "$cmd" '.statusLine.command == $c' "$SETTINGS" >/dev/null
    rm -f "$SETTINGS".pre-observer.backup*
  done
}

@test "T11: remove handles the manual-merge form and reports not-installed for a trailing, non-leading mention" {
  seed_settings "python3 ~/.claude/yellow-context-observer.py | bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest '~/.claude/yellow-context-observer.py'
  echo "$output" | jq -e '.action == "removed"' >/dev/null
  jq -e '.statusLine.command == "bash ~/custom.sh"' "$SETTINGS" >/dev/null
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest '~/.claude/yellow-context-observer.py'
  echo "$output" | jq -e '.action == "not-installed"' >/dev/null
  # The observer's path appears, but not as the leading stage: not "installed" per
  # contains_observer(), so remove reports not-installed rather than refusing.
  seed_settings "bash ~/custom.sh | python3 $TEST_HOME/.claude/yellow-context-observer.py"
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "not-installed"' >/dev/null
  cmp "$TEST_HOME/settings.orig" "$SETTINGS"
}

@test "T11: install composes ahead of a command that only tests for the observer's path" {
  # $OBS_DEST is set inside seed_settings, so it is not yet defined here; use
  # the path it will compute (matching the "non-leading mention" test above).
  seed_settings "test -f $TEST_HOME/.claude/yellow-context-observer.py && python3 custom.py"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  jq -e --arg c "$(obs_stage "$OBS_DEST") | ("$'\n'"test -f $OBS_DEST && python3 custom.py"$'\n'")" \
    '.statusLine.command == $c' "$SETTINGS" >/dev/null
}

@test "T11: statusline keeps a composed observer, writes plain otherwise, and recovers invalid JSON" {
  seed_settings "bash ~/custom.sh"
  setup_py install >/dev/null
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  [ "$status" -eq 0 ]
  jq -e --arg c "$(obs_stage "$OBS_DEST") | python3 $STATUSLINE" '.statusLine.command == $c and .statusLine.padding == 0' "$SETTINGS" >/dev/null
  diff <(jq 'del(.statusLine)' "$TEST_HOME/settings.orig") <(jq 'del(.statusLine)' "$SETTINGS")

  seed_settings "bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  jq -e --arg c "python3 $STATUSLINE" '.statusLine.command == $c' "$SETTINGS" >/dev/null

  printf '{"a": ' > "$SETTINGS"
  run --separate-stderr python3 "$SETUP_PY" statusline --dry-run --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "recover"' >/dev/null
  [ "$(cat "$SETTINGS")" = '{"a": ' ]
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e --arg b "$SETTINGS.corrupt.backup" '.action == "recovered" and .backup == $b' >/dev/null
  [ "$(cat "$SETTINGS.corrupt.backup")" = '{"a": ' ]
  jq -e --arg c "python3 $STATUSLINE" '.statusLine.command == $c' "$SETTINGS" >/dev/null

  printf '{\n  // c\n}\n' > "$SETTINGS"
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error_code == "settings_jsonc"' >/dev/null
}

# --- review follow-ups (PR #912) ----------------------------------------------

@test "R20: a future-dated observed_at is unknown; a small forward skew is fresh" {
  observe future 61
  set_observed_at "$(record_for future)" "$(iso_ago -600)"
  run --separate-stderr co_read_observation future
  [ "$output" = "unknown" ]
  set_observed_at "$(record_for future)" "$(iso_ago -30)"
  run --separate-stderr co_read_observation future
  echo "$output" | jq -e '.remaining_percentage == 61' >/dev/null
}

@test "R20: the newest record for the session wins, even over the toplevel's own" {
  local other="$HOME/.claude/projects/-elsewhere/context-observations"
  observe newest 61
  mkdir -p "$other"
  jq '.context_window.remaining_percentage = 42 | .context_window.used_percentage = 58' \
    "$(record_for newest)" > "$other/newest.json"
  touch -d '+5 seconds' "$other/newest.json"
  run --separate-stderr co_read_observation newest
  echo "$output" | jq -e '.remaining_percentage == 42' >/dev/null
}

@test "R20: the reduced object carries the advisory state and the watermark in effect" {
  YELLOW_CONTEXT_WATERMARK=60 observe adv2 30
  run --separate-stderr co_read_observation adv2
  echo "$output" | jq -e '.advisory_crossings == 1 and .advisory_state == "below" and .watermark_remaining == 60' >/dev/null
  observe adv2 90
  run --separate-stderr co_read_observation adv2
  echo "$output" | jq -e '.advisory_crossings == 1 and .advisory_state == "above"' >/dev/null
}

@test "R19: a record that exists but cannot be read is kept, not reset" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores file modes"
  observe locked 30
  cp "$(record_for locked)" "$TEST_HOME/before"
  chmod 000 "$(record_for locked)"
  payload locked 70 | python3 "$OBS" >/dev/null
  chmod 600 "$(record_for locked)"
  cmp "$TEST_HOME/before" "$(record_for locked)"
}

@test "R19: the deadline exception is not an OSError, so cleanup handlers cannot swallow it" {
  run python3 - "$OBS" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("obs", sys.argv[1])
obs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(obs)
assert not issubclass(obs.DeadlineReached, Exception)
PY
  [ "$status" -eq 0 ]
}

@test "R19: closed stdin or closed stdout still exits 0" {
  payload closed 61 > "$TEST_HOME/in"
  run bash -c 'python3 "$1" < "$2" >&-' _ "$OBS" "$TEST_HOME/in"
  [ "$status" -eq 0 ]
  run bash -c 'python3 "$1" <&-' _ "$OBS"
  [ "$status" -eq 0 ]
}

@test "R22: run on a terminal with no payload prints usage and exits 0" {
  command -v script >/dev/null 2>&1 || skip "script(1) not available"
  run script -qec "python3 '$OBS'" /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"opt-in context observer"* ]]
}

# --- setup helper follow-ups ---------------------------------------------------

@test "T11: the composed stage keeps the payload flowing when the observer file is missing" {
  local cmd
  seed_settings "python3 $TEST_HOME/.claude/yellow-statusline.py"
  run --separate-stderr setup_py plan
  cmd=$(echo "$output" | jq -r '.proposed_command')
  [[ "$cmd" == "$(obs_stage "$OBS_DEST") | "* ]]
  [ ! -e "$OBS_DEST" ]
  run --separate-stderr bash -c "printf abc | $cmd"
  [ "$output" = "RENDER 3" ]
}

@test "T11: a destination path with an apostrophe and a space is recognised after install" {
  local dest="$TEST_HOME/Claude's config/yellow-context-observer.py"
  seed_settings "bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" install --settings "$SETTINGS" --observer-src "$OBS" \
    --observer-dest "$dest" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" install --settings "$SETTINGS" --observer-src "$OBS" \
    --observer-dest "$dest" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "already-installed"' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$dest"
  echo "$output" | jq -e '.action == "removed"' >/dev/null
  jq -e '.statusLine.command == "bash ~/custom.sh"' "$SETTINGS" >/dev/null
}

@test "T11: a manual-merge stage using \$HOME is recognised and a '||' fallback is not mistaken for the stage" {
  seed_settings 'python3 $HOME/.claude/yellow-context-observer.py | bash ~/custom.sh'
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  echo "$output" | jq -e '.action == "removed"' >/dev/null
  seed_settings "python3 $OBS_DEST || echo nope"
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  echo "$output" | jq -e '.action == "not-installed"' >/dev/null
}

@test "T11: plan reports refresh when the installed copy is missing and no source is given" {
  seed_settings "$(obs_stage "$TEST_HOME/.claude/yellow-context-observer.py") | python3 $TEST_HOME/.claude/yellow-statusline.py"
  [ ! -e "$OBS_DEST" ]
  run --separate-stderr setup_py plan
  echo "$output" | jq -e '.action == "refresh"' >/dev/null
}

@test "T11: a non-string statusLine.command is refused with command_not_string" {
  seed_settings none
  printf '{"statusLine": {"command": 5}}\n' > "$SETTINGS"
  run --separate-stderr setup_py plan
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error_code == "command_not_string"' >/dev/null
}

@test "T11: a symlinked observer destination is written through and the link survives" {
  seed_settings "bash ~/custom.sh"
  mkdir -p "$TEST_HOME/real"
  : > "$TEST_HOME/real/target.py"
  ln -s "$TEST_HOME/real/target.py" "$OBS_DEST"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  [ -L "$OBS_DEST" ]
  cmp "$OBS" "$TEST_HOME/real/target.py"
}

@test "T11: recovering from invalid settings keeps every corrupt backup and says so" {
  seed_settings none
  printf '{"first": ' > "$SETTINGS"
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "recovered" and (.reason | test("not valid JSON"))' >/dev/null
  printf '{"second": ' > "$SETTINGS"
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  [ "$(cat "$SETTINGS.corrupt.backup")" = '{"first": ' ]
  [ "$(cat "$SETTINGS.corrupt.backup.2")" = '{"second": ' ]
}

@test "T11: an unknown error code is rejected at the raise site" {
  run python3 - "$SETUP_PY" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("setup_mod", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
try:
    m.SetupError("typo_code", "x")
except ValueError:
    sys.exit(0)
sys.exit(1)
PY
  [ "$status" -eq 0 ]
}

@test "T11: the relocated statusline template renders a fixture payload" {
  local tpl="$BATS_TEST_DIRNAME/../references/statusline-setup/statusline-template.py"
  [ -f "$tpl" ] || skip "template not present"
  # /statusline:setup fills the REPLACE_WITH_ placeholders; do the same with empty values.
  sed -e 's/REPLACE_WITH_ISO_TIMESTAMP/test/' -e 's/REPLACE_WITH_DETECTED_PLUGINS/{}/' \
    -e 's/REPLACE_WITH_ENV_REQUIREMENTS/{}/' -e 's/REPLACE_WITH_BOOLEAN/False/' "$tpl" > "$TEST_HOME/statusline.py"
  run --separate-stderr bash -c 'python3 "$1" < "$2"' _ "$TEST_HOME/statusline.py" "$FIX/mid-session.json"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "T10: a post-compact null sample after real values reads unknown and keeps the advisory state" {
  # Synthetic (not host-captured): the mid-session payload with the context
  # numbers nulled, as the host sends them right after /compact.
  observe compact 30
  payload compact null | jq -c '.context_window.current_usage = null' | python3 "$OBS" >/dev/null
  run --separate-stderr co_read_observation compact
  [ "$output" = "unknown" ]
  jq -e '.advisory.crossings == 1 and .advisory.last_state == "below"' "$(record_for compact)" >/dev/null
}

# --- second follow-up round -----------------------------------------------------

reason_for() {
  local rf="$TEST_HOME/reason"
  : > "$rf"
  CO_REASON_FILE="$rf" co_read_observation "$1" >/dev/null
  cat "$rf"
}

@test "R20: every unknown carries a stable reason code" {
  observe why 61
  [ "$(reason_for nobody)" = "no-record" ]
  [ "$(reason_for unknown)" = "no-session-id" ]
  [ "$(reason_for 'bad id')" = "malformed-session-id" ]
  set_observed_at "$(record_for why)" "$(iso_ago 600)"
  [ "$(reason_for why)" = "stale" ]
  observe why 61
  jq '.observer_format = 2' "$(record_for why)" > "$TEST_HOME/r" && mv "$TEST_HOME/r" "$(record_for why)"
  [ "$(reason_for why)" = "format-mismatch" ]
  observe why2 61
  jq '.session_id = "someone-else"' "$(record_for why2)" > "$TEST_HOME/r" && mv "$TEST_HOME/r" "$(record_for why2)"
  [ "$(reason_for why2)" = "other-session" ]
  observe why3 null
  [ "$(reason_for why3)" = "no-percentage" ]
  observe why4 101
  [ "$(reason_for why4)" = "out-of-range" ]
  observe why5 61
  printf 'not json' > "$(record_for why5)"
  [ "$(reason_for why5)" = "record-malformed" ]
}

@test "R20: handoff.sh context prints the context and the reason, and runs no git" {
  local ho="$BATS_TEST_DIRNAME/../skills/session-handoff/scripts/handoff.sh"
  export CLAUDE_PLUGIN_ROOT="$BATS_TEST_DIRNAME/.."
  observe ctx1 40
  CLAUDE_CODE_SESSION_ID=ctx1 run --separate-stderr bash "$ho" context
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.reason == null and .context.remaining_percentage == 40 and .context.advisory_state == "below"' >/dev/null
  CLAUDE_CODE_SESSION_ID=nobody run --separate-stderr bash "$ho" context
  echo "$output" | jq -e '.context == "unknown" and .reason == "no-record"' >/dev/null
  run --separate-stderr env -u CLAUDE_CODE_SESSION_ID bash "$ho" context
  echo "$output" | jq -e '.context == "unknown" and .reason == "no-session-id"' >/dev/null
  run --separate-stderr bash "$ho" context extra
  [ "$status" -eq 2 ]
}

@test "parity: the Python and bash session-id rules and config-dir rules agree" {
  local id py sh
  for id in a a-b_C9 '' 'x y' '../e' $'a\n' 'a/b' "$(printf 'a%.0s' $(seq 1 128))" "$(printf 'a%.0s' $(seq 1 129))"; do
    py=$(python3 - "$OBS" "$id" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("obs", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(1 if m.sanitize_session_id(sys.argv[2]) is not None else 0)
PY
)
    if [[ "$id" =~ $CO_SESSION_ID_RE ]]; then sh=1; else sh=0; fi
    [ "$py" = "$sh" ]
  done
  local pycfg
  pycfg() {
    python3 - "$OBS" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("obs", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(m.config_dir())
PY
  }
  [ "$(pycfg)" = "$(co_config_dir)" ]
  CLAUDE_CONFIG_DIR="$TEST_HOME/elsewhere" [ "$(CLAUDE_CONFIG_DIR="$TEST_HOME/elsewhere" pycfg)" = "$(CLAUDE_CONFIG_DIR="$TEST_HOME/elsewhere" co_config_dir)" ]
}

@test "T11: status is read-only, never fails on a missing statusline, and reports enabled and refresh" {
  seed_settings none
  rm -f "$STATUSLINE"
  run --separate-stderr python3 "$SETUP_PY" status --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "not-enabled"' >/dev/null
  cmp "$SETTINGS" "$TEST_HOME/settings.orig"
  seed_settings "python3 $TEST_HOME/.claude/yellow-statusline.py"
  run --separate-stderr setup_py install
  run --separate-stderr python3 "$SETUP_PY" status --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  echo "$output" | jq -e '.action == "enabled"' >/dev/null
  rm -f "$OBS_DEST"
  run --separate-stderr python3 "$SETUP_PY" status --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  echo "$output" | jq -e '.action == "refresh" and (.reason | length > 0)' >/dev/null
}

@test "T11: --dry-run reports the change and writes nothing" {
  seed_settings "bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" install --dry-run --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "install" and (.proposed_command | startswith("{ command -v python3 "))' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" statusline --dry-run --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "statusline"' >/dev/null
  cmp "$SETTINGS" "$TEST_HOME/settings.orig"
  [ ! -e "$OBS_DEST" ]
  [ -z "$(find "$TEST_HOME/.claude" -name '*.backup*')" ]
  run --separate-stderr setup_py install
  cp "$SETTINGS" "$TEST_HOME/installed"
  run --separate-stderr python3 "$SETUP_PY" remove --dry-run --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  echo "$output" | jq -e '.action == "remove" and .proposed_command == "bash ~/custom.sh"' >/dev/null
  cmp "$SETTINGS" "$TEST_HOME/installed"
}

@test "T11: every path has a default, so install and status work with no flags" {
  seed_settings "python3 $TEST_HOME/.claude/yellow-statusline.py"
  run --separate-stderr python3 "$SETUP_PY" install
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  [ -x "$OBS_DEST" ]
  run --separate-stderr python3 "$SETUP_PY" status
  echo "$output" | jq -e '.action == "enabled"' >/dev/null
  CLAUDE_CONFIG_DIR="$TEST_HOME/other" run --separate-stderr python3 "$SETUP_PY" status
  echo "$output" | jq -e --arg s "$TEST_HOME/other/settings.json" '.action == "not-enabled" and .settings == $s' >/dev/null
}

@test "T11: prune removes only old observation files" {
  local dir="$HOME/.claude/projects/-p/context-observations"
  mkdir -p "$dir"
  : > "$dir/old.json"; : > "$dir/new.json"; : > "$dir/notes.txt"; : > "$dir/.old.1.part"
  touch -d '40 days ago' "$dir/old.json" "$dir/notes.txt" "$dir/.old.1.part"
  run --separate-stderr python3 "$SETUP_PY" prune --older-than-days 30 --dry-run
  echo "$output" | jq -e '.action == "prune" and (.reason | test("would remove 2 "))' >/dev/null
  [ -e "$dir/old.json" ]
  run --separate-stderr python3 "$SETUP_PY" prune --older-than-days 30
  echo "$output" | jq -e '.action == "pruned" and (.reason | test("removed 2 "))' >/dev/null
  [ ! -e "$dir/old.json" ] && [ ! -e "$dir/.old.1.part" ]
  [ -e "$dir/new.json" ] && [ -e "$dir/notes.txt" ]
}

@test "T11: settings backups keep the original and are capped" {
  local i
  seed_settings none
  for i in 1 2 3 4 5 6 7 8; do
    printf '{"n": %d}\n' "$i" > "$SETTINGS"
    run python3 - "$SETUP_PY" "$SETTINGS" "$i" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("ss", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.backup_settings(sys.argv[2], open(sys.argv[2]).read())
PY
    [ "$status" -eq 0 ]
    sleep 0.05
  done
  [ "$(find "$TEST_HOME/.claude" -name 'settings.json.pre-observer.backup*' | wc -l | tr -d ' ')" -le 5 ]
  [ "$(cat "$SETTINGS.pre-observer.backup")" = '{"n": 1}' ]
  grep -qx '{"n": 8}' "$SETTINGS".pre-observer.backup*
}

@test "T11: a refusal also prints error_code: reason on stderr" {
  seed_settings none
  printf '[1, 2]\n' > "$SETTINGS"
  run --separate-stderr setup_py install
  [ "$status" -eq 1 ]
  [[ "$stderr" == "settings_not_object: "* ]]
  echo "$output" | jq -e '.error_code == "settings_not_object"' >/dev/null
}

# --- third review round (PR #912) ------------------------------------------------

@test "T11: install upgrades an older observer stage, guarded or plain, keeping the wrapped command" {
  local old
  for old in "{ python3 $TEST_HOME/.claude/yellow-context-observer.py || cat; }" \
             "python3 $TEST_HOME/.claude/yellow-context-observer.py"; do
    seed_settings "$old | bash ~/custom.sh"
    cp "$OBS" "$OBS_DEST"
    run --separate-stderr python3 "$SETUP_PY" status --settings "$SETTINGS" --observer-dest "$OBS_DEST"
    echo "$output" | jq -e '.action == "refresh" and (.reason | test("older form"))' >/dev/null
    run --separate-stderr setup_py plan
    echo "$output" | jq -e '.action == "upgrade"' >/dev/null
    cmp "$TEST_HOME/settings.orig" "$SETTINGS"
    run --separate-stderr setup_py install
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.action == "upgraded" and (.backup | type == "string")' >/dev/null
    jq -e --arg c "$(obs_stage "$OBS_DEST") | bash ~/custom.sh" '.statusLine.command == $c' "$SETTINGS" >/dev/null
    run --separate-stderr setup_py install
    echo "$output" | jq -e '.action == "already-installed"' >/dev/null
    rm -f "$SETTINGS".pre-observer.backup*
  done
}

@test "T11: a custom --observer-dest file name is recognised by status, install and remove" {
  local dest="$TEST_HOME/custom-observer.py"
  seed_settings "bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" install --settings "$SETTINGS" --observer-src "$OBS" \
    --observer-dest "$dest" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" status --settings "$SETTINGS" --observer-src "$OBS" --observer-dest "$dest"
  echo "$output" | jq -e '.action == "enabled"' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" install --settings "$SETTINGS" --observer-src "$OBS" \
    --observer-dest "$dest" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "already-installed"' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$dest"
  echo "$output" | jq -e '.action == "removed"' >/dev/null
  jq -e '.statusLine.command == "bash ~/custom.sh"' "$SETTINGS" >/dev/null
}

@test "T11: remove refuses an observer stage with nothing after it and writes nothing" {
  seed_settings "$(obs_stage "$TEST_HOME/.claude/yellow-context-observer.py") | "
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.action == "error" and .error_code == "observer_not_removable"' >/dev/null
  cmp "$TEST_HOME/settings.orig" "$SETTINGS"
  [ -z "$(find "$TEST_HOME/.claude" -name '*.backup*')" ]
}

@test "T11: prune reports prune_incomplete when a file cannot be removed" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores directory modes"
  local dir="$HOME/.claude/projects/-p/context-observations"
  mkdir -p "$dir"
  : > "$dir/old.json"
  touch -d '40 days ago' "$dir/old.json"
  chmod 500 "$dir"
  run --separate-stderr python3 "$SETUP_PY" prune --older-than-days 30
  chmod 700 "$dir"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error_code == "prune_incomplete" and (.reason | test("removed 0 of 1"))' >/dev/null
  [ -e "$dir/old.json" ]
}

@test "T11: every emitted error_code is in ERROR_CODES, and fail() maps an unknown one to internal" {
  run python3 - "$SETUP_PY" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("setup_mod", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert {"usage", "io_error", "internal", "prune_incomplete"} <= m.ERROR_CODES
r = m.new_result(None)
m.fail(r, "typo_code", "x")
assert r["error_code"] == "internal" and "typo_code" in r["reason"], r
PY
  [ "$status" -eq 0 ]
}

@test "R19: the record directory is 0700 and the record 0600, even when the directory pre-exists as 0755" {
  local dir
  dir=$(dirname "$(record_for modes)")
  mkdir -p "$dir"
  chmod 755 "$dir"
  observe modes 61
  [ "$(python3 -c 'import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$dir")" = "0o700" ]
  [ "$(python3 -c 'import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$(record_for modes)")" = "0o600" ]
}

@test "R19: NaN and Infinity in the payload are recorded as null, and the record stays strict JSON" {
  payload nonfinite 61 | sed -e 's/"remaining_percentage":61/"remaining_percentage":NaN/' \
    -e 's/"used_percentage":39/"used_percentage":Infinity/' | python3 "$OBS" >/dev/null
  ! grep -qE 'NaN|Infinity' "$(record_for nonfinite)"
  python3 -c 'import json, sys; json.load(open(sys.argv[1]), parse_constant=lambda c: sys.exit("non-JSON token " + c))' \
    "$(record_for nonfinite)"
  jq -e '.context_window.remaining_percentage == null and .context_window.used_percentage == null' \
    "$(record_for nonfinite)" >/dev/null
}

@test "R20: out-of-range optional fields are nulled by the reader" {
  observe ranges 61
  jq '.context_window.used_percentage = 150 | .advisory.crossings = -1 | .advisory.watermark_remaining = 0' \
    "$(record_for ranges)" > "$TEST_HOME/r" && mv "$TEST_HOME/r" "$(record_for ranges)"
  run --separate-stderr co_read_observation ranges
  echo "$output" | jq -e '.remaining_percentage == 61 and .used_percentage == null
    and .advisory_crossings == null and .watermark_remaining == null' >/dev/null
}

# --- ledger follow-ups (PR #912) -----------------------------------------------

@test "R19: the observer is silent by default and says why with CONTEXT_OBSERVER_DEBUG=1" {
  export CLAUDE_CONFIG_DIR="$TEST_HOME/readonly"
  mkdir -p "$CLAUDE_CONFIG_DIR"
  chmod 500 "$CLAUDE_CONFIG_DIR"
  run --separate-stderr python3 "$OBS" < "$FIX/mid-session.json"
  [ "$status" -eq 0 ] && [ -z "$stderr" ]
  if [ "$(id -u)" -ne 0 ]; then
    CONTEXT_OBSERVER_DEBUG=1 run --separate-stderr python3 "$OBS" < "$FIX/mid-session.json"
    [ "$status" -eq 0 ]
    [ "$output" = "$(cat "$FIX/mid-session.json")" ]
    [ "$(printf '%s\n' "$stderr" | wc -l | tr -d ' ')" -eq 1 ]
    [[ "$stderr" == "[context-observer] "* ]]
  fi
  unset CLAUDE_CONFIG_DIR
  CONTEXT_OBSERVER_DEBUG=1 run --separate-stderr python3 "$OBS" < "$FIX/missing-session.json"
  [ "$status" -eq 0 ]
  [ "$stderr" = "[context-observer] skip: session_id missing or malformed" ]
  CONTEXT_OBSERVER_DEBUG=1 run --separate-stderr python3 "$OBS" < "$FIX/malformed.json"
  [ "$stderr" = "[context-observer] skip: payload is not a JSON object" ]
}

@test "R19: a SIGTERM mid-read still forwards what arrived before it" {
  local killer
  killer=$(command -v timeout || command -v gtimeout || true)
  [ -n "$killer" ] || skip "timeout/gtimeout not available"
  # timeout exits 124 once it has sent the signal; that is the point here.
  { printf 'first-part'; sleep 3; printf 'second-part'; } \
    | "$killer" -s TERM 1 python3 "$OBS" > "$TEST_HOME/out" || true
  [ "$(cat "$TEST_HOME/out")" = "first-part" ]
}

@test "T11: remove through a symlinked settings.json keeps the link and restores the target" {
  seed_settings "bash ~/custom.sh"
  mkdir -p "$TEST_HOME/dotfiles"
  mv "$SETTINGS" "$TEST_HOME/dotfiles/settings.json"
  ln -s "$TEST_HOME/dotfiles/settings.json" "$SETTINGS"
  setup_py install >/dev/null
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.action == "removed"' >/dev/null
  [ -L "$SETTINGS" ]
  jq -e '.statusLine.command == "bash ~/custom.sh"' "$TEST_HOME/dotfiles/settings.json" >/dev/null
}

@test "T11: prune rejects a negative or non-integer --older-than-days and deletes nothing" {
  local dir="$HOME/.claude/projects/-p/context-observations" bad
  mkdir -p "$dir"
  : > "$dir/old.json"
  touch -d '40 days ago' "$dir/old.json"
  for bad in -1 abc 1.5; do
    run --separate-stderr python3 "$SETUP_PY" prune --older-than-days "$bad"
    [ "$status" -eq 2 ]
    echo "$output" | jq -e '.action == "error" and .error_code == "usage"' >/dev/null
  done
  [ -e "$dir/old.json" ]
  run --separate-stderr python3 "$SETUP_PY" prune --older-than-days 0 --dry-run
  echo "$output" | jq -e '.action == "prune" and (.reason | test("would remove 1 "))' >/dev/null
}

@test "T11: a gap in the numbered backups never hides an identical backup or reuses a lower number" {
  seed_settings none
  run python3 - "$SETUP_PY" "$SETTINGS" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("ss", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
settings = sys.argv[2]
def backup(text):
    open(settings, "w").write(text)
    return m.backup_settings(settings, text)
first, second, third = backup('{"n": 1}\n'), backup('{"n": 2}\n'), backup('{"n": 3}\n')
assert (first, second, third) == (settings + ".pre-observer.backup",
                                  settings + ".pre-observer.backup.2",
                                  settings + ".pre-observer.backup.3"), (first, second, third)
os.unlink(second)
assert backup('{"n": 3}\n') == third, "identical backup past the gap was not reused"
assert backup('{"n": 4}\n') == settings + ".pre-observer.backup.4", "a new backup filled the gap"
PY
  [ "$status" -eq 0 ]
}

# --- sweep follow-ups (PR #912 bot threads) ------------------------------------

@test "T09: the record does not store cwd" {
  observe nocwd 61
  jq -e 'has("cwd") | not' "$(record_for nocwd)" >/dev/null
}

@test "T09: a symlinked observations directory is refused and nothing is written through it" {
  local slug dir target
  slug=$(printf '%s' "$PROJECT" | tr '/' '-')
  dir="$HOME/.claude/projects/$slug"
  target="$TEST_HOME/elsewhere"
  mkdir -p "$dir" "$target"
  chmod 755 "$target"
  ln -s "$target" "$dir/context-observations"
  run --separate-stderr bash -c 'payload() { jq -c --arg dir "$1" ".session_id = \"linked\" | .cwd = \$dir | .workspace.project_dir = \$dir" "$2"; }
    payload "$1" "$2" | CONTEXT_OBSERVER_DEBUG=1 python3 "$3" >/dev/null' _ "$PROJECT" "$FIX/mid-session.json" "$OBS"
  [ "$status" -eq 0 ]
  [ -z "$(ls -A "$target")" ]
  [ "$(stat -c '%a' "$target")" = "755" ]
  [[ "$stderr" == *"outside"* ]]
}

@test "T11: prune does not follow a symlinked observations directory" {
  local target="$TEST_HOME/elsewhere"
  mkdir -p "$target" "$HOME/.claude/projects/-p"
  : > "$target/old.json"
  touch -d '40 days ago' "$target/old.json"
  ln -s "$target" "$HOME/.claude/projects/-p/context-observations"
  run --separate-stderr python3 "$SETUP_PY" prune --older-than-days 30
  echo "$output" | jq -e '.action == "pruned" and (.reason | test("removed 0 "))' >/dev/null
  [ -e "$target/old.json" ]
}

@test "T11: an observer destination with a literal \$ is recognised after install" {
  seed_settings "bash ~/custom.sh"
  OBS_DEST="$TEST_HOME/lit\$HOME/yellow-context-observer.py"
  run --separate-stderr setup_py install
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  run --separate-stderr python3 "$SETUP_PY" status --settings "$SETTINGS" --observer-src "$OBS" \
    --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "enabled"' >/dev/null
  run --separate-stderr setup_py install
  echo "$output" | jq -e '.action == "already-installed"' >/dev/null
}

@test "T11: a double-quoted observer path with an apostrophe still expands \$HOME" {
  seed_settings "python3 \"\$HOME/it's/yellow-context-observer.py\" | bash ~/custom.sh"
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" \
    --observer-dest "$TEST_HOME/it's/yellow-context-observer.py"
  echo "$output" | jq -e '.action == "removed"' >/dev/null
  jq -e '.statusLine.command == "bash ~/custom.sh"' "$SETTINGS" >/dev/null
}

@test "T11: a command starting with shell negation is wrapped so the composed stage parses" {
  seed_settings "! cat > $TEST_HOME/seen"
  run --separate-stderr setup_py install
  [ "$status" -eq 0 ]
  bash -n -c "$(jq -r '.statusLine.command' "$SETTINGS")"
  run bash -c "$(jq -r '.statusLine.command' "$SETTINGS")" < "$FIX/mid-session.json"
  cmp "$FIX/mid-session.json" "$TEST_HOME/seen"
  run --separate-stderr python3 "$SETUP_PY" remove --settings "$SETTINGS" --observer-dest "$OBS_DEST"
  echo "$output" | jq -e '.action == "removed"' >/dev/null
  jq -e --arg c "! cat > $TEST_HOME/seen" '.statusLine.command == $c' "$SETTINGS" >/dev/null
}

@test "T11: a relative --observer-dest is stored as an absolute path" {
  seed_settings "bash ~/custom.sh"
  cd "$TEST_HOME"
  run --separate-stderr python3 "$SETUP_PY" install --settings "$SETTINGS" --observer-src "$OBS" \
    --observer-dest "rel/yellow-context-observer.py" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "installed"' >/dev/null
  [ -f "$TEST_HOME/rel/yellow-context-observer.py" ]
  jq -r '.statusLine.command' "$SETTINGS" | grep -qF "$TEST_HOME/rel/yellow-context-observer.py"
}

# --- symlinked recovery, error paths and cross-language invariants ------------

@test "T11: a symlinked invalid settings.json is recovered with the corrupt backup next to the link" {
  seed_settings none
  mkdir -p "$TEST_HOME/dotfiles"
  printf '{"a": ' > "$TEST_HOME/dotfiles/settings.json"
  rm -f "$SETTINGS"
  ln -s "$TEST_HOME/dotfiles/settings.json" "$SETTINGS"
  run --separate-stderr python3 "$SETUP_PY" statusline --dry-run --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  echo "$output" | jq -e '.action == "recover" and .backup == null' >/dev/null
  [ -z "$(find "$TEST_HOME" -name '*.corrupt.backup*')" ]
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e --arg b "$SETTINGS.corrupt.backup" '.action == "recovered" and .backup == $b' >/dev/null
  [ -f "$SETTINGS.corrupt.backup" ]
  [ ! -L "$SETTINGS.corrupt.backup" ]
  [ "$(cat "$SETTINGS.corrupt.backup")" = '{"a": ' ]
  [ -z "$(find "$TEST_HOME/dotfiles" -name '*.corrupt.backup*')" ]
  [ -L "$SETTINGS" ]
  jq -e --arg c "python3 $STATUSLINE" '.statusLine.command == $c' "$TEST_HOME/dotfiles/settings.json" >/dev/null
  printf '{"b": ' > "$TEST_HOME/dotfiles/settings.json"
  run --separate-stderr python3 "$SETUP_PY" statusline --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
  echo "$output" | jq -e --arg b "$SETTINGS.corrupt.backup.2" '.action == "recovered" and .backup == $b' >/dev/null
  [ "$(cat "$SETTINGS.corrupt.backup")" = '{"a": ' ]
  [ "$(cat "$SETTINGS.corrupt.backup.2")" = '{"b": ' ]
  [ -z "$(find "$TEST_HOME/dotfiles" -name '*.corrupt.backup*')" ]
}

@test "T11: status and statusline on an unreadable settings.json fail with settings_unreadable and write nothing" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores file modes"
  local sub
  seed_settings "bash ~/custom.sh"
  for sub in status statusline; do
    chmod 000 "$SETTINGS"
    run --separate-stderr python3 "$SETUP_PY" "$sub" --settings "$SETTINGS" --observer-dest "$OBS_DEST" --statusline "$STATUSLINE"
    chmod 600 "$SETTINGS"
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.error_code == "settings_unreadable"' >/dev/null
    cmp "$TEST_HOME/settings.orig" "$SETTINGS"
  done
  [ -z "$(find "$TEST_HOME/.claude" -name '*.backup*')" ]
}

@test "T11: install into an unwritable observer directory fails with io_error and leaves settings unchanged" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores directory modes"
  local dir="$TEST_HOME/observer-dir"
  seed_settings "bash ~/custom.sh"
  mkdir -p "$dir"
  chmod 500 "$dir"
  run --separate-stderr setup_py install --observer-dest "$dir/yellow-context-observer.py"
  chmod 700 "$dir"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error_code == "io_error"' >/dev/null
  cmp "$TEST_HOME/settings.orig" "$SETTINGS.pre-observer.backup"
  cmp "$TEST_HOME/settings.orig" "$SETTINGS"
  [ ! -e "$dir/yellow-context-observer.py" ]
  [ -z "$(find "$dir" -name '.observer.*')" ]
}

@test "T09: an unchanged sample over a future-dated record is rewritten with the current time" {
  local future
  observe steady 61
  future=$(iso_ago -600)
  set_observed_at "$(record_for steady)" "$future"
  observe steady 61
  jq -e --arg ts "$future" '.observed_at != $ts' "$(record_for steady)" >/dev/null
  python3 - "$(jq -r '.observed_at' "$(record_for steady)")" <<'PY'
import calendar, sys, time
age = time.time() - calendar.timegm(time.strptime(sys.argv[1], "%Y-%m-%dT%H:%M:%SZ"))
sys.exit(0 if -5 <= age <= 5 else 1)
PY
}

@test "parity: REWRITE_AFTER_SECONDS stays below CO_STALE_AFTER, so an unchanged session never reads as stale" {
  local rewrite
  rewrite=$(python3 - "$OBS" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("obs", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(m.REWRITE_AFTER_SECONDS)
PY
)
  [ -n "$rewrite" ]
  [ -n "${CO_STALE_AFTER:-}" ]
  [ "$rewrite" -lt "$CO_STALE_AFTER" ]
}
