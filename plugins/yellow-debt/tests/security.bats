#!/usr/bin/env bats
# Regression tests for shell-compat follow-ups 1 and 2 (security review SS-2,
# SS-3): yellow-debt never writes through a symlink a cloned repository
# ships, and a repository-controlled todo filename never reaches shell text.

bats_require_minimum_version 1.5.0

PLUGIN_ROOT="$BATS_TEST_DIRNAME/.."

setup() {
  . "$BATS_TEST_DIRNAME/../../yellow-core/lib/validate-fs.sh"
  . "$PLUGIN_ROOT/lib/validate.sh"

  WORK="$(mktemp -d)"
  OUTSIDE="$(mktemp -d)"
  mkdir -p "$WORK/todos/debt"
  printf 'sentinel\n' > "$OUTSIDE/target"
  cd "$WORK"
}

teardown() {
  cd /
  # git may still be writing under .git for a moment; retry once.
  rm -rf "$WORK" "$OUTSIDE" 2>/dev/null || { sleep 0.3; rm -rf "$WORK" "$OUTSIDE"; }
}

# A missing tool skips the test locally but fails it in CI, where a silent skip
# would leave this suite green with its coverage gone.
require_kislyuk_yq() {
  if command -v yq >/dev/null 2>&1 && yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk'; then
    return 0
  fi
  [ -z "${CI:-}" ] || { echo "kislyuk yq is required in CI"; return 1; }
  skip "kislyuk yq not installed"
}

require_jq() {
  command -v jq >/dev/null 2>&1 && return 0
  [ -z "${CI:-}" ] || { echo "jq is required in CI"; return 1; }
  skip "jq not installed"
}

require_zsh() {
  command -v zsh >/dev/null 2>&1 && return 0
  [ -z "${CI:-}" ] || { echo "zsh is required in CI"; return 1; }
  skip "zsh not installed"
}

# Hostile names run `touch pwned` / `touch pwned2` (a name cannot hold `/`),
# so an executed name leaves a sentinel somewhere under $WORK.
no_pwned() {
  [ -z "$(find "$WORK" -name 'pwned*' ! -name '*.md')" ]
}

# Usage: make_todo ID STATUS FILENAME [EXTRA_FRONTMATTER_LINES]
make_todo() {
  printf -- '---\nid: "%s"\nstatus: %s\ncategory: complexity\nseverity: high\ntitle: Long function\n%b---\nBody.\n' \
    "$1" "$2" "${4:+$4\n}" > "todos/debt/$3"
}

# Prints the Nth `bash /dev/fd/3 ... 3<<'__YELLOW_DEBT_BASH__'` block of a
# markdown file, from the wrapper line through its terminator.
extract_wrapper() {
  awk -v want="$2" '
    /^bash \/dev\/fd\/3 .*3<<.__YELLOW_DEBT_BASH__.$/ { n++; if (n == want) f = 1 }
    f { print }
    f && /^__YELLOW_DEBT_BASH__$/ { exit }
  ' "$1"
}

# Prints the wrapper block of FILE whose text contains INCLUDE and, when given,
# does not contain EXCLUDE. Select blocks by what they do, not by position: a
# block added above would silently re-point an ordinal.
extract_block() {
  awk -v inc="$2" -v exc="${3:-}" '
    /^bash \/dev\/fd\/3 .*3<<.__YELLOW_DEBT_BASH__.$/ { f = 1; buf = "" }
    f { buf = buf $0 "\n" }
    f && /^__YELLOW_DEBT_BASH__$/ {
      f = 0
      if (index(buf, inc) && (exc == "" || !index(buf, exc))) { printf "%s", buf; found = 1; exit }
    }
    END { exit found ? 0 : 1 }
  ' "$1"
}

# --- debt_resolve_todo (SS-3) ---

@test "debt_resolve_todo resolves a numeric id to its todo file" {
  make_todo 042 pending 042-pending-high-long-fn-abc123.md
  run debt_resolve_todo 042 pending
  [ "$status" -eq 0 ]
  [ "$output" = "todos/debt/042-pending-high-long-fn-abc123.md" ]
}

@test "debt_resolve_todo rejects ids that are not 1-6 digits" {
  make_todo 042 pending 042-pending-high-long-fn-abc123.md
  for bad in '' 'x' '1234567' '042-pending' '../042' '$(id)' '4 2'; do
    run debt_resolve_todo "$bad"
    [ "$status" -eq 1 ]
  done
}

@test "control: a hostile todo name pasted into double quotes runs" {
  name="todos/debt/007-pending-high-x\$(touch pwned)y.md"
  : > "$name"
  bash -c "todo=\"$name\"; : \"\$todo\""
  run no_pwned
  [ "$status" -eq 1 ]
}

@test "debt_resolve_todo ignores names outside the todo pattern and never runs them" {
  : > "todos/debt/007-pending-high-x\$(touch pwned)y-abc123.md"
  : > "todos/debt/007-pending-high-x\`touch pwned2\`y-abc123.md"
  run debt_resolve_todo 007 pending
  [ "$status" -eq 1 ]
  [[ "$output" == *"Ignored 2 file(s)"* ]]
  [[ "$output" != *'$('* ]]
  no_pwned
  no_pwned
}

@test "debt_resolve_todo picks the conforming file when a hostile neighbour shares its id" {
  make_todo 007 pending 007-pending-high-long-fn-abc123.md
  : > "todos/debt/007-pending-high-x\$(touch pwned)y.md"
  run --separate-stderr debt_resolve_todo 007 pending
  [ "$status" -eq 0 ]
  [ "$output" = "todos/debt/007-pending-high-long-fn-abc123.md" ]
}

@test "debt_resolve_todo refuses an ambiguous id" {
  make_todo 042 pending 042-pending-high-one-abc123.md
  make_todo 042 pending 042-pending-high-two-def456.md
  run debt_resolve_todo 042 pending
  [ "$status" -eq 1 ]
  [[ "$output" == *"found 2"* ]]
}

@test "debt_resolve_todo refuses a symlinked todo file" {
  ln -s "$OUTSIDE/target" todos/debt/042-pending-high-long-fn-abc123.md
  run debt_resolve_todo 042 pending
  [ "$status" -eq 1 ]
  [[ "$output" == *"symlink"* ]]
}

@test "debt_resolve_todo refuses a symlinked todos/debt directory" {
  rm -rf todos/debt
  mkdir -p "$OUTSIDE/debt"
  ln -s "$OUTSIDE/debt" todos/debt
  run debt_resolve_todo 042
  [ "$status" -eq 1 ]
  [[ "$output" == *"symlink"* ]]
}

# --- transition_todo_state (SS-2) ---

@test "transition_todo_state renames the todo and leaves no temp or lock behind" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 0 ]
  [ -f todos/debt/001-ready-high-long-fn-abc123.md ]
  [ ! -e todos/debt/001-pending-high-long-fn-abc123.md ]
  [ -z "$(find todos/debt -name '.debt-*' -o -name '*.lock' -o -name '*.tmp')" ]
  grep -q '^status: ready$' todos/debt/001-ready-high-long-fn-abc123.md
}

@test "transition_todo_state keeps in-progress and hash fields when renaming" {
  require_kislyuk_yq
  make_todo 003 in-progress 003-in-progress-low-slug-with-parts-0a1b2c3d.md
  run transition_todo_state todos/debt/003-in-progress-low-slug-with-parts-0a1b2c3d.md ready
  [ "$status" -eq 0 ]
  [ -f todos/debt/003-ready-low-slug-with-parts-0a1b2c3d.md ]
}

@test "transition_todo_state refuses a symlinked todo file" {
  ln -s "$OUTSIDE/target" todos/debt/001-pending-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 1 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]
  [ -L todos/debt/001-pending-high-long-fn-abc123.md ]
}

