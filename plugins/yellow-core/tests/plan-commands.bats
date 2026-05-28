#!/usr/bin/env bats
# Smoke tests for plan-lifecycle commands. Exercises the slug-derivation
# regex from plan/complete.md (Phase 1) and the Gate A unchecked-box grep
# from Phase 3 against fixture files. These are smoke-level only — the
# full end-to-end /plan:complete flow involves AskUserQuestion + gh + gt
# which cannot be exercised in bats.

# Slug derivation regex (mirrors complete.md Phase 1).
derive_slug() {
  basename "$1" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//'
}

# Gate A grep (mirrors complete.md Phase 3). grep -c prints 0 + exits 1
# on no matches, so we suppress the non-zero exit but preserve stdout.
count_unchecked() {
  grep -cE '^[[:space:]]*- \[ \]' "$1" 2>/dev/null || true
}

# Post-derivation slug validation (mirrors complete.md Phase 1).
slug_is_valid() {
  printf '%s' "$1" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$'
}

setup() {
  FIXTURE_DIR="$(mktemp -d)"
}

teardown() {
  if [ -n "${FIXTURE_DIR:-}" ] && [ -d "$FIXTURE_DIR" ]; then
    rm -rf "$FIXTURE_DIR"
  fi
}

# --- slug derivation ---

@test "derive_slug strips YYYY-MM-DD prefix" {
  result=$(derive_slug "2026-05-08-plan-lifecycle-management.md")
  [ "$result" = "plan-lifecycle-management" ]
}

@test "derive_slug leaves bare slug unchanged" {
  result=$(derive_slug "solution-doc-git-workflow.md")
  [ "$result" = "solution-doc-git-workflow" ]
}

@test "derive_slug handles filename with no date prefix and underscores" {
  result=$(derive_slug "my_plan_slug.md")
  [ "$result" = "my_plan_slug" ]
}

# --- slug validation ---

@test "slug_is_valid accepts kebab-case lowercase" {
  slug_is_valid "plan-lifecycle-management"
}

@test "slug_is_valid accepts single-word lowercase" {
  slug_is_valid "refactor"
}

@test "slug_is_valid rejects uppercase" {
  run slug_is_valid "MyPlan"
  [ "$status" -ne 0 ]
}

@test "slug_is_valid rejects consecutive hyphens" {
  run slug_is_valid "plan--lifecycle"
  [ "$status" -ne 0 ]
}

@test "slug_is_valid rejects leading hyphen" {
  run slug_is_valid "-plan-lifecycle"
  [ "$status" -ne 0 ]
}

@test "slug_is_valid rejects trailing hyphen" {
  run slug_is_valid "plan-lifecycle-"
  [ "$status" -ne 0 ]
}

@test "slug_is_valid rejects empty string" {
  run slug_is_valid ""
  [ "$status" -ne 0 ]
}

# --- Gate A unchecked-box scan ---

@test "count_unchecked returns 0 on a fully-completed plan" {
  cat > "$FIXTURE_DIR/clean.md" <<'EOF'
# Feature: Clean

- [x] task one
- [x] task two
EOF
  result=$(count_unchecked "$FIXTURE_DIR/clean.md")
  [ "$result" = "0" ]
}

@test "count_unchecked returns the right count on a partially-completed plan" {
  cat > "$FIXTURE_DIR/dirty.md" <<'EOF'
# Feature: Dirty

- [x] task one
- [ ] task two
- [x] task three
- [ ] task four
EOF
  result=$(count_unchecked "$FIXTURE_DIR/dirty.md")
  [ "$result" = "2" ]
}

@test "count_unchecked returns 0 on a plan with zero task boxes" {
  cat > "$FIXTURE_DIR/prose.md" <<'EOF'
# Feature: Prose-only plan

This plan has no checklist. It is all prose.
EOF
  result=$(count_unchecked "$FIXTURE_DIR/prose.md")
  [ "$result" = "0" ]
}

@test "count_unchecked counts indented boxes the same way" {
  cat > "$FIXTURE_DIR/indented.md" <<'EOF'
# Feature: Nested

- [x] top-level done
  - [ ] nested undone
EOF
  result=$(count_unchecked "$FIXTURE_DIR/indented.md")
  [ "$result" = "1" ]
}
