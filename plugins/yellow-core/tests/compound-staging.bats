#!/usr/bin/env bats
# Tests for lib/compound-staging.sh — background-compounding helper lib.

setup() {
  . "$BATS_TEST_DIRNAME/../lib/compound-staging.sh"

  STAGING_TEST_ROOT="$(mktemp -d)"
  mkdir -p "$STAGING_TEST_ROOT/pending" "$STAGING_TEST_ROOT/tmp"
}

teardown() {
  if [ -n "${STAGING_TEST_ROOT:-}" ] && [ -d "$STAGING_TEST_ROOT" ]; then
    rm -rf "$STAGING_TEST_ROOT"
  fi
}

# --- cs_derive_project_slug ---

@test "derive_project_slug uses git toplevel inside a repo" {
  REPO=$(mktemp -d)
  (cd "$REPO" && git init -q && git config user.email t@t && git config user.name t)
  result=$(cs_derive_project_slug "$REPO")
  [ -n "$result" ]
  # Slug derived from toplevel — must contain no slashes.
  case "$result" in
    */*) false ;;
    *) true ;;
  esac
  rm -rf "$REPO"
}

@test "derive_project_slug falls back to cwd outside a repo" {
  NONREPO=$(mktemp -d)
  result=$(cs_derive_project_slug "$NONREPO")
  [ -n "$result" ]
  case "$result" in
    */*) false ;;
    *) true ;;
  esac
  rm -rf "$NONREPO"
}

@test "derive_project_slug converts slashes to dashes" {
  result=$(cs_derive_project_slug "/a/b/c")
  [ "$result" = "-a-b-c" ]
}

# --- cs_staging_dir_for_slug ---

@test "staging_dir_for_slug builds the canonical path" {
  result=$(cs_staging_dir_for_slug "-test-project")
  [ "$result" = "$HOME/.claude/projects/-test-project/compound-staging" ]
}

@test "staging_dir_for_slug rejects empty slug" {
  run cs_staging_dir_for_slug ""
  [ "$status" -ne 0 ]
}

# --- cs_atomic_jsonl_write ---

@test "atomic_jsonl_write creates the destination directory" {
  target="$STAGING_TEST_ROOT/pending/abc123.jsonl"
  run cs_atomic_jsonl_write "$target" '{"k":"v"}'
  [ "$status" -eq 0 ]
  [ -f "$target" ]
  grep -q '"k":"v"' "$target"
}

@test "atomic_jsonl_write leaves no tmp file on success" {
  target="$STAGING_TEST_ROOT/pending/clean.jsonl"
  cs_atomic_jsonl_write "$target" '{"k":"v"}'
  # No .tmp.* siblings.
  remnants=$(find "$STAGING_TEST_ROOT/pending" -name '*.tmp.*' 2>/dev/null | wc -l | tr -d ' ')
  [ "$remnants" = "0" ]
}

# --- cs_redact_secrets ---

@test "redact_secrets strips password= values" {
  result=$(printf 'password=hunter2\n' | cs_redact_secrets)
  echo "$result" | grep -q 'password=\[REDACTED\]'
  ! echo "$result" | grep -q 'hunter2'
}

@test "redact_secrets strips token= values" {
  result=$(printf 'token=abcdef1234567890\n' | cs_redact_secrets)
  echo "$result" | grep -q 'token=\[REDACTED\]'
  ! echo "$result" | grep -q 'abcdef1234567890'
}

@test "redact_secrets strips api_key= values" {
  result=$(printf 'api_key=sk-test123456789\n' | cs_redact_secrets)
  echo "$result" | grep -q 'api_key=\[REDACTED\]'
}

@test "redact_secrets strips Bearer tokens" {
  result=$(printf 'Authorization: Bearer abc123def456ghi789jkl\n' | cs_redact_secrets)
  echo "$result" | grep -q 'Bearer \[REDACTED\]'
}

@test "redact_secrets is case-insensitive on Password=" {
  result=$(printf 'Password=hunter2longvalue\n' | cs_redact_secrets)
  ! echo "$result" | grep -q 'hunter2longvalue'
}

@test "redact_secrets strips GitHub token prefixes" {
  result=$(printf 'export GH=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n' | cs_redact_secrets)
  echo "$result" | grep -q 'REDACTED:github-token'
}

@test "redact_secrets strips Anthropic API keys (vendor-tagged when bare)" {
  result=$(printf 'log line containing sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 inline\n' | cs_redact_secrets)
  echo "$result" | grep -q 'REDACTED:anthropic-key'
  ! echo "$result" | grep -q 'sk-ant-api03-abcdefghijkl'
}

@test "redact_secrets redacts Anthropic API keys via key= form too" {
  result=$(printf 'API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123\n' | cs_redact_secrets)
  # Either the vendor-tagged form OR the generic [REDACTED] form is acceptable;
  # what matters is the secret value is gone.
  ! echo "$result" | grep -q 'sk-ant-api03-abcdefghijkl'
  echo "$result" | grep -q '\[REDACTED'
}

