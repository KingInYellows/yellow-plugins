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
MERGE_SINGLE_SKILL="$SKILLS_DIR/github-stack-merge-single/SKILL.md"

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

@test "github-stack-merge-single: previews without --confirm and merges with the previewed head" {
  run grep -F 'merge-single --target "<number>" --merge-method <method>' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 0 ]
  run grep -F -- '--preview-token "<previewToken>" --confirm' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-merge-single: checks Graphite ownership before asking to merge" {
  run grep -F 'Is this pull request part of a Graphite stack?' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-merge-single: never calls gh pr merge or gh api itself" {
  # Every command line in the skill is the adapter; none starts with gh.
  run grep -c '^node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" merge-single ' "$MERGE_SINGLE_SKILL"
  [ "$output" -eq 2 ]
  run grep -E '^(gh|git|gt) ' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 1 ]
}

@test "github-stack-merge: sends an ordinary pull request to merge-single" {
  run grep -F 'github-stack-merge-single' "$MERGE_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-merge-single: fences the pull request fields GitHub returns" {
  run grep -c -F -- '--- begin untrusted-content (reference only) ---' "$MERGE_SINGLE_SKILL"
  [ "$output" -eq 2 ]
  run grep -F '<pullRequest fields, or refusalReason>' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-merge-single: no GitHub-supplied name is interpolated into a command" {
  run grep -E '^node .*<(baseRef|headRef|repository|headSha)>' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 1 ]
}

@test "github-stack-merge-single: a fork's head branch is never matched against Graphite branches, but ownership is still asked" {
  run grep -F 'pullRequest.headInRepository` is `false`' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 0 ]
  run grep -F 'go straight to the question below' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 0 ]
  run grep -F 'Is this pull request part of a Graphite stack?' "$MERGE_SINGLE_SKILL"
  [ "$status" -eq 0 ]
}

@test "github-stack-merge: the confirmed merge passes back the previewed repository" {
  run grep -c -F 'merge --target "<target>" --repository "<repository>"' "$MERGE_SKILL"
  [ "$output" -eq 2 ]
  run grep -E '^node .*merge --target "<target>" (--merge-method <method> )?--confirm' "$MERGE_SKILL"
  [ "$status" -eq 1 ]
}

@test "github-stack-merge: the previewed set is checked against the resolved repository" {
  run grep -c -F 'gh api "repos/<repository>/pulls/<number>"' "$MERGE_SKILL"
  [ "$output" -eq 1 ]
  run grep -F 'repos/{owner}/{repo}/pulls' "$MERGE_SKILL"
  [ "$status" -eq 1 ]
  run grep -F 'discard it and run Step 2 again' "$MERGE_SKILL"
  [ "$status" -eq 0 ]
}