@test "transition_todo_state refuses a symlinked todos/debt directory" {
  mkdir -p "$OUTSIDE/debt"
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  mv todos/debt/001-pending-high-long-fn-abc123.md "$OUTSIDE/debt/"
  rm -rf todos/debt
  ln -s "$OUTSIDE/debt" todos/debt
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 1 ]
  [ "$(command ls "$OUTSIDE/debt")" = "001-pending-high-long-fn-abc123.md" ]
}

@test "transition_todo_state refuses a symlinked todos directory" {
  mkdir -p "$OUTSIDE/todos/debt"
  rm -rf todos
  ln -s "$OUTSIDE/todos" todos
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 1 ]
  [ -f "$OUTSIDE/todos/debt/001-pending-high-long-fn-abc123.md" ]
}

@test "transition_todo_state never writes through a planted .lock symlink" {
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  ln -s "$OUTSIDE/target" todos/debt/001-pending-high-long-fn-abc123.md.lock
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 1 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]
  [ -f todos/debt/001-pending-high-long-fn-abc123.md ]
}

@test "transition_todo_state never writes through a planted .tmp symlink" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  ln -s "$OUTSIDE/target" todos/debt/001-pending-high-long-fn-abc123.md.tmp
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 0 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]
  [ -f todos/debt/001-ready-high-long-fn-abc123.md ]
}

@test "transition_todo_state never renames onto a planted symlink" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  ln -s "$OUTSIDE" todos/debt/001-ready-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 1 ]
  [ "$(command ls "$OUTSIDE")" = "target" ]
}

@test "transition_todo_state refuses a name outside the todo pattern" {
  : > "todos/debt/001-pending-high-x\$(touch pwned)y.md"
  run transition_todo_state "todos/debt/001-pending-high-x\$(touch pwned)y.md" ready
  [ "$status" -eq 1 ]
  no_pwned
}

# --- update_frontmatter / debt_write_file (SS-2) ---

@test "update_frontmatter refuses a symlinked todo file" {
  ln -s "$OUTSIDE/target" todos/debt/001-ready-high-long-fn-abc123.md
  run update_frontmatter todos/debt/001-ready-high-long-fn-abc123.md '.linear_issue_id' 'abc'
  [ "$status" -eq 1 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]
}

@test "update_frontmatter writes the field in place" {
  require_kislyuk_yq
  make_todo 001 ready 001-ready-high-long-fn-abc123.md
  run update_frontmatter todos/debt/001-ready-high-long-fn-abc123.md '.linear_issue_id' 'abc-123'
  [ "$status" -eq 0 ]
  grep -q '^linear_issue_id: abc-123$' todos/debt/001-ready-high-long-fn-abc123.md
  [ -z "$(find todos/debt -name '.debt-*')" ]
}

@test "debt_write_file refuses a symlinked file or directory" {
  mkdir -p .debt
  ln -s "$OUTSIDE/target" .debt/file-list.txt
  run debt_write_file .debt/file-list.txt <<< "x"
  [ "$status" -eq 1 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]

  rm -rf .debt
  ln -s "$OUTSIDE" .debt
  run debt_write_file .debt/target <<< "x"
  [ "$status" -eq 1 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]
}

@test "debt_write_file replaces an existing file" {
  mkdir -p .debt
  printf 'old\n' > .debt/file-list.txt
  run debt_write_file .debt/file-list.txt <<< "new"
  [ "$status" -eq 0 ]
  [ "$(cat .debt/file-list.txt)" = "new" ]
  [ -z "$(find .debt -name '.debt-write.*')" ]
}

# --- SessionStart counter (SS-3) ---

@test "session-start counts only conforming high/critical todo names" {
  require_jq
  : > todos/debt/001-pending-high-long-fn-abc123.md
  : > todos/debt/002-ready-critical-thing.md
  : > "todos/debt/003-pending-high-x\$(touch pwned).md"
  : > todos/debt/004-pending-low-minor-abc123.md
  ln -s "$OUTSIDE/target" todos/debt/005-pending-high-linked-abc123.md
  CLAUDE_PROJECT_DIR="$WORK" run bash "$PLUGIN_ROOT/hooks/scripts/session-start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"2 high/critical debt finding(s)"* ]]
}

@test "session-start ignores a symlinked todos/debt directory" {
  require_jq
  rm -rf todos/debt
  mkdir -p "$OUTSIDE/debt"
  : > "$OUTSIDE/debt/001-pending-high-long-fn-abc123.md"
  ln -s "$OUTSIDE/debt" todos/debt
  CLAUDE_PROJECT_DIR="$WORK" run bash "$PLUGIN_ROOT/hooks/scripts/session-start.sh"
  [ "$status" -eq 0 ]
  [ "$output" = '{"continue": true}' ]
}

# --- Command blocks end to end under zsh -f -o noclobber ---

init_repo() {
  git init -q .
  git config user.email t@example.com
  git config user.name t
  printf 'x\n' > app.ts
  git add app.ts
  git commit -qm init
}

@test "triage Step 2 listing skips hostile names and legacy closed todos under zsh noclobber" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  : > "todos/debt/002-pending-high-x\$(touch pwned)y.md"
  make_todo 052 wont_fix 052-pending-high-legacy-aaa.md
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" 'debt_pending_todos' > "$BATS_TEST_TMPDIR/list.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run --separate-stderr zsh -f -o noclobber "$BATS_TEST_TMPDIR/list.zsh"
  [ "$status" -eq 0 ]
  [ "$output" = "todos/debt/001-pending-high-long-fn-abc123.md" ]
  [[ "$stderr" == *"skipped 1 file(s)"* ]]
  [[ "$stderr" == *"052-pending-high-legacy-aaa.md"* ]]
  no_pwned
}

@test "triage accept block takes only an id and never runs a hostile name (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  : > "todos/debt/001-pending-high-x\$(touch pwned)y.md"
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" 'transition_todo_state "$todo_file" ready' \
    | sed "s#'<todo-id>'#'001'#" > "$BATS_TEST_TMPDIR/accept.zsh"
  grep -q "bash /dev/fd/3 '001'" "$BATS_TEST_TMPDIR/accept.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/accept.zsh"
  [ "$status" -eq 0 ]
  [ -f todos/debt/001-ready-high-long-fn-abc123.md ]
  no_pwned
}

@test "triage defer-with-reason block runs under zsh noclobber" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  reason_dir=$(mktemp -d)
  printf 'not now\n' > "$reason_dir/reason.txt"
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" 'deferred "$DEFER_REASON"' \
    | sed "s#'<todo-id>'#'001'#; s#'<reason-dir>'#'$reason_dir'#" > "$BATS_TEST_TMPDIR/defer.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/defer.zsh"
  [ "$status" -eq 0 ]
  grep -q '^deferred_reason: not now$' todos/debt/001-deferred-high-long-fn-abc123.md
  [ ! -e "$reason_dir" ]
}

@test "audit block refuses a symlinked .debt under zsh noclobber" {
  require_zsh
  init_repo
  ln -s "$OUTSIDE" .debt
  extract_wrapper "$PLUGIN_ROOT/commands/debt/audit.md" 1 \
    | sed "s#^bash /dev/fd/3 .* 3<<#bash /dev/fd/3 '.' 3<<#" > "$BATS_TEST_TMPDIR/audit.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/audit.zsh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"symlink"* ]]
  [ "$(command ls "$OUTSIDE")" = "target" ]
}

@test "audit block refuses a symlinked .debt/file-list.txt under zsh noclobber" {
  require_zsh
  init_repo
  mkdir -p .debt
  ln -s "$OUTSIDE/target" .debt/file-list.txt
  extract_wrapper "$PLUGIN_ROOT/commands/debt/audit.md" 1 \
    | sed "s#^bash /dev/fd/3 .* 3<<#bash /dev/fd/3 '.' 3<<#" > "$BATS_TEST_TMPDIR/audit.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/audit.zsh"
  [ "$status" -eq 1 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]
}

