#!/usr/bin/env bats
# Tests for lib/jev-category-eval.py: the frontmatter parser (against a
# PyYAML-generated golden file; see fixtures/jev-eval/README.md), `run`
# against a local stub endpoint (fixtures/jev-eval/stub_server.py), and the
# offline `report`, including the Tango interval against a Python port of
# PropCIs::scoreci.mp and an independent numeric-MLE check.

bats_require_minimum_version 1.5.0

EVAL="$BATS_TEST_DIRNAME/../lib/jev-category-eval.py"
CRITERIA="$BATS_TEST_DIRNAME/../lib/jev-category-criteria.json"
FIX="$BATS_TEST_DIRNAME/fixtures/jev-eval"

setup_file() {
  export BATS_TEST_TIMEOUT=60
}

setup() {
  if ! command -v python3 >/dev/null 2>&1; then
    # A skip in CI would let a missing interpreter pass the required suite.
    [ -z "${CI:-}" ] || { echo "python3 is required in CI" >&2; return 1; }
    skip "python3 not installed"
  fi
  export PATH="$BATS_TEST_DIRNAME/mocks:$PATH"
  export MOCK_FORBIDDEN_LOG="$BATS_TEST_TMPDIR/forbidden.log"
  KEY="sk-bats-$RANDOM$RANDOM-SECRET"
  REPO="$BATS_TEST_TMPDIR/repo"
  OUT="$BATS_TEST_TMPDIR/out"
  cp -R "$FIX/repo" "$REPO"
  git -C "$REPO" init -q
  git -C "$REPO" add docs
  # Present on disk but never staged: must not be sent.
  mkdir -p "$REPO/docs/solutions/workflow"
  printf -- "---\ntitle: 'Untracked lesson'\nproblem: 'x'\n---\n" > "$REPO/docs/solutions/workflow/untracked.md"
  # Record every git argv the script spawns, and whether the API key reached
  # git's environment.
  REAL_GIT="$(command -v git)"
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  : > "$BATS_TEST_TMPDIR/git-argv.log"
  cat > "$BATS_TEST_TMPDIR/bin/git" <<SHIM
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$BATS_TEST_TMPDIR/git-argv.log"
[ -z "\${TYPESAFE_API_KEY:-}" ] || printf 'KEY-IN-GIT-ENV\n' >> "$BATS_TEST_TMPDIR/git-argv.log"
exec "$REAL_GIT" "\$@"
SHIM
  chmod +x "$BATS_TEST_TMPDIR/bin/git"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  STUB_PID=""
}

teardown() {
  if [ -n "${STUB_PID:-}" ]; then
    kill "$STUB_PID" 2>/dev/null || true
    sleep 0.1
    kill -KILL "$STUB_PID" 2>/dev/null || true
    wait "$STUB_PID" 2>/dev/null || true
  fi
  if [ -s "${MOCK_FORBIDDEN_LOG:-/nonexistent}" ]; then
    echo "forbidden commands were invoked:" >&2
    cat "$MOCK_FORBIDDEN_LOG" >&2
    return 1
  fi
}

# start_stub SCENARIO: start the stub, wait for its port, set URL and LOG.
start_stub() {
  LOG="$BATS_TEST_TMPDIR/requests.jsonl"
  : > "$LOG"
  local port_file="$BATS_TEST_TMPDIR/port"
  python3 "$FIX/stub_server.py" "$1" "$LOG" </dev/null >"$port_file" 2>"$BATS_TEST_TMPDIR/stub.err" 3>&- &
  STUB_PID=$!
  local i
  for i in $(seq 1 50); do
    [ -s "$port_file" ] && break
    kill -0 "$STUB_PID" 2>/dev/null || { cat "$BATS_TEST_TMPDIR/stub.err" >&2; return 1; }
    sleep 0.1
  done
  [ -s "$port_file" ] || { echo "stub did not start" >&2; return 1; }
  URL="http://127.0.0.1:$(cat "$port_file")/v1/systemone"
}

eval_run() {
  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "$URL" --timeout 1 "$@"
}

# assert_no_key: the key is absent from the last run's stdout and stderr
# and from every file the run wrote. Not `run`: that would overwrite $output
# for the caller's later checks.
assert_no_key() {
  [[ "$output" != *"$KEY"* ]]
  [[ "$stderr" != *"$KEY"* ]]
  [ -d "$OUT" ]
  [ -f "$BATS_TEST_TMPDIR/git-argv.log" ]
  local rc=0
  grep -rqF "$KEY" "$OUT" "$BATS_TEST_TMPDIR/git-argv.log" || rc=$?
  # 1 means searched and not found; 0 is a leak and 2 a read error.
  [ "$rc" -eq 1 ]
}

