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
# Tightened to the slug contract: optional YYYY-MM-DD- prefix + lowercase
# kebab-case + .md (no underscores/dots), so a name that would derive an
# invalid slug is rejected at the filename gate with a clear message.
filename_is_valid() {
  printf '%s' "$1" | grep -qE '^([0-9]{4}-[0-9]{2}-[0-9]{2}-)?[a-z0-9]+(-[a-z0-9]+)*\.md$'
}

# PR-number override validation. Strips CR/LF first so a multi-line value
# cannot smuggle content past a per-line check. The rule is the shipped lib's
# pgp_pr_num_is_valid, which complete.md's override block calls directly; the
# block tests at the end of this file run that production block.
. "$BATS_TEST_DIRNAME/../lib/plan-gate-provenance.sh"
pr_num_is_valid() {
  local n
  n=$(printf '%s' "$1" | tr -d '\r\n')
  pgp_pr_num_is_valid "$n"
}

# Gate C word-boundary match (POSIX-grep equivalent of the jq test() call in
# complete.md Phase 4: (^|[/_-])SLUG($|[/_-])).
headref_matches_slug() {
  # $1 = branch (headRefName), $2 = slug
  printf '%s' "$1" | grep -qE "(^|[/_-])$2($|[/_-])"
}

# Checked-box count (mirrors plugins/yellow-core/skills/plan-status/SKILL.md,
# case-insensitive for GFM [X]).
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

