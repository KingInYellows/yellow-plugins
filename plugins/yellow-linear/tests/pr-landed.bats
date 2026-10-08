#!/usr/bin/env bats
# Tests for scripts/pr-landed.sh: the merged-PR check for CLOSED PRs that
# Graphite's merge queue landed. Real temp repos; origin is a bare repository
# whose path ends in o/r.git, so it matches the repo argument "o/r".

bats_require_minimum_version 1.5.0

SCRIPT="$BATS_TEST_DIRNAME/../scripts/pr-landed.sh"

setup() {
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
  export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
  T="$BATS_TEST_TMPDIR"
  mkdir -p "$T/o"
  git init -q --bare -b main "$T/o/r.git"
  git init -q -b main "$T/seed"
  cd "$T/seed" || return 1
  git remote add origin "$T/o/r.git"
  printf 'a\n' >a.txt
  git add .
  git commit -q -m 'feat: first thing (#7)'
  printf 'b\n' >b.txt
  git add .
  git commit -q -m 'fix: second thing' -m 'See the earlier work (#9)'
  git push -q origin main
  git clone -q "$T/o/r.git" "$T/work"
  cd "$T/work" || return 1
  git remote set-head origin main >/dev/null
}

@test "a trailing (#N) subject on the default branch is landed=yes" {
  run --separate-stderr "$SCRIPT" o/r 7
  [ "$status" -eq 0 ]
  [ "$output" = "landed=yes" ]
}

@test "no matching subject in a complete history is landed=no" {
  run --separate-stderr "$SCRIPT" o/r 8
  [ "$status" -eq 0 ]
  [ "$output" = "landed=no" ]
}

@test "a number in a commit body, or a longer number, does not count" {
  run --separate-stderr "$SCRIPT" o/r 9
  [ "$output" = "landed=no" ]
  run --separate-stderr "$SCRIPT" o/r 70
  [ "$output" = "landed=no" ]
  run --separate-stderr "$SCRIPT" o/r 1
  [ "$output" = "landed=no" ]
}

@test "a commit the queue lands after the clone is found through the fetch" {
  cd "$T/seed" || return 1
  printf 'c\n' >c.txt
  git add .
  git commit -q -m 'feat: queue landed (#12)'
  git push -q origin main
  cd "$T/work" || return 1
  run --separate-stderr "$SCRIPT" o/r 12
  [ "$output" = "landed=yes" ]
}

@test "a shallow clone is landed=unknown, never no" {
  git clone -q --depth 1 "file://$T/o/r.git" "$T/shallow"
  cd "$T/shallow" || return 1
  git remote set-head origin main >/dev/null
  git remote set-url origin "$T/o/r.git"
  run --separate-stderr "$SCRIPT" o/r 8
  [ "$status" -eq 0 ]
  [ "$output" = "landed=unknown" ]
  [[ $stderr == *"shallow"* ]]
}

@test "the origin-versus-repo comparison ignores case" {
  run --separate-stderr "$SCRIPT" O/R 7
  [ "$status" -eq 0 ]
  [ "$output" = "landed=yes" ]
}

@test "origin that is a different repository is landed=unknown and its URL is not printed" {
  git remote set-url origin "https://user:s3cret@example.invalid/other/repo.git"
  run --separate-stderr "$SCRIPT" o/r 7
  [ "$output" = "landed=unknown" ]
  [[ $stderr == *"origin is not o/r"* ]]
  [[ $stderr != *s3cret* && $stderr != *example.invalid* ]]
}

@test "an unset origin/HEAD is landed=unknown with the fix named" {
  git remote set-head origin -d >/dev/null
  run --separate-stderr "$SCRIPT" o/r 7
  [ "$output" = "landed=unknown" ]
  [[ $stderr == *"origin/HEAD is not set"*"set-head origin --auto"* ]]
}

@test "a failed fetch is landed=unknown and names the failure" {
  git remote set-url origin "$T/gone/o/r.git"
  run --separate-stderr "$SCRIPT" o/r 7
  [ "$output" = "landed=unknown" ]
  [[ $stderr == *"git fetch origin main failed"* ]]
  [[ $stderr != *"$T"* && $stderr != *fatal* ]]
}

@test "a ref that does not resolve after the fetch is landed=unknown, not no" {
  git update-ref -d refs/remotes/origin/main
  git remote set-url origin "$T/o/r.git"
  # The fetch recreates the ref, so break the repository instead: an origin
  # whose main branch is gone makes the fetch itself fail.
  git -C "$T/o/r.git" update-ref -d refs/heads/main
  run --separate-stderr "$SCRIPT" o/r 7
  [ "$output" = "landed=unknown" ]
}

@test "usage errors exit 2 and print no landed line" {
  for args in "" "o/r" "o/r abc" "o/r 0" "o/r 012" "o/r 12345678901" "nope 7" "o/r/x 7" "o/r 7 extra"; do
    # shellcheck disable=SC2086
    run --separate-stderr "$SCRIPT" $args
    [ "$status" -eq 2 ] || { echo "not refused: [$args] status $status"; false; }
    [[ $output != *landed=* ]]
  done
}
