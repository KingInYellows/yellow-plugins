#!/usr/bin/env bats
# Tests for pr-base-remote: which remote (or URL) reaches a PR's base
# repository, so a fork checkout's risk-tier fetches skip the fork's origin.

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/pr-base-remote"
PR=https://github.com/KingInYellows/yellow-plugins/pull/12

setup() {
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  REPO="$BATS_TEST_TMPDIR/repo"
  git init -q "$REPO"
  cd "$REPO"
}

@test "no remotes: falls back to the base repository's https URL" {
  run "$SCRIPT" "$PR"
  [ "$status" -eq 0 ]
  [ "$output" = "https://github.com/KingInYellows/yellow-plugins.git" ]
}

@test "same-repo checkout: origin" {
  git remote add origin git@github.com:KingInYellows/yellow-plugins.git
  git remote add upstream https://github.com/KingInYellows/yellow-plugins
  run "$SCRIPT" "$PR"
  [ "$status" -eq 0 ]
  [ "$output" = origin ]
}

@test "fork checkout: the remote naming the base repository, not origin" {
  git remote add origin git@github.com:someone/yellow-plugins.git
  git remote add upstream https://github.com/kinginyellows/Yellow-Plugins.git/
  run "$SCRIPT" "$PR"
  [ "$status" -eq 0 ]
  [ "$output" = upstream ]
}

@test "fork checkout with no base remote: the https URL, never origin" {
  git remote add origin git@github.com:someone/yellow-plugins.git
  run "$SCRIPT" "$PR"
  [ "$status" -eq 0 ]
  [ "$output" = "https://github.com/KingInYellows/yellow-plugins.git" ]
}

@test "matches ssh:// URLs with a user and port" {
  git remote add origin git@github.com:someone/yellow-plugins.git
  git remote add base ssh://git@github.com:22/KingInYellows/yellow-plugins.git
  run "$SCRIPT" "$PR"
  [ "$output" = base ]
}

@test "a different host or a longer path does not match" {
  git remote add a git@gitlab.com:KingInYellows/yellow-plugins.git
  git remote add b https://github.com/KingInYellows/yellow-plugins/extra
  git remote add c https://github.com/KingInYellows/yellow-plugins-fork
  run "$SCRIPT" "$PR"
  [ "$output" = "https://github.com/KingInYellows/yellow-plugins.git" ]
}

@test "rejects a URL that is not a pull request URL" {
  for u in "" http://github.com/a/b/pull/1 https://github.com/a/b \
    'https://github.com/a/b/pull/1;rm' https://github.com/a/b/c/pull/1 \
    "$(printf 'https://github.com/a/b/pull/1\nx')"; do
    run "$SCRIPT" "$u"
    [ "$status" -eq 2 ]
    [ -z "$output" ] || [[ "$output" == Usage:* ]]
  done
  run "$SCRIPT"
  [ "$status" -eq 2 ]
}

@test "outside a git repository: exit 2" {
  cd "$BATS_TEST_TMPDIR"
  GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR" run "$SCRIPT" "$PR"
  [ "$status" -eq 2 ]
}
