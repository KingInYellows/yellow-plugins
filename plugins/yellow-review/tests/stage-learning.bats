#!/usr/bin/env bats
# Tests for lib/stage-learning.sh, the wrapper /review:pr Step 9a uses to
# stage an unattended review's learnings for yellow-core's compound-staging
# drain. Every case runs in a throwaway repository under $BATS_TEST_TMPDIR
# with its own HOME and TMPDIR.

bats_require_minimum_version 1.5.0

YS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/lib/stage-learning.sh"
CORE_LIB="$(cd "$BATS_TEST_DIRNAME/../../yellow-core/lib" && pwd)/compound-staging.sh"

setup() {
  export HOME="$BATS_TEST_TMPDIR/home"
  export TMPDIR="$BATS_TEST_TMPDIR/tmp"
  mkdir -p "$HOME" "$TMPDIR" "$BATS_TEST_TMPDIR/bin"
  # gh stub: prints MOCK_GH_REPO for `gh repo view`, fails when it is unset.
  cat >"$BATS_TEST_TMPDIR/bin/gh" <<'__GH__'
#!/bin/bash
[ -n "${MOCK_GH_REPO:-}" ] || exit 1
printf '%s\n' "$MOCK_GH_REPO"
__GH__
  chmod +x "$BATS_TEST_TMPDIR/bin/gh"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  export MOCK_GH_REPO="acme/widgets"
  export YS_CORE_LIB="$CORE_LIB"
  MAIN="$BATS_TEST_TMPDIR/main"
  git init -q -b main "$MAIN"
  git -C "$MAIN" config user.email test@test.com
  git -C "$MAIN" config user.name Test
  git -C "$MAIN" config commit.gpgsign false
  git -C "$MAIN" commit -q --allow-empty -m base
  cd "$MAIN" || return 1
}

# A narrative at a path minted by `tmpfile`.
narrative() {
  local p
  p=$("$YS" tmpfile)
  printf '%s\n' "${1:-Finding 1 [P1, unresolved (open)]: title. File: a.sh.}" >|"$p"
  printf '%s' "$p"
}

staged() {
  find "$HOME/.claude/projects" -name "${1}.jsonl" -path '*/pending/*' -print 2>/dev/null
}

slug_of() {
  printf '%s' "$1" | tr '/' '-'
}

@test "tmpfile creates a private empty file under TMPDIR" {
  run "$YS" tmpfile
  [ "$status" -eq 0 ]
  [ -f "$output" ]
  [ ! -s "$output" ]
  [ "$(stat -c %a "$output" 2>/dev/null || stat -f %Lp "$output")" = 600 ]
  [ "$(dirname "$output")" = "$(cd "$TMPDIR" && pwd -P)" ]
  case "$(basename "$output")" in yr-stage.*) ;; *) false ;; esac
}

@test "stage writes review-pr-<owner>-<repo>-<pr> and deletes the narrative" {
  p=$(narrative)
  run "$YS" stage 42 "$p"
  [ "$status" -eq 0 ]
  [ "$output" = "[review:pr] Staged learnings for PR #42; eligible to drain at a later session in $MAIN (count/age thresholds apply)." ]
  [ ! -e "$p" ]
  f=$(staged review-pr-acme-widgets-42)
  [ -n "$f" ]
  jq -e '.transcript_tail | startswith("Finding 1 [P1")' "$f"
}

@test "stage from a linked worktree lands under the main checkout's slug" {
  git worktree add -q "$BATS_TEST_TMPDIR/wt" -b feature
  cd "$BATS_TEST_TMPDIR/wt"
  p=$(narrative)
  run "$YS" stage 7 "$p"
  [ "$status" -eq 0 ]
  f=$(staged review-pr-acme-widgets-7)
  [[ "$f" == *"/$(slug_of "$(cd "$MAIN" && pwd -P)")/compound-staging/pending/"* ]] || false
  jq -e --arg m "$(cd "$MAIN" && pwd -P)" '.cwd == $m' "$f"
}

