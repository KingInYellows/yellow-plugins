#!/usr/bin/env bats
# Tests for classify-risk

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/classify-risk"

POLICY='{"version":1,"default_tier":"medium","low_max_lines":10,"rules":[
  {"tier":"medium","why":"eval tooling","paths":["scripts/eval/*"]},
  {"tier":"high","why":"root scripts","paths":["scripts/*"]},
  {"tier":"high","why":"hooks","paths":["plugins/*/hooks/*"]},
  {"tier":"low","why":"docs","paths":["docs/*","*/README.md","README.md"]}]}'

setup() {
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  cd "$REPO"
  git init -q -b main
  git config user.email t@example.com
  git config user.name t
  git config commit.gpgsign false
  mkdir -p .github docs
  printf '%s\n' "$POLICY" >.github/review-risk.json
  printf 'x\n' >README.md
  git add -A
  git commit -qm base
  git checkout -qb feature
}

commit_file() {
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "${2:-change}" >"$1"
  git add -- "$1"
  git commit -qm "edit $1"
}

@test "usage errors exit 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" main
  [ "$status" -eq 2 ]
  run "$SCRIPT" --stdin
  [ "$status" -eq 2 ]
  run "$SCRIPT" -x main
  [ "$status" -eq 2 ]
  run "$SCRIPT" 'main;rm' feature
  [ "$status" -eq 2 ]
  run "$SCRIPT" main..x feature
  [ "$status" -eq 2 ]
}

@test "unknown ref exits 1" {
  run --separate-stderr "$SCRIPT" main nope
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"cannot resolve head ref"* ]]
}

@test "docs-only change is low" {
  commit_file docs/guide.md
  commit_file plugins/a/README.md
  run "$SCRIPT" main feature
  [ "$status" -eq 0 ]
  [ "$(jq -r .tier <<<"$output")" = low ]
  [ "$(jq -r .policy <<<"$output")" = base ]
  [ "$(jq -r .counts.low <<<"$output")" = 2 ]
  [ "$(jq -r .lines <<<"$output")" = 2 ]
}

@test "one high file makes the change high and is named in reasons" {
  commit_file docs/guide.md
  commit_file plugins/a/hooks/session.sh
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = high ]
  [ "$(jq -r '.reasons | map(.path) | join(",")' <<<"$output")" = plugins/a/hooks/session.sh ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = hooks ]
}

@test "first matching rule wins, so an earlier exception carves out of a broad rule" {
  commit_file scripts/eval/run.py
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = medium ]
  commit_file scripts/release.sh
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = high ]
}

@test "unmatched paths take default_tier" {
  commit_file plugins/a/commands/x.md
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = medium ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = default ]
}

@test "a low change over low_max_lines becomes medium with a size reason" {
  commit_file docs/big.md "$(seq 1 20)"
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = medium ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = size ]
}

@test "the policy is read from the base ref, so a PR cannot lower its own tier" {
  printf '{"version":1,"default_tier":"low","rules":[]}\n' >.github/review-risk.json
  git commit -qam "lower everything"
  commit_file plugins/a/hooks/session.sh
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = high ]
  [ "$(jq -r '[.reasons[].path] | index(".github/review-risk.json") != null' <<<"$output")" = true ]
  # The hooks file keeps the base policy's own rule, not the head default.
  [ "$(jq -r '.reasons[] | select(.path == "plugins/a/hooks/session.sh") | .rule' <<<"$output")" = hooks ]
}

@test "--policy-ref reads the policy from another ref, such as the default branch" {
  git checkout -qb parent
  printf '{"version":1,"default_tier":"low","rules":[]}\n' >.github/review-risk.json
  git commit -qam "parent weakens the policy"
  git checkout -qb child
  commit_file plugins/a/hooks/session.sh
  run "$SCRIPT" parent child
  [ "$(jq -r .tier <<<"$output")" = low ]
  run "$SCRIPT" --policy-ref main parent child
  [ "$(jq -r .policy <<<"$output")" = ref ]
  [ "$(jq -r .tier <<<"$output")" = high ]
  run "$SCRIPT" --policy-ref nope parent child
  [ "$status" -eq 1 ]
}

@test "REVIEW.md and the policy file are always high" {
  commit_file REVIEW.md
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = high ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = review-config ]
}

@test "no policy at the base ref falls back to medium" {
  git checkout -q main
  git rm -q .github/review-risk.json
  git commit -qm "drop policy"
  git checkout -qb nopolicy
  commit_file docs/guide.md
  run "$SCRIPT" main nopolicy
  [ "$(jq -r .policy <<<"$output")" = none ]
  [ "$(jq -r .tier <<<"$output")" = medium ]
}

