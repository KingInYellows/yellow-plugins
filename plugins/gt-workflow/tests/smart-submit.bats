#!/usr/bin/env bats
# Coverage for the deterministic bash embedded in smart-submit/SKILL.md —
# Phase 0's audit.agents clamp + branch.prefix validation, and Phase 4's
# submit-flag construction and --dry-run guarantee. Functions below are
# hand-mirrored from the skill body (before/after-golden pattern, mirrors
# plugins/yellow-core/tests/plan-status-parity.bats and this plugin's own
# hooks/hook-parity.bats and gt-cleanup.bats) — update both places together
# if the skill's bash changes.
#
# Out of scope, matching gt-cleanup.bats's own documented limitation: the
# audit dispatch (now the audit-review skill), the AskUserQuestion
# confirmation gate on critical findings, and commit-message generation are
# agent orchestration that cannot be exercised in bats. What IS verified here
# is the dry-run *guarantee*: with --dry-run, gt submit is never invoked —
# asserted against the mock gt's call log, not by re-implementing the gate
# itself.

bats_require_minimum_version 1.5.0

MOCKS_DIR="$BATS_TEST_DIRNAME/mocks"

setup() {
  export PATH="$MOCKS_DIR:$PATH"
  MOCK_GT_LOG="$(mktemp)"
  export MOCK_GT_LOG
}

teardown() {
  rm -f "$MOCK_GT_LOG"
}

# --- Mirrors smart-submit/SKILL.md Phase 0 "Validate and clamp audit.agents" ---
clamp_audit_agents() {
  local val="$1"
  if [ -n "$val" ]; then
    case "$val" in
      *[!0-9]*) val=3 ;;
    esac
    if [ "$val" -lt 1 ] 2>/dev/null; then
      val=1
    elif [ "$val" -gt 3 ] 2>/dev/null; then
      val=3
    fi
  fi
  echo "$val"
}

# --- Mirrors smart-submit/SKILL.md Phase 0 "Validate branch.prefix" ---
validate_branch_prefix() {
  local val="$1"
  if [ -n "$val" ]; then
    if ! printf '%s' "$val" | grep -qE '^[a-z0-9][a-z0-9/_-]*$'; then
      val=""
    fi
  fi
  echo "$val"
}

# --- Mirrors smart-submit/SKILL.md Phase 4 "Build the submit command" ---
build_submit_flags() {
  local draft="$1" merge_when_ready="$2" publish_arg="$3"
  local flags=""
  if [ "$draft" = "true" ] && [ "$publish_arg" != "true" ]; then
    flags="$flags --draft"
  fi
  if [ "$merge_when_ready" = "true" ]; then
    flags="$flags --merge-when-ready"
  fi
  echo "$flags"
}

# --- Mirrors smart-submit/SKILL.md Phase 4 dry-run guard ---
maybe_submit() {
  local dry_run="$1"
  shift
  if [ "$dry_run" = "true" ]; then
    echo "dry-run: skipped gt submit"
    return 0
  fi
  gt submit "$@"
}

# --- audit.agents clamp ---

@test "clamp_audit_agents: empty stays empty (caller applies hardcoded default)" {
  run clamp_audit_agents ""
  [ "$output" = "" ]
}

@test "clamp_audit_agents: valid in-range value passes through" {
  run clamp_audit_agents "2"
  [ "$output" = "2" ]
}

@test "clamp_audit_agents: non-integer clamps to default 3" {
  run clamp_audit_agents "abc"
  [ "$output" = "3" ]
}

@test "clamp_audit_agents: below minimum clamps to 1" {
  run clamp_audit_agents "0"
  [ "$output" = "1" ]
}

@test "clamp_audit_agents: above maximum clamps to 3" {
  run clamp_audit_agents "7"
  [ "$output" = "3" ]
}

# --- branch.prefix validation ---

@test "validate_branch_prefix: empty stays empty" {
  run validate_branch_prefix ""
  [ "$output" = "" ]
}

@test "validate_branch_prefix: valid prefix passes through" {
  run validate_branch_prefix "agent/"
  [ "$output" = "agent/" ]
}

@test "validate_branch_prefix: invalid characters reset to empty" {
  run validate_branch_prefix "../etc"
  [ "$output" = "" ]
}

@test "validate_branch_prefix: uppercase leading char is rejected" {
  run validate_branch_prefix "Agent/"
  [ "$output" = "" ]
}

# --- submit flag construction ---

@test "build_submit_flags: no config flags produces empty string" {
  run build_submit_flags "false" "false" ""
  [ "$output" = "" ]
}

@test "build_submit_flags: draft=true adds --draft" {
  run build_submit_flags "true" "false" ""
  [[ "$output" == *"--draft"* ]]
  [[ "$output" != *"--merge-when-ready"* ]]
}

@test "build_submit_flags: draft=true with --publish suppresses --draft" {
  run build_submit_flags "true" "false" "true"
  [[ "$output" != *"--draft"* ]]
}

@test "build_submit_flags: merge_when_ready=true adds --merge-when-ready" {
  run build_submit_flags "false" "true" ""
  [[ "$output" == *"--merge-when-ready"* ]]
}

@test "build_submit_flags: both flags set adds both" {
  run build_submit_flags "true" "true" ""
  [[ "$output" == *"--draft"* ]]
  [[ "$output" == *"--merge-when-ready"* ]]
}

# --- --dry-run guarantee: gt submit is never invoked ---

@test "maybe_submit: dry-run never invokes gt submit" {
  run maybe_submit "true" --no-interactive
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry-run: skipped"* ]]
  ! grep -q "gt submit" "$MOCK_GT_LOG"
}

@test "maybe_submit: non-dry-run does invoke gt submit" {
  run maybe_submit "false" --no-interactive
  [ "$status" -eq 0 ]
  grep -q "gt submit --no-interactive" "$MOCK_GT_LOG"
}
