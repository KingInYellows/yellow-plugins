#!/usr/bin/env bats
# controls.bats — positive controls: prove each profile really applies its
# options, so a silently dropped option cannot turn the suite green.

bats_require_minimum_version 1.5.0
load helpers/shells

setup() {
  require_zsh
}

@test "zsh-snapshot refuses to clobber an existing file" {
  profile_cmd zsh-snapshot
  f="$BATS_TEST_TMPDIR/existing"
  : > "$f"
  run --separate-stderr "${PROFILE_CMD[@]}" -c 'printf x > "$1"' _ "$f"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"file exists"* ]]
}

@test "plain zsh and bash overwrite an existing file" {
  f="$BATS_TEST_TMPDIR/existing"
  for p in bash zsh; do
    : > "$f"
    profile_cmd "$p"
    run --separate-stderr "${PROFILE_CMD[@]}" -c 'printf x > "$1"' _ "$f"
    [ "$status" -eq 0 ]
    [ "$(cat "$f")" = x ]
  done
}

@test "zsh-snapshot has extendedglob and rcquotes on" {
  profile_cmd zsh-snapshot
  run --separate-stderr "${PROFILE_CMD[@]}" -c "[[ -o extendedglob ]] && [[ -o rcquotes ]] && printf '%s' 'it''s'"
  [ "$status" -eq 0 ]
  [ "$output" = "it's" ]
}

@test "zsh -f ignores the contributor's ~/.zshrc" {
  mkdir -p "$BATS_TEST_TMPDIR/zdot"
  printf 'print -r -- ZSHRC-LOADED\n' > "$BATS_TEST_TMPDIR/zdot/.zshrc"
  profile_cmd zsh
  ZDOTDIR="$BATS_TEST_TMPDIR/zdot" run --separate-stderr "${PROFILE_CMD[@]}" -i -c 'true'
  [[ "$output" != *ZSHRC-LOADED* ]]
}