results_file() {
  find "$OUT" -name 'results-*.jsonl' | head -n 1
}

# field PATH-SUFFIX KEY: one field of the results row for that doc.
field() {
  python3 - "$(results_file)" "$1" "$2" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    row = json.loads(line)
    if row.get("path", "").endswith(sys.argv[2]):
        print(json.dumps(row[sys.argv[3]]))
PY
}

# summary KEY: one field of the results file's summary record.
summary() {
  python3 -c 'import json,sys; print(json.dumps(json.loads(open(sys.argv[1]).readlines()[-1])[sys.argv[2]]))' "$(results_file)" "$1"
}

current_sha() {
  python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$CRITERIA"
}

# use_fixture: copy the hand-built report fixture to results.jsonl, made
# under the current criteria file.
use_fixture() {
  sed "s/fixture-sha/$(current_sha)/g" "$FIX/report-results.jsonl" > "$BATS_TEST_TMPDIR/results.jsonl"
}

# judge ROW-REGEX VALUE: set the judgement of matching TSV rows in place,
# keeping the file private.
judge() {
  awk -F'\t' -v re="$1" -v j="$2" 'BEGIN{OFS="\t"} $1 ~ re {$6=j} {print}' \
    "$BATS_TEST_TMPDIR/disagreements.tsv" > "$BATS_TEST_TMPDIR/judged.tsv"
  cat "$BATS_TEST_TMPDIR/judged.tsv" > "$BATS_TEST_TMPDIR/disagreements.tsv"
  rm -f "$BATS_TEST_TMPDIR/judged.tsv"
}

# --- frontmatter ----------------------------------------------------------

@test "frontmatter: parser matches the PyYAML golden output" {
  run python3 - "$EVAL" "$FIX/frontmatter" "$FIX/frontmatter-expected.json" <<'PY'
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("ev", sys.argv[1])
ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)
expected = json.load(open(sys.argv[3]))
for name, want in sorted(expected.items()):
    got = ev.parse_frontmatter(open(os.path.join(sys.argv[2], name), encoding="utf-8").read())
    if got != want:
        print("MISMATCH", name, got, want)
        sys.exit(1)
print("checked", len(expected))
PY
  [ "$status" -eq 0 ]
  [ "$output" = "checked 4" ]
}

@test "frontmatter: rejects input outside the subset with a line number" {
  printf -- '---\r\ntitle: one\r\n---\r\n' > "$BATS_TEST_TMPDIR/err-crlf.md"
  printf -- '\xef\xbb\xbf---\ntitle: one\n---\n' > "$BATS_TEST_TMPDIR/err-bom.md"
  cp "$FIX"/frontmatter/err-*.md "$BATS_TEST_TMPDIR/"
  run python3 - "$EVAL" "$BATS_TEST_TMPDIR" <<'PY'
import glob, importlib.util, os, sys
spec = importlib.util.spec_from_file_location("ev", sys.argv[1])
ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)
for p in sorted(glob.glob(os.path.join(sys.argv[2], "err-*.md"))):
    try:
        ev.parse_frontmatter(open(p, encoding="utf-8", newline="").read())
        print(os.path.basename(p), "PARSED")
    except ev.FrontmatterError as e:
        print(os.path.basename(p), e)
PY
  [ "$status" -eq 0 ]
  [[ "$output" == *"err-bom.md line 1: byte order mark"* ]]
  [[ "$output" == *"err-colon.md line 2: \`: \` inside a plain scalar"* ]]
  [[ "$output" == *"err-crlf.md line 1: CR line ending"* ]]
  [[ "$output" == *"err-duplicate.md line 3: duplicate key 'title'"* ]]
  [[ "$output" == *"err-tab.md line 3: tab indentation"* ]]
  [[ "$output" == *"err-unterminated.md line 2: unterminated quoted scalar"* ]]
  [[ "$output" != *PARSED* ]]
}

@test "frontmatter: CR in the body is fine, a surrogate escape is not" {
  run python3 - "$EVAL" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("ev", sys.argv[1])
ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)
print(ev.parse_frontmatter("---\ntitle: ok\n---\nbody with\r\nCRLF\r\n")["title"])
try:
    ev.parse_frontmatter('---\ntitle: "\\ud83d"\n---\n')
    print("PARSED")