@test "audit block rewrites existing .debt files under zsh noclobber" {
  require_zsh
  init_repo
  mkdir -p .debt
  printf 'stale\n' > .debt/file-list.txt
  printf 'stale\n' > .debt/scanners-to-run.txt
  extract_wrapper "$PLUGIN_ROOT/commands/debt/audit.md" 1 \
    | sed "s#^bash /dev/fd/3 .* 3<<#bash /dev/fd/3 '.' '--category' 'complexity' '--severity' 'high' 3<<#" \
    > "$BATS_TEST_TMPDIR/audit.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/audit.zsh"
  [ "$status" -eq 0 ]
  [ "$(cat .debt/file-list.txt)" = "app.ts" ]
  [ "$(cat .debt/scanners-to-run.txt)" = "complexity" ]
  [ "$(cat .debt/severity-filter.txt)" = "high" ]
}

@test "fix block accepts an id or the matching path and moves the todo to in-progress (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 042 ready 042-ready-high-long-fn-abc123.md
  : > "todos/debt/042-ready-high-x\$(touch pwned)y.md"
  extract_wrapper "$PLUGIN_ROOT/commands/debt/fix.md" 1 \
    | sed "s#'<todo-arg>'#'todos/debt/042-ready-high-long-fn-abc123.md'#" > "$BATS_TEST_TMPDIR/fix.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run --separate-stderr zsh -f -o noclobber "$BATS_TEST_TMPDIR/fix.zsh"
  [ "$status" -eq 0 ]
  [ -f todos/debt/042-in-progress-high-long-fn-abc123.md ]
  [[ "$stderr" == *"Todo id: 042"* ]]
  no_pwned

  make_todo 043 ready 043-ready-low-other-def456.md
  extract_wrapper "$PLUGIN_ROOT/commands/debt/fix.md" 1 \
    | sed "s#'<todo-arg>'#'043'#" > "$BATS_TEST_TMPDIR/fix.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/fix.zsh"
  [ "$status" -eq 0 ]
  [ -f todos/debt/043-in-progress-low-other-def456.md ]
}

@test "fix block rejects a path that is not the todo for its id" {
  require_zsh
  init_repo
  make_todo 042 ready 042-ready-high-long-fn-abc123.md
  extract_wrapper "$PLUGIN_ROOT/commands/debt/fix.md" 1 \
    | sed "s#'<todo-arg>'#'todos/debt/042-ready-high-other.md'#" > "$BATS_TEST_TMPDIR/fix.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/fix.zsh"
  [ "$status" -eq 1 ]
  [ -f todos/debt/042-ready-high-long-fn-abc123.md ]
}

@test "debt-fixer scope block resolves the id and resets out-of-scope edits (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  printf -- '---\nid: "042"\nstatus: in-progress\ncategory: complexity\nseverity: high\ntitle: T\naffected_files:\n  - app.ts:1-2\n---\nBody.\n' \
    > todos/debt/042-in-progress-high-long-fn-abc123.md
  printf 'y\n' > other.ts
  git add -A && git commit -qm todo
  extract_wrapper "$PLUGIN_ROOT/agents/remediation/debt-fixer.md" 1 \
    | sed "s#'<todo-id>'#'042'#" > "$BATS_TEST_TMPDIR/scope.zsh"

  printf 'changed\n' > app.ts
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/scope.zsh"
  [ "$status" -eq 0 ]

  printf 'changed\n' > other.ts
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/scope.zsh"
  [ "$status" -eq 1 ]
  [ "$(cat other.ts)" = "y" ]
  [ -f todos/debt/042-ready-high-long-fn-abc123.md ]
}

@test "sync step 8a block sources validate.sh and prints the fields (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 001 ready 001-ready-high-long-fn-abc123.md
  # Step 8a is the second wrapper in sync.md (Step 7 is the first).
  extract_wrapper "$PLUGIN_ROOT/commands/debt/sync.md" 2 \
    | sed "s#'<todo-id>'#'001'#" > "$BATS_TEST_TMPDIR/sync8a.zsh"
  grep -q 'extract_frontmatter' "$BATS_TEST_TMPDIR/sync8a.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run --separate-stderr zsh -f -o noclobber "$BATS_TEST_TMPDIR/sync8a.zsh"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.title')" = "Long function" ]
  [ "$(printf '%s' "$output" | jq -r '.severity')" = "high" ]
}

@test "sync write-back block rejects a hostile issue id (zsh noclobber)" {
  require_zsh
  init_repo
  make_todo 001 ready 001-ready-high-long-fn-abc123.md
  extract_wrapper "$PLUGIN_ROOT/commands/debt/sync.md" 3 \
    | sed "s#'<todo-id>'#'001'#; s#'<issue-id>'#'x\$(touch pwned)'#" > "$BATS_TEST_TMPDIR/sync8e.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/sync8e.zsh"
  [ "$status" -eq 1 ]
  no_pwned
}

@test "debt-fixer rejected block reverts the fix but keeps the in-progress todo (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  printf 'x\n' > app.ts
  make_todo 042 ready 042-ready-high-long-fn-abc123.md
  git add -A && git commit -qm base
  # /debt:fix moved the todo to in-progress without committing it; the fix
  # then edited a tracked file and created an untracked one.
  transition_todo_state todos/debt/042-ready-high-long-fn-abc123.md in-progress
  printf 'changed\n' > app.ts
  printf 'new\n' > helper.ts
  extract_wrapper "$PLUGIN_ROOT/agents/remediation/debt-fixer.md" 4 \
    | sed "s#'<todo-id>'#'042'#" > "$BATS_TEST_TMPDIR/rejected.zsh"

  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/rejected.zsh"
  [ "$status" -eq 0 ]
  [ "$(cat app.ts)" = "x" ]
  [ ! -e helper.ts ]
  [ -f todos/debt/042-ready-high-long-fn-abc123.md ]
  [ ! -e todos/debt/042-in-progress-high-long-fn-abc123.md ]
}

@test "debt-fixer scope block ignores the uncommitted todo rename from /debt:fix (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  printf -- '---\nid: "042"\nstatus: ready\ncategory: complexity\nseverity: high\ntitle: T\naffected_files:\n  - app.ts:1-2\n---\nBody.\n' \
    > todos/debt/042-ready-high-long-fn-abc123.md
  git add -A && git commit -qm todo
  transition_todo_state todos/debt/042-ready-high-long-fn-abc123.md in-progress
  printf 'changed\n' > app.ts
  extract_wrapper "$PLUGIN_ROOT/agents/remediation/debt-fixer.md" 1 \
    | sed "s#'<todo-id>'#'042'#" > "$BATS_TEST_TMPDIR/scope.zsh"

  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/scope.zsh"
  [ "$status" -eq 0 ]
  [ "$(cat app.ts)" = "changed" ]
  [ -f todos/debt/042-in-progress-high-long-fn-abc123.md ]
  [ ! -e todos/debt/042-ready-high-long-fn-abc123.md ]
}

@test "debt-fixer scope block accepts an untracked todos directory (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  printf -- '---\nid: "042"\nstatus: in-progress\ncategory: complexity\nseverity: high\ntitle: T\naffected_files:\n  - app.ts:1-2\n---\nBody.\n' \
    > todos/debt/042-in-progress-high-long-fn-abc123.md
  make_todo 043 pending 043-pending-high-other-def456.md
  printf 'changed\n' > app.ts
  extract_wrapper "$PLUGIN_ROOT/agents/remediation/debt-fixer.md" 1 \
    | sed "s#'<todo-id>'#'042'#" > "$BATS_TEST_TMPDIR/scope.zsh"

  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/scope.zsh"
  [ "$status" -eq 0 ]
  [ -f todos/debt/043-pending-high-other-def456.md ]
}

