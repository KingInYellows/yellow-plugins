#!/usr/bin/env bats
# Tests for bin/start-semgrep.sh — verifies the 3-element fallback works.

WRAPPER="$BATS_TEST_DIRNAME/../bin/start-semgrep.sh"

# Replace `exec semgrep mcp` with `exec env` so we can capture what the wrapper
# would have passed to semgrep without needing semgrep installed.
prep_wrapper() {
  local tmp_wrapper="$BATS_TMPDIR/start-semgrep-test.sh"
  sed 's|exec semgrep mcp|exec env|' "$WRAPPER" >"$tmp_wrapper"
  chmod +x "$tmp_wrapper"
  printf '%s' "$tmp_wrapper"
}

@test "userConfig wins when both userConfig and shell env are set" {
  test_wrapper=$(prep_wrapper)
  output=$(SEMGREP_APP_TOKEN_USERCONFIG="sgp_userconfig" SEMGREP_APP_TOKEN="sgp_shellenv" \
    "$test_wrapper" 2>&1 | grep '^SEMGREP_APP_TOKEN=')
  [ "$output" = "SEMGREP_APP_TOKEN=sgp_userconfig" ]
}

@test "shell env is used when userConfig is empty" {
  test_wrapper=$(prep_wrapper)
  output=$(SEMGREP_APP_TOKEN_USERCONFIG="" SEMGREP_APP_TOKEN="sgp_shellenv_only" \
    "$test_wrapper" 2>&1 | grep '^SEMGREP_APP_TOKEN=')
  [ "$output" = "SEMGREP_APP_TOKEN=sgp_shellenv_only" ]
}

@test "both unset: SEMGREP_APP_TOKEN is absent from exec env (not empty string)" {
  test_wrapper=$(prep_wrapper)
  # Run with both unset; verify SEMGREP_APP_TOKEN does NOT appear in output
  output=$(env -i bash -c "'$test_wrapper'" 2>&1)
  if printf '%s' "$output" | grep -q '^SEMGREP_APP_TOKEN='; then
    printf 'expected SEMGREP_APP_TOKEN to be absent, got: %s\n' "$output" >&2
    return 1
  fi
}

@test "regression guard: empty userConfig does NOT overwrite valid shell env" {
  # This is the exact bug the plugin.json change closes.
  # Pre-fix: env block set SEMGREP_APP_TOKEN="${user_config.semgrep_app_token}"
  # which expanded to "" when userConfig was empty, overwriting any shell value.
  # Post-fix: wrapper resolves precedence and keeps shell env on empty userConfig.
  test_wrapper=$(prep_wrapper)
  output=$(SEMGREP_APP_TOKEN_USERCONFIG="" SEMGREP_APP_TOKEN="sgp_kept" \
    "$test_wrapper" 2>&1 | grep '^SEMGREP_APP_TOKEN=')
  [ "$output" = "SEMGREP_APP_TOKEN=sgp_kept" ]
}
