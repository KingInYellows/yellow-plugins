#!/usr/bin/env bats
# memory-manager-flush.bats — pins hooks_pretrain persistence acknowledgement for
# agents/ruvector/memory-manager.md Queue Flush Mode step 6 (ruvector@0.2.34).

bats_require_minimum_version 1.5.0

MEMORY_MANAGER_MD="$BATS_TEST_DIRNAME/../agents/ruvector/memory-manager.md"

setup() {
  command -v jq >/dev/null || skip "jq not installed"
}

# Mirrors memory-manager.md step 6: success: true acknowledges; retain otherwise.
pretrain_acknowledged() {
  local result="$1"
  jq -e 'type == "object" and .success == true' <<< "$result" >/dev/null 2>&1
}

@test "memory-manager documents ruvector@0.2.34 pretrain success acknowledgement" {
  grep -q 'success: true' "$MEMORY_MANAGER_MD"
  grep -q 'new_stats' "$MEMORY_MANAGER_MD"
  grep -q 'no separate `persisted`' "$MEMORY_MANAGER_MD"
}

@test "hooks_pretrain success true with output and new_stats is acknowledged" {
  pretrain_acknowledged '{"success":true,"output":"Repository intelligence bootstrapped","new_stats":{"patterns":3}}'
}

@test "hooks_pretrain empty result is not acknowledged" {
  ! pretrain_acknowledged ''
}

@test "hooks_pretrain success false is not acknowledged" {
  ! pretrain_acknowledged '{"success":false,"error":"disk full"}'
}

@test "hooks_pretrain missing success field is not acknowledged" {
  ! pretrain_acknowledged '{"output":"indexed","new_stats":{}}'
}

@test "hooks_pretrain malformed JSON is not acknowledged" {
  ! pretrain_acknowledged 'not-json'
}
