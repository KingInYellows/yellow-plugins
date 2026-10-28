#!/usr/bin/env bats
# Tests for debt_backfill_todo / debt_backfill_todos (CLAUDE-4): todos written
# before the current schema get the fields the commands read, and nothing
# that is already present changes.

bats_require_minimum_version 1.5.0

setup() {
  . "$BATS_TEST_DIRNAME/../../yellow-core/lib/validate-fs.sh"
  . "$BATS_TEST_DIRNAME/../lib/validate.sh"
  require_tools
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/todos/debt"
  cd "$WORK"
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# A missing tool skips the test locally but fails it in CI.
require_tools() {
  if command -v jq >/dev/null 2>&1 && command -v yq >/dev/null 2>&1 \
      && yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk'; then
    return 0
  fi
  [ -z "${CI:-}" ] || { echo "jq and kislyuk yq are required in CI"; return 1; }
  skip "jq or kislyuk yq not installed"
}

field() {
  extract_frontmatter "$1" | yq -r "$2"
}

@test "backfill derives id, status, severity and priority from the name" {
  f=todos/debt/007-deferred-high-old-thing.md
  printf -- '---\ncategory: complexity\naffected_files:\n  - src/a.ts:1-5\n---\n\n# Old thing\n\nBody\n' > "$f"
  run debt_backfill_todo "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Backfilled id, status, severity, priority"* ]]
  [ "$(field "$f" .id)" = "007" ]
  [ "$(field "$f" '.id | type')" = "string" ]
  [ "$(field "$f" .status)" = "deferred" ]
  [ "$(field "$f" .severity)" = "high" ]
  [ "$(field "$f" .priority)" = "p2" ]
  [ "$(field "$f" .category)" = "complexity" ]
  [ "$(field "$f" '.affected_files[0]')" = "src/a.ts:1-5" ]
  # The body survives, trailing newline included.
  [ "$(tail -n 3 "$f")" = "$(printf '# Old thing\n\nBody')" ]
  [ "$(tail -c 1 "$f" | od -An -c | tr -d ' ')" = '\n' ]
}

@test "backfill quotes an id that is not valid octal" {
  f=todos/debt/009-ready-low-bare.md
  printf -- '---\nstatus: ready\ncategory: ai-pattern\naffected_files:\n  - a.py:3\n---\n# Bare\n' > "$f"
  run debt_backfill_todo "$f"
  [ "$status" -eq 0 ]
  grep -qx "id: '009'" "$f"
}

@test "backfill never changes a present value" {
  f=todos/debt/012-pending-medium-kept.md
  printf -- "---\nid: '012'\nstatus: ready\nseverity: low\ncategory: duplication\naffected_files:\n  - b.ts:1\n---\n# Kept\n" > "$f"
  run debt_backfill_todo "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Backfilled priority in"* ]]
  # status and severity disagree with the name; priority follows the
  # frontmatter severity.
  [ "$(field "$f" .status)" = "ready" ]
  [ "$(field "$f" .severity)" = "low" ]
  [ "$(field "$f" .priority)" = "p4" ]
}

@test "backfill leaves a complete todo byte-for-byte unchanged" {
  f=todos/debt/008-pending-medium-ok.md
  printf -- "---\nid: '008'\nstatus: pending\npriority: p3\nseverity: medium\ncategory: duplication\naffected_files:\n  - b.ts:1\n---\n# ok\n" > "$f"
  cp "$f" "$WORK/before"
  run debt_backfill_todo "$f"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  cmp "$f" "$WORK/before"
}

@test "backfill fills a null or empty field" {
  f=todos/debt/013-pending-critical-nulls.md
  printf -- "---\nid: null\nstatus: ''\nseverity: critical\npriority: null\ncategory: security-debt\naffected_files:\n  - c.go:9\n---\n# Nulls\n" > "$f"
  run debt_backfill_todo "$f"
  [ "$status" -eq 0 ]
  [ "$(field "$f" .id)" = "013" ]
  [ "$(field "$f" .status)" = "pending" ]
  [ "$(field "$f" .priority)" = "p1" ]
}

@test "backfill warns about category and affected_files it cannot derive" {
  f=todos/debt/014-pending-low-thin.md
  printf -- '---\nstatus: pending\n---\n# Thin\n' > "$f"
  run --separate-stderr debt_backfill_todo "$f"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"lacks category, affected_files"* ]]
  [ "$(field "$f" .category)" = "null" ]
}

@test "backfill refuses a todo without a frontmatter block" {
  f=todos/debt/015-pending-low-nofm.md
  printf 'just text\n' > "$f"
  run --separate-stderr debt_backfill_todo "$f"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"has no frontmatter block"* ]]
  [ "$(cat "$f")" = "just text" ]
}

@test "backfill refuses frontmatter that is not a mapping" {
  f=todos/debt/016-pending-low-list.md
  printf -- '---\n- a\n- b\n---\n# List\n' > "$f"
  run debt_backfill_todo "$f"
  [ "$status" -eq 1 ]
  [ "$(head -n 2 "$f" | tail -n 1)" = "- a" ]
}

@test "backfill refuses a name outside the todo pattern" {
  f=todos/debt/notes.md
  printf -- '---\nstatus: pending\n---\n' > "$f"
  run debt_backfill_todo "$f"
  [ "$status" -eq 1 ]
}

@test "backfill refuses a symlinked todo" {
  printf -- '---\nstatus: pending\n---\n' > "$WORK/outside.md"
  ln -s "$WORK/outside.md" todos/debt/017-pending-low-link.md
  run debt_backfill_todo todos/debt/017-pending-low-link.md
  [ "$status" -eq 1 ]
  [ "$(cat "$WORK/outside.md")" = "$(printf -- '---\nstatus: pending\n---')" ]
}

@test "backfill waits for the transition lock and releases its own" {
  f=todos/debt/018-pending-low-locked.md
  printf -- '---\nstatus: pending\ncategory: complexity\naffected_files:\n  - a.ts:1\n---\n# L\n' > "$f"
  mkdir "$f.lock"
  ( sleep 0.3; rmdir "$f.lock" ) &
  run debt_backfill_todo "$f"
  wait
  [ "$status" -eq 0 ]
  [ "$(field "$f" .id)" = "018" ]
  [ ! -e "$f.lock" ]
}

@test "debt_backfill_todos covers every well-named todo and reports failures" {
  printf -- '---\ncategory: complexity\naffected_files:\n  - a.ts:1\n---\n# A\n' > todos/debt/001-pending-high-a.md
  printf 'no frontmatter\n' > todos/debt/002-pending-low-b.md
  printf 'readme\n' > todos/debt/README.md
  run --separate-stderr debt_backfill_todos
  [ "$status" -eq 1 ]
  [[ "$output" == *"Backfilled id, status, severity, priority in todos/debt/001-pending-high-a.md"* ]]
  [[ "$output" == *"Checked 2 todo(s); 1 failed"* ]]
  [[ "$stderr" == *"skipped 1 file(s)"* ]]
  [ "$(cat todos/debt/README.md)" = "readme" ]
}

@test "debt_backfill_todos refuses a symlinked todos/debt" {
  rm -rf todos/debt
  mkdir "$WORK/elsewhere"
  ln -s "$WORK/elsewhere" todos/debt
  run debt_backfill_todos
  [ "$status" -eq 1 ]
}