@test "stage falls back to the current toplevel for a bare main entry" {
  git clone -q --bare "$MAIN" "$BATS_TEST_TMPDIR/bare.git"
  git -C "$BATS_TEST_TMPDIR/bare.git" worktree add -q "$BATS_TEST_TMPDIR/wt2" main 2>/dev/null \
    || git -C "$BATS_TEST_TMPDIR/bare.git" worktree add -q "$BATS_TEST_TMPDIR/wt2"
  cd "$BATS_TEST_TMPDIR/wt2"
  p=$(narrative)
  run "$YS" stage 8 "$p"
  [ "$status" -eq 0 ]
  f=$(staged review-pr-acme-widgets-8)
  jq -e --arg t "$(cd "$BATS_TEST_TMPDIR/wt2" && pwd -P)" '.cwd == $t' "$f"
}

@test "repo key falls back to the origin URL, then to unknown-repo" {
  unset MOCK_GH_REPO
  git remote add origin git@github.com:octo/thing.git
  p=$(narrative)
  "$YS" stage 3 "$p"
  [ -n "$(staged review-pr-octo-thing-3)" ]
  git remote remove origin
  p=$(narrative)
  "$YS" stage 4 "$p"
  [ -n "$(staged review-pr-unknown-repo-4)" ]
}

@test "a repeat stage of the same PR overwrites the entry" {
  p=$(narrative 'first')
  "$YS" stage 5 "$p"
  p=$(narrative 'second')
  "$YS" stage 5 "$p"
  [ "$(find "$HOME/.claude/projects" -name '*.jsonl' | wc -l | tr -d ' ')" = "1" ]
  [ "$(jq -r .transcript_tail "$(staged review-pr-acme-widgets-5)")" = "second" ]
}

@test "an invalid PR number warns, exits 0 and still deletes the narrative" {
  for bad in 0 -1 01 abc '12 ' 12345678901; do
    p=$(narrative)
    run "$YS" stage "$bad" "$p"
    [ "$status" -eq 0 ]
    [ "$output" = "[review:pr] Warning: learning staging skipped (invalid input)" ]
    [ ! -e "$p" ]
  done
  [ -z "$(find "$HOME" -name '*.jsonl' -print)" ]
}

@test "a narrative path outside TMPDIR is refused and never deleted" {
  outside="$BATS_TEST_TMPDIR/keep.txt"
  printf 'x\n' >|"$outside"
  run "$YS" stage 9 "$outside"
  [ "$status" -eq 0 ]
  [ "$output" = "[review:pr] Warning: learning staging skipped (invalid input)" ]
  [ -f "$outside" ]
  misnamed="$TMPDIR/other.txt"
  printf 'x\n' >|"$misnamed"
  run "$YS" stage 9 "$misnamed"
  [ "$output" = "[review:pr] Warning: learning staging skipped (invalid input)" ]
  [ -f "$misnamed" ]
}

@test "a yr-stage.* file outside TMPDIR is refused and never deleted" {
  outside="$BATS_TEST_TMPDIR/yr-stage.abc"
  printf 'x\n' >|"$outside"
  run "$YS" stage 9 "$outside"
  [ "$output" = "[review:pr] Warning: learning staging skipped (invalid input)" ]
  [ -f "$outside" ]
}

@test "a symlinked narrative is refused and left alone" {
  target="$BATS_TEST_TMPDIR/target.txt"
  printf 'x\n' >|"$target"
  link="$TMPDIR/yr-stage.link"
  ln -s "$target" "$link"
  run "$YS" stage 9 "$link"
  [ "$output" = "[review:pr] Warning: learning staging skipped (invalid input)" ]
  [ -L "$link" ]
  [ -f "$target" ]
}

