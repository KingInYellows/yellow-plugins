#!/usr/bin/env bats
# Tests for read-resolve-config

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/read-resolve-config"

setup() {
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  REPO="$BATS_TEST_TMPDIR/repo"
  git init -q -b main "$REPO"
  cd "$REPO"
  git config user.email test@test.com
  git config user.name Test
}

field() { printf '%s\n' "$output" | jq -c ".$1"; }

@test "no config file prints every default" {
  run --separate-stderr "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$output" = '{"file":"absent","tracked":"untracked","cluster_line_distance":10,"cluster_cap":20,"verify_command":null,"verify_unattended":false,"verify_timeout_seconds":540,"repass_wait_seconds":120,"repass_max_passes":5,"resolve_human_threads":"evidence","warnings":[]}' ]
  [ -z "$stderr" ]
}

@test "valid values are read from the resolve_pr block in the frontmatter only" {
  cat >| yellow-plugins.local.md <<'CFG'
---
review_pipeline: persona
resolve_pr:
  # a comment
  cluster_line_distance: 4
  cluster_cap: 7   # trailing comment
  verify_command: "pnpm test -- --grep \"a b\" # not a comment"
  verify_unattended: true

  verify_timeout_seconds: 300
  repass_wait_seconds: 0
  repass_max_passes: 10
  resolve_human_threads: never
focus_areas: [security]
---
resolve_pr:
  cluster_cap: 99
CFG
  run --separate-stderr "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(field file)" = '"present"' ]
  [ "$(field cluster_line_distance)" = 4 ]
  [ "$(field cluster_cap)" = 7 ]
  [ "$(field verify_command)" = '"pnpm test -- --grep \"a b\" # not a comment"' ]
  [ "$(field verify_unattended)" = true ]
  [ "$(field verify_timeout_seconds)" = 300 ]
  [ "$(field repass_wait_seconds)" = 0 ]
  [ "$(field repass_max_passes)" = 10 ]
  [ "$(field resolve_human_threads)" = '"never"' ]
  [ "$(field warnings)" = '[]' ]
}

@test "single-quoted and plain commands keep their text; empty means unset" {
  printf -- "---\nresolve_pr:\n  verify_command: 'it''s fine' # c\n---\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = "\"it's fine\"" ]
  printf -- "---\nresolve_pr:\n  verify_command: make test # c\n---\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = '"make test"' ]
  printf -- "---\nresolve_pr:\n  verify_command: \"\"\n---\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = null ]
  [ "$(field warnings)" = '[]' ]
}

@test "invalid values warn and fall back; caps and clamps apply" {
  cat >| yellow-plugins.local.md <<'CFG'
---
resolve_pr:
  cluster_line_distance: 0
  cluster_cap: "5"
  verify_unattended: "true"
  verify_timeout_seconds: 900
  repass_wait_seconds: 481
  repass_max_passes: 0
  resolve_human_threads: sometimes
  bogus: 1
---
CFG
  run --separate-stderr "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(field cluster_line_distance)" = 10 ]
  [ "$(field cluster_cap)" = 20 ]
  [ "$(field verify_unattended)" = false ]
  [ "$(field verify_timeout_seconds)" = 540 ]
  [ "$(field repass_wait_seconds)" = 120 ]
  [ "$(field repass_max_passes)" = 1 ]
  [ "$(field resolve_human_threads)" = '"evidence"' ]
  [ "$(printf '%s\n' "$output" | jq '.warnings | length')" -eq 8 ]
  [[ "$stderr" == *"resolve_pr.bogus is not a known key"* ]]
}

@test "a nested, flow, block-scalar or repeated command is unset, never half-read" {
  printf -- "---\nresolve_pr:\n  verify_command:\n    nested: x\n---\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = null ]
  printf -- "---\nresolve_pr:\n  verify_command: |\n    rm -rf /\n---\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = null ]
  [[ "$stderr" == *"verify_command is invalid"* ]]
  printf -- "---\nresolve_pr:\n  verify_command: a\n  verify_command: b\n---\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = null ]
  [[ "$stderr" == *"given more than once"* ]]
  printf -- "---\nresolve_pr: {verify_command: a}\n---\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = null ]
  [[ "$stderr" == *"not a block mapping"* ]]
  printf '%s\n' '---' 'resolve_pr:' '  verify_command: "a\\x"' '---' >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = '"a\\x"' ]
  printf '%s\n' '---' 'resolve_pr:' '  verify_command: "a\nb"' '---' >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field verify_command)" = null ]
}

@test "CRLF line endings parse like LF" {
  printf -- "---\r\nresolve_pr:\r\n  cluster_cap: 3\r\n---\r\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field cluster_cap)" = 3 ]
}

@test "an unclosed frontmatter warns and uses defaults" {
  printf -- "---\nresolve_pr:\n  cluster_cap: 3\n" >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field cluster_cap)" = 20 ]
  [[ "$stderr" == *"no closing"* ]]
}

@test "a tracked config reports tracked" {
  printf -- "---\nresolve_pr:\n  verify_unattended: true\n---\n" >| yellow-plugins.local.md
  git add yellow-plugins.local.md
  git commit -q -m cfg
  run --separate-stderr "$SCRIPT"
  [ "$(field tracked)" = '"tracked"' ]
  [ "$(field verify_unattended)" = true ]
}

@test "a symlinked or oversized config is refused and every key takes its default" {
  printf -- "---\nresolve_pr:\n  verify_command: x\n---\n" >| "$BATS_TEST_TMPDIR/real.md"
  ln -s "$BATS_TEST_TMPDIR/real.md" yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field file)" = '"refused"' ]
  [ "$(field verify_command)" = null ]
  rm yellow-plugins.local.md
  { printf -- "---\nresolve_pr:\n  verify_command: x\n---\n"; head -c 70000 /dev/zero | tr '\0' 'a'; } >| yellow-plugins.local.md
  run --separate-stderr "$SCRIPT"
  [ "$(field file)" = '"refused"' ]
  [ "$(field verify_command)" = null ]
}

@test "reads the repository root's file from a subdirectory" {
  printf -- "---\nresolve_pr:\n  cluster_cap: 3\n---\n" >| yellow-plugins.local.md
  mkdir -p sub && cd sub
  run --separate-stderr "$SCRIPT"
  [ "$(field cluster_cap)" = 3 ]
}

@test "outside a work tree the file is absent and tracked is unknown" {
  mkdir -p "$BATS_TEST_TMPDIR/plain" && cd "$BATS_TEST_TMPDIR/plain"
  GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR" run --separate-stderr "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(field file)" = '"absent"' ]
  [ "$(field tracked)" = '"unknown"' ]
}

@test "usage: any argument exits 2" {
  run "$SCRIPT" extra
  [ "$status" -eq 2 ]
}
