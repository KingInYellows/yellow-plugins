#!/usr/bin/env bats
# aliases.bats — Tier 1: shipped inline shell blocks survive hostile user aliases.
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
  # Newest-first is the reverse of name order, so dropping `-t` fails a test.
  : > "$PROJ/plans/b-new.md"
  : > "$PROJ/plans/a-old.md"
  touch -t 200001010000 "$PROJ/plans/a-old.md"
  # Claude Code shadows find (and grep) with shell functions, not aliases.
  ALIASES=$'alias ls=false ps=false du=false df=false\nfind() { false; }'
}

# The first line of $1 (repo-relative) containing the fixed string $2, with
# leading blanks stripped. Fails the test when the shipped text moved.
shipped_line() {
  local line
  line=$(grep -F -m1 -- "$2" "$REPO_ROOT/$1" | sed 's/^[[:space:]]*//')
  [ -n "$line" ] || { printf 'no line with %s in %s\n' "$2" "$1" >&2; return 1; }
  printf '%s' "$line"
}

# Every line of $1 (repo-relative) containing the fixed string $2, blanks
# stripped, one per line. Fails the test when none is left.
shipped_lines() {
  local lines
  lines=$(grep -F -- "$2" "$REPO_ROOT/$1" | sed 's/^[[:space:]]*//')
  [ -n "$lines" ] || { printf 'no line with %s in %s\n' "$2" "$1" >&2; return 1; }
  printf '%s\n' "$lines"
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
    [ "$output" = $'plans/b-new.md\nplans/a-old.md' ]
    run_profile "$profile" aliased "ls -t plans/*.md 2>/dev/null | head -5"
    [ -z "$output" ]
  done
}

@test "control: the find shadow in the alias prelude takes effect in every profile" {
  local profile
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" plain "find plans -name '*.md'"
    [ "$status" -eq 0 ]
    [ -n "$output" ]
    run_profile "$profile" aliased "find plans -name '*.md'"
    [ "$status" -ne 0 ]
    [ -z "$output" ]
  done
}

@test "flow work and review list plans newest first under aliases" {
  local profile line work_line review_line
  work_line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 \( -type f -o -type l \) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -5")
  review_line=$(shipped_line plugins/yellow-core/commands/flow/review.md "command find -H plans -maxdepth 1 \( -type f -o -type l \) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -3")
  for line in "$work_line" "$review_line"; do
    for profile in "${PROFILES[@]}"; do
      run_profile "$profile" aliased "$line"
      [ "$status" -eq 0 ]
      [ "$output" = $'plans/b-new.md\nplans/a-old.md' ]
    done
  done
}

@test "the plan listing is silent with no plans: no output, exit 0, no nomatch error" {
  local profile line
  line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 \( -type f -o -type l \) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -5")
  rm -f "$PROJ"/plans/*.md
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
    [ -z "$stderr" ]
  done
}

@test "control: the old glob leaks a nomatch error under zsh and the shipped line does not" {
  local line profile
  line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 \\( -type f -o -type l \\) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -5")
  rm -f "$PROJ"/plans/*.md
  for profile in zsh zsh-snapshot; do
    run_profile "$profile" plain 'ls -t plans/*.md 2>/dev/null | head -5'
    [[ "$stderr" == *"no matches found"* ]]
    run_profile "$profile" plain "$line"
    [ -z "$stderr" ]
  done
}

@test "dotfile plans are not listed, matching the old glob" {
  local line profile
  line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 \\( -type f -o -type l \\) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -5")
  : > "$PROJ/plans/.hidden.md"
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$output" = $'plans/b-new.md\nplans/a-old.md' ]
  done
}

@test "a symlinked plans/ directory is still listed" {
  local profile line
  line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 \( -type f -o -type l \) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -5")
  mv "$PROJ/plans" "$PROJ/real-plans"
  ln -s real-plans "$PROJ/plans"
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$status" -eq 0 ]
    [ "$output" = $'plans/b-new.md\nplans/a-old.md' ]
  done
}

@test "a symlinked plan file is still listed" {
  local profile line
  line=$(shipped_line plugins/yellow-core/commands/flow/work.md "command find -H plans -maxdepth 1 \\( -type f -o -type l \\) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -5")
  mkdir -p "$PROJ/elsewhere" "$PROJ/plans/dir.md"
  : > "$PROJ/elsewhere/linked.md"
  ln -s ../elsewhere/linked.md "$PROJ/plans/linked.md"
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$status" -eq 0 ]
    [[ "$output" == *plans/linked.md* ]]
    [[ "$output" != *dir.md* ]]
  done
}

@test "flow decompose collision check lists every directory under aliases" {
  local profile line
  mkdir -p "$PROJ/plans/complete"
  : > "$PROJ/plans/shells/s1.md"
  line=$(awk '/^for d in plans plans\/complete plans\/shells; do$/ {p=1} p {print} /^done$/ && p {exit}' "$REPO_ROOT/plugins/yellow-core/commands/flow/decompose.md")
  [ -n "$line" ]
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$status" -eq 0 ]
    [ "$output" = $'plans/b-new.md\nplans/a-old.md\nplans/shells/s1.md' ] || [ "$output" = $'plans/a-old.md\nplans/b-new.md\nplans/shells/s1.md' ]
    [ -z "$stderr" ]
  done
}

@test "flow decompose collision check tolerates a missing plans/complete" {
  local profile line
  : > "$PROJ/plans/shells/s1.md"
  line=$(awk '/^for d in plans plans\/complete plans\/shells; do$/ {p=1} p {print} /^done$/ && p {exit}' "$REPO_ROOT/plugins/yellow-core/commands/flow/decompose.md")
  [ -n "$line" ]
  for profile in "${PROFILES[@]}"; do
    run_profile "$profile" aliased "$line"
    [ "$status" -eq 0 ]
    [ "$output" = $'plans/b-new.md\nplans/a-old.md\nplans/shells/s1.md' ] || [ "$output" = $'plans/a-old.md\nplans/b-new.md\nplans/shells/s1.md' ]
    [ -z "$stderr" ]
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
      # `ps -o comm=` names the running shell: bash, or zsh for both zsh profiles.
      [ "$output" = "${profile%%-*}" ]
    done
  done
}

@test "agent cache-dir permission check keeps a private directory and drops an open one under aliases" {
  local profile line file
  mkdir -m 700 "$PROJ/private"
  mkdir -m 755 "$PROJ/open"
  for file in plugins/yellow-debt/agents/scanners/duplication-scanner.md plugins/yellow-debt/agents/scanners/complexity-scanner.md plugins/yellow-research/agents/research/code-researcher.md; do
    while IFS= read -r line; do
      for profile in "${PROFILES[@]}"; do
        run_profile "$profile" aliased 'b="$PWD/private"'$'\n'"$line"$'\nprintf "%s\\n" "$b"'
        [ "$status" -eq 0 ]
        [ "$output" = "$PROJ/private" ]
        run_profile "$profile" aliased 'b="$PWD/open"'$'\n'"$line"$'\nprintf "[%s]\\n" "$b"'
        [ "$status" -eq 0 ]
        [ "$output" = "[]" ]
      done
    done < <(shipped_lines "$file" 'case "$(command ls -ld -- "$b")" in')
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
