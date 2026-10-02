#!/usr/bin/env bats
# Parity check: every todo status in DEBT_TODO_NAME_RE (lib/validate.sh) must
# appear at each site that lists statuses, so a status added in one place and
# missed in another fails here instead of in a user's repository.
# See docs/solutions/code-quality/validator-invariant-parity-check.md.

bats_require_minimum_version 1.5.0

PLUGIN_ROOT="$BATS_TEST_DIRNAME/.."

setup() {
  . "$BATS_TEST_DIRNAME/../../yellow-core/lib/validate-fs.sh"
  . "$PLUGIN_ROOT/lib/validate.sh"
  STATUS_MD="$PLUGIN_ROOT/commands/debt/status.md"
  SKILL_MD="$PLUGIN_ROOT/skills/debt-conventions/SKILL.md"
  README_MD="$PLUGIN_ROOT/README.md"
  SYNTH_MD="$PLUGIN_ROOT/agents/synthesis/audit-synthesizer.md"
  SESSION_SH="$PLUGIN_ROOT/hooks/scripts/session-start.sh"
  misses=()
}

# Canonical statuses, one per line, taken from the status group of
# DEBT_TODO_NAME_RE.
canonical_statuses() {
  [[ "$DEBT_TODO_NAME_RE" =~ ^\^\[0-9\]\{1,6\}-\(([a-z|-]+)\)-\(critical ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]//|/$'\n'}"
}

# Sorted, de-duplicated statuses from a `a|b|c` or `a b c` list on stdin.
sorted_set() {
  tr '| ' '\n\n' | sed '/^$/d' | LC_ALL=C sort -u
}

# Record a miss unless FILE contains the literal NEEDLE.
need_literal() {
  run grep -qF -- "$2" "$1"
  [ "$status" -eq 0 ] || misses+=("$3")
}

# Record a miss unless STATUS appears as a whole token in the text on stdin.
# Call it with a here-string, not a pipe: a pipeline would run it in a subshell
# and lose the recorded miss.
need_token() {
  local text
  text=$(cat)
  run grep -Eq -- "(^|[^a-z_-])$1([^a-z_-]|\$)" <<<"$text"
  [ "$status" -eq 0 ] || misses+=("$2")
}

# status.md: init loop, valid case arm and JSON key for every status.
check_status_md() {
  local file="$1" st key canon init arm
  canon=$(canonical_statuses | LC_ALL=C sort -u)
  init=$(sed -n 's/^for status in \(.*\); do$/\1/p' "$file" | sorted_set)
  arm=$(sed -n 's/^ *\(pending|[a-z|-]*\))$/\1/p' "$file" | sorted_set)
  [ "$init" = "$canon" ] || misses+=("status.md init loop differs from DEBT_TODO_NAME_RE")
  [ "$arm" = "$canon" ] || misses+=("status.md valid case arm differs from DEBT_TODO_NAME_RE")
  for st in $(canonical_statuses); do
    key="${st//-/_}"
    need_literal "$file" "\"$key\": \${by_status[$st]}" "status.md JSON key for $st"
  done
}

@test "the canonical status list has at least seven entries including pending and wont-fix" {
  run canonical_statuses
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -ge 7 ]
  [[ " ${lines[*]} " == *" pending "* ]]
  [[ " ${lines[*]} " == *" wont-fix "* ]]
}

@test "status.md lists every status in its init loop, case arm and JSON" {
  check_status_md "$STATUS_MD"
  [ "${#misses[@]}" -eq 0 ] || { printf 'miss: %s\n' "${misses[@]}"; return 1; }
}

@test "SKILL.md, README, the synthesizer and validate_transition mention every status" {
  local st readme_block preserve transitions
  readme_block=$(awk '/^## State Machine/{f=1;next} /^## /{f=0} f' "$README_MD")
  preserve=$(awk '/Preserve all other states/{f=1} f{print} f&&/\)/{exit}' "$SYNTH_MD" | tr '\n' ' ')
  transitions=$(awk '/^validate_transition\(\)/{f=1} f{print} f&&/^}/{exit}' "$PLUGIN_ROOT/lib/validate.sh")
  [ -n "$readme_block" ] && [ -n "$preserve" ] && [ -n "$transitions" ]
  for st in $(canonical_statuses); do
    need_literal "$SKILL_MD" "- \`$st\` —" "SKILL.md bullet for $st"
    need_token "$st" "README State Machine token for $st" <<<"$readme_block"
    if [ "$st" != pending ]; then
      need_token "$st" "synthesizer preserve list for $st" <<<"$preserve"
    fi
    run grep -qE -- "(^|[ |])$st→|→$st([ |)]|\$)" <<<"$transitions"
    [ "$status" -eq 0 ] || misses+=("validate_transition pair for $st")
  done
  [ "${#misses[@]}" -eq 0 ] || { printf 'miss: %s\n' "${misses[@]}"; return 1; }
}

@test "the session-start hook counts exactly pending and ready" {
  local group
  group=$(sed -n 's/^.*\^\[0-9\]{1,6}-(\([a-z|-]*\))-(critical.*$/\1/p' "$SESSION_SH")
  [ "$group" = "pending|ready" ]
}

@test "control: a status.md with wont-fix stripped is reported as a miss" {
  sed 's/wont-fix//g; s/wont_fix//g' "$STATUS_MD" > "$BATS_TEST_TMPDIR/status-stripped.md"
  check_status_md "$BATS_TEST_TMPDIR/status-stripped.md"
  [ "${#misses[@]}" -ge 3 ]
}
