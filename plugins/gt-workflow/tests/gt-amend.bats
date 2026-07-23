#!/usr/bin/env bats
# Coverage for the deterministic bash embedded in gt-amend/SKILL.md — Phase 0's
# audit.agents clamp (identical logic to smart-submit's, applied to a
# differently-scoped field set) and Phase 4's submit-flag construction (only
# --draft, no --merge-when-ready — gt-amend never reads submit.merge_when_ready)
# plus the --no-submit guarantee. Functions below are hand-mirrored from the
# skill body (before/after-golden pattern, mirrors
# plugins/yellow-core/tests/plan-status-parity.bats and this plugin's own
# hooks/hook-parity.bats, gt-cleanup.bats, and smart-submit.bats) — update both
# places together if the skill's bash changes.
#
# Out of scope, matching gt-cleanup.bats's and smart-submit.bats's own
# documented limitation: the audit dispatch (now the audit-review skill), the
# AskUserQuestion confirmation gate on critical findings, and the trunk-branch
# warning are agent orchestration that cannot be exercised in bats. What IS
# verified here is the --no-submit guarantee: gt submit is never invoked when
# --no-submit is passed — asserted against the mock gt's call log.

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

# --- Mirrors gt-amend/SKILL.md Phase 0 "Validate and clamp audit.agents" ---
# (identical logic to smart-submit.bats's clamp_audit_agents — kept as a
# separate function here since gt-amend/SKILL.md's bash block is its own
# copy in the skill body, not a shared source the tests could import once.)
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

# --- Mirrors gt-amend/SKILL.md Phase 4 "Build the submit command" ---
# Only --draft is ever appended — gt-amend has no merge_when_ready field.
build_submit_flags() {
  local draft="$1" publish_arg="$2"
  local flags=""
  if [ "$draft" = "true" ] && [ "$publish_arg" != "true" ]; then
    flags="$flags --draft"
  fi
  echo "$flags"
}

# --- Mirrors gt-amend/SKILL.md Phase 4 "Skip this phase if --no-submit" ---
maybe_submit() {
  local no_submit="$1"
  shift
  if [ "$no_submit" = "true" ]; then
    echo "no-submit: skipped gt submit"
    return 0
  fi
  gt submit "$@"
}

# --- audit.agents clamp (same behavior as smart-submit's) ---

@test "clamp_audit_agents: empty stays empty" {
  run clamp_audit_agents ""
  [ "$output" = "" ]
}

@test "clamp_audit_agents: non-integer clamps to default 3" {
  run clamp_audit_agents "xyz"
  [ "$output" = "3" ]
}

@test "clamp_audit_agents: below minimum clamps to 1" {
  run clamp_audit_agents "0"
  [ "$output" = "1" ]
}

@test "clamp_audit_agents: above maximum clamps to 3" {
  run clamp_audit_agents "9"
  [ "$output" = "3" ]
}

# --- submit flag construction (--draft only, never --merge-when-ready) ---

@test "build_submit_flags: draft=false produces empty string" {
  run build_submit_flags "false" ""
  [ "$output" = "" ]
}

@test "build_submit_flags: draft=true adds --draft" {
  run build_submit_flags "true" ""
  [[ "$output" == *"--draft"* ]]
}

@test "build_submit_flags: draft=true with --publish suppresses --draft" {
  run build_submit_flags "true" "true"
  [[ "$output" != *"--draft"* ]]
}

@test "build_submit_flags: never includes --merge-when-ready regardless of input" {
  run build_submit_flags "true" ""
  [[ "$output" != *"--merge-when-ready"* ]]
}

# --- --no-submit guarantee: gt submit is never invoked ---

@test "maybe_submit: --no-submit never invokes gt submit" {
  run maybe_submit "true" --no-interactive
  [ "$status" -eq 0 ]
  [[ "$output" == *"no-submit: skipped"* ]]
  ! grep -q "gt submit" "$MOCK_GT_LOG"
}

@test "maybe_submit: without --no-submit does invoke gt submit" {
  run maybe_submit "false" --no-interactive
  [ "$status" -eq 0 ]
  grep -q "gt submit --no-interactive" "$MOCK_GT_LOG"
}