# --- wont-fix: transitions, reasons, repair ---

frontmatter_field() {
  extract_frontmatter "$1" | yq -r "$2"
}

@test "transition to wont-fix renames the file and round-trips the reason" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-0a1b2c3d.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-0a1b2c3d.md wont-fix "too costly: not worth it"
  [ "$status" -eq 0 ]
  [ -f todos/debt/001-wont-fix-high-long-fn-0a1b2c3d.md ]
  [ ! -e todos/debt/001-pending-high-long-fn-0a1b2c3d.md ]
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-0a1b2c3d.md .status)" = "wont-fix" ]
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-0a1b2c3d.md .wont_fix_reason)" = "too costly: not worth it" ]
  [ -z "$(find todos/debt -name '.debt-*' -o -name '*.lock')" ]
}

@test "reopening wont-fix restores a hyphenated slug and hash exactly" {
  require_kislyuk_yq
  make_todo 004 pending 004-pending-medium-slug-with-parts-0a1b2c3d.md
  transition_todo_state todos/debt/004-pending-medium-slug-with-parts-0a1b2c3d.md wont-fix "later"
  [ -f todos/debt/004-wont-fix-medium-slug-with-parts-0a1b2c3d.md ]
  run transition_todo_state todos/debt/004-wont-fix-medium-slug-with-parts-0a1b2c3d.md pending
  [ "$status" -eq 0 ]
  [ -f todos/debt/004-pending-medium-slug-with-parts-0a1b2c3d.md ]
  debt_todo_name_ok 004-pending-medium-slug-with-parts-0a1b2c3d.md
  [ "$(frontmatter_field todos/debt/004-pending-medium-slug-with-parts-0a1b2c3d.md '.wont_fix_reason // "absent"')" = "absent" ]
}

@test "reason fields are exclusive to their own status" {
  require_kislyuk_yq
  make_todo 001 deferred 001-deferred-high-long-fn-abc123.md 'deferred_reason: later'
  transition_todo_state todos/debt/001-deferred-high-long-fn-abc123.md wont-fix "never"
  f=todos/debt/001-wont-fix-high-long-fn-abc123.md
  [ "$(frontmatter_field $f '.deferred_reason // "absent"')" = "absent" ]
  [ "$(frontmatter_field $f .wont_fix_reason)" = "never" ]
  transition_todo_state $f pending
  [ "$(frontmatter_field todos/debt/001-pending-high-long-fn-abc123.md '.wont_fix_reason // "absent"')" = "absent" ]
}

@test "wont-fix reason is cut to 200 codepoints without splitting a character (C locale)" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  reason="$(printf 'a%.0s' $(seq 199))é$(printf 'b%.0s' $(seq 100))"
  LC_ALL=C run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md wont-fix "$reason"
  [ "$status" -eq 0 ]
  got=$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-abc123.md .wont_fix_reason)
  [ "$(printf '%s' "$got" | jq -Rr 'length')" -eq 200 ]
  [ "$(printf '%s' "$got" | jq -Rr 'endswith("é")')" = "true" ]
  printf '%s' "$got" | iconv -f UTF-8 -t UTF-8 >/dev/null
}

@test "wont-fix reason drops newlines; a reason of only newlines writes no field" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  make_todo 002 pending 002-pending-high-long-fn-abc123.md
  transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md wont-fix $'line one\nline two\r'
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-abc123.md .wont_fix_reason)" = "line oneline two" ]
  transition_todo_state todos/debt/002-pending-high-long-fn-abc123.md wont-fix $'\n\n'
  [ "$(frontmatter_field todos/debt/002-wont-fix-high-long-fn-abc123.md '.wont_fix_reason // "absent"')" = "absent" ]
}

@test "hostile wont-fix reasons are stored as data and never run" {
  require_kislyuk_yq
  local i=0 reason
  for reason in '$(touch pwned)' '`touch pwned2`' 'a: b # c' '---' "it's \"quoted\""; do
    i=$((i + 1))
    make_todo "00$i" pending "00$i-pending-high-long-fn-abc123.md"
    run transition_todo_state "todos/debt/00$i-pending-high-long-fn-abc123.md" wont-fix "$reason"
    [ "$status" -eq 0 ]
    [ "$(frontmatter_field "todos/debt/00$i-wont-fix-high-long-fn-abc123.md" .wont_fix_reason)" = "$reason" ]
    [ "$(frontmatter_field "todos/debt/00$i-wont-fix-high-long-fn-abc123.md" .status)" = "wont-fix" ]
  done
  no_pwned
}

@test "legacy wont_fix frontmatter is repaired and keeps its hand-written reason" {
  require_kislyuk_yq
  make_todo 052 wont_fix 052-pending-high-long-fn-0a1b2c3d.md 'wont_fix_reason: agent wrote this'
  run transition_todo_state todos/debt/052-pending-high-long-fn-0a1b2c3d.md wont-fix
  [ "$status" -eq 0 ]
  f=todos/debt/052-wont-fix-high-long-fn-0a1b2c3d.md
  [ -f $f ]
  [ ! -e todos/debt/052-pending-high-long-fn-0a1b2c3d.md ]
  debt_todo_name_ok 052-wont-fix-high-long-fn-0a1b2c3d.md
  [ "$(frontmatter_field $f .status)" = "wont-fix" ]
  [ "$(frontmatter_field $f .wont_fix_reason)" = "agent wrote this" ]
}

@test "legacy repair truncates an over-long hand-written reason to 200 codepoints" {
  require_kislyuk_yq
  make_todo 052 wont_fix 052-pending-high-long-fn-0a1b2c3d.md "wont_fix_reason: $(printf 'x%.0s' $(seq 250))"
  transition_todo_state todos/debt/052-pending-high-long-fn-0a1b2c3d.md wont-fix
  got=$(frontmatter_field todos/debt/052-wont-fix-high-long-fn-0a1b2c3d.md .wont_fix_reason)
  [ "$(printf '%s' "$got" | jq -Rr 'length')" -eq 200 ]
}

@test "reopening onto an existing pending name fails and leaves the source and no lock" {
  require_kislyuk_yq
  make_todo 001 wont-fix 001-wont-fix-high-long-fn-abc123.md 'wont_fix_reason: keep'
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-wont-fix-high-long-fn-abc123.md pending
  [ "$status" -ne 0 ]
  [ -f todos/debt/001-wont-fix-high-long-fn-abc123.md ]
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-abc123.md .wont_fix_reason)" = "keep" ]
  [ -z "$(find todos/debt -name '.debt-*' -o -name '*.lock')" ]
}

@test "a todo closed as wont-fix no longer resolves as in-progress" {
  require_kislyuk_yq
  make_todo 001 in-progress 001-in-progress-high-long-fn-abc123.md
  transition_todo_state todos/debt/001-in-progress-high-long-fn-abc123.md wont-fix "dropped"
  run debt_resolve_todo 001 in-progress
  [ "$status" -eq 1 ]
  run debt_resolve_todo 001 wont-fix
  [ "$status" -eq 0 ]
}

@test "triage won't-fix blocks run under zsh noclobber" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  make_todo 002 pending 002-pending-high-long-fn-abc123.md
  reason_dir=$(mktemp -d)
  printf 'not worth it\n' > "$reason_dir/reason.txt"
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" 'wont-fix "$REASON"' '<current-status>' \
    | sed "s#'<todo-id>'#'001'#; s#'<reason-dir>'#'$reason_dir'#" > "$BATS_TEST_TMPDIR/wf-reason.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/wf-reason.zsh"
  [ "$status" -eq 0 ]
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-abc123.md .wont_fix_reason)" = "not worth it" ]
  [ ! -e "$reason_dir" ]
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" 'wont-fix || {' \
    | sed "s#'<todo-id>'#'002'#" > "$BATS_TEST_TMPDIR/wf-blank.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/wf-blank.zsh"
  [ "$status" -eq 0 ]
  [ "$(frontmatter_field todos/debt/002-wont-fix-high-long-fn-abc123.md '.wont_fix_reason // "absent"')" = "absent" ]
}