except ev.FrontmatterError as e:
    print(e)
PY
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "ok" ]
  [ "${lines[1]}" = "line 2: surrogate escape" ]
}

@test "criteria: keys equal VALID_CATEGORIES in scripts/validate-solutions.js" {
  local js="$BATS_TEST_DIRNAME/../../../scripts/validate-solutions.js"
  [ -f "$js" ]
  run python3 - "$CRITERIA" "$js" <<'PY'
import json, re, sys
crit = set(json.load(open(sys.argv[1]))["criteria"])
block = re.search(r"VALID_CATEGORIES = new Set\(\[(.*?)\]\)", open(sys.argv[2]).read(), re.S).group(1)
valid = set(re.findall(r"'([a-z-]+)'", block))
print("equal" if crit == valid else "criteria=%s valid=%s" % (sorted(crit), sorted(valid)))
PY
  [ "$status" -eq 0 ]
  [ "$output" = "equal" ]
}

@test "criteria: a malformed criteria file is a usage error" {
  mkdir -p "$BATS_TEST_TMPDIR/lib"
  cp "$EVAL" "$BATS_TEST_TMPDIR/lib/"
  python3 - "$CRITERIA" "$BATS_TEST_TMPDIR/lib/jev-category-criteria.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
data["protocol"]["go_rule"]["look_at_n"] = 0
json.dump(data, open(sys.argv[2], "w"))
PY
  use_fixture
  run --separate-stderr python3 "$BATS_TEST_TMPDIR/lib/jev-category-eval.py" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"missing or out-of-range protocol value"* ]]
  printf '{not json' > "$BATS_TEST_TMPDIR/lib/jev-category-criteria.json"
  run --separate-stderr python3 "$BATS_TEST_TMPDIR/lib/jev-category-eval.py" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"criteria file is not valid UTF-8 JSON"* ]]
}

# --- run ------------------------------------------------------------------

@test "run --dry-run counts docs and sends nothing" {
  start_stub ok
  run --separate-stderr env -u TYPESAFE_API_KEY python3 "$EVAL" run --repo "$REPO" --url "$URL" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"eligible_docs=3 (dev=2 test=0 holdout=1)"* ]]
  [[ "$output" == *"skipped: archived=1, no-frontmatter=1, unknown-folder=1"* ]]
  [[ "$output" == *"estimated_input_bytes="* ]]
  [ ! -s "$LOG" ]
  [ ! -e "$OUT" ]
}

@test "run: usage errors exit 2" {
  local offline="http://127.0.0.1:9/x"
  run --separate-stderr env -u TYPESAFE_API_KEY python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "$offline"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"TYPESAFE_API_KEY is not set"* ]]

  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$REPO" --out "$REPO/out" --url "$offline"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"--out must be outside the repository"* ]]

  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "http://localhost:1/x"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"loopback IP"* ]]

  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "https://user:pw@api.example/x"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"credentials"* ]]
  [[ "$stderr" != *"$KEY"* && "$stderr" != *":pw@"* ]]

  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "$offline" --timeout nan
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"--timeout must be between"* ]]

  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "http://127.0.0.1:99999/x"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"invalid port"* ]]

  run --separate-stderr env TYPESAFE_API_KEY="bad key" python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "$offline"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"printable ASCII"* && "$stderr" != *"bad key"* ]]
  [ ! -e "$OUT" ]

  mkdir -p "$OUT" && chmod 0777 "$OUT"
  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$REPO" --out "$OUT" --url "$offline"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"writable by other users"* ]]
}

@test "run: no eligible docs is a usage error and writes nothing" {
  local empty="$BATS_TEST_TMPDIR/empty"
  mkdir -p "$empty" && git -C "$empty" init -q
  run --separate-stderr env TYPESAFE_API_KEY="$KEY" python3 "$EVAL" run --repo "$empty" --out "$OUT" --url "http://127.0.0.1:9/x"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"no eligible docs to send"* ]]
  [ ! -e "$OUT" ]
}

