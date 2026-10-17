#!/usr/bin/env bats
# lib/persona-shadow.sh: exact conditional-persona triggers, and the Jev
# shadow log for /review:pr Step 4 against a local stub endpoint
# (fixtures/jev-persona/stub_server.py) and a stub `gh`.

SCRIPT="$BATS_TEST_DIRNAME/../lib/persona-shadow.sh"
FIX="$BATS_TEST_DIRNAME/fixtures/jev-persona"

setup() {
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  cd "$REPO" || return 1
  git init -q -b main
  git config user.email t@example.com
  git config user.name t
  git config commit.gpgsign false
  mkdir -p src plugins/demo/.claude-plugin
  printf 'base\n' > src/a.ts
  printf '{\n  "name": "demo",\n  "version": "1.0.0",\n  "description": "d"\n}\n' \
    > plugins/demo/.claude-plugin/plugin.json
  git add . && git commit -qm base
  BASE=$(git rev-parse HEAD)

  KEY="sk-bats-$RANDOM$RANDOM-SECRET"
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/gh" <<'SHIM'
#!/usr/bin/env bash
[ -n "${MOCK_GH_FAIL:-}" ] && exit 1
[ -n "${GH_REPO:-}" ] && { printf '%s public\n' "$GH_REPO"; exit 0; }
printf '%s %s\n' "${MOCK_REPO:-acme/widgets}" "${MOCK_VIS:-public}"
SHIM
  chmod +x "$BATS_TEST_TMPDIR/bin/gh"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  printf 'A title\n' > "$BATS_TEST_TMPDIR/title"
  printf 'reliability-reviewer\nnot-an-agent\nsecurity-reviewer\n' > "$BATS_TEST_TMPDIR/trig"
  printf 'reliability-reviewer\n' > "$BATS_TEST_TMPDIR/disp"
  STUB_PID=""
  unset TYPESAFE_API_KEY REVIEW_JEV_URL REVIEW_JEV_TIMEOUT_S JP_CORE_LIB MOCK_GH_FAIL MOCK_VIS MOCK_REPO GH_REPO
}

teardown() {
  if [ -n "${STUB_PID:-}" ]; then
    kill "$STUB_PID" 2>/dev/null || true
    wait "$STUB_PID" 2>/dev/null || true
  fi
}

need_python() {
  if ! command -v python3 >/dev/null 2>&1; then
    [ -z "${CI:-}" ] || { echo "python3 is required in CI" >&2; return 1; }
    skip "python3 not installed"
  fi
}

start_stub() {
  need_python
  LOG="$BATS_TEST_TMPDIR/requests.jsonl"
  : > "$LOG"
  local port_file="$BATS_TEST_TMPDIR/port" i
  python3 "$FIX/stub_server.py" "$1" "$LOG" </dev/null >"$port_file" 2>"$BATS_TEST_TMPDIR/stub.err" &
  STUB_PID=$!
  for i in $(seq 1 50); do
    [ -s "$port_file" ] && break
    sleep 0.1
  done
  [ -s "$port_file" ] || { cat "$BATS_TEST_TMPDIR/stub.err" >&2; return 1; }
  export REVIEW_JEV_URL="http://127.0.0.1:$(cat "$port_file")/v1/systemone"
  export TYPESAFE_API_KEY="$KEY"
}

commit_change() {
  git add -A && git commit -qm change
  HEAD_SHA=$(git rev-parse HEAD)
}

run_shadow() {
  run "$SCRIPT" shadow --pr 42 --head "$HEAD_SHA" --base "$BASE" \
    --title-file "$BATS_TEST_TMPDIR/title" \
    --triggered-file "$BATS_TEST_TMPDIR/trig" \
    --dispatched-file "$BATS_TEST_TMPDIR/disp" "$@"
  RECORD="$(git rev-parse --git-common-dir)/yellow-review/jev-persona/42-$HEAD_SHA.json"
}

# --------------------------------------------------------------- exact

