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

@test "a symlink to a file outside the root is ignored" {
  OUTSIDE="$(mktemp -d)"; : > "$OUTSIDE/secret.ts"
  ln -s "$OUTSIDE/secret.ts" "$PROJECT_ROOT/src/link.ts"
  ln -s link.ts "$PROJECT_ROOT/src/link2.ts"
  for p in "$PROJECT_ROOT/src/link.ts" "$PROJECT_ROOT/src/link2.ts"; do
    edit s1 "$PROJECT_ROOT/src/a.ts"
    edit s1 "$p"
  done
  rm -rf "$OUTSIDE"
  [ ! -f "$COEDIT" ]
}

@test "a symlink inside the root records its target" {
  ln -s b.ts "$PROJECT_ROOT/src/alias.ts"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/alias.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ "$(pair src/a.ts src/alias.ts)" -eq 0 ]
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

@test "the cap evicts whole pairs, never one direction" {
  jq -n '{version:1, pairs:{"a":{"b":3,"c":2,"d":2}, "b":{"a":3}, "c":{"a":2}, "d":{"a":2}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  printf '%s' "$(event s1 Edit "$PROJECT_ROOT/src/b.ts")" | COEDIT_MAX_PAIRS=5 PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" >/dev/null
  [ "$(jq '[.pairs[] | length] | add' "$COEDIT")" -eq 4 ]
  jq -e '.pairs as $p | [$p | to_entries[] | .key as $k | .value | to_entries[] | $p[.key][$k] == .value] | all' "$COEDIT" > /dev/null
  [ "$(pair a b)" -eq 3 ] && [ "$(pair a c)" -eq 2 ] && [ "$(pair c a)" -eq 2 ]
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

@test "a symlinked coedit-sessions dir is never written through" {
  victim="$(mktemp -d)"
  ln -s "$victim" "$RUVECTOR_DIR/coedit-sessions"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  [ -z "$(ls -A "$victim")" ]
  rm -rf "$victim"
}

@test "a .ruvector symlink to a directory outside the project is never written" {
  victim="$(mktemp -d)"
  rm -rf "$RUVECTOR_DIR"
  ln -s "$victim" "$RUVECTOR_DIR"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ -z "$(ls -A "$victim")" ]
  rm -rf "$victim"
}

@test "a linked worktree records into the main worktree's store" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$PROJECT_ROOT" init -q
  echo x > "$PROJECT_ROOT/f.txt"; git -C "$PROJECT_ROOT" add f.txt
  git -C "$PROJECT_ROOT" -c user.email=t@t -c user.name=t commit -q -m init
  WT="$(mktemp -d)/wt"
  git -C "$PROJECT_ROOT" worktree add -q "$WT" 2>/dev/null
  mkdir -p "$WT/src"; : > "$WT/src/a.ts"; : > "$WT/src/b.ts"
  ln -s "$RUVECTOR_DIR" "$WT/.ruvector"
  for f in a b; do
    jq -cn --arg c "$WT" --arg f "$WT/src/$f.ts" \
      '{hook_event_name:"PostToolUse", session_id:"w1", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}' \
      | PATH="$MOCK_BIN:$PATH" bash "$HOOK_SCRIPT" >/dev/null
  done
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  git -C "$PROJECT_ROOT" worktree remove --force "$WT" 2>/dev/null || true
}

@test "a coedit.json with a non-numeric count is set aside, and recording resumes" {
  jq -n '{version:1, pairs:{"src/a.ts":{"src/b.ts":"many"}, "src/b.ts":{"src/a.ts":"many"}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  ls "$RUVECTOR_DIR"/coedit.json.corrupt-* >/dev/null
}

@test "a worktree of a bare repo never records into the bare repo's parent" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  base="$(cd "$(mktemp -d)" && pwd -P)"
  git -C "$base" init -q src
  git -C "$base/src" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  git clone -q --bare "$base/src" "$base/repos/foo.git"
  mkdir -p "$base/repos/.ruvector"
  git -C "$base/repos/foo.git" worktree add -q "$base/wt" -b w 2>/dev/null
  mkdir -p "$base/wt/src"; : > "$base/wt/src/a.ts"; : > "$base/wt/src/b.ts"
  ln -s "$base/repos/.ruvector" "$base/wt/.ruvector"
  for f in a b; do
    jq -cn --arg c "$base/wt" --arg f "$base/wt/src/$f.ts" \
      '{hook_event_name:"PostToolUse", session_id:"b1", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}' \
      | PATH="$MOCK_BIN:$PATH" bash "$HOOK_SCRIPT" >/dev/null
  done
  [ -z "$(ls -A "$base/repos/.ruvector")" ]
  rm -rf "$base"
}