@test "run: sends only tracked, non-archived frontmatter, never body text or the key" {
  start_stub ok
  eval_run
  [ "$status" -eq 0 ]
  [[ "$output" == *"status: ok=3"* ]]
  assert_no_key
  [ "$(stat -c %a "$(results_file)")" = "600" ]
  # git ran with the key removed from its environment and with the
  # repository's fsmonitor and hooks disabled.
  run grep -c 'KEY-IN-GIT-ENV' "$BATS_TEST_TMPDIR/git-argv.log"
  [ "$output" = "0" ]
  run grep -c -- '-c core.fsmonitor=false -c core.hooksPath=/dev/null' "$BATS_TEST_TMPDIR/git-argv.log"
  [ "$output" -ge 2 ]
  run python3 - "$LOG" <<'PY'
import json, sys
reqs = [json.loads(l) for l in open(sys.argv[1])]
for r in reqs:
    assert set(r["body"]) == {"model", "state", "questions"}, r["body"].keys()
    assert set(r["body"]["state"]) == {"lesson"}
    assert set(r["body"]["state"]["lesson"]) == {"title", "problem", "tags"}
    assert set(r["body"]["questions"]) == {"category"}
print(sorted(r["body"]["state"]["lesson"]["title"] for r in reqs))
print(sorted(json.dumps(r["body"]["state"]["lesson"]) for r in reqs)[1])
PY
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "['Alpha lesson', 'Beta lesson', 'Gamma lesson']" ]]
  [[ "${lines[1]}" == '{"title": "Beta lesson", "problem": "Beta problem statement", "tags": ["beta-tag", "shared"]}' ]]
  run grep -c 'BODY-SENTINEL' "$LOG"
  [ "$output" = "0" ]
  # Each row's lesson_sha is the sha256 of the lesson it sent.
  run python3 - "$LOG" "$(results_file)" <<'PY'
import hashlib, json, sys
sent = [r["body"]["state"]["lesson"] for r in map(json.loads, open(sys.argv[1]))]
rows = [r for r in map(json.loads, open(sys.argv[2])) if "record" not in r]
want = {hashlib.sha256(json.dumps(l, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest() for l in sent}
assert {r["lesson_sha"] for r in rows} == want and len(want) == 3
print("ok")
PY
  [ "$output" = "ok" ]
  # The key reaches the server only as the bearer header.
  run python3 -c 'import json,sys; print({json.loads(l)["headers"].get("authorization") for l in open(sys.argv[1])})' "$LOG"
  [ "$output" = "{'Bearer $KEY'}" ]
}

@test "run: rows record split, prediction, filtered probabilities and model; a summary ends the file" {
  start_stub ok
  eval_run
  [ "$status" -eq 0 ]
  assert_no_key
  [ "$(field gamma.md split)" = '"holdout"' ]
  [ "$(field gamma.md date)" = '"2027-03-01"' ]
  [ "$(field alpha.md split)" = '"dev"' ]
  [ "$(field beta.md prediction)" = '"code-quality"' ]
  [ "$(field beta.md confidence)" = '0.62' ]
  [ "$(field beta.md model_returned)" = '"jev-1.13.0"' ]
  [ "$(field beta.md status)" = '"ok"' ]
  run field beta.md probabilities
  [[ "$output" != *bogus* ]]
  [ "$(field alpha.md criteria_sha)" = "\"$(current_sha)\"" ]
  [ "$(summary eligible)" = "3" ]
  [ "$(summary written)" = "3" ]
  [ "$(summary aborted)" = "false" ]
  [ "$(summary limit)" = "null" ]
  [ "$(summary skipped)" = '{"archived": 1, "no-frontmatter": 1, "unknown-folder": 1}' ]
}

@test "run: 500 after one retry becomes an error row and all-failed exits 1" {
  start_stub 500
  eval_run
  [ "$status" -eq 1 ]
  assert_no_key
  [ "$(wc -l < "$LOG")" -eq 6 ]
  [ "$(field alpha.md status)" = '"error:http-500"' ]
  [ "$(field alpha.md prediction)" = 'null' ]
  [ "$(summary written)" = "3" ]
}

@test "run: 429 is retried once and then succeeds" {
  start_stub 429-then-200
  eval_run
  [ "$status" -eq 0 ]
  assert_no_key
  [ "$(wc -l < "$LOG")" -eq 6 ]
  [[ "$output" == *"status: ok=3"* ]]
}

@test "run: a choice outside the criteria is invalid; no usable answer exits 1" {
  start_stub invalid
  eval_run
  [ "$status" -eq 1 ]
  assert_no_key
  [ "$(field alpha.md status)" = '"invalid"' ]
  [ "$(field alpha.md prediction)" = 'null' ]
}

@test "run: a body that is not an answer is error:bad-response, not invalid" {
  start_stub garbage
  eval_run
  [ "$status" -eq 1 ]
  assert_no_key
  [ "$(field alpha.md status)" = '"error:bad-response"' ]
  [[ "$output" == *"status: error:bad-response=3"* ]]
}

@test "run: a redirect is not followed" {
  start_stub redirect
  eval_run
  [ "$status" -eq 1 ]
  assert_no_key
  [ "$(field alpha.md status)" = '"error:redirect"' ]
  # The stub logs GETs too, so a followed redirect would appear here.
  run grep -c '"/target"' "$LOG"
  [ "$output" = "0" ]
  run grep -c '"method": "GET"' "$LOG"
  [ "$output" = "0" ]
}

@test "run: a slow endpoint becomes an error:timeout row" {
  start_stub timeout
  eval_run --limit 1
  [ "$status" -eq 1 ]
  assert_no_key
  [ "$(field alpha.md status)" = '"error:timeout"' ]
  [ "$(summary limit)" = "1" ]
}

@test "run: stops after five consecutive failed requests" {
  for i in 1 2 3 4 5 6 7; do
    printf -- "---\ntitle: 'Extra %d'\nproblem: 'p'\ndate: 2026-01-01\n---\n" "$i" > "$REPO/docs/solutions/workflow/extra-$i.md"
  done
  git -C "$REPO" add docs/solutions/workflow/extra-*.md
  start_stub 500
  eval_run
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"stopped after 5 consecutive failed requests"* ]]
  [[ "$output" == *"requests=5 of 10"* ]]
  [ "$(summary written)" = "5" ]
  [ "$(summary aborted)" = "true" ]
  assert_no_key
}

