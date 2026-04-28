#!/usr/bin/env bats
# Tests for scripts/lint-plugins.sh — fixture-based regression coverage.
#
# Catches regressions in:
#   - frontmatter completeness checks (Check 1, including missing-tools as ERROR)
#   - memory: true detection (Check 2 — must be scoped to frontmatter only)
#   - skill-reference resolution (Check 3) — including the regression where
#     SKILL.md body prose containing "name:" lines was corrupting the
#     known-skills set (P1 fix shipped in PR #261)
#   - exit code aggregation (errors → 1, warnings-only → 0)

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  LINT_SCRIPT="$ROOT/scripts/lint-plugins.sh"
  FIXTURE_SRC="$ROOT/fixtures/lint"

  [ -f "$LINT_SCRIPT" ] || skip "lint script not found at $LINT_SCRIPT"
  [ -d "$FIXTURE_SRC/plugins" ] || skip "fixture not found at $FIXTURE_SRC"

  TEST_TMP=$(mktemp -d -t lint-tests-XXXXXX)
}

teardown() {
  rm -rf "$TEST_TMP"
}

# Helper: build a git-initialized fixture tree under $TEST_TMP/<subdir>
# and run the lint script. Sets $output and $status (Bats run conventions).
run_lint_in_fixture() {
  local subdir="$1"
  local fixture_path="$2"
  cp -r "$fixture_path" "$TEST_TMP/$subdir/plugins"
  ( cd "$TEST_TMP/$subdir" \
      && git init -q \
      && git config user.email lint@example.invalid \
      && git config user.name lint \
      && git add . \
      && git commit -q -m init >/dev/null )
  cd "$TEST_TMP/$subdir"
  run bash "$LINT_SCRIPT"
  cd "$ROOT"
}

# ============================================================================
# Test 1: full fixture (intentional errors and warnings)
# Exit code should be 1 (errors present). All expected findings must appear.
# ============================================================================

@test "full fixture: exit code is 1 (errors present)" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [ "$status" -eq 1 ]
}

@test "full fixture: missing-name agent fires ERROR" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" == *"missing 'name:' frontmatter: plugins/sample-plugin/agents/missing-name.md"* ]]
}

@test "full fixture: missing-description agent fires ERROR" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" == *"missing 'description:' frontmatter: plugins/sample-plugin/agents/missing-description.md"* ]]
}

@test "full fixture: missing-tools agent fires ERROR (escalated from warn in PR #261)" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" == *"missing required 'tools:' allowlist"* ]]
}

@test "full fixture: unknown-skill reference fires ERROR" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" == *"unknown skill: this-skill-does-not-exist"* ]]
}

@test "full fixture: body-prose 'name:' does NOT index as a skill (regression for PR #261)" {
  # skill-body-ref.md (fixture) references `should-not-be-collected`, a string
  # that only appears in SKILL.md body prose. Under the pre-PR-261 bug, the
  # extractor collected it as a known skill and the reference silently
  # resolved. Under the fix, it must surface as an unknown skill error.
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" == *"unknown skill: should-not-be-collected"* ]]
}

@test "full fixture: memory: true fires WARN" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" == *"'memory: true' is likely a no-op"* ]]
}

@test "full fixture: memory: project does NOT trigger the memory check" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" != *"memory-project.md"* ]]
}

@test "full fixture: valid skill reference does NOT error" {
  mkdir "$TEST_TMP/full"
  run_lint_in_fixture full "$FIXTURE_SRC/plugins"
  [[ "$output" != *"unknown skill: test-skill"* ]]
}

# ============================================================================
# Test 2: clean fixture (only good agents) — exit 0, no ERRORs.
# ============================================================================

@test "clean subset: exits 0 (no errors)" {
  mkdir -p "$TEST_TMP/clean/plugins/sample-plugin/agents" \
           "$TEST_TMP/clean/plugins/sample-plugin/skills/test-skill"
  cp "$FIXTURE_SRC/plugins/sample-plugin/agents/good-agent.md" \
     "$TEST_TMP/clean/plugins/sample-plugin/agents/"
  cp "$FIXTURE_SRC/plugins/sample-plugin/agents/valid-skill.md" \
     "$TEST_TMP/clean/plugins/sample-plugin/agents/"
  cp "$FIXTURE_SRC/plugins/sample-plugin/skills/test-skill/SKILL.md" \
     "$TEST_TMP/clean/plugins/sample-plugin/skills/test-skill/"
  ( cd "$TEST_TMP/clean" \
      && git init -q \
      && git config user.email lint@example.invalid \
      && git config user.name lint \
      && git add . \
      && git commit -q -m init >/dev/null )
  cd "$TEST_TMP/clean"
  run bash "$LINT_SCRIPT"
  cd "$ROOT"
  [ "$status" -eq 0 ]
  [[ "$output" != *"ERROR"* ]]
}

# ============================================================================
# Test 3: GitHub Actions annotation emission. When GITHUB_ACTIONS=true,
# the script must emit ::warning::/::error:: lines to stdout (where the
# Actions runner parses them). Runs without the env var must NOT emit them.
# The "local" invocation explicitly unsets GITHUB_ACTIONS so this assertion
# holds even when the test harness itself runs inside CI (where
# GITHUB_ACTIONS is already exported as "true" for every step).
# ============================================================================

setup_annotations_fixture() {
  mkdir "$TEST_TMP/actions"
  cp -r "$FIXTURE_SRC/plugins" "$TEST_TMP/actions/plugins"
  ( cd "$TEST_TMP/actions" \
      && git init -q \
      && git config user.email lint@example.invalid \
      && git config user.name lint \
      && git add . \
      && git commit -q -m init >/dev/null )
}

@test "annotations: local run (GITHUB_ACTIONS unset) emits 0 annotations to stdout" {
  setup_annotations_fixture
  cd "$TEST_TMP/actions"
  local_stdout=$(env -u GITHUB_ACTIONS bash "$LINT_SCRIPT" 2>/dev/null || true)
  cd "$ROOT"
  count=$(printf '%s' "$local_stdout" | grep -c '^::' || true)
  [ "$count" -eq 0 ]
}

@test "annotations: GITHUB_ACTIONS=true emits ::warning:: lines to stdout" {
  setup_annotations_fixture
  cd "$TEST_TMP/actions"
  ga_stdout=$(GITHUB_ACTIONS=true bash "$LINT_SCRIPT" 2>/dev/null || true)
  cd "$ROOT"
  count=$(printf '%s' "$ga_stdout" | grep -c '^::warning' || true)
  [ "$count" -ge 1 ]
}

@test "annotations: GITHUB_ACTIONS=true emits ::error:: lines to stdout" {
  setup_annotations_fixture
  cd "$TEST_TMP/actions"
  ga_stdout=$(GITHUB_ACTIONS=true bash "$LINT_SCRIPT" 2>/dev/null || true)
  cd "$ROOT"
  count=$(printf '%s' "$ga_stdout" | grep -c '^::error' || true)
  [ "$count" -ge 1 ]
}

@test "annotations: GITHUB_ACTIONS=true emits file-anchored annotations" {
  setup_annotations_fixture
  cd "$TEST_TMP/actions"
  ga_stdout=$(GITHUB_ACTIONS=true bash "$LINT_SCRIPT" 2>/dev/null || true)
  cd "$ROOT"
  [[ "$ga_stdout" == *"file=plugins/"* ]]
}
