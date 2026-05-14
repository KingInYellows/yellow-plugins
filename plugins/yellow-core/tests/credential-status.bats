#!/usr/bin/env bats
# Tests for lib/credential-status.sh

setup() {
  . "$BATS_TEST_DIRNAME/../lib/credential-status.sh"
  CLAUDE_PLUGIN_DATA="$(mktemp -d)"
  export CLAUDE_PLUGIN_DATA
}

teardown() {
  if [ -n "${CLAUDE_PLUGIN_DATA:-}" ] && [ -d "$CLAUDE_PLUGIN_DATA" ]; then
    rm -rf "$CLAUDE_PLUGIN_DATA"
  fi
}

# --- write_credential_status: happy path ---

@test "writes a valid JSON file when given valid inputs" {
  fields='[{"field":"foo_key","source":"userConfig","present":true,"valid":null}]'
  write_credential_status "yellow-foo" "1.0.0" "$fields"
  [ -f "$CLAUDE_PLUGIN_DATA/credential-status.json" ]
  if command -v jq >/dev/null 2>&1; then
    name=$(jq -r '.plugin' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$name" = "yellow-foo" ]
    version=$(jq -r '.version' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$version" = "1.0.0" ]
    cred_count=$(jq '.credentials | length' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$cred_count" = "1" ]
  fi
}

@test "overwrites an existing file (no append)" {
  fields1='[{"field":"foo","source":"userConfig","present":true,"valid":null}]'
  fields2='[{"field":"bar","source":"shell_env","present":false,"valid":null}]'
  write_credential_status "yellow-foo" "1.0.0" "$fields1"
  write_credential_status "yellow-foo" "1.1.0" "$fields2"
  if command -v jq >/dev/null 2>&1; then
    version=$(jq -r '.version' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$version" = "1.1.0" ]
    field=$(jq -r '.credentials[0].field' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$field" = "bar" ]
  fi
}

@test "produces a session_ts in ISO 8601 UTC format" {
  fields='[]'
  write_credential_status "yellow-foo" "1.0.0" "$fields"
  if command -v jq >/dev/null 2>&1; then
    ts=$(jq -r '.session_ts' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    # Expect e.g. 2026-05-13T18:42:31Z
    [[ "$ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
  fi
}

# --- write_credential_status: error paths (must not block SessionStart) ---

@test "returns 0 when plugin name is empty" {
  run write_credential_status "" "1.0.0" '[]'
  [ "$status" -eq 0 ]
}

@test "returns 0 when version is empty" {
  run write_credential_status "yellow-foo" "" '[]'
  [ "$status" -eq 0 ]
}

@test "returns 0 when CLAUDE_PLUGIN_DATA is unwritable" {
  unwritable=$(mktemp -d)
  chmod 0500 "$unwritable"
  CLAUDE_PLUGIN_DATA="$unwritable/cannot-create" \
    run write_credential_status "yellow-foo" "1.0.0" '[]'
  [ "$status" -eq 0 ]
  chmod 0700 "$unwritable"
  rm -rf "$unwritable"
}

@test "atomic write: no leftover .tmp file on success" {
  fields='[]'
  write_credential_status "yellow-foo" "1.0.0" "$fields"
  # Unique per-invocation tmp filenames (mktemp template
  # credential-status.json.tmp.XXXXXX) — assert none survived the rename.
  shopt -s nullglob
  leftovers=( "$CLAUDE_PLUGIN_DATA"/credential-status.json.tmp* )
  shopt -u nullglob
  [ "${#leftovers[@]}" -eq 0 ]
}

@test "malformed fields_json does not overwrite a previously valid file (when jq is present)" {
  if ! command -v jq >/dev/null 2>&1; then
    skip "jq not installed; printf fallback path skipped"
  fi
  write_credential_status "yellow-foo" "1.0.0" '[{"field":"k","source":"userConfig","present":true,"valid":null}]'
  [ -f "$CLAUDE_PLUGIN_DATA/credential-status.json" ]
  prev_version=$(jq -r '.version' "$CLAUDE_PLUGIN_DATA/credential-status.json")
  [ "$prev_version" = "1.0.0" ]

  # Second call with invalid JSON in fields_json — jq rejects, helper
  # returns 0 (non-blocking) but does NOT overwrite the file.
  run write_credential_status "yellow-foo" "9.9.9" 'not-json-at-all'
  [ "$status" -eq 0 ]
  after_version=$(jq -r '.version' "$CLAUDE_PLUGIN_DATA/credential-status.json")
  [ "$after_version" = "1.0.0" ]
}

@test "does not pollute the caller's shell options" {
  # The lib MUST NOT enable nounset / pipefail at file scope, otherwise
  # SessionStart hooks that omit `set -u` would abort on unset vars and
  # fail to emit their required {"continue": true} response. Run in a
  # fresh subshell so bats's own option state doesn't mask drift.
  result=$(bash -c '
    before=$(set +o | tr -d "\n")
    . "$1"
    after=$(set +o | tr -d "\n")
    [ "$before" = "$after" ] && echo OK || echo "DRIFT: $before -> $after"
  ' _ "$BATS_TEST_DIRNAME/../lib/credential-status.sh")
  [ "$result" = "OK" ]
}

# --- credential_status_field helper ---

@test "credential_status_field composes a valid field object" {
  result=$(credential_status_field "foo_key" "userConfig" "true" "null")
  if command -v jq >/dev/null 2>&1; then
    field=$(printf '%s' "$result" | jq -r '.field')
    [ "$field" = "foo_key" ]
    source=$(printf '%s' "$result" | jq -r '.source')
    [ "$source" = "userConfig" ]
    present=$(printf '%s' "$result" | jq -r '.present')
    [ "$present" = "true" ]
  fi
}

@test "credential_status_field uses defaults for missing args" {
  result=$(credential_status_field "foo_key")
  if command -v jq >/dev/null 2>&1; then
    source=$(printf '%s' "$result" | jq -r '.source')
    [ "$source" = "absent" ]
    present=$(printf '%s' "$result" | jq -r '.present')
    [ "$present" = "false" ]
  fi
}

# --- Falls back to HOME path when CLAUDE_PLUGIN_DATA is unset ---

@test "falls back to ~/.claude/plugins/data/<plugin>/ when CLAUDE_PLUGIN_DATA is unset" {
  fake_home=$(mktemp -d)
  unset CLAUDE_PLUGIN_DATA
  HOME="$fake_home" write_credential_status "yellow-bar" "2.0.0" '[]'
  [ -f "$fake_home/.claude/plugins/data/yellow-bar/credential-status.json" ]
  rm -rf "$fake_home"
}

# --- credential_hook_scaffold (SessionStart-hook scaffold) ---

@test "credential_hook_scaffold writes status, classifies userConfig, emits continue" {
  CLAUDE_PLUGIN_OPTION_SEMGREP_APP_TOKEN="sgp_test" \
    run credential_hook_scaffold "yellow-semgrep" "" \
      "semgrep_app_token:CLAUDE_PLUGIN_OPTION_SEMGREP_APP_TOKEN:SEMGREP_APP_TOKEN"
  [ "$status" -eq 0 ]
  [ "$output" = '{"continue": true}' ]
  [ -f "$CLAUDE_PLUGIN_DATA/credential-status.json" ]
  if command -v jq >/dev/null 2>&1; then
    field=$(jq -r '.credentials[0].field' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$field" = "semgrep_app_token" ]
    src=$(jq -r '.credentials[0].source' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$src" = "userConfig" ]
  fi
}

@test "credential_hook_scaffold classifies an absent field" {
  run credential_hook_scaffold "yellow-foo" "" \
    "foo_key:CLAUDE_PLUGIN_OPTION_FOO_KEY_UNSET:FOO_KEY_UNSET"
  [ "$status" -eq 0 ]
  [ "$output" = '{"continue": true}' ]
  if command -v jq >/dev/null 2>&1; then
    src=$(jq -r '.credentials[0].source' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$src" = "absent" ]
  fi
}

@test "credential_hook_scaffold falls back to shell env when no userConfig" {
  FOO_KEY="shell-value" run credential_hook_scaffold "yellow-foo" "" \
    "foo_key:CLAUDE_PLUGIN_OPTION_FOO_KEY:FOO_KEY"
  [ "$status" -eq 0 ]
  if command -v jq >/dev/null 2>&1; then
    src=$(jq -r '.credentials[0].source' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$src" = "shell_env" ]
  fi
}

@test "credential_hook_scaffold handles multiple field specs" {
  CLAUDE_PLUGIN_OPTION_A_KEY="x" \
    run credential_hook_scaffold "yellow-multi" "" \
      "a_key:CLAUDE_PLUGIN_OPTION_A_KEY:A_KEY" \
      "b_key:CLAUDE_PLUGIN_OPTION_B_KEY:B_KEY"
  [ "$status" -eq 0 ]
  if command -v jq >/dev/null 2>&1; then
    count=$(jq '.credentials | length' "$CLAUDE_PLUGIN_DATA/credential-status.json")
    [ "$count" = "2" ]
  fi
}