# --- report ---------------------------------------------------------------

@test "report: agreement, Wilson interval, threshold coverage and confusion" {
  use_fixture
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"coverage: complete, 14 of 14 eligible docs"* ]]
  [[ "$output" == *"split test: n=12 ok=10 error=1 invalid=1"* ]]
  [[ "$output" == *"agreement 7/10 = 70.0% of ok rows (Wilson 95% 39.7%-89.2%)"* ]]
  [[ "$output" == *"conf>=0.70: coverage 7/10 = 70.0%, agreement 5/7 = 71.4%"* ]]
  [[ "$output" == *"conf>=0.95: coverage 4/10 = 40.0%, agreement 3/4 = 75.0%"* ]]
  [[ "$output" == *"confusion (folder -> jev): code-quality -> logic-errors 2; workflow -> integration-issues 1"* ]]
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (holdout has 0 docs"* ]]
  run cut -f1 "$BATS_TEST_TMPDIR/disagreements.tsv"
  [ "${lines[0]}" = "path" ]
  [ "${#lines[@]}" -eq 5 ]
  [ "$(stat -c %a "$BATS_TEST_TMPDIR/disagreements.tsv")" = "600" ]
}

@test "report: judgements merge across runs; changed ones are kept as stale" {
  use_fixture
  python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" >/dev/null
  judge 't8\.md$' jev
  judge 't10\.md$' folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"test: folder 8/9 = 88.9%, jev 8/9 = 88.9%; awaiting judgement 1"* ]]
  [[ "$output" == *"(4 disagreements, 0 agreements listed, 2 judged)"* ]]
  run grep -cE $'\tjev\t[0-9a-f]{64}$' "$BATS_TEST_TMPDIR/disagreements.tsv"
  [ "$output" = "1" ]
  # t8's prediction changes: its judgement no longer applies but is kept.
  sed -i '/t8.md/s/"prediction": "logic-errors"/"prediction": "workflow"/' "$BATS_TEST_TMPDIR/results.jsonl"
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 judgement(s) kept as kind=stale"* ]]
  [[ "$output" == *"(4 disagreements, 0 agreements listed, 1 judged)"* ]]
  run grep -cE $'t8.md\tcode-quality\tlogic-errors\t\tstale\tjev\t[0-9a-f]{64}$' "$BATS_TEST_TMPDIR/disagreements.tsv"
  [ "$output" = "1" ]
  # The stale mark survives a further run too.
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [[ "$output" == *"1 judgement(s) kept as kind=stale"* ]]
}

@test "report: a judgement does not carry over to edited frontmatter" {
  use_fixture
  python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" >/dev/null
  judge 't10\.md$' folder
  # Same path, folder and Jev answer, but the lesson sent was different.
  sed -i '/t10.md/s/"lesson_sha": "[0-9a-f]*"/"lesson_sha": "'"$(printf 'b%.0s' $(seq 64))"'"/' "$BATS_TEST_TMPDIR/results.jsonl"
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 judgement(s) kept as kind=stale"* ]]
  [[ "$output" == *"(4 disagreements, 0 agreements listed, 0 judged)"* ]]
}

