#!/usr/bin/env bats
# Tests for lib/validate-fs.sh — the canonical shared filesystem-path
# validators (extracted from yellow-ci, yellow-ruvector, yellow-debt).

setup() {
  . "$BATS_TEST_DIRNAME/../lib/validate-fs.sh"

  PROJECT_ROOT="$(mktemp -d)"
  mkdir -p "$PROJECT_ROOT/src"
  echo "test" > "$PROJECT_ROOT/src/file.txt"
}

teardown() {
  if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT" ]; then
    rm -rf "$PROJECT_ROOT"
  fi
}

# --- canonicalize_project_dir ---

@test "canonicalize_project_dir resolves an existing absolute path" {
  result=$(canonicalize_project_dir "$PROJECT_ROOT")
  [ -n "$result" ]
  [ -d "$result" ]
}

@test "canonicalize_project_dir handles a non-existent path" {
  result=$(canonicalize_project_dir "/nonexistent/path/xyz")
  [ -n "$result" ]
}

# --- validate_file_path: acceptance ---

@test "validate_file_path accepts a valid relative path" {
  run validate_file_path "src/file.txt" "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "validate_file_path accepts a nested path" {
  mkdir -p "$PROJECT_ROOT/src/deep/nested"
  echo "x" > "$PROJECT_ROOT/src/deep/nested/file.ts"
  run validate_file_path "src/deep/nested/file.ts" "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "validate_file_path accepts a file in the project root" {
  touch "$PROJECT_ROOT/README.md"
  run validate_file_path "README.md" "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "validate_file_path accepts a symlink pointing inside the project" {
  ln -s "$PROJECT_ROOT/src/file.txt" "$PROJECT_ROOT/src/good-link"
  run validate_file_path "src/good-link" "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

# --- validate_file_path: rejection ---

@test "validate_file_path rejects an empty path" {
  run validate_file_path "" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects a path with .." {
  run validate_file_path "../etc/passwd" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects an embedded .." {
  run validate_file_path "src/../../etc/passwd" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects an absolute path" {
  run validate_file_path "/etc/passwd" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects a tilde path" {
  run validate_file_path "~/.ssh/id_rsa" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects a path with a newline" {
  bad_path=$'src/file\n.txt'
  run validate_file_path "$bad_path" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects a path with a carriage return" {
  bad_path=$'src/file\r.txt'
  run validate_file_path "$bad_path" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects a symlink whose target escapes the project" {
  ln -s /etc/passwd "$PROJECT_ROOT/src/evil-link"
  run validate_file_path "src/evil-link" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

# --- validate_file_path: optional project root ($2 defaults to git toplevel) ---

@test "validate_file_path defaults project root to the git toplevel when \$2 omitted" {
  # Use an isolated temp git repo so the test does not depend on the
  # real repository layout or working directory at test time.
  # Run via subshell to avoid changing the bats process working directory,
  # which would break subsequent tests that rely on PROJECT_ROOT.
  local tmp_git
  tmp_git="$(mktemp -d)"
  git -C "$tmp_git" init -q
  git -C "$tmp_git" config user.email "test@example.com"
  git -C "$tmp_git" config user.name "Test"
  mkdir -p "$tmp_git/src"
  echo "test" > "$tmp_git/src/file.txt"
  git -C "$tmp_git" add .
  git -C "$tmp_git" commit -q -m "init"
  local exit_code=0
  ( cd "$tmp_git" && validate_file_path "src/file.txt" ) || exit_code=$?
  rm -rf "$tmp_git"
  [ "$exit_code" -eq 0 ]
}

@test "validate_file_path still rejects traversal when \$2 is omitted" {
  cd "$BATS_TEST_DIRNAME"
  run validate_file_path "../../../etc/passwd"
  [ "$status" -eq 1 ]
}
