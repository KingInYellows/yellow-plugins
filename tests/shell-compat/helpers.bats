#!/usr/bin/env bats
# helpers.bats — skip_or_fail must fail, not skip, whenever a tool is
# required, so a required CI job cannot pass by skipping every test.

bats_require_minimum_version 1.5.0

# Runs skip_or_fail in a clean child bash, with `skip` stubbed, under the
# environment assignments given as arguments.
call_skip_or_fail() {
  run --separate-stderr env -i PATH="$PATH" "$@" bash --norc --noprofile -c '
    BATS_TEST_DIRNAME=$1
    . "$1/helpers/shells.bash"
    skip() { printf "skipped: %s\n" "$1"; }
    skip_or_fail "zsh not installed"
  ' _ "$BATS_TEST_DIRNAME"
}

@test "skips locally when CI is unset, empty, false or 0" {
  for ci in '' false 0; do
    call_skip_or_fail CI="$ci"
    [ "$status" -eq 0 ]
    [ "$output" = "skipped: zsh not installed" ]
  done
  call_skip_or_fail
  [ "$status" -eq 0 ]
  [ "$output" = "skipped: zsh not installed" ]
}

@test "fails when CI is set to true or any other value" {
  for ci in true 1 yes; do
    call_skip_or_fail CI="$ci"
    [ "$status" -eq 1 ]
    [[ "$stderr" == *"zsh not installed (required in CI)"* ]]
  done
}

@test "fails when SHELL_COMPAT_REQUIRE_ZSH=1 outside CI" {
  call_skip_or_fail SHELL_COMPAT_REQUIRE_ZSH=1
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"required by SHELL_COMPAT_REQUIRE_ZSH=1"* ]]
}