@test "triage won't-fix recipe closes a ready todo under zsh noclobber" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 003 ready 003-ready-high-long-fn-abc123.md
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" '<current-status>' \
    | sed "s#'<todo-id>'#'003'#; s#'<current-status>'#'ready'#; s#'<reason-dir>'#'-'#" > "$BATS_TEST_TMPDIR/recipe.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/recipe.zsh"
  [ "$status" -eq 0 ]
  [ -f todos/debt/003-wont-fix-high-long-fn-abc123.md ]
}

# --- debt_fingerprint, anchors and kept-todo matching ---

make_source() {
  mkdir -p src
  printf 'toplevel_function_name()\ncompute_total(alpha,beta)\n  bar(beta)\nbaz()\nqux()\n' > src/a.js
}

# Loads .debt/fingerprints.json into `lines`, one compact object per element.
load_fingerprints() {
  lines=()
  local line
  while IFS= read -r line; do lines+=("$line"); done < <(jq -c '.[]' .debt/fingerprints.json)
}

write_surviving() {
  printf '[' > .debt/surviving-findings.json
  local first=1 spec
  for spec in "$@"; do
    [ "$first" -eq 1 ] || printf ',' >> .debt/surviving-findings.json
    first=0
    printf '{"category":"complexity","file":{"path":"src/a.js","lines":"%s"},"finding":"f"}' "$spec" >> .debt/surviving-findings.json
  done
  printf ']' >> .debt/surviving-findings.json
}

@test "debt_fingerprint ignores inserted lines above and re-indentation, not code edits" {
  make_source
  before=$(debt_fingerprint complexity src/a.js 2 3)
  [[ "$before" =~ ^fp/v1:[0-9a-f]{16}$ ]]
  printf 'n1\nn2\nn3\ntop\n      compute_total(alpha,beta)\n\t\tbar(beta)\nbaz()\nqux()\n' > src/a.js
  [ "$(debt_fingerprint complexity src/a.js 5 6)" = "$before" ]
  printf 'n1\nn2\nn3\ntop\n      compute_total(gamma,beta)\n\t\tbar(beta)\nbaz()\nqux()\n' > src/a.js
  [ "$(debt_fingerprint complexity src/a.js 5 6)" != "$before" ]
  [ "$(debt_fingerprint duplication src/a.js 5 6)" != "$(debt_fingerprint complexity src/a.js 5 6)" ]
}

# SHA-256 of stdin, first 16 hex digits, without assuming GNU coreutils.
sha16_ref() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -c1-16; else shasum -a 256 | cut -c1-16; fi
}

@test "debt_fingerprint known answer: the fp/v1 recipe does not drift" {
  printf 'alpha_one_long_name_here\n  beta_two_long_name_here\n' > known.js
  # Pinned literals, and the same recipe recomputed without the library.
  [ "$(debt_fingerprint complexity known.js 1 2)" = "fp/v1:7af66535893caf60" ]
  [ "$(printf 'fp/v1\0complexity\0known.js\0alpha_one_long_name_here\nbeta_two_long_name_here' | sha16_ref)" = "7af66535893caf60" ]
  [ "$(debt_anchor_hashes known.js 1 2 1)" = "9ea1ec096be5fb89" ]
  [ "$(printf '%s' alpha_one_long_name_here | sha16_ref)" = "9ea1ec096be5fb89" ]
}

@test "debt_fingerprint refuses traversal, absolute and symlinked paths and bad ranges" {
  make_source
  ln -s a.js src/link.js
  local args misses=""
  for args in "../a.js 1 2" "/etc/passwd 1 2" "src/link.js 1 2" "src/a.js 0 2" "src/a.js 3 2" "src/a.js x 2" "src/a.js 90 95" "src/missing.js 1 2"; do
    # shellcheck disable=SC2086
    debt_fingerprint complexity $args >/dev/null 2>&1 && misses="$misses [$args]"
  done
  [ -z "$misses" ] || { echo "accepted:$misses"; return 1; }
  run debt_fingerprint not-a-category src/a.js 1 2
  [ "$status" -eq 1 ]
}

@test "debt_fingerprint needs a line range, so one closed finding cannot cover a whole file" {
  make_source
  run debt_fingerprint complexity src/a.js
  [ "$status" -eq 1 ]
  run debt_fingerprint complexity src/a.js 2
  [ "$status" -eq 1 ]
  run debt_fingerprint complexity src/a.js 2 2
  [ "$status" -eq 0 ]
}

@test "debt_fingerprint hashes the whole range, so an edit past line 200 changes it" {
  seq 1 400 | sed 's/^/statement_/' > big.js
  before=$(debt_fingerprint complexity big.js 1 300)
  [ "$before" != "$(debt_fingerprint complexity big.js 1 200)" ]
  sed -i.bak '250s/.*/statement_changed/' big.js
  [ "$(debt_fingerprint complexity big.js 1 300)" != "$before" ]
}

@test "debt_fingerprint folds blanks but keeps the gap between tokens" {
  printf 'if (role == "allow admin") {\n  grant()\n}\n' > ws.js
  before=$(debt_fingerprint complexity ws.js 1 3)
  printf '\tif   (role == "allow  admin")  {\r\n\t\tgrant()  \r\n}\n' > ws.js
  [ "$(debt_fingerprint complexity ws.js 1 3)" = "$before" ]
  printf 'if (role == "allowadmin") {\n  grant()\n}\n' > ws.js
  [ "$(debt_fingerprint complexity ws.js 1 3)" != "$before" ]
}

@test "debt_anchor_hashes skips short lines and honours LIMIT" {
  printf '}\nelse {\nif err != nil {\nlong_statement_number_one(x)\nlong_statement_number_two(y)\n' > a.js
  run debt_anchor_hashes a.js 1 5
  [ "${#lines[@]}" -eq 2 ]
  run debt_anchor_hashes a.js 1 5 1
  [ "${#lines[@]}" -eq 1 ]
}

@test "closing a todo as wont-fix stamps its fingerprint and anchor from the tree" {
  require_kislyuk_yq
  make_source
  make_todo 001 pending 001-pending-high-long-fn-abc123.md "affected_files:\n  - src/a.js:2-3"
  transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md wont-fix "later"
  f=todos/debt/001-wont-fix-high-long-fn-abc123.md
  [ "$(frontmatter_field $f .fingerprint)" = "$(debt_fingerprint complexity src/a.js 2 3)" ]
  [ "$(frontmatter_field $f .anchor_hash)" = "$(debt_anchor_hashes src/a.js 2 3 1)" ]
}

@test "a transition never fails because the todo has no usable affected_files" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md "affected_files:\n  - ../outside.js:1-2"
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md deleted
  [ "$status" -eq 0 ]
  [ -f todos/debt/001-deleted-high-long-fn-abc123.md ]
  [ "$(frontmatter_field todos/debt/001-deleted-high-long-fn-abc123.md '.fingerprint // "absent"')" = "absent" ]
}

@test "debt_match_kept_todos skips a finding that matches a kept wont-fix todo after the code moved" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  anchor=$(debt_anchor_hashes src/a.js 2 3 1)
  make_todo 007 wont-fix 007-wont-fix-high-long-fn-abc123.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp\nanchor_hash: $anchor"
  printf 'n1\nn2\nn3\ntop\n      compute_total(alpha,beta)\n\t\tbar(beta)\nbaz()\nqux()\n' > src/a.js
  mkdir -p .debt
  write_surviving 5-6 5-7 4-4
  run debt_match_kept_todos
  [ "$status" -eq 0 ]
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"kept_id":"007"'*'"status":"wont-fix"'*'"match":"fingerprint"'* ]]
  [[ "${lines[1]}" == *'"skip":true'*'"match":"anchor"'* ]]
  [[ "${lines[2]}" == *'"skip":false'*'"fingerprint":"fp/v1:'* ]]
}

