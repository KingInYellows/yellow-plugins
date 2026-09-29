#!/usr/bin/env bats
# wrappers.bats — Tier 2/3: bash-only libraries are only ever run in a bash
# child. From a zsh parent with snapshot options (noclobber on), the wrapper
#   bash /dev/fd/3 3<<'TAG'
#   …
#   TAG
# must source each Tier 3 library, keep the caller's stdin, and pass the
# exit status through. The real /debt:triage block is run end to end.

bats_require_minimum_version 1.5.0
load helpers/shells

setup() {
  require_zsh
  profile_cmd zsh-snapshot
}

# Tier 3 library → a function it must define once sourced.
tier3_probe() {
  case "$1" in
    plugins/yellow-ci/hooks/scripts/lib/validate.sh) printf 'validate_ssh_host' ;;
    plugins/yellow-ci/hooks/scripts/lib/resolve-runner-targets.sh) printf 'resolve_runner_targets' ;;
    plugins/yellow-debt/lib/validate.sh) printf 'transition_todo_state' ;;
    plugins/yellow-ruvector/hooks/scripts/lib/resolve.sh) printf 'ruvector_hash_selected' ;;
    plugins/yellow-ruvector/lib/install-ruvector.sh) printf 'yellow_ruvector_validate_paths' ;;
    *) return 1 ;;
  esac
}

# Writes a zsh script that sources $1 (plus yellow-ci's validate.sh first
# for resolve-runner-targets.sh, which depends on it) inside the wrapper.
write_wrapper_script() {
  local lib="$1" fn="$2" pre=""
  case "$lib" in
    *resolve-runner-targets.sh) pre=". \"$REPO_ROOT/plugins/yellow-ci/hooks/scripts/lib/validate.sh\"" ;;
  esac
  cat > "$BATS_TEST_TMPDIR/wrapped.zsh" <<SCRIPT
bash /dev/fd/3 3<<'__TEST_BASH__'
$pre
. "$REPO_ROOT/$lib" || exit 90
type $fn >/dev/null 2>&1 || exit 91
printf 'sourced %s\n' "$fn"
__TEST_BASH__
SCRIPT
}

@test "every Tier 3 library has a probe function in this suite" {
  local lib missing=0
  while IFS= read -r lib; do
    tier3_probe "$lib" >/dev/null || { printf 'no probe for %s\n' "$lib" >&2; missing=1; }
  done < <(jq -r '.tier3Libraries[]' "$REPO_ROOT/scripts/shell-compat-config.json")
  [ "$missing" -eq 0 ]
}

@test "each Tier 3 library sources through the wrapper from a zsh noclobber parent" {
  local lib fn libs
  # Read the list first: a child reading stdin must not consume the loop's.
  mapfile -t libs < <(jq -r '.tier3Libraries[]' "$REPO_ROOT/scripts/shell-compat-config.json")
  [ "${#libs[@]}" -gt 0 ]
  for lib in "${libs[@]}"; do
    fn=$(tier3_probe "$lib")
    write_wrapper_script "$lib" "$fn"
    CLAUDE_PLUGIN_ROOT="$REPO_ROOT/$(printf '%s' "$lib" | cut -d/ -f1-2)" \
      run --separate-stderr "${PROFILE_CMD[@]}" "$BATS_TEST_TMPDIR/wrapped.zsh"
    if [ "$status" -ne 0 ] || [ "$output" != "sourced $fn" ]; then
      printf '%s: exit %s\nstdout: %s\nstderr: %s\n' "$lib" "$status" "$output" "$stderr" >&2
      return 1
    fi
  done
}

@test "the wrapper keeps the caller's stdin and passes the exit status through" {
  cat > "$BATS_TEST_TMPDIR/stdin.zsh" <<'SCRIPT'
bash /dev/fd/3 3<<'__TEST_BASH__'
printf 'read: %s\n' "$(cat)"
printf 'after\n'
exit 7
__TEST_BASH__
SCRIPT
  run --separate-stderr "${PROFILE_CMD[@]}" "$BATS_TEST_TMPDIR/stdin.zsh" <<< "caller-data"
  [ "$status" -eq 7 ]
  [ "${lines[0]}" = "read: caller-data" ]
  [ "${lines[1]}" = "after" ]
}

@test "control: bash <<'TAG' lets a stdin reader swallow the rest of the script (SHC-009)" {
  cat > "$BATS_TEST_TMPDIR/stdin-form.zsh" <<'SCRIPT'
bash <<'__TEST_BASH__'
cat >/dev/null
printf 'after\n'
__TEST_BASH__
SCRIPT
  run --separate-stderr "${PROFILE_CMD[@]}" "$BATS_TEST_TMPDIR/stdin-form.zsh"
  [ "$status" -eq 0 ]
  [[ "$output" != *after* ]]
}

@test "/debt:triage accept block transitions a todo when run under zsh" {
  yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk' || skip_or_fail "kislyuk yq not installed"
  local work block todo
  work="$BATS_TEST_TMPDIR/work"
  mkdir -p "$work/todos/debt"
  git -C "$work" init -q
  todo="$work/todos/debt/001-pending-high-complexity-long-fn-abc123.md"
  printf -- '---\nid: "001"\nstatus: pending\ncategory: complexity\nseverity: high\ntitle: Long function\n---\nBody.\n' > "$todo"
  # A repository-controlled name that would run if pasted into shell text;
  # the block takes only the numeric id, so it is never touched.
  : > "$work/todos/debt/001-pending-high-x\$(touch pwned)y.md"
  # The first wrapped block in triage.md is "On Accept".
  block="$BATS_TEST_TMPDIR/accept.zsh"
  awk '/^bash \/dev\/fd\/3 .<todo-id>. 3<<.__YELLOW_DEBT_BASH__.$/{f=1} f{print} f&&/^__YELLOW_DEBT_BASH__$/{exit}' \
    "$REPO_ROOT/plugins/yellow-debt/commands/debt/triage.md" \
    | sed "s#'<todo-id>'#'001'#" > "$block"
  grep -q 'transition_todo_state' "$block"
  cd "$work"
  CLAUDE_PLUGIN_ROOT="$REPO_ROOT/plugins/yellow-debt" run --separate-stderr "${PROFILE_CMD[@]}" "$block"
  [ "$status" -eq 0 ]
  [ -f "$work/todos/debt/001-ready-high-complexity-long-fn-abc123.md" ]
  [ ! -e "$todo.lock" ]
  [ -z "$(find "$work" -name pwned)" ]
}
