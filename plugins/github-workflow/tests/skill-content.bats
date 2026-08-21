#!/usr/bin/env bats
# Static content assertions for skill-authoring fixes that are prose, not
# executable code, so they cannot be exercised via a Node/Bash unit test.
# Each case asserts a specific fix landed in the relevant SKILL.md and stays
# there — regressions here are silent (a future edit could drop a line and
# nothing else would notice).

bats_require_minimum_version 1.5.0

SKILLS_DIR="$BATS_TEST_DIRNAME/../skills"
SUBMIT_SKILL="$SKILLS_DIR/github-stack-submit/SKILL.md"
NAV_SKILL="$SKILLS_DIR/github-stack-nav/SKILL.md"
AMEND_SKILL="$SKILLS_DIR/github-stack-amend/SKILL.md"
MERGE_SKILL="$SKILLS_DIR/github-stack-merge/SKILL.md"

@test "github-stack-submit: Step 2 reviews pre-staged (cached) files before staging" {
  run grep -F 'git diff --cached --name-only' "$SUBMIT_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-submit: Step 3 fences the staged diff as untrusted content" {
  run grep -F -- '--- begin untrusted-content (reference only) ---' "$SUBMIT_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-submit: file staging uses an array, not string interpolation" {
  run grep -F 'git add -- "${files[@]}"' "$SUBMIT_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-submit: commit uses -F from a temp file, not -m" {
  run grep -F 'git commit -F "$msgfile"' "$SUBMIT_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-nav: direct-argument target is validated before use" {
  run grep -F 'If the argument text is non-empty, validate it before using it' "$NAV_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-amend: file staging uses an array, not string interpolation" {
  run grep -F 'git add -- "${files[@]}"' "$AMEND_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-amend: amend commit uses -F from a temp file, not -m" {
  run grep -F 'git commit --amend -F "$msgfile"' "$AMEND_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-merge: direct-argument target is validated before use" {
  run grep -F '^[1-9][0-9]*$' "$MERGE_SKILL"
  [ "$status" -eq 0 ]
}