@test "debt_match_kept_todos does not anchor-match a range that merely contains the anchor line" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  anchor=$(debt_anchor_hashes src/a.js 2 3 1)
  make_todo 007 wont-fix 007-wont-fix-high-long-fn-abc123.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp\nanchor_hash: $anchor"
  mkdir -p .debt
  write_surviving 1-5
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos suppresses on an exact fingerprint shared by several kept todos" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 007 wont-fix 007-wont-fix-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  make_todo 008 complete 008-complete-high-bbb.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"kept_id":"007"'*'"match":"fingerprint"'* ]]
}

@test "debt_match_kept_todos does not suppress on a tie between two kept anchors" {
  require_kislyuk_yq
  init_repo
  make_source
  anchor=$(debt_anchor_hashes src/a.js 2 3 1)
  make_todo 007 wont-fix 007-wont-fix-high-aaa.md "affected_files:\n  - src/a.js:2-2\nanchor_hash: $anchor"
  make_todo 008 ready 008-ready-high-bbb.md "affected_files:\n  - src/a.js:2-4\nanchor_hash: $anchor"
  mkdir -p .debt
  write_surviving 2-5
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos never matches a pending todo or another category" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  anchor=$(debt_anchor_hashes src/a.js 2 3 1)
  make_todo 007 pending 007-pending-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp\nanchor_hash: $anchor"
  printf -- '---\nstatus: wont-fix\ncategory: duplication\naffected_files:\n  - src/a.js:2-3\nanchor_hash: %s\n---\nB\n' "$anchor" > todos/debt/008-wont-fix-high-bbb.md
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos rehashes an older todo with no stored identity, except a complete one" {
  require_kislyuk_yq
  init_repo
  make_source
  make_todo 007 wont-fix 007-wont-fix-high-aaa.md "affected_files:\n  - src/a.js:2-3"
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"kept_id":"007"'* ]]
  rm todos/debt/007-wont-fix-high-aaa.md
  make_todo 009 complete 009-complete-high-ccc.md "affected_files:\n  - src/a.js:2-3"
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos lets a deferred finding resurface" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 007 deferred 007-deferred-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos never anchor-matches a security-debt finding" {
  require_kislyuk_yq
  init_repo
  make_source
  anchor=$(debt_anchor_hashes src/a.js 2 3 1)
  printf -- '---\nstatus: wont-fix\ncategory: security-debt\naffected_files:\n  - src/a.js:2-3\nanchor_hash: %s\n---\nB\n' "$anchor" > todos/debt/007-wont-fix-high-aaa.md
  mkdir -p .debt
  printf '[{"category":"security-debt","file":{"path":"src/a.js","lines":"2-5"},"finding":"f"}]' > .debt/surviving-findings.json
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos removes a stale fingerprints.json, even when it fails" {
  require_kislyuk_yq
  init_repo
  make_source
  mkdir -p .debt
  printf '[{"index":0,"skip":true}]' > .debt/fingerprints.json
  printf 'not json' > .debt/surviving-findings.json
  run debt_match_kept_todos
  [ "$status" -ne 0 ]
  [ ! -e .debt/fingerprints.json ]
  [ -z "$(find .debt -name '.paths.*' -o -name '.fingerprints.*')" ]
}

@test "debt_match_kept_todos refuses a symlinked fingerprints.json and writes nothing through it" {
  require_kislyuk_yq
  init_repo
  make_source
  mkdir -p .debt
  ln -s "$OUTSIDE/target" .debt/fingerprints.json
  write_surviving 2-3
  run debt_match_kept_todos
  [ "$status" -ne 0 ]
  [ "$(cat "$OUTSIDE/target")" = "sentinel" ]
}

@test "debt_match_kept_todos warns about findings it cannot fingerprint" {
  require_kislyuk_yq
  init_repo
  make_source
  mkdir -p .debt
  printf '[{"category":"complexity","file":{"path":"src/a.js"},"finding":"f"}]' > .debt/surviving-findings.json
  run --separate-stderr debt_match_kept_todos
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"without a usable line range"* ]]
}

@test "debt_next_todo_id counts above every file, including 8x and malformed names" {
  : > todos/debt/008-ready-high-a.md
  : > todos/debt/009-wont-fix-high-b.md
  : > todos/debt/012-pending-bogus-name.md
  : > todos/debt/notes.md
  run debt_next_todo_id
  [ "$status" -eq 0 ]
  [ "$output" = "013" ]
}

@test "debt_next_todo_id ignores a planted symlink so it cannot exhaust the id space" {
  : > todos/debt/004-ready-high-a.md
  ln -s 004-ready-high-a.md todos/debt/999999-ready-high-planted.md
  run debt_next_todo_id
  [ "$status" -eq 0 ]
  [ "$output" = "005" ]
}

@test "debt_next_todo_id ignores a directory named like a todo for the maximum" {
  : > todos/debt/004-ready-high-a.md
  mkdir -p todos/debt/999999-poison.md/child
  run debt_next_todo_id
  [ "$status" -eq 0 ]
  [ "$output" = "005" ]
}

@test "debt_next_todo_id skips a number held by a dangling symlink" {
  : > todos/debt/004-ready-high-a.md
  ln -s missing.md todos/debt/005-ready-high-gone.md
  run debt_next_todo_id 2
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "006" ]
  [ "${lines[1]}" = "007" ]
}

@test "debt_next_todo_id starts at 001 with no todos and refuses when ids run out" {
  run debt_next_todo_id
  [ "$output" = "001" ]
  : > todos/debt/999999-ready-high-a.md
  run debt_next_todo_id
  [ "$status" -eq 1 ]
}

@test "debt_pending_todos skips a ready todo whose slug contains -pending- and a legacy closed one" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-old-finding.md
  make_todo 002 ready 002-ready-high-fix-pending-queue.md
  make_todo 052 wont_fix 052-pending-high-legacy-closed.md
  run --separate-stderr debt_pending_todos
  [ "$status" -eq 0 ]
  [ "$output" = "todos/debt/001-pending-high-old-finding.md" ]
  [[ "$stderr" == *"052-pending-high-legacy-closed.md"* ]]
}

@test "the synthesizer blocks call the library functions this suite tests" {
  local f="$PLUGIN_ROOT/agents/synthesis/audit-synthesizer.md" fn misses=""
  for fn in debt_pending_todos debt_match_kept_todos debt_next_todo_id debt_todo_name_ok; do
    grep -qF -- "$fn" "$f" || misses="$misses $fn"
  done
  [ -z "$misses" ] || { echo "not called from the synthesizer:$misses"; return 1; }
}

@test "a defer reason that starts with a dash is stored, not read as a yq option" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md deferred '--help'
  [ "$status" -eq 0 ]
  [ "$(frontmatter_field todos/debt/001-deferred-high-long-fn-abc123.md .deferred_reason)" = "--help" ]
}

@test "every legacy wont-fix spelling can be repaired, in place when the name is already right" {
  require_kislyuk_yq
  make_todo 001 wontfix 001-pending-high-aaa.md
  make_todo 002 "wont fix" 002-pending-high-bbb.md
  make_todo 003 wont_fix 003-wont-fix-high-ccc.md 'wont_fix_reason: kept'
  transition_todo_state todos/debt/001-pending-high-aaa.md wont-fix
  transition_todo_state todos/debt/002-pending-high-bbb.md wont-fix
  run transition_todo_state todos/debt/003-wont-fix-high-ccc.md wont-fix
  [ "$status" -eq 0 ]
  [ -f todos/debt/001-wont-fix-high-aaa.md ] && [ -f todos/debt/002-wont-fix-high-bbb.md ]
  [ -f todos/debt/003-wont-fix-high-ccc.md ]
  [ "$(frontmatter_field todos/debt/003-wont-fix-high-ccc.md .status)" = "wont-fix" ]
  [ "$(frontmatter_field todos/debt/003-wont-fix-high-ccc.md .wont_fix_reason)" = "kept" ]
}