@test "report: keeps orphaned judgements and protects an existing judged TSV" {
  use_fixture
  python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" >/dev/null
  judge 't10\.md$' folder
  # A separate review file would overwrite the judged TSV: refused.
  printf 'path\tfolder\tjev\tlesson_sha\tjudgement\n' > "$BATS_TEST_TMPDIR/other.tsv"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/other.tsv"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"missing from --review that this run would overwrite"* ]]
  # t10 leaves the results: its judgement survives as an orphan row.
  sed -i '/t10.md/d' "$BATS_TEST_TMPDIR/results.jsonl"
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 judgement(s) kept as kind=orphan"* ]]
  run grep -cE $'\torphan\tfolder\t[0-9a-f]{64}$' "$BATS_TEST_TMPDIR/disagreements.tsv"
  [ "$output" = "1" ]
}

@test "report: refuses to overwrite a judged TSV it will not read" {
  use_fixture
  python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" >/dev/null
  judge 't10\.md$' folder
  chmod 0664 "$BATS_TEST_TMPDIR/disagreements.tsv"
  cp "$BATS_TEST_TMPDIR/disagreements.tsv" "$BATS_TEST_TMPDIR/before.tsv"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"is not a private regular file you own"* ]]
  cmp "$BATS_TEST_TMPDIR/before.tsv" "$BATS_TEST_TMPDIR/disagreements.tsv"
  # Passing it explicitly is the way through.
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/disagreements.tsv"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 judged)"* ]]
}

@test "report: a bad judgement value or a malformed judged row is a usage error" {
  use_fixture
  printf 'path\tfolder\tjev\tlesson_sha\tjudgement\nx\ty\tz\tw\tmaybe\n' > "$BATS_TEST_TMPDIR/review.tsv"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"review.tsv:2: judgement must be one of"* ]]
  printf 'path\tfolder\tjev\tlesson_sha\tjudgement\nnot/a/doc\tworkflow\tworkflow\t%s\tboth\n' "$(printf 'a%.0s' $(seq 64))" > "$BATS_TEST_TMPDIR/review.tsv"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"review.tsv:2: judged row has a malformed path, folder, jev or lesson_sha"* ]]
  printf 'path\tfolder\tjev\tlesson_sha\tjudgement\ndocs/solutions/workflow/x.md\tworkflow\tworkflow\tnot-a-sha\tboth\n' > "$BATS_TEST_TMPDIR/review.tsv"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"review.tsv:2: judged row has a malformed path, folder, jev or lesson_sha"* ]]
}

@test "report: refuses mixed criteria shas, mixed models and repeated paths" {
  sed '1s/fixture-sha/other-sha/' "$FIX/report-results.jsonl" > "$BATS_TEST_TMPDIR/mixed.jsonl"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/mixed.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"mix 2 criteria shas"* ]]
  sed '1s/"model_returned": "jev-1.13.0"/"model_returned": "jev-1.14.0"/' "$FIX/report-results.jsonl" > "$BATS_TEST_TMPDIR/mixed.jsonl"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/mixed.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"mix models"* ]]
  # Row 11 returned no model, so only its requested model can reveal the mix.
  sed '11s/"model_requested": "jev-1.13.0"/"model_requested": "jev-1.14.0"/' "$FIX/report-results.jsonl" > "$BATS_TEST_TMPDIR/mixed.jsonl"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/mixed.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"mix requested models"* ]]
  { head -n 1 "$FIX/report-results.jsonl"; cat "$FIX/report-results.jsonl"; } > "$BATS_TEST_TMPDIR/dup.jsonl"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/dup.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"repeats path"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/disagreements.tsv" ]
}

@test "report: rejects rows that could inject terminal escapes or TSV rows" {
  python3 - "$FIX/report-results.jsonl" > "$BATS_TEST_TMPDIR/bad.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
rows[0]["path"] = "docs/solutions/code-quality/x\tjev.md"
print("\n".join(json.dumps(r) for r in rows))
PY
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/bad.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"bad.jsonl:1 has a bad path"* ]]
  # A trailing newline would pass a `$`-anchored re.match.
  for field in path folder prediction lesson_sha; do
    python3 - "$FIX/report-results.jsonl" "$field" > "$BATS_TEST_TMPDIR/bad.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
