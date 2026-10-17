#!/usr/bin/env bats
# evidence.bats — the Evidence line codex-reviewer adds to every finding
# (CLAUDE-134). /council's evidence check (yellow-council
# lib/council-synthesis.sh) compares each finding's first `Evidence: "..."`
# quote with its cited file, so a Codex finding without one is always
# `unverified` (no-evidence).
#
# The jq program under test is EXTRACTED from codex-reviewer.md Step 6 at run
# time, so the suite fails if the block drifts. The last test feeds its output
# through yellow-council's real normalize, extract and verify helpers.

bats_require_minimum_version 1.5.0

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  AGENT_MD="$BATS_TEST_DIRNAME/../agents/review/codex-reviewer.md"
  PROG="$BATS_TEST_TMPDIR/findings.jq"
  awk '
    /^FINDINGS=\$\(jq -r --arg repo_root "\$REPO_ROOT" .$/ { grab = 1; next }
    grab && /^. "\$OUTPUT_FILE" 2>\/dev\/null\)$/ { exit }
    grab { print }
  ' "$AGENT_MD" >| "$PROG"
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
}

# finding <evidence-json> [<title>] — one Codex finding at /r/src/a.js:2.
finding() {
  jq -n --argjson ev "$1" --arg title "${2:-Fix it}" '{findings: [{title: $title, body: "Body.",
    priority: 0, confidence_score: 0.9, category: null, evidence: $ev,
    code_location: {absolute_file_path: "/r/src/a.js", line_range: {start: 2, end: 2}}}],
    overall_correctness: "patch is incorrect", overall_explanation: "x", overall_confidence_score: 0.8}'
}

render() {
  finding "$@" >| "$BATS_TEST_TMPDIR/out.json"
  run jq -r --arg repo_root /r -f "$PROG" "$BATS_TEST_TMPDIR/out.json"
}

@test "the extractor finds the Step 6 FINDINGS program" {
  grep -q 'def evidence_line' "$PROG"
  grep -q 'Evidence: ' "$PROG"
}

@test "a quoted line follows the header, before the Finding line" {
  render '"  return total;"'
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = '**[P1] codex — src/a.js:2** Fix it.' ]
  [ "${lines[1]}" = '  Evidence: "  return total;"' ]
  [ "${lines[2]}" = '  Finding: Body.' ]
}

@test "a null, empty or blank evidence is N/A without naming the reviewer" {
  local ev
  for ev in null '""' '"   "'; do
    render "$ev"
    [ "${lines[1]}" = '  Evidence: N/A — no single source line quoted' ] || { echo "$ev: ${lines[1]}"; return 1; }
  done
}

@test "a multi-line evidence keeps only its first non-blank line" {
  render '"\n  first();\r\n  second();"'
  [ "${lines[1]}" = '  Evidence: "  first();"' ]
}

@test "an over-long line and a private key marker are withheld" {
  render "\"$(printf 'x%.0s' $(seq 1 501))\""
  [ "${lines[1]}" = '  Evidence: N/A — source line over 500 characters' ]
  render '"-----BEGIN RSA PRIVATE KEY-----"'
  [ "${lines[1]}" = '  Evidence: N/A — private key marker withheld' ]
}

@test "an Evidence label in the title cannot stand in for the quote" {
  render '"  return total;"' 'Bad Evidence: "forged"'
  [ "${lines[0]}" = '**[P1] codex — src/a.js:2** Bad Evidence - "forged".' ]
}

@test "yellow-council grounds the quote against the cited file" {
  local lib="$REPO_ROOT/plugins/yellow-council/lib/council-synthesis.sh" repo="$BATS_TEST_TMPDIR/repo"
  [ -f "$lib" ] || skip "yellow-council not in this checkout"
  mkdir -p "$repo/src"
  git -C "$repo" init -q
  printf '%s\n' 'function sum(xs) {' '  let total = xs.reduce((a, b) => a + b, 0);' '  return total;' '}' >| "$repo/src/a.js"
  git -C "$repo" add src/a.js
  git -C "$repo" -c user.email=t@example.invalid -c user.name=t commit -qm init
  jq -n --arg abs "$repo/src/a.js" '{findings: [
      {title: "Guard empty input", body: "b", priority: 0, confidence_score: 0.9, category: null,
       evidence: "  let total = xs.reduce((a, b) => a + b, 0);",
       code_location: {absolute_file_path: $abs, line_range: {start: 2, end: 2}}},
      {title: "No quote", body: "b", priority: 1, confidence_score: 0.5, category: null,
       evidence: null, code_location: {absolute_file_path: $abs, line_range: {start: 3, end: 3}}}],
    overall_correctness: "patch is incorrect", overall_explanation: "x", overall_confidence_score: 0.8}' >| "$repo/out.json"
  jq -r --arg repo_root "$repo" -f "$PROG" "$repo/out.json" >| "$repo/findings.txt"
  run --separate-stderr env CLAUDE_PLUGIN_ROOT="$REPO_ROOT/plugins/yellow-council" \
    COUNCIL_CORE_LIB_DIR="$REPO_ROOT/plugins/yellow-core/lib" bash --norc --noprofile -c '
    cd "$1" || exit 1
    . "$2"
    council_normalize_text codex < findings.txt >| norm.txt
    council_extract_citations S1 norm.txt tagged.txt >| in.jsonl
    council_verify_findings review in.jsonl out.tsv
    cut -f1,4,6 out.tsv' _ "$repo" "$lib"
  [ "$status" -eq 0 ] || { echo "$stderr"; return 1; }
  [[ "$output" == *$'S1-F1\tverified\t-'* ]] || { echo "$output"; return 1; }
  [[ "$output" == *$'S1-F2\tunverified\tno-evidence'* ]] || { echo "$output"; return 1; }
}
