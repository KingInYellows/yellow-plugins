#!/usr/bin/env bats
# Tests for hooks/scripts/post-tool-use.sh — co-edit recording (jq only).
# Fixtures use Claude Code's PostToolUse envelope: hook_event_name,
# session_id, cwd, tool_name, and tool_input.file_path (MultiEdit carries a
# top-level file_path too; its edits[] have no paths).
bats_require_minimum_version 1.5.0

setup() {
  command -v jq >/dev/null || skip "jq not installed"
  PROJECT_ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR" "$PROJECT_ROOT/src"
  : > "$PROJECT_ROOT/src/a.ts"; : > "$PROJECT_ROOT/src/b.ts"; : > "$PROJECT_ROOT/src/c.ts"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/post-tool-use.sh"
  # Any ruvector or node call would be a regression: the hook is jq-only.
  MOCK_BIN="$(mktemp -d)"
  MARKER="$MOCK_BIN/cli-called"
  for b in ruvector npx node; do
    printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$MARKER" > "$MOCK_BIN/$b"
    chmod +x "$MOCK_BIN/$b"
  done
  COEDIT="$RUVECTOR_DIR/coedit.json"
}

teardown() {
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN"
}

# $1 session, $2 tool, $3 file_path, [$4 event]
event() {
  jq -cn --arg s "$1" --arg t "$2" --arg f "$3" --arg c "$PROJECT_ROOT" --arg e "${4:-PostToolUse}" \
    '{hook_event_name:$e, session_id:$s, cwd:$c, tool_name:$t, tool_input:{file_path:$f}, tool_response:{success:true}}'
}

run_hook() {
  printf '%s' "$1" | PATH="$MOCK_BIN:$PATH" RUVECTOR_BIN="$MOCK_BIN/ruvector" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

edit() { run_hook "$(event "$1" "${3:-Edit}" "$2" "${4:-PostToolUse}")" >/dev/null; }

pair() { jq -r --arg a "$1" --arg b "$2" '.pairs[$a][$b] // 0' "$COEDIT" 2>/dev/null || echo 0; }

@test "every path prints only the allow JSON" {
  for input in "$(event s1 Edit "$PROJECT_ROOT/src/a.ts")" '{}' 'not json' \
      "$(event s1 Bash "")" "$(event s1 Edit "$PROJECT_ROOT/src/b.ts" PostToolUseFailure)"; do
    run --separate-stderr run_hook "$input"
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | wc -l)" -eq 1 ]
    echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
  done
}

@test "two files edited by one session within the window count as a symmetric pair" {
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ "$(pair src/b.ts src/a.ts)" -eq 1 ]
  edit s1 "$PROJECT_ROOT/src/a.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 2 ]
}

@test "never runs ruvector, npx, or node" {
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ ! -e "$MARKER" ]
}

@test "the same file twice is not a pair" {
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  [ ! -f "$COEDIT" ] || [ "$(jq '.pairs | length' "$COEDIT")" -eq 0 ]
}

@test "edits from different sessions never pair (worktrees share the store)" {
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s2 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
}

@test "an edit outside the window does not pair" {
  edit s1 "$PROJECT_ROOT/src/a.ts"
  jq '.epoch -= 120' "$RUVECTOR_DIR/coedit-sessions/s1" > "$BATS_TEST_TMPDIR/s" && mv "$BATS_TEST_TMPDIR/s" "$RUVECTOR_DIR/coedit-sessions/s1"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
}

@test "MultiEdit and Write use tool_input.file_path" {
  edit s1 "$PROJECT_ROOT/src/a.ts" MultiEdit
  edit s1 "$PROJECT_ROOT/src/c.ts" Write
  [ "$(pair src/a.ts src/c.ts)" -eq 1 ]
}

@test "a relative path resolves against the session cwd" {
  edit s1 "src/a.ts"
  edit s1 "src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a subdirectory session records root-relative paths in the root store" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$PROJECT_ROOT" init -q
  for f in a b; do
    jq -cn --arg c "$PROJECT_ROOT/src" --arg f "$f.ts" \
      '{hook_event_name:"PostToolUse", session_id:"s1", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}' \
      | PATH="$MOCK_BIN:$PATH" bash "$HOOK_SCRIPT" >/dev/null
  done
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ ! -e "$PROJECT_ROOT/src/.ruvector" ]
}