rows[0][sys.argv[2]] += "\n"
print("\n".join(json.dumps(r) for r in rows))
PY
    run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/bad.jsonl"
    [ "$status" -eq 2 ]
    [[ "$stderr" == *"bad.jsonl:1 has a bad $field"* ]]
  done
  sed '1s/"prediction": "code-quality"/"prediction": "\\u001b]0;x\\u0007"/' "$FIX/report-results.jsonl" > "$BATS_TEST_TMPDIR/bad.jsonl"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/bad.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"has a bad prediction"* ]]
  printf '\xff\xfe\n' > "$BATS_TEST_TMPDIR/bad.jsonl"
  run --separate-stderr python3 "$EVAL" report "$BATS_TEST_TMPDIR/bad.jsonl"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"is not UTF-8"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/disagreements.tsv" ]
}

# make_holdout N DISAGREE [SHA] [NO-SUMMARY]: N holdout rows (by path), the
# first DISAGREE with Jev disagreeing, made under SHA (default: the current
# criteria file) and ending in a complete-run summary unless NO-SUMMARY is
# set; then report once to list the rows for judging.
make_holdout() {
  rm -f "$BATS_TEST_TMPDIR/disagreements.tsv" "$BATS_TEST_TMPDIR/review.tsv"
  python3 - "$1" "$2" "${3:-$(current_sha)}" "${4:-}" > "$BATS_TEST_TMPDIR/results.jsonl" <<'PY'
import json, sys
n, bad, sha, no_summary = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
for i in range(n):
    print(json.dumps({"schema": 1, "path": "docs/solutions/workflow/h%03d.md" % i, "folder": "workflow",
        "split": "holdout", "date": "2027-01-01", "lesson_sha": "%064x" % i, "prediction": "code-quality" if i < bad else "workflow",
        "confidence": 0.9, "probabilities": {}, "model_requested": "jev-1.13.0", "model_returned": "jev-1.13.0",
        "criteria_sha": sha, "latency_s": 0.1, "input_tokens": 900, "status": "ok"}))
if not no_summary:
    print(json.dumps({"schema": 1, "record": "summary", "criteria_sha": sha, "eligible": n, "written": n,
        "limit": None, "aborted": False, "skipped": {}}))
PY
  python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" >/dev/null
}

# judge_all JUDGEMENT: judge every listed disagreement JUDGEMENT and every
# listed agreement both, into review.tsv.
judge_all() {
  awk -F'\t' -v j="$1" 'BEGIN{OFS="\t"} NR==1 {print; next} {$6 = ($5 == "disagreement" ? j : "both"); print}' \
    "$BATS_TEST_TMPDIR/disagreements.tsv" > "$BATS_TEST_TMPDIR/review.tsv"
}

@test "report: verdict GO, NO-GO and INSUFFICIENT-DATA" {
  make_holdout 160 0
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl"
  [[ "$output" == *"verdict: INSUFFICIENT-DATA ("*"of the first 155 holdout docs await a judgement"* ]]
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"verdict: GO (lower bound above -0.10)"* ]]
  [[ "$output" == *"on 155 adjudicated holdout docs: jev-only 0, folder-only 0, Tango 90% interval [-0.0172, 0.0172]"* ]]

  make_holdout 160 60
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"verdict: NO-GO (upper bound below -0.10)"* ]]

  make_holdout 160 16
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (interval straddles -0.10)"* ]]
  [[ "$output" == *"jev-only 0, folder-only 16"* ]]

  make_holdout 40 0
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (holdout has 40 docs, the look is at 155; descriptive only)"* ]]
}

@test "report: no verdict for results from another criteria file or a partial run" {
  make_holdout 160 0 fixture-sha
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"criteria_sha: fixture-sha (differs from the current criteria file"* ]]
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (the results were made under another criteria file"* ]]

  make_holdout 160 0 "" no-summary
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"coverage: partial: the results file has no run summary"* ]]
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (the results file has no run summary"* ]]

  make_holdout 160 0
  sed -i '$s/"limit": null/"limit": 160/' "$BATS_TEST_TMPDIR/results.jsonl"
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (the run used --limit 160"* ]]

  make_holdout 160 0
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv" --seed 1
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (--seed 1 is not the pre-registered seed 0"* ]]
  [[ "$output" != *"verdict: GO"* ]]
  [[ "$output" != *"verdict: NO-GO"* ]]
}

@test "report: errors in the holdout window block the verdict; invalid counts as a Jev miss" {
  make_holdout 160 0
  sed -i '1s/"prediction": "workflow"/"prediction": null/; 1s/"status": "ok"/"status": "error:timeout"/' "$BATS_TEST_TMPDIR/results.jsonl"
  python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" >/dev/null
  judge_all folder
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"verdict: INSUFFICIENT-DATA (1 of the first 155 holdout docs have no answer (request errors); make a new full run"* ]]
  sed -i '1s/"status": "error:timeout"/"status": "invalid"/' "$BATS_TEST_TMPDIR/results.jsonl"
  run python3 "$EVAL" report "$BATS_TEST_TMPDIR/results.jsonl" --review "$BATS_TEST_TMPDIR/review.tsv"
  [[ "$output" == *"verdict: GO"* ]]
  [[ "$output" == *"on 155 adjudicated holdout docs: jev-only 0, folder-only 1"* ]]
}

