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
  rm -rf "$WORK" "$OUTSIDE"
}

require_kislyuk_yq() {
  command -v yq >/dev/null 2>&1 && yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk' \
    || skip "kislyuk yq not installed"
}

require_zsh() {
  command -v zsh >/dev/null 2>&1 || skip "zsh not installed"
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
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
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
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
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

@test "triage Step 2 listing skips hostile names under zsh noclobber" {
  require_zsh
  init_repo
  : > todos/debt/001-pending-high-long-fn-abc123.md
  : > "todos/debt/002-pending-high-x\$(touch pwned)y.md"
  awk '/^GIT_ROOT="\$\(git rev-parse --show-toplevel\)"/{f=1} f&&/^```$/{exit} f{print}' \
    "$PLUGIN_ROOT/commands/debt/triage.md" > "$BATS_TEST_TMPDIR/list.zsh"
  grep -q 'todo_list' "$BATS_TEST_TMPDIR/list.zsh"
  run --separate-stderr zsh -f -o noclobber "$BATS_TEST_TMPDIR/list.zsh"
  [ "$status" -eq 0 ]
  [ "$output" = "todos/debt/001-pending-high-long-fn-abc123.md" ]
  [[ "$stderr" == *"skipped 1 file(s)"* ]]
  no_pwned
}

@test "triage accept block takes only an id and never runs a hostile name (zsh noclobber)" {
  require_zsh
  require_kislyuk_yq
  init_repo
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  : > "todos/debt/001-pending-high-x\$(touch pwned)y.md"
  extract_wrapper "$PLUGIN_ROOT/commands/debt/triage.md" 1 \
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
  extract_wrapper "$PLUGIN_ROOT/commands/debt/triage.md" 3 \
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
  extract_wrapper "$PLUGIN_ROOT/commands/debt/triage.md" 5 \
    | sed "s#'<todo-id>'#'001'#; s#'<reason-dir>'#'$reason_dir'#" > "$BATS_TEST_TMPDIR/wf-reason.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/wf-reason.zsh"
  [ "$status" -eq 0 ]
  [ "$(frontmatter_field todos/debt/001-wont-fix-high-long-fn-abc123.md .wont_fix_reason)" = "not worth it" ]
  [ ! -e "$reason_dir" ]
  extract_wrapper "$PLUGIN_ROOT/commands/debt/triage.md" 6 \
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
  extract_wrapper "$PLUGIN_ROOT/commands/debt/triage.md" 7 \
    | sed "s#'<todo-id>'#'003'#; s#'<current-status>'#'ready'#" > "$BATS_TEST_TMPDIR/recipe.zsh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run zsh -f -o noclobber "$BATS_TEST_TMPDIR/recipe.zsh"
  [ "$status" -eq 0 ]
  [ -f todos/debt/003-wont-fix-high-long-fn-abc123.md ]
}

# --- debt_fingerprint / audit-synthesizer kept-todo matching ---

make_source() {
  mkdir -p src
  printf 'top\nfoo(alpha)\n  bar(beta)\nbaz()\nqux()\n' > src/a.js
}

@test "debt_fingerprint ignores inserted lines above and re-indentation, not code edits" {
  make_source
  before=$(debt_fingerprint complexity src/a.js 2 3)
  [[ "$before" =~ ^fp/v1:[0-9a-f]{16}$ ]]
  printf 'n1\nn2\nn3\ntop\n      foo(alpha)\n\t\tbar(beta)\nbaz()\nqux()\n' > src/a.js
  [ "$(debt_fingerprint complexity src/a.js 5 6)" = "$before" ]
  printf 'n1\nn2\nn3\ntop\n      foo(gamma)\n\t\tbar(beta)\nbaz()\nqux()\n' > src/a.js
  [ "$(debt_fingerprint complexity src/a.js 5 6)" != "$before" ]
  [ "$(debt_fingerprint duplication src/a.js 5 6)" != "$(debt_fingerprint complexity src/a.js 5 6)" ]
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

@test "debt_fingerprint without a range covers category and path only" {
  make_source
  one=$(debt_fingerprint complexity src/a.js)
  printf 'changed\n' > src/a.js
  [ "$(debt_fingerprint complexity src/a.js)" = "$one" ]
}

# Runs the synthesizer's kept-todo matching block (Step 5a), then loads the
# per-finding results from .debt/fingerprints.json into `lines`, one compact
# object per element. Call it directly, not through `run`.
run_match_block() {
  mkdir -p .debt
  extract_wrapper "$PLUGIN_ROOT/agents/synthesis/audit-synthesizer.md" 4 > "$BATS_TEST_TMPDIR/match.sh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run bash "$BATS_TEST_TMPDIR/match.sh"
  [ "$status" -eq 0 ]
  lines=()
  while IFS= read -r line; do lines+=("$line"); done < <(jq -c '.[]' .debt/fingerprints.json)
}

write_surviving() {
  printf '[' > .debt/surviving-findings.json
  local first=1 lines
  for lines in "$@"; do
    [ "$first" -eq 1 ] || printf ',' >> .debt/surviving-findings.json
    first=0
    printf '{"category":"complexity","file":{"path":"src/a.js","lines":"%s"},"finding":"f"}' "$lines" >> .debt/surviving-findings.json
  done
  printf ']' >> .debt/surviving-findings.json
}

@test "synthesizer block skips a finding that matches a kept wont-fix todo after the code moved" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  anchor=$(debt_anchor_hashes src/a.js 2 3 | head -n 1)
  make_todo 007 wont-fix 007-wont-fix-high-long-fn-abc123.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp\nanchor_hash: $anchor"
  printf 'n1\nn2\nn3\ntop\n      foo(alpha)\n\t\tbar(beta)\nbaz()\nqux()\n' > src/a.js
  mkdir -p .debt
  write_surviving 5-6 5-7 4-4
  run_match_block
  [[ "${lines[0]}" == *'"skip":true'*'"kept_id":"007"'*'"status":"wont-fix"'*'"match":"fingerprint"'* ]]
  [[ "${lines[1]}" == *'"skip":true'*'"match":"anchor"'* ]]
  [[ "${lines[2]}" == *'"skip":false'*'"fingerprint":"fp/v1:'* ]]
}

@test "synthesizer block does not suppress on a tie between two kept todos" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 007 wont-fix 007-wont-fix-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  make_todo 008 complete 008-complete-high-bbb.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  mkdir -p .debt
  write_surviving 2-3
  run_match_block
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "synthesizer block never matches a pending todo" {
  require_kislyuk_yq
  init_repo
  make_source
  fp=$(debt_fingerprint complexity src/a.js 2 3)
  make_todo 007 pending 007-pending-high-aaa.md "affected_files:\n  - src/a.js:2-3\nfingerprint: $fp"
  mkdir -p .debt
  write_surviving 2-3
  run_match_block
  [[ "${lines[0]}" == *'"skip":false'* ]]
}

@test "synthesizer next-id block counts above every file, including 8x and malformed names" {
  mkdir -p todos/debt
  : > todos/debt/008-ready-high-a.md
  : > todos/debt/009-wont-fix-high-b.md
  : > todos/debt/012-pending-bogus-name.md
  : > todos/debt/notes.md
  init_repo
  extract_wrapper "$PLUGIN_ROOT/agents/synthesis/audit-synthesizer.md" 5 > "$BATS_TEST_TMPDIR/nextid.sh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run bash "$BATS_TEST_TMPDIR/nextid.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "013" ]
}