@test "a symlinked coedit.json is set aside, never imported" {
  other="$(mktemp -d)"
  jq -n '{version:1, pairs:{"elsewhere/x.ts":{"elsewhere/y.ts":9}, "elsewhere/y.ts":{"elsewhere/x.ts":9}}}' > "$other/coedit.json"
  ln -s "$other/coedit.json" "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ ! -L "$COEDIT" ]
  [ "$(jq '.pairs | has("elsewhere/x.ts")' "$COEDIT")" = "false" ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ "$(jq '.pairs["elsewhere/x.ts"]["elsewhere/y.ts"]' "$other/coedit.json")" -eq 9 ]
  rm -rf "$other"
}

@test "a session timestamp in the future never pairs" {
  mkdir -p "$RUVECTOR_DIR/coedit-sessions"
  jq -cn --argjson e "$(( $(date +%s) + 3600 ))" '{last:"src/a.ts", epoch:$e}' > "$RUVECTOR_DIR/coedit-sessions/s1"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
}

@test "a coedit.json that is a directory is set aside and recording works" {
  mkdir "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ -f "$COEDIT" ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  ls -d "$RUVECTOR_DIR"/coedit.json.corrupt-* >/dev/null
}

@test "concurrent sessions queue for the lock instead of dropping increments" {
  for i in $(seq 1 8); do edit "c$i" "$PROJECT_ROOT/src/a.ts"; done
  for i in $(seq 1 8); do
    ( edit "c$i" "$PROJECT_ROOT/src/b.ts" ) &
  done
  wait
  [ "$(pair src/a.ts src/b.ts)" -eq 8 ]
  [ "$(pair src/b.ts src/a.ts)" -eq 8 ]
}

@test "a linked worktree of a --separate-git-dir repo never records into the git dir's parent" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  base="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$base/meta" "$base/main"
  git -C "$base/main" init -q --separate-git-dir="$base/meta/.git"
  echo x > "$base/main/f.txt"; git -C "$base/main" add f.txt
  git -C "$base/main" -c user.email=t@t -c user.name=t commit -q -m init
  mkdir "$base/meta/.ruvector"
  git -C "$base/main" worktree add -q "$base/wt" -b w 2>/dev/null
  mkdir -p "$base/wt/src"; : > "$base/wt/src/a.ts"; : > "$base/wt/src/b.ts"
  ln -s "$base/meta/.ruvector" "$base/wt/.ruvector"
  for f in a b; do
    jq -cn --arg c "$base/wt" --arg f "$base/wt/src/$f.ts" \
      '{hook_event_name:"PostToolUse", session_id:"m1", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}' \
      | PATH="$MOCK_BIN:$PATH" bash "$HOOK_SCRIPT" >/dev/null
  done
  [ -z "$(ls -A "$base/meta/.ruvector")" ]
  rm -rf "$base"
}

@test "unsafe path keys in an existing coedit.json are dropped on the next write" {
  jq -n '{version:1, extra:"x", pairs:{
    "../outside":{"src/a.ts":5}, "src/a.ts":{"../outside":5, "/etc/passwd":2, ".git/config":1, "src/c.ts":4},
    "/etc/passwd":{"src/a.ts":2}, "src/c.ts":{"src/a.ts":4}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(jq -c '[.pairs | keys[]] | sort' "$COEDIT")" = '["src/a.ts","src/b.ts","src/c.ts"]' ]
  [ "$(jq -c '.pairs["src/a.ts"] | keys' "$COEDIT")" = '["src/b.ts","src/c.ts"]' ]
  [ "$(jq 'has("extra")' "$COEDIT")" = "false" ]
  [ "$(pair src/a.ts src/c.ts)" -eq 4 ]
}

@test "a tampered session file's last path never enters coedit.json" {
  mkdir -p "$RUVECTOR_DIR/coedit-sessions"
  for bad in "../outside" "/etc/passwd" ".git/config" $'src/a.ts\nx'; do
    jq -cn --arg l "$bad" --argjson e "$(date +%s)" '{last:$l, epoch:$e}' > "$RUVECTOR_DIR/coedit-sessions/t1"
    edit t1 "$PROJECT_ROOT/src/b.ts"
  done
  [ "$(jq '[.pairs // {} | .. | objects | keys[]] | map(select(. != "src/b.ts" and . != "src/a.ts")) | length' "$COEDIT" 2>/dev/null || echo 0)" -eq 0 ]
  [ "$(pair src/b.ts '../outside')" -eq 0 ]
  # The session still records its own edit, so the next pair counts.
  edit t1 "$PROJECT_ROOT/src/c.ts"
  [ "$(pair src/b.ts src/c.ts)" -eq 1 ]
}