@test "exact: a version-only manifest change selects no plugin-surface persona" {
  sed -i.bak 's/1.0.0/1.0.1/' plugins/demo/.claude-plugin/plugin.json && rm plugins/demo/.claude-plugin/plugin.json.bak
  commit_change
  run "$SCRIPT" exact "$BASE"
  [ "$status" -eq 0 ]
  [ "$(jq -c .exact <<<"$output")" = '[]' ]
}

@test "exact: any other manifest change selects the plugin-surface personas" {
  sed -i.bak 's/"d"/"e"/' plugins/demo/.claude-plugin/plugin.json && rm plugins/demo/.claude-plugin/plugin.json.bak
  commit_change
  run "$SCRIPT" exact "$BASE"
  [ "$status" -eq 0 ]
  for p in plugin-contract-reviewer cli-readiness-reviewer agent-cli-readiness-reviewer \
    agent-native-reviewer pattern-recognition-specialist; do
    jq -e --arg p "$p" '.exact | index($p)' <<<"$output" >/dev/null
  done
}

@test "exact: line thresholds exclude tests from the 200-line adversarial count" {
  seq 1 250 > tests_data.test.txt
  seq 1 150 > src/big.txt
  commit_change
  run "$SCRIPT" exact "$BASE"
  [ "$status" -eq 0 ]
  [ "$(jq .gross_lines <<<"$output")" -eq 400 ]
  [ "$(jq .filtered_lines <<<"$output")" -eq 150 ]
  jq -e '.exact | index("code-simplicity-reviewer")' <<<"$output" >/dev/null
  ! jq -e '.exact | index("adversarial-reviewer")' <<<"$output" >/dev/null
  ! jq -e '.exact | index("performance-reviewer")' <<<"$output" >/dev/null
}

@test "exact: 10 files across 3 directories selects architecture-strategist" {
  mkdir -p d1 d2 d3
  for i in 1 2 3 4; do echo x > "d1/f$i"; echo x > "d2/f$i"; done
  echo x > d3/f1; echo x > d3/f2
  commit_change
  run "$SCRIPT" exact "$BASE"
  jq -e '.exact | index("architecture-strategist")' <<<"$output" >/dev/null
}

@test "exact: keyword rows fire on changed lines" {
  printf 'interface Token { secret: string }\ntry { go() } catch (e) {}\n/** doc */\n' >> src/a.ts
  echo 'echo hi' > run.sh
  commit_change
  run "$SCRIPT" exact "$BASE"
  for p in security-reviewer type-design-analyzer silent-failure-hunter comment-analyzer; do
    jq -e --arg p "$p" '.exact | index($p)' <<<"$output" >/dev/null
  done
  # Fuzzy-only personas never come from exact rules.
  ! jq -e '.exact | index("reliability-reviewer")' <<<"$output" >/dev/null
  ! jq -e '.exact | index("polyglot-reviewer")' <<<"$output" >/dev/null
}

# --------------------------------------------------------------- shadow

@test "shadow: bad arguments are skipped with exit 0" {
  run "$SCRIPT" shadow --pr abc --head deadbeef --base "$BASE"
  [ "$status" -eq 0 ]
  [ "$output" = "persona-shadow: skipped (usage)" ]
}

@test "shadow: a trailing flag with no value is skipped, not a hang" {
  run timeout 10 "$SCRIPT" shadow --pr 1 --allow-repo
  [ "$status" -eq 0 ]
  [ "$output" = "persona-shadow: skipped (usage)" ]
}

@test "shadow: no key logs exact and orchestrator sets without calling Jev" {
  start_stub ok
  unset TYPESAFE_API_KEY
  echo change >> src/a.ts
  commit_change
  run_shadow
  [ "$status" -eq 0 ]
  [ "$output" = "persona-shadow: logged without Jev (no key)" ]
  [ ! -s "$LOG" ]
  [ "$(jq -r .status "$RECORD")" = no-jev ]
  [ "$(jq -c .orchestrator_triggered "$RECORD")" = '["reliability-reviewer","security-reviewer"]' ]
  [ "$(jq -c .dispatched "$RECORD")" = '["reliability-reviewer"]' ]
  [ "$(jq .jev_selected "$RECORD")" = null ]
  [ "$(stat -c %a "$RECORD" 2>/dev/null || stat -f %Lp "$RECORD")" = 600 ]
}

