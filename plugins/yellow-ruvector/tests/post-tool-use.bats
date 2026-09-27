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

@test "an inherited TIMEOUT_CMD is probed, not trusted, so pairs still record" {
  printf '#!/bin/sh\nexit 1\n' > "$BATS_TEST_TMPDIR/timeout"
  chmod +x "$BATS_TEST_TMPDIR/timeout"
  export TIMEOUT_CMD="$BATS_TEST_TMPDIR/timeout"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  unset TIMEOUT_CMD
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a destination swapped for a symlink to a directory is replaced, never written through" {
  out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  mb="$BATS_TEST_TMPDIR/mvbin"; mkdir -p "$mb"
  # The first rename finds its destination swapped for a symlink to a directory.
  cat > "$mb/mv" <<SH
#!/bin/sh
for d; do :; done
if [ ! -e "$BATS_TEST_TMPDIR/swapped" ]; then
  : > "$BATS_TEST_TMPDIR/swapped"; rm -f "\$d"; ln -s "$out" "\$d"
fi
exec $(command -v mv) "\$@"
SH
  chmod +x "$mb/mv"
  PATH="$mb:$PATH" edit s1 "$PROJECT_ROOT/src/a.ts"
  [ -e "$BATS_TEST_TMPDIR/swapped" ]
  [ -z "$(ls -A "$out")" ]
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

@test "a root-level file whose name starts with a dash is never recorded" {
  : > "$PROJECT_ROOT/-config"
  edit s1 "$PROJECT_ROOT/-config"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  [ "$(pair -config src/a.ts)" -eq 0 ]
  [ "$(pair src/a.ts -config)" -eq 0 ]
}

@test "a leading-dash key in an existing coedit.json is dropped on the next write" {
  jq -n '{version:1, pairs:{"-rf":{"src/x.ts":50}, "src/x.ts":{"-rf":50, "src/y.ts":2}, "src/y.ts":{"src/x.ts":2}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"; edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ "$(pair src/x.ts src/y.ts)" -eq 2 ]
  jq -e '(.pairs | has("-rf") | not) and (.pairs["src/x.ts"] | has("-rf") | not)' "$COEDIT" >/dev/null
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
  [ -z "$(ls -A "$RUVECTOR_DIR/coedit-sessions" 2>/dev/null)" ]
}

@test "a one-character session id records nothing (the cleanup shards could never reach it)" {
  edit a "$PROJECT_ROOT/src/a.ts"; edit a "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
  [ ! -e "$RUVECTOR_DIR/coedit-sessions/a" ]
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

@test "an empty, blank, or multi-document coedit.json is rebuilt, not a permanent no-op" {
  for body in '' '   ' '{"version":1,"pairs":{}} {"version":1,"pairs":{}}'; do
    rm -f "$RUVECTOR_DIR"/coedit.json.corrupt-*
    printf '%s' "$body" > "$COEDIT"
    edit s1 "$PROJECT_ROOT/src/a.ts"
    edit s1 "$PROJECT_ROOT/src/b.ts"
    [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
    [ "$(wc -l < "$COEDIT" | tr -d ' ')" -eq 1 ]
    ls "$RUVECTOR_DIR"/coedit.json.corrupt-* >/dev/null
    rm -rf "$RUVECTOR_DIR/coedit-sessions"
  done
}

@test "a multi-document session file is reset, so the session keeps recording pairs" {
  mkdir -p "$RUVECTOR_DIR/coedit-sessions"
  printf '{"last":"src/x.ts","epoch":1}\n{"last":"src/y.ts","epoch":2}\n' > "$RUVECTOR_DIR/coedit-sessions/s1"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  [ "$(wc -l < "$RUVECTOR_DIR/coedit-sessions/s1" | tr -d ' ')" -eq 1 ]
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a directory, symlink, or FIFO at the session path is cleared, so the session keeps recording" {
  sd="$RUVECTOR_DIR/coedit-sessions"; mkdir -p "$sd/s1/keep"
  outside="$BATS_TEST_TMPDIR/outside"; printf 'keep\n' > "$outside"
  ln -s "$outside" "$sd/s2"
  mkfifo "$sd/s3" 2>/dev/null || skip "mkfifo unsupported"
  for s in s1 s2 s3; do
    edit "$s" "$PROJECT_ROOT/src/a.ts"
    edit "$s" "$PROJECT_ROOT/src/b.ts"
    [ -f "$sd/$s" ] && [ ! -L "$sd/$s" ]
  done
  [ "$(pair src/a.ts src/b.ts)" -eq 3 ]
  [ "$(cat "$outside")" = keep ]
  # The directory is renamed aside as a stale lock tree for the sweep.
  ls -d "$sd"/.s1.lock.stale.s*/s1/keep >/dev/null
}

@test "a NUL inside a field can never forge the event, session, or cwd" {
  other="$(mktemp -d)"
  for f in a b; do
    input=$(jq -cn --arg p "$PROJECT_ROOT/src/$f.ts" --arg c "$PROJECT_ROOT" --arg o "$other" \
      '{hook_event_name:"PostToolUseFailure", session_id:"x", cwd:$o, tool_name:"Edit",
        tool_input:{file_path:($p + "\u0000PostToolUse\u0000s1\u0000" + $c + "\u0000")}}')
    run --separate-stderr run_hook "$input"
    [ "$status" -eq 0 ]
  done
  rm -rf "$other"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
  [ ! -d "$RUVECTOR_DIR/coedit-sessions" ] || [ -z "$(ls -A "$RUVECTOR_DIR/coedit-sessions")" ]
}

@test "an absurd imported count is dropped, never pinned above real pairs" {
  : > "$PROJECT_ROOT/src/x.ts"; : > "$PROJECT_ROOT/src/y.ts"
  jq -n '{version:1, pairs:{"src/x.ts":{"src/y.ts":9007199254740993}, "src/y.ts":{"src/x.ts":9007199254740993}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ "$(pair src/x.ts src/y.ts)" -eq 0 ]
}

@test "a stale session lock is reclaimed even when the wait budget is already spent" {
  sd="$RUVECTOR_DIR/coedit-sessions"; mkdir -p "$sd/.s1.lock"
  touch -d '5 minutes ago' "$sd/.s1.lock" 2>/dev/null || skip "touch -d unsupported"
  # The parse and root lookup's 6 tries use the whole budget.
  export COEDIT_LOCK_TRIES=6
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a count at the bound stays at the bound instead of being dropped" {
  jq -n '{version:1, pairs:{"src/a.ts":{"src/b.ts":1000000000}, "src/b.ts":{"src/a.ts":1000000000}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1000000000 ]
  edit s1 "$PROJECT_ROOT/src/a.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1000000000 ]
}

@test "a file at the session-dir path is replaced, so recording resumes" {
  printf 'x\n' > "$RUVECTOR_DIR/coedit-sessions"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ -d "$RUVECTOR_DIR/coedit-sessions" ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a lock dated far in the future is reclaimed as stale" {
  sd="$RUVECTOR_DIR/coedit-sessions"; mkdir -p "$sd/.s1.lock" "$RUVECTOR_DIR/.coedit.lock"
  touch -d '1 year' "$sd/.s1.lock" "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a non-empty expired marker is renamed before the reclaim, not in the background" {
  sd="$RUVECTOR_DIR/coedit-sessions"; l="$sd/.s1.lock"; mkdir -p "$l"
  touch -d '5 minutes ago' "$l" 2>/dev/null || skip "touch -d unsupported"
  ino=$(ls -di "$l" | awk '{print $1}'); mt=$(stat -c %Y "$l" 2>/dev/null || stat -f %m "$l")
  m="$l.reclaim.$ino-$mt"; mkdir -p "$m/keep"; touch -d '20 minutes ago' "$m"
  # A slow rename of the marker: a detached one would lose the race.
  mb="$BATS_TEST_TMPDIR/mvbin"; mkdir -p "$mb"
  printf '#!/bin/sh\ncase "$*" in *.reclaim.*) sleep 0.3 ;; esac\nexec %s "$@"\n' "$(command -v mv)" > "$mb/mv"
  chmod +x "$mb/mv"
  export COEDIT_LOCK_TRIES=6
  PATH="$mb:$PATH" edit s1 "$PROJECT_ROOT/src/a.ts"
  PATH="$mb:$PATH" edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a dangling symlink at the store lock path is cleared, so pairs still count" {
  ln -s "$BATS_TEST_TMPDIR/nowhere" "$RUVECTOR_DIR/.coedit.lock"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a stale lock is never moved through a symlink planted at its aside name" {
  sd="$RUVECTOR_DIR/coedit-sessions"; l="$sd/.s1.lock"; mkdir -p "$l/keep"
  touch -d '5 minutes ago' "$l" 2>/dev/null || skip "touch -d unsupported"
  ino=$(ls -di "$l" | awk '{print $1}'); mt=$(stat -c %Y "$l" 2>/dev/null || stat -f %m "$l")
  outside="$BATS_TEST_TMPDIR/outside"; mkdir -p "$outside"
  # Start the hook blocked on its input, so its pid is known before it runs.
  fifo="$BATS_TEST_TMPDIR/in"; mkfifo "$fifo"
  ( exec env PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" < "$fifo" > /dev/null ) &
  hp=$!
  ln -s "$outside" "$l.stale.$ino-$mt.$hp"
  event s1 Edit "$PROJECT_ROOT/src/a.ts" > "$fifo"
  wait "$hp" || true
  sleep 0.3
  [ -z "$(ls -A "$outside")" ]
  [ ! -e "$l/keep" ]
}

@test "a path holding a Unicode C1 control is never recorded, in any locale" {
  f="$PROJECT_ROOT/src/a"$'\xc2\x9b'"[31mX.ts"; : > "$f"
  for loc in C C.UTF-8; do
    LC_ALL=$loc edit s1 "$f"
    LC_ALL=$loc edit s1 "$PROJECT_ROOT/src/b.ts"
  done
  [ "$(jq '[.pairs[] | keys[]] | map(select(test("\u009b"))) | length' "$COEDIT" 2>/dev/null || echo 0)" -eq 0 ]
  ! grep -q $'\xc2\x9b' "$RUVECTOR_DIR"/coedit-sessions/* 2>/dev/null
}

@test "a lock dated before 1970 is reclaimed as stale" {
  sd="$RUVECTOR_DIR/coedit-sessions"; mkdir -p "$sd/.s1.lock" "$RUVECTOR_DIR/.coedit.lock"
  touch -d '1960-01-01' "$sd/.s1.lock" "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  [ "$(stat -c %Y "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || stat -f %m "$RUVECTOR_DIR/.coedit.lock")" -lt 0 ] || skip "filesystem cannot store pre-1970 times"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  edit s1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "the pair file is capped, keeping the highest counts and the pair just seen" {
  jq -n '{version:1, pairs:{"src/a.ts":{"src/b.ts":9, "src/d.ts":1}, "src/b.ts":{"src/a.ts":9}, "src/d.ts":{"src/a.ts":1}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  printf '%s' "$(event s1 Edit "$PROJECT_ROOT/src/c.ts")" | COEDIT_MAX_PAIRS=4 PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" >/dev/null
  [ "$(jq '[.pairs[] | length] | add' "$COEDIT")" -eq 4 ]
  [ "$(pair src/a.ts src/b.ts)" -eq 9 ]
  [ "$(pair src/a.ts src/c.ts)" -eq 1 ]
  [ "$(pair src/a.ts src/d.ts)" -eq 0 ]
}

@test "at the cap a repeatedly seen new pair accumulates instead of being evicted" {
  : > "$PROJECT_ROOT/src/y.ts"; : > "$PROJECT_ROOT/src/z.ts"
  jq -n '{version:1, pairs:{"src/a.ts":{"src/b.ts":1}, "src/b.ts":{"src/a.ts":1}}}' > "$COEDIT"
  for f in y z y; do
    printf '%s' "$(event s1 Edit "$PROJECT_ROOT/src/$f.ts")" | COEDIT_MAX_PAIRS=2 PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" >/dev/null
  done
  [ "$(pair src/y.ts src/z.ts)" -eq 2 ]
}

@test "the cap evicts whole pairs, never one direction" {
  jq -n '{version:1, pairs:{"a":{"b":3,"c":2,"d":2}, "b":{"a":3}, "c":{"a":2}, "d":{"a":2}}}' > "$COEDIT"
  edit s1 "$PROJECT_ROOT/src/a.ts"
  printf '%s' "$(event s1 Edit "$PROJECT_ROOT/src/b.ts")" | COEDIT_MAX_PAIRS=5 PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" >/dev/null
  [ "$(jq '[.pairs[] | length] | add' "$COEDIT")" -eq 4 ]
  jq -e '.pairs as $p | [$p | to_entries[] | .key as $k | .value | to_entries[] | $p[.key][$k] == .value] | all' "$COEDIT" > /dev/null
  # The pair just seen (src/a.ts <-> src/b.ts) is kept, plus the top one.
  [ "$(pair a b)" -eq 3 ] && [ "$(pair b a)" -eq 3 ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ] && [ "$(pair src/b.ts src/a.ts)" -eq 1 ]
  [ "$(pair a c)" -eq 0 ] && [ "$(pair c a)" -eq 0 ]
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

@test "a slow main-worktree lookup is bounded; the hook still answers in time" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$PROJECT_ROOT" init -q
  echo x > "$PROJECT_ROOT/f.txt"; git -C "$PROJECT_ROOT" add f.txt
  git -C "$PROJECT_ROOT" -c user.email=t@t -c user.name=t commit -q -m init
  WT="$(mktemp -d)/wt"
  git -C "$PROJECT_ROOT" worktree add -q "$WT" 2>/dev/null
  mkdir -p "$WT/src"; : > "$WT/src/a.ts"
  ln -s "$RUVECTOR_DIR" "$WT/.ruvector"
  # A git whose worktree listing never finishes (a huge or slow checkout).
  gb="$BATS_TEST_TMPDIR/gitbin"; mkdir -p "$gb"
  printf '#!/bin/sh\ncase "$*" in *"worktree list"*) echo $$ >> "%s/pids"; exec sleep 30 ;; esac\nexec %s "$@"\n' "$gb" "$(command -v git)" > "$gb/git"
  chmod +x "$gb/git"
  start=$(date +%s%N)
  out=$(jq -cn --arg c "$WT" --arg f "$WT/src/a.ts" \
      '{hook_event_name:"PostToolUse", session_id:"w2", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}' \
    | PATH="$gb:$MOCK_BIN:$PATH" bash "$HOOK_SCRIPT")
  end=$(date +%s%N)
  printf '%s' "$out" | jq -e '.continue == true' >/dev/null
  [ $(( (end - start) / 1000000 )) -lt 900 ]
  # The abandoned lookup is killed within its bound, not left running.
  sleep 0.5
  # (A zombie is dead: a container's PID 1 may never reap it.)
  while read -r p; do
    st=$(ps -o stat= -p "$p" 2>/dev/null | tr -d ' ')
    case "$st" in ''|Z*) ;; *) kill "$p"; false ;; esac
  done < "$gb/pids"
  git -C "$PROJECT_ROOT" worktree remove --force "$WT" 2>/dev/null || true
}

@test "a slow project-root lookup is bounded; the hook still answers in time" {
  gb="$BATS_TEST_TMPDIR/gitbin"; mkdir -p "$gb"
  printf '#!/bin/sh\ncase "$*" in *"rev-parse --show-toplevel"*) echo $$ >> "%s/pids"; exec sleep 30 ;; esac\nexec %s "$@"\n' "$gb" "$(command -v git)" > "$gb/git"
  chmod +x "$gb/git"
  start=$(date +%s%N)
  out=$(event s1 Edit "$PROJECT_ROOT/src/a.ts" | PATH="$gb:$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT")
  end=$(date +%s%N)
  printf '%s' "$out" | jq -e '.continue == true' >/dev/null
  [ $(( (end - start) / 1000000 )) -lt 900 ]
  sleep 0.5
  [ -s "$gb/pids" ]
  while read -r p; do
    st=$(ps -o stat= -p "$p" 2>/dev/null | tr -d ' ')
    case "$st" in ''|Z*) ;; *) kill "$p"; false ;; esac
  done < "$gb/pids"
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
  # What is tested is queueing, not the default budget: give the eight
  # writers room to wait for each other even on a loaded runner.
  export COEDIT_LOCK_TRIES=40
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
  mt=$(stat -c %Y "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || stat -f %m "$RUVECTOR_DIR/.coedit.lock")
  mkdir -p "$RUVECTOR_DIR/.coedit.lock.reclaim.$ino-$mt"
  edit r1 "$PROJECT_ROOT/src/c.ts"
  [ -d "$RUVECTOR_DIR/.coedit.lock" ]
  [ "$(pair src/b.ts src/c.ts)" -eq 0 ]
}

@test "a failed rename leaves no temp file behind" {
  run bash -c '
    . "$1"
    d=$(mktemp -d); f="$d/coedit.json"; echo "{}" > "$f"
    mv() { return 1; }
    printf "{\"x\":1}\n" | coedit_write_atomic "$f" && exit 9
    ls "$d" | grep -c "\.tmp\." || true' _ "$BATS_TEST_DIRNAME/../hooks/scripts/lib/coedit.sh"
  [ "$status" -eq 0 ]
  [ "$output" = 0 ]
}

@test "a stale lock that is not empty is still reclaimed" {
  edit r2 "$PROJECT_ROOT/src/a.ts"
  mkdir -p "$RUVECTOR_DIR/.coedit.lock/junk"; : > "$RUVECTOR_DIR/.coedit.lock/file"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  edit r2 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ ! -e "$RUVECTOR_DIR/.coedit.lock" ]
  # The renamed copy is removed in the background.
  for _ in $(seq 1 30); do ls -d "$RUVECTOR_DIR"/.coedit.lock.stale.* >/dev/null 2>&1 || break; sleep 0.1; done
  ! ls -d "$RUVECTOR_DIR"/.coedit.lock.stale.* 2>/dev/null
}

@test "reclaiming a stale lock holding a large tree stays inside the hook budget" {
  edit r3 "$PROJECT_ROOT/src/a.ts"
  mkdir -p "$RUVECTOR_DIR/.coedit.lock"
  for d in $(seq 1 40); do mkdir -p "$RUVECTOR_DIR/.coedit.lock/d$d"; (cd "$RUVECTOR_DIR/.coedit.lock/d$d" && touch $(seq -f 'f%g' 1 500)); done
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  start=$(date +%s%N)
  edit r3 "$PROJECT_ROOT/src/b.ts"
  end=$(date +%s%N)
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ $(( (end - start) / 1000000 )) -lt 900 ]
}

@test "stale-lock reclaim does not depend on find, and leaves other markers to SessionStart" {
  mkdir -p "$BATS_TEST_TMPDIR/nofind"
  printf '#!/bin/sh\nexit 1\n' > "$BATS_TEST_TMPDIR/nofind/find"
  chmod +x "$BATS_TEST_TMPDIR/nofind/find"
  edit f1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock" "$RUVECTOR_DIR/.coedit.lock.reclaim.1-1"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  touch -d '20 minutes ago' "$RUVECTOR_DIR/.coedit.lock.reclaim.1-1"
  PATH="$BATS_TEST_TMPDIR/nofind:$PATH" edit f1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  [ ! -e "$RUVECTOR_DIR/.coedit.lock" ]
  # Another generation's marker is never listed by the hook.
  [ -d "$RUVECTOR_DIR/.coedit.lock.reclaim.1-1" ]
}

@test "a busy store never makes the session's next edit lose its place" {
  edit q1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  ( edit q1 "$PROJECT_ROOT/src/b.ts" ) &
  sleep 0.02
  ( edit q1 "$PROJECT_ROOT/src/c.ts" ) &
  wait
  rmdir "$RUVECTOR_DIR/.coedit.lock"
  [ "$(jq -r .last "$RUVECTOR_DIR/coedit-sessions/q1")" = "src/c.ts" ]
  edit q1 "$PROJECT_ROOT/src/d.ts"
  [ "$(pair src/c.ts src/d.ts)" -eq 1 ]
  [ "$(pair src/b.ts src/d.ts)" -eq 0 ]
}

@test "session ids are validated, never rewritten into a shared file" {
  edit 'a/b' "$PROJECT_ROOT/src/a.ts"
  edit 'a?b' "$PROJECT_ROOT/src/b.ts"
  edit '.x' "$PROJECT_ROOT/src/c.ts"
  [ ! -e "$RUVECTOR_DIR/coedit-sessions/a_b" ]
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
  [ -z "$(ls -A "$RUVECTOR_DIR/coedit-sessions" 2>/dev/null)" ]
}

@test "no pair is counted when the session state cannot be saved" {
  edit u1 "$PROJECT_ROOT/src/a.ts"
  # An mv that refuses only session-file writes: the store stays writable.
  mkdir -p "$BATS_TEST_TMPDIR/mvbin"
  printf '#!/bin/sh\ncase "$*" in *coedit-sessions/*) exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$BATS_TEST_TMPDIR/mvbin/mv"
  chmod +x "$BATS_TEST_TMPDIR/mvbin/mv"
  PATH="$BATS_TEST_TMPDIR/mvbin:$PATH" edit u1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
  [ "$(jq -r .last "$RUVECTOR_DIR/coedit-sessions/u1")" = "src/a.ts" ]
  # Once saving works again, pairing resumes normally.
  edit u1 "$PROJECT_ROOT/src/c.ts"
  [ "$(pair src/a.ts src/c.ts)" -eq 1 ]
}

@test "hundreds of stale reclaim markers never push the hook past its budget" {
  edit k1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  for i in $(seq 1 500); do
    mkdir -p "$RUVECTOR_DIR/.coedit.lock.reclaim.$i-$i/keep"
    touch -d '20 minutes ago' "$RUVECTOR_DIR/.coedit.lock.reclaim.$i-$i"
  done
  start=$(date +%s%N)
  run --separate-stderr run_hook "$(event k1 Edit "$PROJECT_ROOT/src/b.ts")"
  end=$(date +%s%N)
  printf '%s' "$output" | jq -e '.continue == true' >/dev/null
  [ $(( (end - start) / 1000000 )) -lt 800 ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a planted quarantine symlink never receives the store" {
  outside="$BATS_TEST_TMPDIR/outside"; mkdir -p "$outside"; echo keep > "$outside/coedit.json"
  printf 'not json' > "$COEDIT"
  now=$(date +%s)
  for t in $(seq $((now - 2)) $((now + 5))); do ln -s "$outside" "$COEDIT.corrupt-$t"; done
  edit y1 "$PROJECT_ROOT/src/a.ts"
  edit y1 "$PROJECT_ROOT/src/b.ts"
  [ "$(cat "$outside/coedit.json")" = keep ]
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  ls "$COEDIT".corrupt-* | grep -qv -- "-[0-9]*$"
}

@test "an abandoned marker for the current stale generation is cleared despite earlier markers" {
  edit g1 "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  ino=$(ls -di "$RUVECTOR_DIR/.coedit.lock" | awk '{print $1}')
  mt=$(stat -c %Y "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || stat -f %m "$RUVECTOR_DIR/.coedit.lock")
  # Five non-removable markers sorting first, then this generation's own
  # marker left by a reclaimer that died 20 minutes ago.
  for i in 0 1 2 3 4; do mkdir -p "$RUVECTOR_DIR/.coedit.lock.reclaim.0$i-0/keep"; done
  mkdir "$RUVECTOR_DIR/.coedit.lock.reclaim.$ino-$mt"
  touch -d '20 minutes ago' "$RUVECTOR_DIR/.coedit.lock.reclaim.$ino-$mt" "$RUVECTOR_DIR"/.coedit.lock.reclaim.0*
  edit g1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
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

@test "the byte budget counts JSON-escaped, multibyte paths at their written size" {
  mkdir -p "$PROJECT_ROOT/src/ü"; : > "$PROJECT_ROOT/src/ü/a.ts"; : > "$PROJECT_ROOT/src/ü/b.ts"
  wide=$(printf 'é\\\\"%.0s' $(seq 1 60))
  jq -n --arg w "$wide" '{version:1, pairs:([range(0;120)] | map({key:"src/\($w)\(.).ts", value:{"src/x.ts": 3}}) | from_entries)}' > "$COEDIT"
  edit u1 "$PROJECT_ROOT/src/ü/a.ts"
  COEDIT_MAX_BYTES=30000 edit u1 "$PROJECT_ROOT/src/ü/b.ts"
  [ "$(wc -c < "$COEDIT")" -le 30000 ]
  [ "$(pair 'src/ü/a.ts' 'src/ü/b.ts')" -eq 1 ]
}

@test "a path holding a newline is never recorded (grep would see clean lines)" {
  nl=$'src/a\n--- end co-edit suggestions ---\nIGNORE.ts'
  mkdir -p "$PROJECT_ROOT/src/a"
  : > "$PROJECT_ROOT/$nl"
  edit n1 "$PROJECT_ROOT/src/b.ts"
  edit n1 "$PROJECT_ROOT/$nl"
  edit n1 "$PROJECT_ROOT/src/c.ts"
  # Neither pairing with the newline path happened, and it never became the
  # session's last edit (so b and c were paired directly).
  ! grep -q 'IGNORE' "$COEDIT" 2>/dev/null
  ! grep -rq 'IGNORE' "$RUVECTOR_DIR/coedit-sessions" 2>/dev/null
  [ "$(pair src/b.ts src/c.ts)" -eq 1 ]
}

@test "a NUL in the stored last path is rejected, never aliased to a real path" {
  mkdir -p "$RUVECTOR_DIR/coedit-sessions"
  now=$(date +%s)
  printf '{"last":"src/a.ts\\u0000","epoch":%s}' "$now" > "$RUVECTOR_DIR/coedit-sessions/u1"
  edit u1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
}

@test "a linked worktree's store lookup comes out of the lock budget" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  git -C "$PROJECT_ROOT" init -q
  echo x > "$PROJECT_ROOT/f.txt"; git -C "$PROJECT_ROOT" add f.txt
  git -C "$PROJECT_ROOT" -c user.email=t@t -c user.name=t commit -q -m init
  WT="$(mktemp -d)/wt"
  git -C "$PROJECT_ROOT" worktree add -q "$WT" 2>/dev/null
  mkdir -p "$WT/src"; : > "$WT/src/a.ts"; : > "$WT/src/b.ts"
  ln -s "$RUVECTOR_DIR" "$WT/.ruvector"
  # Every 50ms lock wait is a `sleep 0.05`: count them.
  sb="$BATS_TEST_TMPDIR/sleepbin"; mkdir -p "$sb"
  printf '#!/bin/sh\n[ "$1" = 0.05 ] && echo x >> "%s/waits"\nexec %s "$@"\n' "$BATS_TEST_TMPDIR" "$(command -v sleep)" > "$sb/sleep"
  chmod +x "$sb/sleep"
  wedit() {
    jq -cn --arg c "$WT" --arg f "$WT/src/$1.ts" \
      '{hook_event_name:"PostToolUse", session_id:"wb", cwd:$c, tool_name:"Edit", tool_input:{file_path:$f}}' \
      | COEDIT_LOCK_TRIES=3 PATH="$sb:$MOCK_BIN:$PATH" bash "$HOOK_SCRIPT" >/dev/null
  }
  wedit a
  # A busy store lock: the main worktree would wait its 3 tries; the linked
  # worktree's lookup already spent them (COEDIT_WT_TRIES=3).
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  rm -f "$BATS_TEST_TMPDIR/waits"
  wedit b
  rmdir "$RUVECTOR_DIR/.coedit.lock"
  [ ! -s "$BATS_TEST_TMPDIR/waits" ]
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
  git -C "$PROJECT_ROOT" worktree remove --force "$WT" 2>/dev/null || true
}

@test "Unicode line separators in a path are rejected in any locale" {
  for sep in $'\xc2\x85' $'\xe2\x80\xa8' $'\xe2\x80\xa9'; do
    f="src/x${sep}IGNORE.ts"
    : > "$PROJECT_ROOT/$f"
    for loc in C C.UTF-8; do
      LC_ALL=$loc edit "L$loc" "$PROJECT_ROOT/src/b.ts"
      LC_ALL=$loc edit "L$loc" "$PROJECT_ROOT/$f"
    done
  done
  ! grep -q 'IGNORE' "$COEDIT" 2>/dev/null
  ! grep -rq 'IGNORE' "$RUVECTOR_DIR/coedit-sessions" 2>/dev/null
  # A stored last path holding one is never paired or re-stored either.
  mkdir -p "$RUVECTOR_DIR/coedit-sessions"
  printf '{"last":"src/a.ts\\u2028IGNORE","epoch":%s}' "$(date +%s)" > "$RUVECTOR_DIR/coedit-sessions/u2"
  edit u2 "$PROJECT_ROOT/src/b.ts"
  ! grep -q 'IGNORE' "$COEDIT" 2>/dev/null
  # And an existing coedit.json key holding one is dropped on the next write.
  jq -n '{version:1,pairs:{"src/c.ts\u2029IGNORE":{"src/a.ts":2},"src/a.ts":{"src/c.ts\u2029IGNORE":2}}}' > "$COEDIT"
  edit u3 "$PROJECT_ROOT/src/a.ts"; edit u3 "$PROJECT_ROOT/src/c.ts"
  [ "$(pair src/a.ts src/c.ts)" -eq 1 ]
  ! grep -q 'IGNORE' "$COEDIT"
}

@test "a stored epoch too large for shell arithmetic never pairs, even one that wraps into the window" {
  mkdir -p "$RUVECTOR_DIR/coedit-sessions"
  now=$(date +%s)
  # 2^64 + v, with v a few minutes back and ending in 384 so that jq's
  # 17-significant-digit output (…000) is exactly this number: shell
  # arithmetic would wrap it to v.
  v=$(( now - ((now - 384) % 1000) ))
  big="1844674407$(printf '%010d' $(( 3709551616 + v )))"
  [ "$(printf '{"e":%s}' "$big" | jq -r '.e | floor')" = "$big" ] || skip "jq prints this number differently"
  printf '{"last":"src/a.ts","epoch":%s}' "$big" > "$RUVECTOR_DIR/coedit-sessions/w1"
  COEDIT_WINDOW_SECS=2000 edit w1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 0 ]
}

@test "an expired non-directory or non-empty marker at the current generation never blocks the reclaim" {
  mkdir -p "$RUVECTOR_DIR/.coedit.lock/junk"
  touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
  ino=$(ls -di "$RUVECTOR_DIR/.coedit.lock" | awk '{print $1}')
  mt=$(stat -c %Y "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || stat -f %m "$RUVECTOR_DIR/.coedit.lock")
  m="$RUVECTOR_DIR/.coedit.lock.reclaim.${ino}-${mt}"
  : > "$m"; touch -d '20 minutes ago' "$m"
  edit k1 "$PROJECT_ROOT/src/a.ts"; edit k1 "$PROJECT_ROOT/src/b.ts"
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "a dangling symlink or fresh file at the current generation's marker never blocks the reclaim" {
  for kind in dangling file; do
    rm -rf "$RUVECTOR_DIR"/.coedit.lock* "$COEDIT"
    mkdir -p "$RUVECTOR_DIR/.coedit.lock"
    touch -d '5 minutes ago' "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || skip "touch -d unsupported"
    ino=$(ls -di "$RUVECTOR_DIR/.coedit.lock" | awk '{print $1}')
    mt=$(stat -c %Y "$RUVECTOR_DIR/.coedit.lock" 2>/dev/null || stat -f %m "$RUVECTOR_DIR/.coedit.lock")
    m="$RUVECTOR_DIR/.coedit.lock.reclaim.${ino}-${mt}"
    case $kind in dangling) ln -s "$BATS_TEST_TMPDIR/nowhere" "$m" ;; file) : > "$m" ;; esac
    edit "k$kind" "$PROJECT_ROOT/src/a.ts"; edit "k$kind" "$PROJECT_ROOT/src/b.ts"
    [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
  done
}

@test "a multi-megabyte Write payload never keeps the hook past its budget" {
  big="$BATS_TEST_TMPDIR/big.json"
  { printf '{"hook_event_name":"PostToolUse","session_id":"big","cwd":"%s","tool_name":"Write","tool_input":{"file_path":"%s","content":"' "$PROJECT_ROOT" "$PROJECT_ROOT/src/a.ts"
    head -c 30000000 /dev/zero | tr '\0' a
    printf '"}}'; } > "$big"
  for tc in "$(command -v timeout || true)" ""; do
    start=$(date +%s%N)
    out=$(TIMEOUT_CMD="$tc" PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" < "$big")
    end=$(date +%s%N)
    printf '%s' "$out" | jq -e '.continue == true' >/dev/null
    [ $(( (end - start) / 1000000 )) -lt 900 ]
  done
  # An ordinary Write is still recorded.
  edit big2 "$PROJECT_ROOT/src/a.ts" Write; edit big2 "$PROJECT_ROOT/src/b.ts" Write
  [ "$(pair src/a.ts src/b.ts)" -eq 1 ]
}

@test "temp files are created exclusively: a symlink planted at the temp name is never written through" {
  outside="$BATS_TEST_TMPDIR/outside"; : > "$outside"
  run bash -c '
    . "$1"; f="$2/coedit.json"
    # Seeding RANDOM makes a $$.$RANDOM temp name predictable: plant a
    # symlink exactly there, then write.
    RANDOM=42; guess="${f}.tmp.$$.${RANDOM}"
    ln -s "$3" "$guess"
    RANDOM=42
    # A here-string, not a pipe: a subshell would reseed RANDOM.
    coedit_write_atomic "$f" <<< "{\"version\":1,\"pairs\":{}}"
    rm -f "$guess"' _ "$BATS_TEST_DIRNAME/../hooks/scripts/lib/coedit.sh" "$RUVECTOR_DIR" "$outside"
  [ ! -s "$outside" ]
  jq -e '.version == 1' "$RUVECTOR_DIR/coedit.json" >/dev/null
}

@test "the input parse and root lookup are charged against the lock budget" {
  sb="$BATS_TEST_TMPDIR/sleepbin"; mkdir -p "$sb"
  printf '#!/bin/sh\n[ "$1" = 0.05 ] && echo x >> "%s/waits"\nexec %s "$@"\n' "$BATS_TEST_TMPDIR" "$(command -v sleep)" > "$sb/sleep"
  chmod +x "$sb/sleep"
  edit pc "$PROJECT_ROOT/src/a.ts"
  mkdir "$RUVECTOR_DIR/.coedit.lock"
  rm -f "$BATS_TEST_TMPDIR/waits"
  event pc Edit "$PROJECT_ROOT/src/b.ts" | PATH="$sb:$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT" >/dev/null
  rmdir "$RUVECTOR_DIR/.coedit.lock"
  # 8 tries less the parse's 3 and the root lookup's 3.
  [ "$(wc -l < "$BATS_TEST_TMPDIR/waits")" -eq 2 ]
}
