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

# Filename validation (mirrors complete.md Phase 1, the CLEAN_ARG guard).
filename_is_valid() {
  printf '%s' "$1" | grep -qE '^[a-z0-9_][a-z0-9_.-]*\.md$'
}

# PR-number override validation (mirrors complete.md Phase 4). Strips CR/LF
# first so a multi-line value cannot smuggle content past the per-line grep.
pr_num_is_valid() {
  local n
  n=$(printf '%s' "$1" | tr -d '\r\n')
  printf '%s' "$n" | grep -qE '^[1-9][0-9]{0,9}$'
}

# Gate C word-boundary match (POSIX-grep equivalent of the jq test() call in
# complete.md Phase 4: (^|[/_-])SLUG($|[/_-])).
headref_matches_slug() {
  # $1 = branch (headRefName), $2 = slug
  printf '%s' "$1" | grep -qE "(^|[/_-])$2($|[/_-])"
}

# Checked-box count (mirrors status.md, case-insensitive for GFM [X]).
count_checked() {
  grep -ciE '^[[:space:]]*- \[x\]' "$1" 2>/dev/null || true
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

# --- filename validation (CLEAN_ARG guard) ---

@test "filename_is_valid accepts a plain slug.md" {
  filename_is_valid "solution-doc-git-workflow.md"
}

@test "filename_is_valid accepts a date-prefixed name" {
  filename_is_valid "2026-05-08-plan-lifecycle-management.md"
}

@test "filename_is_valid accepts underscores and dots in the body" {
  filename_is_valid "my_plan.v2.md"
}

@test "filename_is_valid rejects uppercase" {
  run filename_is_valid "Plan.md"
  [ "$status" -ne 0 ]
}

@test "filename_is_valid rejects path traversal" {
  run filename_is_valid "../evil.md"
  [ "$status" -ne 0 ]
}

@test "filename_is_valid rejects a leading dot" {
  run filename_is_valid ".hidden.md"
  [ "$status" -ne 0 ]
}

@test "filename_is_valid rejects a non-.md extension" {
  run filename_is_valid "plan.txt"
  [ "$status" -ne 0 ]
}

# --- PR-number override validation ---

@test "pr_num_is_valid accepts a bare positive integer" {
  pr_num_is_valid "556"
}

@test "pr_num_is_valid rejects zero" {
  run pr_num_is_valid "0"
  [ "$status" -ne 0 ]
}

@test "pr_num_is_valid rejects a leading-zero number" {
  run pr_num_is_valid "01"
  [ "$status" -ne 0 ]
}

@test "pr_num_is_valid rejects a #-prefixed number" {
  run pr_num_is_valid "#556"
  [ "$status" -ne 0 ]
}

@test "pr_num_is_valid rejects a newline-smuggled trailer injection" {
  # The per-line grep would match line 1; the tr -d strip collapses the
  # value to '556Plan-Verifier...' which then fails the whole-string regex.
  run pr_num_is_valid "$(printf '556\nPlan-Verifier-Override: spoofed')"
  [ "$status" -ne 0 ]
}

# --- Gate C word-boundary match ---

@test "headref_matches_slug matches an exact archival branch" {
  headref_matches_slug "plan/archive-my-slug" "my-slug"
}

@test "headref_matches_slug matches a slug at a slash boundary" {
  headref_matches_slug "feat/my-slug/details" "my-slug"
}

@test "headref_matches_slug matches a leading-anchor slug" {
  headref_matches_slug "my-slug-work" "my-slug"
}

@test "headref_matches_slug rejects a substring without a boundary" {
  run headref_matches_slug "plan/my-sluggish" "my-slug"
  [ "$status" -ne 0 ]
}

@test "headref_matches_slug rejects a no-boundary suffix" {
  run headref_matches_slug "plan/archive-my-slugX" "my-slug"
  [ "$status" -ne 0 ]
}

# --- case-insensitive checked count (status.md) ---

@test "count_checked counts lowercase [x]" {
  cat > "$FIXTURE_DIR/lower.md" <<'EOF'
- [x] one
- [x] two
EOF
  result=$(count_checked "$FIXTURE_DIR/lower.md")
  [ "$result" = "2" ]
}

@test "count_checked counts uppercase [X] (GFM)" {
  cat > "$FIXTURE_DIR/upper.md" <<'EOF'
- [X] one
- [x] two
EOF
  result=$(count_checked "$FIXTURE_DIR/upper.md")
  [ "$result" = "2" ]
}