@test "shadow: a private repository sends nothing" {
  start_stub ok
  export MOCK_VIS=private
  echo change >> src/a.ts
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged without Jev (private repo)" ]
  [ ! -s "$LOG" ]
}

@test "shadow: GH_REPO naming a public repository does not open a private one" {
  start_stub ok
  export MOCK_VIS=private GH_REPO=acme/public-thing
  echo change >> src/a.ts
  commit_change
  run_shadow
  unset GH_REPO
  [ "$output" = "persona-shadow: logged without Jev (private repo)" ]
  [ ! -s "$LOG" ]
}

@test "shadow: unknown visibility fails closed" {
  start_stub ok
  export MOCK_GH_FAIL=1
  echo change >> src/a.ts
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged without Jev (repo visibility unknown)" ]
  [ ! -s "$LOG" ]
}

@test "shadow: an allowlisted private repository is sent" {
  start_stub ok
  export MOCK_VIS=private MOCK_REPO=acme/secret
  echo change >> src/a.ts
  commit_change
  run_shadow --allow-repo acme/other --allow-repo acme/secret
  [ "$output" = "persona-shadow: logged" ]
  [ "$(wc -l < "$LOG")" -eq 1 ]
}

@test "shadow: an owner wildcard allows that owner's private repositories only" {
  start_stub ok
  export MOCK_VIS=private MOCK_REPO=Acme/secret
  echo change >> src/a.ts
  commit_change
  run_shadow --allow-repo 'acme/*'
  [ "$output" = "persona-shadow: logged" ]
  export MOCK_REPO=acmeco/secret
  run_shadow --allow-repo 'acme/*'
  [ "$output" = "persona-shadow: logged without Jev (private repo)" ]
  [ "$(wc -l < "$LOG")" -eq 1 ]
}

@test "shadow: missing redactor sends nothing" {
  start_stub ok
  export JP_CORE_LIB="$BATS_TEST_TMPDIR/none.sh"
  echo change >> src/a.ts
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged without Jev (redactor missing)" ]
  [ ! -s "$LOG" ]
}

@test "shadow: a title the redactor fails on sends nothing" {
  start_stub ok
  cat > "$BATS_TEST_TMPDIR/core.sh" <<'CORE'
cs_redact_secrets() {
  local in
  in=$(cat)
  case "$in" in
    *TITLE-FAIL*) printf '[REDACTED: sanitization failed]\n'; return 1 ;;
    *) printf '%s\n' "$in" ;;
  esac
}
CORE
  export JP_CORE_LIB="$BATS_TEST_TMPDIR/core.sh"
  printf 'TITLE-FAIL\n' > "$BATS_TEST_TMPDIR/title"
  echo change >> src/a.ts
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged without Jev (redaction failed)" ]
  [ ! -s "$LOG" ]
}