@test "redact_secrets strips Slack tokens (vendor-tagged when bare)" {
  # Build the prefix at runtime so GitHub secret scanning does not flag
  # the literal token in the bats source. The runtime concatenation
  # produces a valid prefix that exercises the redaction regex.
  prefix=$(printf 'xox%s-' 'b')
  result=$(printf 'webhook url contains %sTESTTOKENPLACEHOLDER-NOTREALCREDS somewhere\n' "$prefix" | cs_redact_secrets)
  echo "$result" | grep -q 'REDACTED:slack-token'
}

@test "redact_secrets strips Stripe live keys" {
  prefix=$(printf 'sk_%s_' 'live')
  result=$(printf 'STRIPE=%sTESTPLACEHOLDERvalue1234NOTREAL\n' "$prefix" | cs_redact_secrets)
  echo "$result" | grep -q 'REDACTED:stripe-key'
}

@test "redact_secrets strips JSON-formatted secrets (double-quoted)" {
  result=$(printf '{"api_key": "sk-test-1234567890abcdef"}\n' | cs_redact_secrets)
  echo "$result" | grep -q '\[REDACTED\]'
  ! echo "$result" | grep -q 'sk-test-1234567890abcdef'
}

@test "redact_secrets handles basic-auth URLs" {
  result=$(printf 'https://user:pass@host/x\n' | cs_redact_secrets)
  echo "$result" | grep -q '\[REDACTED:basic-auth\]'
  ! echo "$result" | grep -q 'user:pass'
}

@test "redact_secrets passes innocuous text through unchanged" {
  result=$(printf 'hello world\n' | cs_redact_secrets)
  [ "$result" = "hello world" ]
}

# --- drain budget ---

@test "read_drain_budget returns zeroed object when file missing" {
  result=$(cs_read_drain_budget "$STAGING_TEST_ROOT")
  drains=$(printf '%s' "$result" | jq -r '.drains_in_window')
  [ "$drains" = "0" ]
}

@test "update_drain_budget creates the file with drains_in_window=1" {
  cs_update_drain_budget "$STAGING_TEST_ROOT" "subscription"
  [ -f "$STAGING_TEST_ROOT/drain-budget.json" ]
  drains=$(jq -r '.drains_in_window' "$STAGING_TEST_ROOT/drain-budget.json")
  [ "$drains" = "1" ]
}

@test "update_drain_budget increments within the 5h window" {
  cs_update_drain_budget "$STAGING_TEST_ROOT" "subscription"
  cs_update_drain_budget "$STAGING_TEST_ROOT" "subscription"
  drains=$(jq -r '.drains_in_window' "$STAGING_TEST_ROOT/drain-budget.json")
  [ "$drains" = "2" ]
}

@test "update_drain_budget resets when window_start is older than 5h" {
  # Seed a budget file with a window_start 6h ago.
  old=$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -v-6H +%Y-%m-%dT%H:%M:%SZ)
  printf '{"window_start_iso":"%s","drains_in_window":4,"last_drain_iso":"%s","auth_route":"subscription"}\n' \
    "$old" "$old" > "$STAGING_TEST_ROOT/drain-budget.json"
  cs_update_drain_budget "$STAGING_TEST_ROOT" "subscription"
  drains=$(jq -r '.drains_in_window' "$STAGING_TEST_ROOT/drain-budget.json")
  [ "$drains" = "1" ]
}

@test "drain_budget_warn returns false under subscription auth regardless of count" {
  printf '{"window_start_iso":"2026-05-18T00:00:00Z","drains_in_window":50,"last_drain_iso":"2026-05-18T00:00:00Z","auth_route":"subscription"}\n' \
    > "$STAGING_TEST_ROOT/drain-budget.json"
  run cs_drain_budget_warn "$STAGING_TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "drain_budget_warn returns true under api route when over threshold" {
  printf '{"window_start_iso":"2026-05-18T00:00:00Z","drains_in_window":20,"last_drain_iso":"2026-05-18T00:00:00Z","auth_route":"api"}\n' \
    > "$STAGING_TEST_ROOT/drain-budget.json"
  run cs_drain_budget_warn "$STAGING_TEST_ROOT"
  [ "$status" -eq 0 ]
}

# --- cs_detect_auth_route ---

@test "detect_auth_route returns subscription when ANTHROPIC_API_KEY unset" {
  unset ANTHROPIC_API_KEY
  result=$(cs_detect_auth_route)
  [ "$result" = "subscription" ]
}

@test "detect_auth_route returns api when ANTHROPIC_API_KEY set" {
  ANTHROPIC_API_KEY=fake-key cs_detect_auth_route > "$STAGING_TEST_ROOT/route"
  result=$(cat "$STAGING_TEST_ROOT/route")
  [ "$result" = "api" ]
}

# --- idempotent source guard ---

@test "library is safe to source twice" {
  . "$BATS_TEST_DIRNAME/../lib/compound-staging.sh"
  . "$BATS_TEST_DIRNAME/../lib/compound-staging.sh"
  [ "${_COMPOUND_STAGING_LOADED:-}" = "1" ]
}