@test "legacy repair strips newlines from a hand-written reason" {
  require_kislyuk_yq
  printf -- '---\nid: "9"\nstatus: wont_fix\ncategory: complexity\nseverity: high\nwont_fix_reason: "one\\ntwo"\n---\nB\n' > todos/debt/009-pending-high-aaa.md
  transition_todo_state todos/debt/009-pending-high-aaa.md wont-fix
  [ "$(frontmatter_field todos/debt/009-wont-fix-high-aaa.md .wont_fix_reason)" = "onetwo" ]
}

@test "triage won't-fix block refuses a symlinked reason file and a missing one" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  reason_dir=$(mktemp -d)
  ln -s "$OUTSIDE/target" "$reason_dir/reason.txt"
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" 'wont-fix "$REASON"' '<current-status>' \
    | sed "s#'<todo-id>'#'001'#; s#'<reason-dir>'#'$reason_dir'#" > "$BATS_TEST_TMPDIR/wf.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/wf.zsh"
  [ "$status" -ne 0 ]
  [ -f todos/debt/001-pending-high-long-fn-abc123.md ]
  rm -f "$reason_dir/reason.txt"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/wf.zsh"
  [ "$status" -ne 0 ]
  [ -f todos/debt/001-pending-high-long-fn-abc123.md ]
}

@test "triage recipe records a reason from a reason directory" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 003 deferred 003-deferred-high-long-fn-abc123.md
  reason_dir=$(mktemp -d)
  printf 'cost\n' > "$reason_dir/reason.txt"
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" '<current-status>' \
    | sed "s#'<todo-id>'#'003'#; s#'<current-status>'#'deferred'#; s#'<reason-dir>'#'$reason_dir'#" > "$BATS_TEST_TMPDIR/recipe.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/recipe.zsh"
  [ "$status" -eq 0 ]
  [ "$(frontmatter_field todos/debt/003-wont-fix-high-long-fn-abc123.md .wont_fix_reason)" = "cost" ]
}

# Runs the status block against the todos in the current directory.
run_status_block() {
  awk '/^bash \/dev\/fd\/3/{f=1;next} /^__YELLOW_DEBT_BASH__$/{f=0} f' "$PLUGIN_ROOT/commands/debt/status.md" > "$BATS_TEST_TMPDIR/status-block.sh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run --separate-stderr bash "$BATS_TEST_TMPDIR/status-block.sh" "$@"
}

@test "status counts wont-fix, keeps --json valid and explains a legacy status" {
  require_kislyuk_yq
  init_repo
  make_todo 001 wont-fix 001-wont-fix-high-aaa.md
  make_todo 002 wont_fix 002-pending-high-bbb.md
  make_todo 003 pending 003-pending-high-ccc.md
  run_status_block --json
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq '.by_status.wont_fix')" = "1" ]
  [ "$(printf '%s' "$output" | jq '.by_status.pending')" = "1" ]
  [ "$(printf '%s' "$output" | jq '.total_findings')" = "3" ]
  [[ "$stderr" == *'close todo id 002 (name status pending)'* ]]
  run_status_block
  [[ "$output" == *"Won't fix:   1 findings (closed)"* ]]
}

@test "status tells a legacy todo with a nonconforming name to be renamed by hand" {
  require_kislyuk_yq
  init_repo
  make_todo 004 wont_fix 004-wont_fix-high-ddd.md
  run_status_block --json
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"rename it by hand"* ]]
}

# --- installed layout, matcher status source, close-time identity ---

@test "validate.sh finds the highest yellow-core in the versioned plugin cache" {
  cache="$BATS_TEST_TMPDIR/cache/yellow-plugins"
  mkdir -p "$cache/yellow-debt/1.0.0/lib" "$cache/yellow-core/1.9.0/lib" "$cache/yellow-core/1.10.0/lib"
  cp "$PLUGIN_ROOT/lib/validate.sh" "$cache/yellow-debt/1.0.0/lib/"
  for v in 1.9.0 1.10.0; do
    { cat "$PLUGIN_ROOT/../yellow-core/lib/validate-fs.sh"; printf '_VFS_MARK=%s\n' "$v"; } > "$cache/yellow-core/$v/lib/validate-fs.sh"
  done
  run env -u _VALIDATE_FS_LOADED CLAUDE_PLUGIN_ROOT="$cache/yellow-debt/1.0.0" bash -c '. "$CLAUDE_PLUGIN_ROOT/lib/validate.sh" 2>&1; type -t validate_file_path; printf "%s\n" "$_VFS_MARK"'
  [ "$status" -eq 0 ]
  [[ "$output" == *"function"* ]]
  [[ "$output" == *"1.10.0" ]]
  [[ "$output" != *"unavailable"* ]]
}

@test "debt_match_kept_todos fails loudly when validate_file_path is unavailable" {
  init_repo
  mkdir -p .debt
  printf '[]' > .debt/surviving-findings.json
  run env -u CLAUDE_PLUGIN_ROOT -u _VALIDATE_FS_LOADED bash -c '. "$1" 2>/dev/null; debt_match_kept_todos' _ "$PLUGIN_ROOT/lib/validate.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"validate_file_path is unavailable"* ]]
}

@test "debt_match_kept_todos reads the frontmatter status: a legacy todo named pending suppresses" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 052 wont_fix 052-pending-high-legacy-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"kept_id":"052"'*'"status":"wont-fix"'* ]]
}

@test "debt_match_kept_todos does not let a name outrank a pending or deferred frontmatter status" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 007 pending 007-ready-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  make_todo 008 deferred 008-wont-fix-high-bbb.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos: ready and in-progress todos suppress on an exact fingerprint" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 007 ready 007-ready-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"status":"ready"'* ]]
  rm todos/debt/007-ready-high-aaa.md
  make_todo 008 in-progress 008-in-progress-high-bbb.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"status":"in-progress"'* ]]
}

@test "debt_match_kept_todos: complete and deleted todos suppress only on an exact fingerprint" {
  require_kislyuk_yq
  init_repo
  make_source
  anchor=$(debt_anchor_hashes src/a.js 2 3 1)
  make_todo 007 complete 007-complete-high-aaa.md "affected_files:\n  - src/a.js:2-3\nanchor_hash: $anchor"
  make_todo 008 deleted 008-deleted-high-bbb.md "affected_files:\n  - src/a.js:2-3\nanchor_hash: $anchor"
  mkdir -p .debt
  write_surviving 2-5
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "debt_match_kept_todos reports the numerically lowest id, not the first filename" {
  require_kislyuk_yq
  init_repo
  make_source
  make_todo 10 wont-fix 10-wont-fix-high-aaa.md "affected_files:\n  - src/a.js:2-3"
  make_todo 2 wont-fix 2-wont-fix-high-bbb.md "affected_files:\n  - src/a.js:2-3"
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"kept_id":"2"'* ]]
}

@test "debt_match_kept_todos keeps going past a kept todo it cannot read" {
  require_kislyuk_yq
  init_repo
  make_source
  printf -- '---\nstatus: [unclosed\ncategory: complexity\n---\nB\n' > todos/debt/007-wont-fix-high-aaa.md
  printf -- '---\nstatus: wont-fix\naffected_files:\n  - src/a.js:2-3\n  - bad: [\n---\nB\n' > todos/debt/009-wont-fix-high-ccc.md
  make_todo 011 wont-fix 011-wont-fix-high-ddd.md "affected_files:\n  - src/a.js:2-3"
  mkdir -p .debt
  write_surviving 2-3
  run --separate-stderr debt_match_kept_todos
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"unreadable"* ]]
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"kept_id":"011"'* ]]
}

