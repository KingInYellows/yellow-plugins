#!/usr/bin/env bats
# Tests for hooks/scripts/lib/validate.sh

setup() {
  # Source the validation library
  . "$BATS_TEST_DIRNAME/../hooks/scripts/lib/validate.sh"

  # Create a temporary project root for testing
  PROJECT_ROOT="$(mktemp -d)"
  mkdir -p "$PROJECT_ROOT/src"
  echo "test" > "$PROJECT_ROOT/src/file.txt"
}

teardown() {
  rm -rf "$PROJECT_ROOT"
}

# --- canonicalize_project_dir ---

@test "canonicalize_project_dir resolves absolute path" {
  result=$(canonicalize_project_dir "$PROJECT_ROOT")
  [ -n "$result" ]
  [ -d "$result" ]
}

@test "canonicalize_project_dir handles non-existent path" {
  result=$(canonicalize_project_dir "/nonexistent/path/xyz")
  [ -n "$result" ]
}

# --- validate_file_path ---

@test "validate_file_path accepts valid relative path" {
  run validate_file_path "src/file.txt" "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "validate_file_path rejects empty path" {
  run validate_file_path "" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects path with .." {
  run validate_file_path "../etc/passwd" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects absolute path" {
  run validate_file_path "/etc/passwd" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects path with tilde" {
  run validate_file_path "~/.ssh/id_rsa" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects path with embedded .." {
  run validate_file_path "src/../../etc/passwd" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects path with newline" {
  run validate_file_path $'src/file\n.txt' "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects path with carriage return" {
  run validate_file_path $'src/file\r.txt' "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path accepts nested path" {
  mkdir -p "$PROJECT_ROOT/src/deep/nested"
  echo "x" > "$PROJECT_ROOT/src/deep/nested/file.ts"
  run validate_file_path "src/deep/nested/file.ts" "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "validate_file_path rejects symlink outside project" {
  ln -s /etc/passwd "$PROJECT_ROOT/src/evil-link"
  run validate_file_path "src/evil-link" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path accepts symlink inside project" {
  ln -s "$PROJECT_ROOT/src/file.txt" "$PROJECT_ROOT/src/good-link"
  run validate_file_path "src/good-link" "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

# --- validate_namespace ---

@test "validate_namespace accepts simple name" {
  run validate_namespace "reflexion"
  [ "$status" -eq 0 ]
}

@test "validate_namespace accepts name with hyphens" {
  run validate_namespace "my-namespace"
  [ "$status" -eq 0 ]
}

@test "validate_namespace accepts name with digits" {
  run validate_namespace "ns123"
  [ "$status" -eq 0 ]
}

@test "validate_namespace rejects empty name" {
  run validate_namespace ""
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects name with uppercase" {
  run validate_namespace "MyNamespace"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects name with dots" {
  run validate_namespace "my.namespace"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects path traversal" {
  run validate_namespace "../etc"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects slash" {
  run validate_namespace "ns/evil"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects tilde" {
  run validate_namespace "ns~evil"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects leading hyphen" {
  run validate_namespace "-leading"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects trailing hyphen" {
  run validate_namespace "trailing-"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects name over 64 chars" {
  long_name=$(printf '%0.sa' $(seq 1 65))
  run validate_namespace "$long_name"
  [ "$status" -eq 1 ]
}

@test "validate_namespace accepts 64-char name" {
  # 64 'a' characters
  name=$(printf '%0.sa' $(seq 1 64))
  run validate_namespace "$name"
  [ "$status" -eq 0 ]
}

@test "validate_namespace rejects spaces" {
  run validate_namespace "my namespace"
  [ "$status" -eq 1 ]
}

@test "validate_namespace rejects underscore" {
  run validate_namespace "my_namespace"
  [ "$status" -eq 1 ]
}