@test "an invalid policy fails closed to high" {
  git checkout -q main
  printf '{"version":1,"rules":[{"tier":"low","why":"x","paths":["a b"]}]}\n' >.github/review-risk.json
  git commit -qam "bad glob"
  git checkout -qb badpolicy
  commit_file docs/guide.md
  run "$SCRIPT" main badpolicy
  [ "$status" -eq 0 ]
  [ "$(jq -r .policy <<<"$output")" = invalid ]
  [ "$(jq -r .tier <<<"$output")" = high ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = policy-invalid ]
}

@test "a policy of the wrong version is invalid" {
  : >"$BATS_TEST_TMPDIR/empty.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/empty.json" --stdin main <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = invalid ]
  printf '{"version":2,"rules":[]}\n' >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin main <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = invalid ]
}

@test "a path git quotes is high" {
  commit_file 'docs/we"ird.md'
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = high ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = unlisted-path ]
}

@test "--stdin classifies listed paths with unknown line counts" {
  run "$SCRIPT" --stdin main <<<$'docs/a.md\nREADME.md'
  [ "$status" -eq 0 ]
  [ "$(jq -r .tier <<<"$output")" = low ]
  [ "$(jq -r .lines <<<"$output")" = null ]
  [ "$(jq -r .files <<<"$output")" = 2 ]
}

@test "--policy-file overrides the base policy" {
  printf '{"version":1,"default_tier":"high","rules":[]}\n' >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin main <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = file ]
  [ "$(jq -r .tier <<<"$output")" = high ]
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/missing.json" --stdin main <<<"docs/a.md"
  [ "$status" -eq 2 ]
}

@test "reasons are capped at 50 and truncated says so" {
  for i in $(seq 1 55); do printf 'plugins/a/hooks/h%s.sh\n' "$i"; done >"$BATS_TEST_TMPDIR/list"
  run "$SCRIPT" --stdin main <"$BATS_TEST_TMPDIR/list"
  [ "$(jq -r '.reasons | length' <<<"$output")" = 50 ]
  [ "$(jq -r .truncated <<<"$output")" = true ]
  [ "$(jq -r .counts.high <<<"$output")" = 55 ]
}

@test "an empty diff takes default_tier" {
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = medium ]
  [ "$(jq -r .files <<<"$output")" = 0 ]
}

@test "a binary file does not switch off the size rule" {
  commit_file docs/big.md "$(seq 1 20)"
  printf '\000\001\002' >docs/img.png
  git add docs/img.png
  git commit -qm binary
  run "$SCRIPT" main feature
  [ "$(jq -r .tier <<<"$output")" = medium ]
  [ "$(jq -r .lines <<<"$output")" = 20 ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = size ]
}

@test "a fractional or huge low_max_lines makes the policy invalid" {
  printf '{"version":1,"low_max_lines":1.5,"rules":[]}\n' >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = invalid ]
  printf '{"version":1,"low_max_lines":1e30,"rules":[]}\n' >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = invalid ]
}

@test "--stdin without a base ref needs --policy-file" {
  run "$SCRIPT" --stdin <<<"docs/a.md"
  [ "$status" -eq 2 ]
  printf '%s\n' "$POLICY" >"$BATS_TEST_TMPDIR/p.json"
  cd "$BATS_TEST_TMPDIR"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin <<<"docs/a.md"
  [ "$status" -eq 0 ]
  [ "$(jq -r .tier <<<"$output")" = low ]
}

@test "a dot in a glob is literal and globs match the whole path" {
  printf '{"version":1,"default_tier":"medium","rules":[{"tier":"low","why":"x","paths":["a.md","dir/?.txt"]}]}\n' >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin <<<$'aXmd\nsub/a.md\ndir/b.txt\ndir/bb.txt'
  [ "$(jq -c '[.counts.low, .counts.medium]' <<<"$output")" = '[1,3]' ]
}

@test "two thousand paths classify quickly" {
  for i in $(seq 1 2000); do printf 'plugins/p%s/commands/c.md\n' "$i"; done >"$BATS_TEST_TMPDIR/list"
  SECONDS=0
  run "$SCRIPT" --stdin main <"$BATS_TEST_TMPDIR/list"
  [ "$status" -eq 0 ]
  [ "$(jq -r .files <<<"$output")" = 2000 ]
  [ "$SECONDS" -lt 10 ]
}