@test "closing a todo as deleted stamps it, and the stamp then suppresses the finding" {
  require_kislyuk_yq
  init_repo
  make_source
  make_todo 001 pending 001-pending-high-long-fn-abc123.md "affected_files:\n  - src/a.js:2-3"
  transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md deleted
  f=todos/debt/001-deleted-high-long-fn-abc123.md
  [ "$(frontmatter_field $f .fingerprint)" = "$(debt_fingerprint complexity src/a.js 2 3)" ]
  mkdir -p .debt
  write_surviving 2-3
  debt_match_kept_todos
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":true'*'"status":"deleted"'* ]]
}

@test "closing a todo keeps a fingerprint it already has" {
  require_kislyuk_yq
  make_source
  make_todo 001 pending 001-pending-high-long-fn-abc123.md "affected_files:\n  - src/a.js:2-3\nfingerprint: fp/v1:keepme0000000000"
  transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md wont-fix
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-abc123.md .fingerprint)" = "fp/v1:keepme0000000000" ]
}

@test "closing a todo with no line range warns that it was closed without a fingerprint" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md "affected_files:\n  - src/a.js"
  run --separate-stderr transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md wont-fix
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"closed without a code fingerprint"* ]]
}

@test "debt-conventions recipe repairs a legacy todo and reopens a closed one (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 052 wont_fix 052-pending-high-legacy-aaa.md
  extract_block "$PLUGIN_ROOT/skills/debt-conventions/SKILL.md" '<new-status>' \
    | sed "s#'<todo-id>'#'052'#; s#'<current-status>'#'pending'#; s#'<new-status>'#'wont-fix'#" > "$BATS_TEST_TMPDIR/repair.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/repair.zsh"
  [ "$status" -eq 0 ]
  [ "$(frontmatter_field todos/debt/052-wont-fix-high-legacy-aaa.md .status)" = "wont-fix" ]
  extract_block "$PLUGIN_ROOT/skills/debt-conventions/SKILL.md" '<new-status>' \
    | sed "s#'<todo-id>'#'052'#; s#'<current-status>'#'wont-fix'#; s#'<new-status>'#'pending'#" > "$BATS_TEST_TMPDIR/reopen.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/reopen.zsh"
  [ "$status" -eq 0 ]
  [ -f todos/debt/052-pending-high-legacy-aaa.md ]
}

# --- idempotent close, messages, receipts, multi-id, resurfaced deferred ---

@test "closing a todo that is already wont-fix succeeds and says so" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md wont-fix "first"
  run transition_todo_state todos/debt/001-wont-fix-high-long-fn-abc123.md wont-fix
  [ "$status" -eq 0 ]
  [[ "$output" == *"already wont-fix"* ]]
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-abc123.md .wont_fix_reason)" = "first" ]
}

@test "a transition prints a receipt naming the new file" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md ready
  [ "$status" -eq 0 ]
  [[ "$output" == *"pending -> ready: todos/debt/001-ready-high-long-fn-abc123.md"* ]]
}

@test "a rejected transition lists the allowed targets" {
  require_kislyuk_yq
  make_todo 001 complete 001-complete-high-long-fn-abc123.md
  make_todo 002 pending 002-pending-high-long-fn-abc123.md
  run --separate-stderr transition_todo_state todos/debt/001-complete-high-long-fn-abc123.md ready
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"allowed from complete: none"* ]]
  run --separate-stderr transition_todo_state todos/debt/002-pending-high-long-fn-abc123.md complete
  [[ "$stderr" == *"allowed from pending: ready deferred deleted wont-fix"* ]]
}

@test "debt_resolve_todo names the state a todo is actually in" {
  make_todo 001 wont-fix 001-wont-fix-high-long-fn-abc123.md
  run --separate-stderr debt_resolve_todo 001 pending
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"todo 001 exists as wont-fix"* ]]
}

@test "a reason over 200 characters is truncated with a note" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  run --separate-stderr transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md wont-fix "$(printf 'x%.0s' $(seq 300))"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"reason truncated from 300 to 200 characters"* ]]
}

@test "debt_next_todo_id prints COUNT consecutive ids and rejects a bad count" {
  : > todos/debt/008-ready-high-a.md
  run debt_next_todo_id 3
  [ "$status" -eq 0 ]
  [ "$output" = $'009\n010\n011' ]
  run debt_next_todo_id 0
  [ "$status" -eq 1 ]
  run debt_next_todo_id abc
  [ "$status" -eq 1 ]
}

@test "debt_match_kept_todos explains a surviving-findings file that is not an array" {
  init_repo
  mkdir -p .debt
  printf '{"a":1}' > .debt/surviving-findings.json
  run --separate-stderr debt_match_kept_todos
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"missing or not a JSON array"* ]]
}

@test "debt_match_kept_todos names each unreadable kept todo and records a deferred origin" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 012 deferred 012-deferred-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  printf -- '---\nstatus: [unclosed\naffected_files:\n  - src/a.js:2-3\n---\nB\n' > todos/debt/013-wont-fix-high-bbb.md
  mkdir -p .debt
  write_surviving 2-3
  run --separate-stderr debt_match_kept_todos
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"kept todo 013-wont-fix-high-bbb.md is unreadable"* ]]
  load_fingerprints
  [[ "${lines[0]}" == *'"skip":false'*'"resurfaced_from":"012"'* ]]
}

@test "the Step 7 block builds a safe name and refuses a bad id or hash" {
  init_repo
  extract_block "$PLUGIN_ROOT/agents/synthesis/audit-synthesizer.md" 'debt_todo_name_ok "${todo_filename##*/}"' > "$BATS_TEST_TMPDIR/name.sh"
  record='{"finding":"Fix: The BIG -- thing!! (really)"}'
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" record="$record" id=013 severity=high fp_prefix=0a1b2c3d run bash "$BATS_TEST_TMPDIR/name.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "todos/debt/013-pending-high-fix-the-big-thing-really-0a1b2c3d.md" ]
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" record="$record" id=1234567 severity=high fp_prefix=0a1b2c3d run bash "$BATS_TEST_TMPDIR/name.sh"
  [ "$status" -ne 0 ]
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" record="$record" id=013 severity=high fp_prefix='zz/../x' run bash "$BATS_TEST_TMPDIR/name.sh"
  [ "$status" -ne 0 ]
}

@test "triage won't-fix block keeps the reason directory when the close fails" {
  require_zsh
  require_kislyuk_yq
  init_repo
  reason_dir=$(mktemp -d)
  printf 'cost\n' > "$reason_dir/reason.txt"
  extract_block "$PLUGIN_ROOT/commands/debt/triage.md" 'wont-fix "$REASON"' '<current-status>' \
    | sed "s#'<todo-id>'#'099'#; s#'<reason-dir>'#'$reason_dir'#" > "$BATS_TEST_TMPDIR/wf.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/wf.zsh"
  [ "$status" -ne 0 ]
  [ -f "$reason_dir/reason.txt" ]
}

@test "status survives a todo with unreadable frontmatter and lists files needing repair in JSON" {
  require_kislyuk_yq
  init_repo
  make_todo 002 wont_fix 002-pending-high-bbb.md
  printf -- '---\nstatus: [unclosed\n---\nB\n' > todos/debt/003-pending-high-ccc.md
  run_status_block --json
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '.needs_repair')" = '[{"id":"002","name_status":"pending"}]' ]
  [ "$(printf '%s' "$output" | jq '.errors')" -ge 2 ]
}