@test "paths outside the root, in .ruvector, .git, or docs/solutions are ignored" {
  mkdir -p "$PROJECT_ROOT/docs/solutions/x"; : > "$PROJECT_ROOT/docs/solutions/x/d.md"
  for p in /etc/hosts "$RUVECTOR_DIR/coedit.json" "$PROJECT_ROOT/.git/config" "$PROJECT_ROOT/docs/solutions/x/d.md"; do
    edit s1 "$PROJECT_ROOT/src/a.ts"
    edit s1 "$p"
  done
  [ ! -f "$COEDIT" ] || [ "$(jq '[.pairs[] | keys[]] | length' "$COEDIT")" -eq 0 ]
}

@test "a path with control characters is ignored" {
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b"$'\x1b'".ts"
  [ ! -f "$COEDIT" ]
}

@test "a hostile session id cannot escape coedit-sessions" {
  edit "../../evil" "$PROJECT_ROOT/src/a.ts"
  [ ! -e "$PROJECT_ROOT/evil" ]
  [ -f "$RUVECTOR_DIR/coedit-sessions/.._.._evil" ]
}

@test "a missing session id records nothing" {
  run_hook "$(jq -cn --arg c "$PROJECT_ROOT" --arg f "$PROJECT_ROOT/src/a.ts" '{hook_event_name:"PostToolUse", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}')" >/dev/null
  [ ! -d "$RUVECTOR_DIR/coedit-sessions" ] || [ -z "$(ls -A "$RUVECTOR_DIR/coedit-sessions")" ]
}

@test "no .ruvector directory means no writes" {
  rm -rf "$RUVECTOR_DIR"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ ! -e "$RUVECTOR_DIR" ]
}

@test "Bash and PostToolUseFailure events are no-ops" {
  edit s1 "$PROJECT_ROOT/src/a.ts"
  run_hook "$(jq -cn --arg c "$PROJECT_ROOT" '{hook_event_name:"PostToolUse", session_id:"s1", cwd:$c, tool_name:"Bash", tool_input:{command:"npm test"}}')" >/dev/null
  edit s1 "$PROJECT_ROOT/src/b.ts" Edit PostToolUseFailure
  [ ! -f "$COEDIT" ]
}

@test "a corrupt coedit.json is set aside, not trusted" {
  echo 'not json' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  ls "$RUVECTOR_DIR"/coedit.json.corrupt-* >/dev/null
}

@test "the pair file is capped, keeping the highest counts" {
  jq -n '{version:1, pairs:{"src/a.ts":{"src/b.ts":9}, "src/b.ts":{"src/a.ts":9}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  printf '%s' "$(event s1 Edit "$PROJECT_ROOT/src/c.ts")" | COEDIT_MAX_PAIRS=2 PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" >/dev/null
  [ "$(jq '[.pairs[] | length] | add' "$COEDIT")" -eq 2 ]
  [ "$(pair src/a.ts src/b.ts)" -eq 9 ]
}

@test "20 parallel edits never corrupt coedit.json" {
  for i in $(seq 1 20); do : > "$PROJECT_ROOT/src/f$i.ts"; done
  for i in $(seq 1 20); do
    ( edit "s$((i % 4))" "$PROJECT_ROOT/src/f$i.ts" ) &
  done
  wait
  for i in $(seq 1 20); do
    ( edit "s$((i % 4))" "$PROJECT_ROOT/src/f$(( (i % 20) + 1 )).ts" ) &
  done
  wait
  [ -f "$COEDIT" ]
  jq -e '(.pairs | type) == "object"' "$COEDIT" > /dev/null
  [ ! -d "$RUVECTOR_DIR/.coedit.lock" ]
  ! ls "$RUVECTOR_DIR"/coedit.json.tmp.* >/dev/null 2>&1
}
