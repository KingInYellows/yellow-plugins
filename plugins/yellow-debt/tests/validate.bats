#!/usr/bin/env bats
# Tests for lib/validate.sh

setup() {
  # Source the validation library
  . "$BATS_TEST_DIRNAME/../lib/validate.sh"

  # Create a temporary project root for testing
  PROJECT_ROOT="$(mktemp -d)"
  mkdir -p "$PROJECT_ROOT/src"
  echo "test" > "$PROJECT_ROOT/src/file.txt"
}

teardown() {
  rm -rf "$PROJECT_ROOT"
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
  bad_path=$'src/file\n.txt'
  run validate_file_path "$bad_path" "$PROJECT_ROOT"
  [ "$status" -eq 1 ]
}

@test "validate_file_path rejects path with carriage return" {
  bad_path=$'src/file\r.txt'
  run validate_file_path "$bad_path" "$PROJECT_ROOT"
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

# --- validate_category ---

@test "validate_category accepts ai-patterns" {
  run validate_category "ai-patterns"
  [ "$status" -eq 0 ]
}

@test "validate_category accepts complexity" {
  run validate_category "complexity"
  [ "$status" -eq 0 ]
}

@test "validate_category accepts duplication" {
  run validate_category "duplication"
  [ "$status" -eq 0 ]
}

@test "validate_category accepts architecture" {
  run validate_category "architecture"
  [ "$status" -eq 0 ]
}

@test "validate_category accepts security" {
  run validate_category "security"
  [ "$status" -eq 0 ]
}

@test "validate_category rejects invalid category" {
  run validate_category "invalid"
  [ "$status" -eq 1 ]
}

@test "validate_category rejects empty category" {
  run validate_category ""
  [ "$status" -eq 1 ]
}

# --- validate_severity ---

@test "validate_severity accepts critical" {
  run validate_severity "critical"
  [ "$status" -eq 0 ]
}

@test "validate_severity accepts high" {
  run validate_severity "high"
  [ "$status" -eq 0 ]
}

@test "validate_severity accepts medium" {
  run validate_severity "medium"
  [ "$status" -eq 0 ]
}

@test "validate_severity accepts low" {
  run validate_severity "low"
  [ "$status" -eq 0 ]
}

@test "validate_severity rejects invalid severity" {
  run validate_severity "invalid"
  [ "$status" -eq 1 ]
}

@test "validate_severity rejects empty severity" {
  run validate_severity ""
  [ "$status" -eq 1 ]
}

# --- validate_transition ---

@test "validate_transition allows pending to ready" {
  run validate_transition "pending" "ready"
  [ "$status" -eq 0 ]
}

@test "validate_transition allows pending to deleted" {
  run validate_transition "pending" "deleted"
  [ "$status" -eq 0 ]
}

@test "validate_transition allows pending to deferred" {
  run validate_transition "pending" "deferred"
  [ "$status" -eq 0 ]
}

@test "validate_transition allows ready to in-progress" {
  run validate_transition "ready" "in-progress"
  [ "$status" -eq 0 ]
}

@test "validate_transition allows ready to deleted" {
  run validate_transition "ready" "deleted"
  [ "$status" -eq 0 ]
}

@test "validate_transition allows in-progress to complete" {
  run validate_transition "in-progress" "complete"
  [ "$status" -eq 0 ]
}

@test "validate_transition allows in-progress to ready" {
  run validate_transition "in-progress" "ready"
  [ "$status" -eq 0 ]
}

@test "validate_transition allows deferred to pending" {
  run validate_transition "deferred" "pending"
  [ "$status" -eq 0 ]
}

@test "validate_transition rejects pending to complete" {
  run validate_transition "pending" "complete"
  [ "$status" -eq 1 ]
}

@test "validate_transition rejects ready to complete" {
  run validate_transition "ready" "complete"
  [ "$status" -eq 1 ]
}

@test "validate_transition rejects complete to any state" {
  run validate_transition "complete" "ready"
  [ "$status" -eq 1 ]
}

@test "validate_transition rejects empty from state" {
  run validate_transition "" "ready"
  [ "$status" -eq 1 ]
}

@test "validate_transition rejects empty to state" {
  run validate_transition "pending" ""
  [ "$status" -eq 1 ]
}
