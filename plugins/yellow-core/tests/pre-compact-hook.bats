#!/usr/bin/env bats
# Tests for hooks/scripts/pre-compact.sh — compaction-preservation instruction.
#
# Contract under test (Claude Code hook reference): exit 0 + plain-text stdout
# is appended to the compaction prompt; exit 2 would block compaction. So the
# hook must always exit 0, must never print JSON, and must not depend on the
# shape of its stdin.

PC_HOOK="$BATS_TEST_DIRNAME/../hooks/scripts/pre-compact.sh"

@test "exits 0 and prints the preservation instruction on manual trigger" {
  run bash "$PC_HOOK" <<< '{"session_id":"s1","trigger":"manual","custom_instructions":""}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"preserve the following exactly"* ]]
  [[ "$output" == *"still unchecked"* ]]
  [[ "$output" == *"last failing command"* ]]
}

@test "prints plain text, never JSON (JSON would be embedded in the prompt)" {
  run bash "$PC_HOOK" <<< '{"trigger":"auto","custom_instructions":"focus on tests"}'
  [ "$status" -eq 0 ]
  [[ "$output" != "{"* ]]
  [[ "$output" != *'"continue"'* ]]
}

@test "tolerates empty and malformed stdin" {
  run bash "$PC_HOOK" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"preserve the following"* ]]

  run bash "$PC_HOOK" <<< 'not json at all'
  [ "$status" -eq 0 ]
  [[ "$output" == *"preserve the following"* ]]
}

@test "stays short enough to sit in a compaction prompt" {
  run bash "$PC_HOOK" <<< '{}'
  [ "$status" -eq 0 ]
  line_count=$(printf '%s\n' "$output" | wc -l)
  [ "$line_count" -le 15 ]
}