@test "report: Tango interval agrees with a PropCIs port and an independent MLE check" {
  # Reference values from a line-for-line Python port of PropCIs 0.3-0
  # R/scoreci.mp.R; R itself was not available when they were recorded, so
  # replace them with real scoreci.mp output when it can be run. PropCIs
  # estimates (c - b) / n, so its b is our folder-only count and its c our
  # jev-only count. Columns: folder_only jev_only n conf.level lower upper.
  run python3 - "$EVAL" <<'PY'
import importlib.util, sys
from statistics import NormalDist
spec = importlib.util.spec_from_file_location("ev", sys.argv[1])
ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)
REF = [
    (40, 20, 160, 0.95, -0.218064, -0.030865),
    (20, 40, 160, 0.95, 0.030865, 0.218064),
    (17, 14, 136, 0.90, -0.091070, 0.046469),
    (5, 30, 155, 0.90, 0.103714, 0.223478),
    (0, 0, 155, 0.90, -0.017156, 0.017156),
    (10, 10, 155, 0.90, -0.049699, 0.049699),
    (3, 25, 155, 0.90, 0.091553, 0.199200),
    (0, 3, 10, 0.90, 0.023175, 0.558300),
]
for folder_only, jev_only, n, conf, lo, hi in REF:
    z = NormalDist().inv_cdf(1 - (1 - conf) / 2)
    got = ev.tango_interval(jev_only, folder_only, n, z)
    assert abs(got[0] - lo) < 1e-6 and abs(got[1] - hi) < 1e-6, (folder_only, jev_only, n, got)
# Closed form for b = c = 0: upper = z^2 / (n + z^2).
z = NormalDist().inv_cdf(0.95)
assert abs(ev.tango_interval(0, 0, 155, z)[1] - z * z / (155 + z * z)) < 1e-9

# Independent of the port: the restricted MLE of p21 found by ternary
# search on the multinomial log-likelihood, not the closed-form root, so a
# formula slip or a b/c swap copied into REF would still show up here.
import math, random
def score(b, c, n, d):
    a = n - b - c
    lo, hi = max(0.0, -d), (1 - d) / 2
    def ll(q):
        return sum(k * math.log(max(p, 1e-300)) for k, p in ((b, q + d), (c, q), (a, 1 - 2 * q - d)) if k)
    for _ in range(100):
        m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        lo, hi = (m1, hi) if ll(m1) < ll(m2) else (lo, m2)
    var = n * (2 * (lo + hi) / 2 + d - d * d)
    num = b - c - n * d
    return num / math.sqrt(var) if var > 0 else (0.0 if num == 0 else math.copysign(math.inf, num))
def interval(b, c, n, z):
    def solve(t, lo, hi):
        for _ in range(60):
            m = (lo + hi) / 2
            lo, hi = (m, hi) if score(b, c, n, m) > t else (lo, m)
        return (lo + hi) / 2
    e = (b - c) / n
    return (-1.0 if c == n else solve(z, -1 + 1e-12, e), 1.0 if b == n else solve(-z, e, 1 - 1e-12))
rng = random.Random(1)
cases = [(j, f, n) for f, j, n, _, _, _ in REF]
for _ in range(10):
    n = rng.randint(5, 300); b = rng.randint(0, n); cases.append((b, rng.randint(0, n - b), n))
for b, c, n in cases:
    x, y = ev.tango_interval(b, c, n, z), interval(b, c, n, z)
    assert abs(x[0] - y[0]) < 1e-6 and abs(x[1] - y[1]) < 1e-6, (b, c, n, x, y)
print("ok")
PY
  [ "$status" -eq 0 ]
  [ "$output" = "ok" ]
}
