#!/usr/bin/env bats
# aliases.bats — Tier 2: shipped shell blocks survive hostile user aliases.
# Claude Code replays the user's alias snapshot in every Bash call, so
# `alias ls=eza` (stood in for here by `false`) breaks any block that parses
# `ls` output, and zsh's `nomatch` aborts `ls plans/*.md 2>/dev/null` before
# its redirect applies. Each case extracts the hardened line from the shipped
# markdown with a fixed grep (so the test exercises the shipped text, not a
# copy) and runs it under every profile with the aliases defined.

bats_require_minimum_version 1.5.0
load helpers/shells

setup() {
  require_zsh
  PROJ="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$PROJ/plans/shells"
  : > "$PROJ/plans/new.md"
  : > "$PROJ/plans/old.md"
  touch -d '-1 hour' "$PROJ/plans/old.md"
  ALIASES='alias ls=false ps=false du=false df=false find=false'
}

# The first line of $1 (repo-relative) containing the fixed string $2, with
# leading blanks stripped. Fails the test when the shipped text moved.
shipped_line() {
  local line
  line=$(grep -F -m1 -- "$2" "$REPO_ROOT/$1" | sed 's/^[[:space:]]*//')
  [ -n "$line" ] || { printf 'no line with %s in %s\n' "$2" "$1" >&2; return 1; }
  printf '%s' "$line"
}

# Runs $3 under profile $1 inside the fixture dir. $2 is "aliased" or "plain".
# Bash expands aliases in scripts only with expand_aliases.
run_profile() {
  local profile="$1" mode="$2" body="$3" script="$BATS_TEST_TMPDIR/case.sh"
  profile_cmd "$profile"
  {
    if [ "$mode" = aliased ]; then
      [ "$profile" = bash ] && printf 'shopt -s expand_aliases\n'
      printf '%s\n' "$ALIASES"
    fi
    printf '%s\n' "$body"
  } > "$script"
  cd "$PROJ"
  run --separate-stderr "${PROFILE_CMD[@]}" "$script"
}

@test "control: the old unguarded listing breaks under the alias prelude" {
  local profile
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" plain "ls -t plans/*.md 2>/dev/null | head -5"
    [ "$status" -eq 0 ]
    [ "$output" = $'plans/new.md\nplans/old.md' ]
    run_profile "$profile" aliased "ls -t plans/*.md 2>/dev/null | head -5"
    [ -z "$output" ]
  done
}

@test "flow work and review list plans newest first under aliases" {
  local profile line work_line review_line
  work_line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -5")
  review_line=$(shipped_line plugins/yellow-core/commands/flow/review.md "command find -H plans -maxdepth 1 -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -3")
  for line in "$work_line" "$review_line"; do
    for profile in "${PROFILES[@]}"; do
      run_profile "$profile" aliased "$line"
      [ "$status" -eq 0 ]
      [ "$output" = $'plans/new.md\nplans/old.md' ]
    done
  done
}

@test "the plan listing is silent with no plans: no output, exit 0, no nomatch error" {
  local profile line
  line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -5")
  rm -f "$PROJ"/plans/*.md
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
    [ -z "$stderr" ]
  done
}

@test "a symlinked plans/ directory is still listed" {
  local profile line
  line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -5")
  mv "$PROJ/plans" "$PROJ/real-plans"
  ln -s real-plans "$PROJ/plans"
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$status" -eq 0 ]
    [ "$output" = $'plans/new.md\nplans/old.md' ]
  done
}

@test "flow decompose captures the spec list under aliases" {
  local profile line
  line=$(shipped_line plugins/yellow-core/commands/flow/decompose.md 'SPEC_LIST=$(command find -H plans/specs')
  mkdir -p "$PROJ/plans/specs"
  : > "$PROJ/plans/specs/a.md"
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"$'\nprintf "%s\\n" "$SPEC_LIST"'
    [ "$status" -eq 0 ]
    [ "$output" = "plans/specs/a.md" ]
  done
  rm -f "$PROJ/plans/specs/a.md"
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"$'\nprintf "[%s]\\n" "$SPEC_LIST"'
    [ "$output" = "[]" ]
    [ -z "$stderr" ]
  done
}

# The shipped existence checks are `if [ -z "$(…)" ]; then`: the then branch
# is the empty case. Close them with both branches.
branch_probe() {
  printf '%s\n  printf empty\nelse\n  printf nonempty\nfi\n' "$1"
}

@test "plan-status and pick-next-shell existence checks take the right branch" {
  local profile status_if shell_if
  status_if=$(shipped_line plugins/yellow-core/skills/plan-status/SKILL.md 'if [ -z "$(command find -H plans -maxdepth 1')
  shell_if=$(shipped_line plugins/yellow-core/commands/flow/pick-next-shell.md 'if [ -z "$(command find -H plans/shells -maxdepth 1')
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$(branch_probe "$status_if")"
    [ "$output" = "nonempty" ]
    run_profile "$profile" aliased "$(branch_probe "$shell_if")"
    [ "$output" = "empty" ]
  done
  : > "$PROJ/plans/shells/s1.md"
  rm -f "$PROJ"/plans/*.md
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$(branch_probe "$status_if")"
    [ "$output" = "empty" ]
    [ -z "$stderr" ]
    run_profile "$profile" aliased "$(branch_probe "$shell_if")"
    [ "$output" = "nonempty" ]
  done
}

@test "browser-test process check finds the command name under aliases" {
  local profile line file
  for file in explore test; do
    line=$(shipped_line "plugins/yellow-browser-test/commands/browser-test/$file.md" 'PROC_CMD=$(command ps -p')
    for profile in "${PROFILES[@]}"; do
      run_profile "$profile" aliased 'PID=$$'$'\n'"$line"$'\nprintf "%s\\n" "$PROC_CMD"'
      [ "$status" -eq 0 ]
      [ -n "$output" ]
    done
  done
}

@test "codex status lists recent sessions under aliases" {
  local profile line
  line=$(shipped_line plugins/yellow-codex/commands/codex/status.md 'command ls -lt "$CODEX_SESSIONS"')
  mkdir -p "$PROJ/sessions"
  : > "$PROJ/sessions/s1"
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased 'CODEX_SESSIONS="$PWD/sessions"'$'\n'"$line"
    [ "$status" -eq 0 ]
    [[ "$output" == *s1* ]]
  done
}
