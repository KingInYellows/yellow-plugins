#!/usr/bin/env bats
# Tests for lib/rule-pack-roots.sh: the rule-pack roots /flow:plan passes to
# learnings-researcher, and the trust rules for machine-local folders.

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/rule-pack-roots.sh"

setup() {
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO" "$BATS_TEST_TMPDIR/local" "$BATS_TEST_TMPDIR/config"
  cd "$REPO"
  git init -q -b main .
  git config user.email t@example.com
  git config user.name t
  git config commit.gpgsign false
  export CLAUDE_CONFIG_DIR="$BATS_TEST_TMPDIR/config"
}

@test "no packs and no config prints nothing" {
  run --separate-stderr bash "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "the working tree's rule-packs folder is listed first" {
  mkdir -p rule-packs/team
  printf -- '---\nrule_pack_dirs:\n  - %s\n---\n' "$BATS_TEST_TMPDIR/local" >"$CLAUDE_CONFIG_DIR/yellow-plugins.local.md"
  run --separate-stderr bash "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf '%s/rule-packs\n%s' "$(git rev-parse --show-toplevel)" "$BATS_TEST_TMPDIR/local")" ]
}

@test "relative, dot-dot, missing and symlinked entries are skipped" {
  ln -s "$BATS_TEST_TMPDIR/local" "$BATS_TEST_TMPDIR/link"
  printf -- '---\nrule_pack_dirs:\n  - rel/dir\n  - %s/../local\n  - %s/missing\n  - %s/link\n---\n' \
    "$BATS_TEST_TMPDIR" "$BATS_TEST_TMPDIR" "$BATS_TEST_TMPDIR" >"$CLAUDE_CONFIG_DIR/yellow-plugins.local.md"
  run --separate-stderr bash "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [[ "$stderr" == *'not an absolute path'* ]]
  [[ "$stderr" == *'. or .. segments'* ]]
  [[ "$stderr" == *'symlink'* ]]
}

@test "a tracked repo config is ignored; an untracked one is honored" {
  printf -- '---\nrule_pack_dirs:\n  - %s\n---\n' "$BATS_TEST_TMPDIR/local" >yellow-plugins.local.md
  run --separate-stderr bash "$SCRIPT"
  [ "$output" = "$BATS_TEST_TMPDIR/local" ]
  git add yellow-plugins.local.md
  git commit -q -m cfg
  run --separate-stderr bash "$SCRIPT"
  [ -z "$output" ]
  [[ "$stderr" == *'tracked yellow-plugins.local.md is ignored'* ]]
}