@test "a missing yellow-core warns once and exits 0" {
  export YS_CORE_LIB="$BATS_TEST_TMPDIR/missing/compound-staging.sh"
  p=$(narrative)
  run "$YS" stage 11 "$p"
  [ "$status" -eq 0 ]
  [ "$output" = "[review:pr] Warning: learning staging skipped (yellow-core not found or too old)" ]
  [ ! -e "$p" ]
}

@test "a yellow-core without cs_stage_entry counts as too old" {
  old="$BATS_TEST_TMPDIR/old/compound-staging.sh"
  mkdir -p "$(dirname "$old")"
  printf 'cs_redact_secrets() { cat; }\n' >|"$old"
  export YS_CORE_LIB="$old"
  p=$(narrative)
  run "$YS" stage 11 "$p"
  [ "$output" = "[review:pr] Warning: learning staging skipped (yellow-core not found or too old)" ]
}

@test "missing jq warns and exits 0" {
  p=$(narrative)
  stripped="$BATS_TEST_TMPDIR/nojq"
  mkdir -p "$stripped"
  for t in bash git gh tr sed head cat wc printf dirname basename sort tail grep mktemp rm date cut sha256sum shasum; do
    src=$(PATH="$BATS_TEST_TMPDIR/bin:/usr/bin:/bin:/usr/local/bin" command -v "$t" 2>/dev/null) && ln -sf "$src" "$stripped/$t"
  done
  PATH="$stripped" run "$YS" stage 12 "$p"
  [ "$status" -eq 0 ]
  [ "$output" = "[review:pr] Warning: learning staging skipped (jq missing)" ]
}

@test "an unwritable staging dir warns write failed and exits 0" {
  mkdir -p "$HOME/.claude/projects/$(slug_of "$(cd "$MAIN" && pwd -P)")/compound-staging"
  : >|"$HOME/.claude/projects/$(slug_of "$(cd "$MAIN" && pwd -P)")/compound-staging/pending"
  p=$(narrative)
  run "$YS" stage 13 "$p"
  [ "$status" -eq 0 ]
  [ "$output" = "[review:pr] Warning: learning staging skipped (write failed)" ]
  [ ! -e "$p" ]
}

@test "the core lib resolves in the installed cache layout, newest version first" {
  source "$YS"
  cache="$BATS_TEST_TMPDIR/cache/mkt"
  mkdir -p "$cache/yellow-review/3.5.0" "$cache/yellow-core/2.4.0/lib" "$cache/yellow-core/2.10.1/lib"
  : >|"$cache/yellow-core/2.4.0/lib/compound-staging.sh"
  : >|"$cache/yellow-core/2.10.1/lib/compound-staging.sh"
  unset YS_CORE_LIB
  CLAUDE_PLUGIN_ROOT="$cache/yellow-review/3.5.0" run ys_core_lib_path
  [ "$output" = "$cache/yellow-review/3.5.0/../../yellow-core/2.10.1/lib/compound-staging.sh" ]
}

@test "the core lib resolves as a repository sibling" {
  source "$YS"
  unset YS_CORE_LIB CLAUDE_PLUGIN_ROOT
  run ys_core_lib_path
  [ -f "$output" ]
  [ "$(cd "$(dirname "$output")" && pwd -P)" = "$(dirname "$CORE_LIB")" ]
}

@test "a set-but-missing YS_CORE_LIB does not fall back" {
  source "$YS"
  export YS_CORE_LIB="$BATS_TEST_TMPDIR/missing.sh"
  run ys_core_lib_path
  [ -z "$output" ]
}

@test "the narrative is never echoed" {
  p=$(narrative 'NARRATIVE-CANARY body text')
  run "$YS" stage 14 "$p"
  [[ "$output" != *NARRATIVE-CANARY* ]] || false
}

@test "an unknown subcommand prints usage and exits 2" {
  run -2 "$YS" bogus
  [[ "$output" == usage:* ]] || false
}
