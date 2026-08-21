#!/usr/bin/env bats
# Static content assertions for the stack-traversal provider-resolution-
# ordering fixes (L14), which are prose, not executable code, so they cannot
# be exercised via a Node/Bash unit test. Each case asserts a specific
# ordering fix landed in the relevant file and stays there — regressions
# here are silent (a future edit could reintroduce a Graphite-only
# enumeration/adoption call ahead of provider resolution and nothing else
# would notice).

bats_require_minimum_version 1.5.0

SKILLS_DIR="$BATS_TEST_DIRNAME/../skills"
COMMANDS_DIR="$BATS_TEST_DIRNAME/../commands/review"
TRAVERSAL_SKILL="$SKILLS_DIR/stack-traversal/SKILL.md"
RESOLVE_STACK="$COMMANDS_DIR/resolve-stack.md"
REVIEW_ALL="$COMMANDS_DIR/review-all.md"

@test "stack-traversal skill: Step 0 (resolve provider) heading precedes Step 1 (enumerate)" {
  step0_line=$(grep -n '^### Step 0: Resolve the active stacked-PR provider' "$TRAVERSAL_SKILL" | head -1 | cut -d: -f1)
  step1_line=$(grep -n '^### Step 1: Enumerate the stack' "$TRAVERSAL_SKILL" | head -1 | cut -d: -f1)
  [ -n "$step0_line" ]
  [ -n "$step1_line" ]
  [ "$step0_line" -lt "$step1_line" ]
}

@test "resolve-stack: provider resolution (Step 0) precedes the gt preflight check" {
  provider_line=$(grep -n 'skill: "stack-provider-router"' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  gt_check_line=$(grep -n 'command -v gt' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  [ -n "$provider_line" ]
  [ -n "$gt_check_line" ]
  [ "$provider_line" -lt "$gt_check_line" ]
}

@test "review-all: gt track is gated on READY_GRAPHITE, not run unconditionally" {
  track_line=$(grep -n '^gt track$' "$REVIEW_ALL" | head -1 | cut -d: -f1)
  gate_line=$(grep -n 'READY_GRAPHITE.\{0,20\}only' "$REVIEW_ALL" | head -1 | cut -d: -f1)
  [ -n "$track_line" ]
  [ -n "$gate_line" ]
  [ "$gate_line" -lt "$track_line" ]
  # Only one unconditional `gt track` invocation should exist in the file
  # (the gated one above) — a second bare occurrence would mean a new
  # unconditional call slipped back in.
  count=$(grep -c '^gt track$' "$REVIEW_ALL")
  [ "$count" -eq 1 ]
}
