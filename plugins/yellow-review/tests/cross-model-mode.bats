#!/usr/bin/env bats
# Tests for cross-model-mode: the cross_model_review switch and its
# precedence (off in either file wins; a repo file cannot lift a user-level
# off; unknown values fail closed).

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/cross-model-mode"

setup() {
  BATS_TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
  export CLAUDE_CONFIG_DIR="$BATS_TEST_TMPDIR/cfg"
  mkdir -p "$CLAUDE_CONFIG_DIR"
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  cd "$REPO" || return 1
  git init -q
}

cfg() { # <file> <value-line>
  printf -- '---\n%s\n---\n\nbody\n' "$2" >|"$1"
}

@test "no config anywhere is auto" {
  run -0 "$SCRIPT"
  [ "$output" = 'cross_model_review=auto source=default' ]
}

@test "off in the repo file turns it off" {
  cfg yellow-plugins.local.md 'cross_model_review: off'
  run -0 "$SCRIPT"
  [ "$output" = 'cross_model_review=off source=repo' ]
}

@test "a repo file setting auto cannot override a user-level off" {
  cfg yellow-plugins.local.md 'cross_model_review: auto'
  cfg "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md" 'cross_model_review: off'
  run -0 "$SCRIPT"
  [ "$output" = 'cross_model_review=off source=user' ]
}

@test "off in both files reports both" {
  cfg yellow-plugins.local.md "cross_model_review: 'off' # no egress"
  cfg "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md" 'cross_model_review: "OFF"'
  run -0 "$SCRIPT"
  [ "$output" = 'cross_model_review=off source=both' ]
}

@test "an unknown value fails closed with a warning" {
  cfg yellow-plugins.local.md 'cross_model_review: maybe'
  run -0 --separate-stderr "$SCRIPT"
  [ "$output" = 'cross_model_review=off source=repo' ]
  [[ "$stderr" == *'not auto or off; treating it as off'* ]]
}

@test "a key with no inline value fails closed instead of reading as auto" {
  printf -- '---\ncross_model_review:\n  off\n---\n' >|yellow-plugins.local.md
  run -0 --separate-stderr "$SCRIPT"
  [ "$output" = 'cross_model_review=off source=repo' ]
  [[ "$stderr" == *'not auto or off; treating it as off'* ]]
  cfg "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md" "cross_model_review: ''"
  rm yellow-plugins.local.md
  run -0 --separate-stderr "$SCRIPT"
  [ "$output" = 'cross_model_review=off source=user' ]
}

@test "a config path that exists but cannot be read fails closed" {
  mkdir "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md"
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *'cross_model_review=off source=user'* ]]
  [[ "$output" == *'cannot be read'* ]]
  rmdir "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md"
  if [ "$(id -u)" -ne 0 ]; then
    cfg "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md" 'cross_model_review: off'
    chmod 000 "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md"
    run "$SCRIPT"
    chmod 600 "$CLAUDE_CONFIG_DIR/yellow-plugins.local.md"
    [[ "$output" == *'cross_model_review=off source=user'* ]]
  fi
}

@test "only top-level frontmatter counts, not the body or nested keys" {
  printf -- '---\nreviewer_set:\n  cross_model_review: off\n---\ncross_model_review: off\n' >|yellow-plugins.local.md
  run -0 "$SCRIPT"
  [ "$output" = 'cross_model_review=auto source=default' ]
}

@test "an explicit repo-file argument is read" {
  cfg "$BATS_TEST_TMPDIR/other.md" 'cross_model_review: off'
  run -0 "$SCRIPT" "$BATS_TEST_TMPDIR/other.md"
  [ "$output" = 'cross_model_review=off source=repo' ]
}
