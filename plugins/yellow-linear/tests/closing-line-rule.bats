#!/usr/bin/env bats
# The Linear closing-line ID rule is written out in each place that cannot call
# Linear (gt-workflow cannot depend on yellow-linear at runtime), so this test
# pins every copy to the one wording in the linear-workflows skill.

PLUGINS="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"

flat() { tr '\n' ' ' <"$1" | tr -s ' '; }

RULE='Take the Linear ID only from the last path segment of the branch name, which must start with `[A-Z]{2,5}-[0-9]{1,6}` followed by `-` or the end of the name, or from the stack item'"'"'s `Linear:` field; ignore IDs mentioned anywhere else.'

@test "the skill, smart-submit and /flow:work carry the same ID-sourcing rule" {
  for f in \
    "$PLUGINS/yellow-linear/skills/linear-workflows/SKILL.md" \
    "$PLUGINS/gt-workflow/skills/smart-submit/SKILL.md" \
    "$PLUGINS/yellow-core/commands/flow/work.md"; do
    [[ "$(flat "$f")" == *"$RULE"* ]] || { echo "rule missing or reworded in $f"; false; }
  done
}

@test "the generated Codex copy of smart-submit carries the same rule" {
  [[ "$(flat "$PLUGINS/gt-workflow/codex/skills/smart-submit/SKILL.md")" == *"$RULE"* ]]
}

@test "no writer still takes the ID from the user's request or writes Closes by default" {
  for f in "$PLUGINS/gt-workflow/skills/smart-submit/SKILL.md" "$PLUGINS/yellow-core/commands/flow/work.md"; do
    t=$(flat "$f")
    [[ $t != *"or the user's request carries a Linear issue ID"* ]]
    [[ $t != *"end the body with \`Closes <ISSUE-ID>\`, using"* ]]
  done
}

@test "gt-amend reads the current message and only keeps an existing line" {
  t=$(flat "$PLUGINS/gt-workflow/skills/gt-amend/SKILL.md")
  [[ $t == *'read the current one with `git log -1 --format=%B`'* ]]
  [[ $t == *"never adds one"* ]]
}
