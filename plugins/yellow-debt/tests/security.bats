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

make_todo() {
  printf -- '---\nid: "%s"\nstatus: %s\ncategory: complexity\nseverity: high\ntitle: Long function\n---\nBody.\n' \
    "$1" "$2" > "todos/debt/$3"
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