@test "a held co-edit lock skips the increment well inside the 1s hook timeout" {
  edit h1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  start=$(date +%s%N)
  run --separate-stderr run_hook "$(event h1 Edit "$PROJECT_ROOT/src/b.ts")"
  end=$(date +%s%N)
  rmdir "$RUVECTOR_DIR/.coedit.lock"
  [ "$status" -eq 0 ]
  printf '%s' "$output" | jq -e '.continue == true' >/dev/null
  [ $(( (end - start) / 1000000 )) -lt 800 ]
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
}

@test "two parallel edits in one session still count their pair" {
  for i in $(seq 1 5); do
    rm -f "$COEDIT" "$RUVECTOR_DIR/coedit-sessions/p$i"
    ( edit "p$i" "$PROJECT_ROOT/src/a.ts" ) &
    ( edit "p$i" "$PROJECT_ROOT/src/b.ts" ) &
    wait
    [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  done
}

@test "a stale co-edit lock is reclaimed once per generation" {
  edit r1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  ino=$(ls -di "$RUVECTOR_DIR/.coedit.lock" | awk '{print $1}')
  edit r1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ ! -e "$RUVECTOR_DIR/.coedit.lock" ]
  ls -d "$RUVECTOR_DIR/.coedit.lock.reclaim.$ino-"* >/dev/null
  # Another waiter already claimed this stale generation: leave the lock.
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock"
  ino=$(ls -di "$RUVECTOR_DIR/.coedit.lock" | awk '{print $1}')
  mt=$(date -r "$RUVECTOR_DIR/.coedit.lock" +%s)
  mkdir -p "$RUVECTOR_DIR/.coedit.lock.reclaim.$ino-$mt"
  edit r1 "$PROJECT_ROOT/src/c.ts"
  [ -d "$RUVECTOR_DIR/.coedit.lock" ]
  [ "$(pair src/b.ts src/c.ts)" -eq 0 ]
}

@test "a busy store lock loses only that increment; the session still advances" {
  edit v1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  edit v1 "$PROJECT_ROOT/src/b.ts"
  rmdir "$RUVECTOR_DIR/.coedit.lock"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
  edit v1 "$PROJECT_ROOT/src/c.ts"
  [ "$(pair src/b.ts src/c.ts)" -eq 1 ]
  [ "$(pair src/a.ts src/c.ts)" -eq 0 ]
}

@test "an oversized coedit.json is set aside unparsed" {
  jq -n '{version:1, pairs:([range(0;20)] | map({key:"src/x\(.).ts", value:{"src/y.ts":3}}) | from_entries)}' > "$COEDIT"
  [ "$(wc -c < "$COEDIT")" -gt 200 ]
  edit o1 "$PROJECT_ROOT/src/a.ts"
  COEDIT_MAX_BYTES=200 edit o1 "$PROJECT_ROOT/src/b.ts"
  ls -d "$RUVECTOR_DIR"/coedit.json.corrupt-* >/dev/null
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ "$(pair src/x0.ts src/y.ts)" -eq 0 ]
}

@test "one-sided or mismatched pairs are rebuilt symmetric on the next write" {
  jq -n '{version:1, pairs:{"src/x.ts":{"src/y.ts":7}, "src/p.ts":{"src/q.ts":2}, "src/q.ts":{"src/p.ts":5}}}' > "$COEDIT"
  edit m1 "$PROJECT_ROOT/src/a.ts"
  edit m1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/y.ts src/x.ts)" -eq 7 ]
  [ "$(pair src/p.ts src/q.ts)" -eq 5 ] && [ "$(pair src/q.ts src/p.ts)" -eq 5 ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ] && [ "$(pair src/b.ts src/a.ts)" -eq 1 ]
}

@test "a session's last path that now links outside the root is never paired" {
  outside="$(mktemp -d)"; : > "$outside/secret.ts"
  edit l1 "$PROJECT_ROOT/src/a.ts"
  rm "$PROJECT_ROOT/src/a.ts"; ln -s "$outside/secret.ts" "$PROJECT_ROOT/src/a.ts"
  edit l1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
  [ "$(jq '[.pairs // {} | .. | objects | keys[]] | length' "$COEDIT" 2>/dev/null || echo 0)" -eq 0 ]
  rm -rf "$outside"
}