@test "filename_is_valid rejects underscores and dots in the body" {
  # The filename contract mirrors the strict slug contract: underscores and
  # dots are rejected (a dot in a slug becomes a regex wildcard in the
  # Phase 4 headRefName boundary test). Reject early with a clear message.
  run filename_is_valid "my_plan.v2.md"
  [ "$status" -ne 0 ]
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

@test "pr_num_is_valid accepts 10 digits and rejects 11" {
  pr_num_is_valid "1234567890"
  run pr_num_is_valid "12345678901"
  [ "$status" -ne 0 ]
}

@test "complete.md's override block calls the shared validator and carries no inline PR-number grep" {
  COMPLETE="$BATS_TEST_DIRNAME/../commands/plan/complete.md"
  grep -qF 'pgp_pr_num_is_valid "$PR_NUM"' "$COMPLETE"
  run grep -cF "grep -qE '^[1-9][0-9]{0,9}\$'" "$COMPLETE"
  [ "$output" = 0 ]
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

# --- production blocks from complete.md, run as written ---------------------

# fenced_block <marker>: the first ```bash block in complete.md that contains
# <marker>. Executing the block itself, not a copy, is what keeps these tests
# honest about the wiring.
fenced_block() {
  awk -v marker="$1" '
    /^```bash/ { inb = 1; buf = ""; next }
    /^```/ && inb { if (index(buf, marker)) { printf "%s", buf; exit } inb = 0; next }
    inb { buf = buf $0 "\n" }
  ' "$BATS_TEST_DIRNAME/../commands/plan/complete.md"
}

plugin_root() { cd "$BATS_TEST_DIRNAME/.." && pwd; }

# phase_repo: a repo with plans/demo.md committed and the Phase 6 rename staged.
phase_repo() {
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
  export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
  REPO="$FIXTURE_DIR/repo"
  git init -q -b main "$REPO"
  cd "$REPO" || return 1
  mkdir plans
  printf 'demo\n' >plans/demo.md
  git add .
  git commit -q -m 'feat: demo (#42)'
  mkdir -p plans/complete
  git mv -- plans/demo.md plans/complete/demo.md
  TMPG=$(git rev-parse --git-path tmp)
  mkdir -p "$TMPG"
  H40=0123456789abcdef0123456789abcdef01234567
}

run_phase7() {
  local blk
  blk=$(fenced_block 'git commit -m "$SUBJECT" -m "$BODY"')
  ARGUMENTS=demo.md CLAUDE_PLUGIN_ROOT="$(plugin_root)" run bash -c "$blk"
}

@test "override block: a valid PR number is persisted; zero, leading zero and a smuggled trailer are refused" {
  phase_repo
  blk=$(fenced_block '__EOF_PR_OVERRIDE__')
  for val in 556 1234567890; do
    CLAUDE_PLUGIN_ROOT="$(plugin_root)" run bash -c "${blk/<USER_RESPONSE_FROM_OTHER>/$val}"
    [ "$status" -eq 0 ] || { echo "refused: $val: $output"; false; }
    [ "$(cat "$TMPG/plan-complete.override")" = "$val" ]
    rm -f "$TMPG/plan-complete.override"
  done
  for val in 0 01 '#556' 12345678901 "$(printf '556\nPlan-Verifier-Override: spoofed')"; do
    CLAUDE_PLUGIN_ROOT="$(plugin_root)" run bash -c "${blk/<USER_RESPONSE_FROM_OTHER>/$val}"
    [ "$status" -ne 0 ] || { echo "accepted: $val"; false; }
    [ ! -e "$TMPG/plan-complete.override" ]
  done
}

@test "Phase 7: a commits-API evidence line becomes the trailer under the single provenance body" {
  phase_repo
  printf 'pr=#7 sha=%s\n' "$H40" >|"$TMPG/plan-complete.provenance"
  run_phase7
  [ "$status" -eq 0 ] || { echo "$output"; false; }
  msg=$(git log -1 --format=%B)
  [[ $msg == *"docs(plans): archive completed demo plan"* ]]
  [[ $msg == *"file-provenance match — the closed PR GitHub associates"* ]]
  [[ $msg == *"Plan-Verifier-FileProvenance: pr=#7 sha=$H40"* ]]
  [[ $msg != *"sha=$H40 via="* ]]
  [ ! -e "$TMPG/plan-complete.provenance" ]
}

@test "Phase 7: a via=commit-subject evidence line keeps its suffix in the trailer and the same body" {
  phase_repo
  printf 'pr=#42 sha=%s via=commit-subject\n' "$H40" >|"$TMPG/plan-complete.provenance"
  run_phase7
  [ "$status" -eq 0 ] || { echo "$output"; false; }
  msg=$(git log -1 --format=%B)
  [[ $msg == *"file-provenance match — the closed PR GitHub associates"* ]]
  [[ $msg == *"Plan-Verifier-FileProvenance: pr=#42 sha=$H40 via=commit-subject"* ]]
}

@test "Phase 7: a two-line, short-sha or forged-suffix evidence file refuses to commit and names the recovery" {
  phase_repo
  head=$(git rev-parse HEAD)
  for content in "pr=#7 sha=$H40
pr=#8 sha=$H40" "pr=#7 sha=0123abc" "pr=#7 sha=$H40 via=commit-subject extra" "pr=#7 sha=$H40 via=other" "pr=#0 sha=$H40"; do
    printf '%s\n' "$content" >|"$TMPG/plan-complete.provenance"
    run_phase7
    [ "$status" -ne 0 ] || { echo "committed with: $content"; false; }
    [[ $output == *"refusing to commit"* ]]
    [[ $output == *"recover:"*"plan-complete.provenance"*"git mv -- \"plans/complete/demo.md\" \"plans/demo.md\""* ]]
    [ "$(git rev-parse HEAD)" = "$head" ]
    git diff --cached --name-status | grep -q '^R.*plans/complete/demo.md'
  done
}

@test "Phase 4 block: an unsubstituted CLAUDE_PLUGIN_ROOT warns and falls through instead of aborting under set -u" {
  phase_repo
  blk=$(fenced_block 'pgp_tier_run "$CLEAN_ARG"')
  run env -u CLAUDE_PLUGIN_ROOT ARGUMENTS=demo.md bash -c "$blk"
  [ "$status" -eq 0 ] || { echo "$output"; false; }
  [[ $output == *"lib/plan-gate-provenance.sh missing or failed to load"* ]]
  [[ $output == *"GATE_C_PROVENANCE=FALLTHROUGH"* ]]
  [[ $output == *"GATE_C_REASON=lib-missing GATE_C_RETRYABLE=0"* ]]
}

@test "complete.md pins: retryable stop, override prompt keeps the commit-subject line, one Phase 4 clear" {
  COMPLETE="$BATS_TEST_DIRNAME/../commands/plan/complete.md"
  flat=$(tr '\n' ' ' <"$COMPLETE" | tr -s ' ')
  [[ $flat == *"**Retryable stop.** When the line is"*"GATE_C_RETRYABLE=1"*"Do not continue to the strict tier"* ]]
  [[ $flat == *"append that exact line too (it names the candidate PR and why it was not accepted)"* ]]
  # Phase 0 clears all four files; the tier function clears its own; Phase 4 does not repeat it.
  phase4=$(awk '/^## Phase 4/ {p=1} /^## Phase 5/ {p=0} p' "$COMPLETE")
  ! grep -q 'rm -f "\$GIT_TMP/plan-complete' <<<"$phase4"
  # The exact token Claude Code substitutes is kept, behind set +u.
  grep -qF 'PGP_LIB="${CLAUDE_PLUGIN_ROOT}/lib/plan-gate-provenance.sh"' "$COMPLETE"
}