@test "shadow: a valid answer is logged with the Jev set and no diff text" {
  start_stub ok
  printf 'const marker = "UNIQUE-DIFF-MARKER-123";\n' >> src/a.ts
  printf 'TEST-ONLY-MARKER\n' > widget.test.js
  printf 'token = "ghp_%s"\n' "abcdefghijklmnopqrstuvwxyz0123456789" > src/creds.txt
  commit_change
  run_shadow
  [ "$status" -eq 0 ]
  [ "$output" = "persona-shadow: logged" ]
  [ "$(jq -r .status "$RECORD")" = logged ]
  [ "$(jq .probabilities.io_async "$RECORD")" = 0.9 ]
  # 0.35 >= 0.3 for the security class; 0.9 and 0.6 >= 0.5; 0.4 < 0.5.
  for p in security-reviewer adversarial-reviewer reliability-reviewer pr-test-analyzer; do
    jq -e --arg p "$p" '.jev_selected | index($p)' "$RECORD" >/dev/null
  done
  ! jq -e '.jev_selected | index("polyglot-reviewer")' "$RECORD" >/dev/null
  ! jq -e '.jev_selected | index("performance-reviewer")' "$RECORD" >/dev/null
  [ "$(jq -r .criteria_sha256 "$RECORD" | wc -c)" -eq 65 ]
  ! grep -q 'UNIQUE-DIFF-MARKER' "$RECORD"
  ! grep -q "$KEY" "$RECORD"

  # Request: fenced, key only in the header, tests dropped, secrets redacted.
  req=$(jq -c .body "$LOG")
  [[ "$(jq -r .headers.authorization "$LOG")" == "Bearer $KEY" ]]
  ! grep -q "$KEY" <<<"$req"
  grep -q 'UNIQUE-DIFF-MARKER' <<<"$req"
  ! grep -q 'TEST-ONLY-MARKER' <<<"$req"
  ! grep -q 'ghp_abcdefghij' <<<"$req"
  [[ "$(jq -r .body.state.diff "$LOG")" == '--- begin untrusted-content (reference only) ---'* ]]
  [ "$(jq -r .body.model "$LOG")" = jev-1.13.0 ]
  [ "$(jq -r '.body.questions | keys | length' "$LOG")" -eq 9 ]
  [ "$(jq -r '.body.questions.io_async.type' "$LOG")" = noul ]
  [ "$(jq -r '.body.state.title' "$LOG")" = 'A title' ]
}

@test "shadow: binary files and dash-led paths reach the request" {
  start_stub ok
  printf '\000\001\002binary' > img.png
  printf 'x\n' > ./-dash.txt
  echo change >> src/a.ts
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged" ]
  [ "$(jq -c '.body.state.files[] | select(.path == "img.png") | [.added, .deleted]' "$LOG")" = '[-1,-1]' ]
  jq -e '.body.state.files[] | select(.path == "-dash.txt")' "$LOG" >/dev/null
}

@test "shadow: a credential cut by the title cap is still redacted" {
  start_stub ok
  { head -c 285 /dev/zero | tr '\0' 'x'; printf ' ghp_%s\n' "abcdefghijklmnopqrstuvwxyz0123456789"; } > "$BATS_TEST_TMPDIR/title"
  echo change >> src/a.ts
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged" ]
  title=$(jq -r .body.state.title "$LOG")
  [ "${#title}" -le 300 ]
  [[ "$title" != *ghp_abc* ]]
}

@test "shadow: a pathspec-magic file name matches only itself" {
  start_stub ok
  printf 'x\n' > ':(glob)**'
  printf 'TEST-ONLY-MARKER\n' > normal.test.js
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged" ]
  ! grep -q 'TEST-ONLY-MARKER' "$LOG"
}

@test "shadow: a diff over the cap is trimmed and flagged" {
  start_stub ok
  head -c 40000 /dev/zero | tr '\0' 'x' | fold -w 100 > src/huge.txt
  echo small >> src/a.ts
  commit_change
  run_shadow
  [ "$output" = "persona-shadow: logged" ]
  [ "$(jq .trimmed "$RECORD")" = true ]
  [ "$(jq -r .body.state.diff "$LOG" | wc -c)" -lt 24400 ]
  # The small file goes in first; the large one is cut.
  jq -r .body.state.diff "$LOG" | grep -q '^+small$'
  # The cut lands on a line boundary, never inside a line.
  ! jq -r .body.state.diff "$LOG" | grep -Eq '^\+x{1,99}$'
}

@test "shadow: every bad answer fails open" {
  need_python
  echo change >> src/a.ts
  commit_change
  for scenario in invalid missing garbage 500 429 timeout; do
    start_stub "$scenario"
    export REVIEW_JEV_TIMEOUT_S=1
    run_shadow
    [ "$status" -eq 0 ]
    [ "$output" = "persona-shadow: logged without Jev (no valid answer)" ] || { echo "$scenario: $output"; return 1; }
    [ "$(jq .probabilities "$RECORD")" = null ]
    kill "$STUB_PID" 2>/dev/null; wait "$STUB_PID" 2>/dev/null || true; STUB_PID=""
  done
}