@test "synthesizer pending wipe leaves a ready todo whose slug contains -pending-" {
  require_kislyuk_yq
  init_repo
  : > todos/debt/001-pending-high-old-finding.md
  : > todos/debt/002-ready-high-fix-pending-queue.md
  extract_wrapper "$PLUGIN_ROOT/agents/synthesis/audit-synthesizer.md" 2 > "$BATS_TEST_TMPDIR/wipe.sh"
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" run bash "$BATS_TEST_TMPDIR/wipe.sh"
  [ "$status" -eq 0 ]
  [ ! -e todos/debt/001-pending-high-old-finding.md ]
  [ -f todos/debt/002-ready-high-fix-pending-queue.md ]
}

@test "a defer reason that starts with a dash is stored, not read as a yq option" {
  require_kislyuk_yq
  make_todo 001 pending 001-pending-high-long-fn-abc123.md
  run transition_todo_state todos/debt/001-pending-high-long-fn-abc123.md deferred '--help'
  [ "$status" -eq 0 ]
  [ "$(frontmatter_field todos/debt/001-deferred-high-long-fn-abc123.md .deferred_reason)" = "--help" ]
}

@test "debt_fingerprint refuses a range of 200 lines or more" {
  seq 1 400 | sed 's/^/statement_/' > big.js
  run debt_fingerprint complexity big.js 1 100
  [ "$status" -eq 0 ]
  run debt_fingerprint complexity big.js 1 300
  [ "$status" -eq 1 ]
}

@test "debt_anchor_hashes skips short lines and honours LIMIT" {
  printf '}\nelse {\nlong_statement(one)\nlong_statement(two)\n' > a.js
  run debt_anchor_hashes a.js 1 4
  [ "${#lines[@]}" -eq 2 ]
  run debt_anchor_hashes a.js 1 4 1
  [ "${#lines[@]}" -eq 1 ]
}

@test "synthesizer block never anchor-matches a security-debt finding" {
  require_kislyuk_yq
  init_repo
  make_source
  anchor=$(debt_anchor_hashes src/a.js 2 3 | head -n 1)
  printf -- '---\nstatus: wont-fix\ncategory: security-debt\naffected_files:\n  - src/a.js:2-3\nanchor_hash: %s\n---\nB\n' "$anchor" > todos/debt/007-wont-fix-high-aaa.md
  mkdir -p .debt
  printf '[{"category":"security-debt","file":{"path":"src/a.js","lines":"1-5"},"finding":"f"}]' > .debt/surviving-findings.json
  run_match_block
  [[ "${lines[0]}" == *'"skip":false'* ]]
}