@test "the 512-char cap applies to the root-relative path, not the absolute one" {
  deep="$PROJECT_ROOT/$(printf 'd%.0s' $(seq 1 200))/$(printf 'e%.0s' $(seq 1 200))/$(printf 'f%.0s' $(seq 1 200))"
  mkdir -p "$deep/.ruvector" "$deep/src"; : > "$deep/src/a.ts"; : > "$deep/src/b.ts"
  for f in a b; do
    jq -cn --arg c "$deep" --arg f "$deep/src/$f.ts" \
      '{hook_event_name:"PostToolUse", session_id:"z1", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}' \
      | PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$deep" bash "$HOOK_SCRIPT" >/dev/null
  done
  [ "$(jq -r '.pairs["src/a.ts"]["src/b.ts"] // 0' "$deep/.ruvector/coedit.json")" -eq 1 ]
  # A short symlink whose in-root target is over 512 chars is not recorded.
  long="$PROJECT_ROOT/$(printf 'x%.0s' $(seq 1 250))/$(printf 'y%.0s' $(seq 1 250))"
  mkdir -p "$long"; : > "$long/zzzzzzzzzzzzzzzz.ts"
  ln -s "$long/zzzzzzzzzzzzzzzz.ts" "$PROJECT_ROOT/src/short.ts"
  edit z2 "$PROJECT_ROOT/src/short.ts"
  [ ! -e "$RUVECTOR_DIR/coedit-sessions/z2" ] || ! grep -q yyyy "$RUVECTOR_DIR/coedit-sessions/z2"
}

@test "a reused inode never inherits an old generation's reclaim marker" {
  edit g1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  ino=$(ls -di "$RUVECTOR_DIR/.coedit.lock" | awk '{print $1}')
  # A marker left by an earlier generation with the same inode.
  mkdir "$RUVECTOR_DIR/.coedit.lock.reclaim.$ino-1"
  edit g1 "$PROJECT_ROOT/src/b.ts"
  [ ! -e "$RUVECTOR_DIR/.coedit.lock" ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "the session and store locks share one wait budget; the hook still answers" {
  edit h2 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  start=$(date +%s%N)
  run --separate-stderr run_hook "$(event h2 Edit "$PROJECT_ROOT/src/b.ts")"
  end=$(date +%s%N)
  rmdir "$RUVECTOR_DIR/.coedit.lock"
  printf '%s' "$output" | jq -e '.continue == true' >/dev/null
  [ $(( (end - start) / 1000000 )) -lt 700 ]
  [ ! -e "$RUVECTOR_DIR/coedit-sessions/.h2.lock" ]
}

@test "a coedit.json that is slow to process is skipped within the time bound, not set aside" {
  jq -n '{version:1, pairs:{"src/x.ts": ([range(0;20000)] | map({key:"src/d/f\(.).ts", value:3}) | from_entries)}}' > "$COEDIT"
  before=$(cksum < "$COEDIT")
  edit t1 "$PROJECT_ROOT/src/a.ts"
  COEDIT_JQ_SECS=0.01 edit t1 "$PROJECT_ROOT/src/b.ts"
  [ "$(cksum < "$COEDIT")" = "$before" ]
  ! ls "$RUVECTOR_DIR"/coedit.json.corrupt-* 2>/dev/null
}

@test "the writer keeps coedit.json under the byte cap, so a store it wrote is never set aside" {
  long=$(printf 'p%.0s' $(seq 1 400))
  jq -n --arg l "$long" '{version:1, pairs:([range(0;200)] | map({key:"src/\($l)\(.).ts", value:{"src/x.ts": 3}}) | from_entries)}' > "$COEDIT"
  edit c1 "$PROJECT_ROOT/src/a.ts"
  COEDIT_MAX_BYTES=40000 edit c1 "$PROJECT_ROOT/src/b.ts"
  [ "$(wc -c < "$COEDIT")" -le 40000 ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  COEDIT_MAX_BYTES=40000 edit c1 "$PROJECT_ROOT/src/c.ts"
  ! ls "$RUVECTOR_DIR"/coedit.json.corrupt-* 2>/dev/null
  [ "$(pair src/b.ts src/c.ts)" -eq 1 ]
}