@test "--stdin --numstat applies the size rule from API line counts" {
  printf '%s\n' "$POLICY" >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin --numstat <<<$'15\t0\tdocs/a.md\n-\t-\tdocs/img.png'
  [ "$status" -eq 0 ]
  [ "$(jq -r .tier <<<"$output")" = medium ]
  [ "$(jq -r .lines <<<"$output")" = 15 ]
  [ "$(jq -r '[.reasons[].path] | join(",")' <<<"$output")" = "" ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = size ]
}

@test "--stdin --numstat: a path-only or malformed row makes the size unknown, not low" {
  printf '%s\n' "$POLICY" >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin --numstat <<<$'1\t0\tdocs/a.md\ndocs/no-tabs.md'
  [ "$status" -eq 0 ]
  [ "$(jq -r .tier <<<"$output")" = medium ]
  [ "$(jq -r .lines <<<"$output")" = null ]
  [ "$(jq -r '.reasons[0].rule' <<<"$output")" = size-unknown ]
  [ "$(jq -r .counts.low <<<"$output")" = 2 ]
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin --numstat <<<$'x\t0\tdocs/a.md'
  [ "$(jq -r .tier <<<"$output")" = medium ]
  [ "$(jq -r .lines <<<"$output")" = null ]
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin --numstat <<<$'-\t3\tdocs/a.md'
  [ "$(jq -r .tier <<<"$output")" = medium ]
  # Well-formed small rows, including a binary file, stay low.
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin --numstat <<<$'1\t1\tdocs/a.md\n-\t-\tdocs/img.png'
  [ "$(jq -r .tier <<<"$output")" = low ]
  [ "$(jq -r .lines <<<"$output")" = 2 ]
}

@test "a present false, null or unknown key makes the policy invalid" {
  for bad in '{"version":1,"default_tier":"low","low_max_lines":false,"rules":[]}' \
             '{"version":1,"default_tier":"low","low_max_lines":null,"rules":[]}' \
             '{"version":1,"default_tier":null,"rules":[]}' \
             '{"version":1,"default_tier":false,"rules":[]}' \
             '{"version":1,"rules":[],"extra":1}'; do
    printf '%s\n' "$bad" >"$BATS_TEST_TMPDIR/p.json"
    run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin <<<"docs/a.md"
    [ "$(jq -r .policy <<<"$output")" = invalid ]
    [ "$(jq -r .tier <<<"$output")" = high ]
  done
}

@test "several JSON documents in the policy make it invalid" {
  printf '{"version":1,"default_tier":"low","rules":[]}\n{"version":1,"default_tier":"high","rules":[]}\n' >"$BATS_TEST_TMPDIR/p.json"
  run "$SCRIPT" --policy-file "$BATS_TEST_TMPDIR/p.json" --stdin <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = invalid ]
  [ "$(jq -r .tier <<<"$output")" = high ]
}

@test "a policy path that is not a regular file is invalid, not absent" {
  git checkout -q main
  git rm -q .github/review-risk.json
  mkdir -p .github/review-risk.json
  printf '{}\n' >.github/review-risk.json/x
  git add -A
  git commit -qm "policy is a directory"
  run "$SCRIPT" --stdin main <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = invalid ]
  [ "$(jq -r .tier <<<"$output")" = high ]
  git checkout -q feature
  git checkout -qb linked
  git rm -q .github/review-risk.json
  mkdir -p .github
  ln -s ../README.md .github/review-risk.json
  git add -A
  git commit -qm "policy is a symlink"
  run "$SCRIPT" --stdin linked <<<"docs/a.md"
  [ "$(jq -r .policy <<<"$output")" = invalid ]
}

@test "--stdin with --policy-ref needs no base ref" {
  run "$SCRIPT" --policy-ref main --stdin <<<"docs/a.md"
  [ "$status" -eq 0 ]
  [ "$(jq -r .policy <<<"$output")" = ref ]
  [ "$(jq -r .tier <<<"$output")" = low ]
}

@test "diff.relative does not hide changes outside the current directory" {
  commit_file docs/guide.md
  commit_file plugins/a/hooks/session.sh
  git config diff.relative true
  cd docs
  run "$SCRIPT" main feature
  [ "$status" -eq 0 ]
  [ "$(jq -r .files <<<"$output")" = 2 ]
  [ "$(jq -r .tier <<<"$output")" = high ]
  [ "$(jq -r '.reasons[0].path' <<<"$output")" = plugins/a/hooks/session.sh ]
}
