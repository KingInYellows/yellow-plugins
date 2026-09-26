#!/usr/bin/env bats
# remove-legacy-hooks.bats — scripts/remove-legacy-hooks.sh: list, then remove
# only the `ruvector hooks …` entries a past `ruvector hooks init` left in a
# settings.json, with a backup.

bats_require_minimum_version 1.5.0

SCRIPT="$BATS_TEST_DIRNAME/../scripts/remove-legacy-hooks.sh"

setup() {
  command -v jq >/dev/null || skip "jq not installed"
  S="$BATS_TEST_TMPDIR/settings.json"
  jq -n '{model: "x", hooks: {
    PreToolUse: [{matcher: "Edit", hooks: [
      {type: "command", command: "npx ruvector hooks pre-edit \"$FILE\""},
      {type: "command", command: "git-ai checkpoint"}]}],
    PostToolUse: [{matcher: "Edit", hooks: [{type: "command", command: "ruvector hooks post-edit --success"}]}],
    SessionStart: [{hooks: [{type: "command", command: "ruvector hooks session-start --resume"}]}],
    Stop: [{hooks: [{type: "command", command: "bash my-stop.sh"}]}]}}' > "$S"
}

@test "lists legacy entries without changing the file" {
  before=$(cat "$S")
  run --separate-stderr bash "$SCRIPT" "$S"
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | wc -l)" -eq 3 ]
  [[ "$output" == *"PostToolUse: ruvector hooks post-edit --success"* ]]
  [ "$(cat "$S")" = "$before" ]
}

@test "--apply removes only ruvector hook entries, drops emptied groups, keeps a backup" {
  run --separate-stderr bash "$SCRIPT" "$S" --apply
  [ "$status" -eq 0 ]
  jq -e '.model == "x"' "$S" >/dev/null
  jq -e '.hooks.PreToolUse[0].hooks == [{"type":"command","command":"git-ai checkpoint"}]' "$S" >/dev/null
  jq -e '.hooks | has("PostToolUse") or has("SessionStart") | not' "$S" >/dev/null
  jq -e '.hooks.Stop[0].hooks[0].command == "bash my-stop.sh"' "$S" >/dev/null
  ls "$S".bak-* >/dev/null
  run --separate-stderr bash "$SCRIPT" "$S"
  [ "$status" -eq 1 ]
}

@test "a symlinked settings.json stays a symlink" {
  real="$BATS_TEST_TMPDIR/real.json"
  mv "$S" "$real"; ln -s "$real" "$S"
  run --separate-stderr bash "$SCRIPT" "$S" --apply
  [ "$status" -eq 0 ]
  [ -L "$S" ]
  run --separate-stderr bash "$SCRIPT" "$real"
  [ "$status" -eq 1 ]
}

@test "no legacy entries, a missing file, or invalid JSON never writes" {
  jq -n '{hooks: {Stop: [{hooks: [{type: "command", command: "bash my-stop.sh"}]}]}}' > "$S"
  run --separate-stderr bash "$SCRIPT" "$S" --apply
  [ "$status" -eq 1 ]
  ! ls "$S".bak-* 2>/dev/null
  run --separate-stderr bash "$SCRIPT" "$BATS_TEST_TMPDIR/missing.json" --apply
  [ "$status" -eq 2 ]
  echo 'not json' > "$S"
  run --separate-stderr bash "$SCRIPT" "$S" --apply
  [ "$status" -eq 2 ]
  [ "$(cat "$S")" = "not json" ]
}
