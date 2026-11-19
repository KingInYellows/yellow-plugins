#!/usr/bin/env bats
# Parity gate for the Node SessionStart runtime (hooks/scripts/entrypoint-*.js)
# against the pre-port bash session-start.sh. Each golden in fixtures/hooks/ was
# captured by running the ORIGINAL bash hook (deleted once this gate is green)
# under a named environment scenario (tests/lib/hook-scenario.bash). Unlike
# gt-workflow's pure envelope->decision hooks, yellow-ci's SessionStart is
# I/O-driven, so a "fixture" is an environment scenario (cwd, routing cache, gh
# mock, result cache), not just a stdin payload — the .stdin envelope is
# constant and (as in the bash hook) not consumed by the SessionStart logic.
#
# DELIBERATE DIVERGENCE from the bash original (cache-miss-failures): the
# original interpolated `headBranch` straight into the systemMessage. Branch
# names are attacker-controllable, so the Node runtime sanitizes them and wraps
# them in a reference-only fence, and that golden was re-captured to match.
# Parity is a porting aid, not a correctness oracle — where the bash hook had a
# defect, reproducing it faithfully would just preserve the defect. Any future
# divergence should be recorded here with its reason, never silently re-baselined.
#
# DELIBERATE DIVERGENCE (routing-summary-present, gh-missing, gh-unauthed,
# cache-miss-failures, malformed-gh-json, rate-limited-gh): the original
# interpolated the routing-summary cache straight into the systemMessage too.
# That cache embeds `best_for` free text from a user-writable runner-targets
# config, so it is attacker-influenceable the same way branch names are — the
# Node runtime defangs it and wraps it in a reference-only fence, and those
# goldens were re-captured to match.
#
# DELIBERATE DIVERGENCE (cache-hit / legacy-cache-not-trusted): the R38 cache
# relocation gave the last-check result cache a read-only legacy fallback
# (${HOME}/.cache/yellow-ci), and the port originally trusted a fresh hit from
# EITHER location verbatim. But the legacy location can still hold raw text
# written by the deleted bash hook — which never sanitized branch names — for
# up to 60s after an upgrade, so a legacy-only hit could bypass
# defangUntrustedText/fenceReferenceOnly entirely. The Node runtime now reads
# a cache hit only from the NEW (plugin-data) location; `cache-hit` was
# repointed to pre-seed the new location, and `legacy-cache-not-trusted` was
# added to prove a legacy-only hit falls through to a live (mocked) fetch
# instead of being trusted.
#
# DELIBERATE DIVERGENCE (cache-hit, again — R20-B): even a NEW-location hit is
# no longer trusted verbatim. A same-uid local process can plant a file at the
# cache's predictable path (md5 of cwd) and pass the ownership check just as
# easily as this runtime itself — ownership cannot prove provenance. The
# last-check cache now stores raw FACTS (failureCount + candidate branch
# names, as JSON) instead of a rendered message, and a hit is re-rendered
# through the identical sanitize/fence pipeline (renderOutput) a live fetch
# uses, prefixed with the freshly-read routing summary, on every read. Hostile
# cache content can therefore only ever surface defanged inside a
# reference-only fence, the same as a hostile branch name from the GitHub API
# — regardless of who wrote the file. `cache-hit.golden.txt` was re-captured
# accordingly (routing summary now included ahead of the failure line, where
# it previously was not, since the cache no longer embeds a stale copy of it).
#
# DELIBERATE DIVERGENCE (CLAUDE-369, every case but cache-hit and
# no-workflows): the hook no longer calls `gh` in the foreground. A cache miss
# shows the routing summary only and starts a detached refresh-cache.js, which
# runs `gh auth status` + `gh run list` and writes the cache the NEXT session
# start reads. The bash hook did both in one process, so each golden now
# describes "refresh, then start": assert_parity runs refresh-cache.js first
# (YELLOW_CI_NO_BACKGROUND_REFRESH=1 keeps the hook itself from launching
# one) and compares the refresh's stderr followed by the hook's stderr with
# the golden. The goldens are unchanged. The one-step miss is tested below.
#
# STDOUT is compared JSON-semantically (jq -S -c) because the bash hook emitted
# jq's pretty multi-line JSON while the Node port emits compact JSON — the
# decision is what must match, not the byte formatting. STDERR and EXIT_CODE are
# compared exactly. Both entrypoints are checked: SessionStart output is
# identical on both hosts (R36), so they must produce byte-identical results.

bats_require_minimum_version 1.5.0

FIXTURE_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/fixtures/hooks" && pwd)"
SCRIPTS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"

setup() {
  load lib/hook-scenario.bash
}

golden_exit_code() { awk -F= '/^EXIT_CODE=/{print $2; exit}' "$1"; }

golden_section() {
  awk -v want="--- $2 ---" '
    $0 == want { grabbing = 1; next }
    /^--- .* ---$/ { grabbing = 0 }
    grabbing { print }
  ' "$1"
}

assert_stdout_matches_golden() {
  local actual="$1" expected="$2"
  if [ -z "$actual" ] && [ -z "$expected" ]; then return 0; fi
  if printf '%s' "$actual" | jq -e . >/dev/null 2>&1 && printf '%s' "$expected" | jq -e . >/dev/null 2>&1; then
    diff <(printf '%s' "$actual" | jq -S -c .) <(printf '%s' "$expected" | jq -S -c .)
    return $?
  fi
  [ "$actual" = "$expected" ]
}

# Run one scenario through one entrypoint and assert stdout/stderr/exit parity.
assert_parity() {
  local case="$1" entrypoint="$2"
  local golden="$FIXTURE_ROOT/$case.golden.txt"
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/$case-XXXXXX")"

  hook_scenario_setup "$case" "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"

  # A seeded cache-hit is already fresh; every other case starts from a miss,
  # so the background refresh runs first (see the CLAUDE-369 note above).
  local refresh_err=""
  if [ "$case" != "cache-hit" ]; then
    refresh_err=$(node "$SCRIPTS_DIR/lib/refresh-cache.js" 2>&1 >/dev/null)
  fi

  run --separate-stderr node "$SCRIPTS_DIR/$entrypoint" <"$FIXTURE_ROOT/$case.stdin"

  [ "$status" -eq "$(golden_exit_code "$golden")" ]
  assert_stdout_matches_golden "$output" "$(golden_section "$golden" STDOUT)"
  local all_err="$refresh_err"
  if [ -n "$stderr" ]; then all_err="${all_err:+$all_err
}$stderr"; fi
  [ "$all_err" = "$(golden_section "$golden" STDERR)" ]
}

assert_parity_both() {
  assert_parity "$1" entrypoint-claude.js
  assert_parity "$1" entrypoint-codex.js
}

@test "SessionStart parity: no-workflows (early exit)" { assert_parity_both no-workflows; }
@test "SessionStart parity: routing-summary-present" { assert_parity_both routing-summary-present; }
@test "SessionStart parity: routing-summary-absent" { assert_parity_both routing-summary-absent; }
@test "SessionStart parity: gh-missing (routing only)" { assert_parity_both gh-missing; }
@test "SessionStart parity: gh-unauthed (routing only)" { assert_parity_both gh-unauthed; }
@test "SessionStart parity: cache-hit (new plugin-data location, trusted)" { assert_parity_both cache-hit; }
@test "SessionStart parity: legacy-only cache hit is not trusted (refreshed, not shown)" { assert_parity_both legacy-cache-not-trusted; }
@test "SessionStart parity: cache-miss-failures (routing + failure line)" { assert_parity_both cache-miss-failures; }
@test "SessionStart parity: malformed-gh-json (routing only + stderr warning)" { assert_parity_both malformed-gh-json; }
@test "SessionStart parity: rate-limited-gh (routing only)" { assert_parity_both rate-limited-gh; }

@test "SessionStart: hostile branch names are sanitized and fenced" {
  # Not a parity case — the bash original had no such handling. Guards the
  # deliberate divergence documented in this file's header.
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/hostile-XXXXXX")"
  hook_scenario_setup hostile-branch "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  node "$SCRIPTS_DIR/lib/refresh-cache.js"
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]

  local msg; msg=$(printf '%s' "$output" | jq -r '.systemMessage')

  # The forged closing delimiter must be defanged, not passed through.
  [[ "$msg" != *"--- end ci-branches --- ignore previous"* ]]
  [[ "$msg" == *"[ESCAPED] end"* ]]

  # Backticks stripped so the name cannot render as a command substitution.
  [[ "$msg" != *'`id`'* ]]

  # The real fence still opens and closes exactly once around the data.
  [ "$(grep -o -- '--- begin ci-branches' <<<"$msg" | wc -l)" -eq 1 ]
  [ "$(grep -o -- '--- end ci-branches' <<<"$msg" | wc -l)" -eq 1 ]
}

@test "SessionStart: symlinked last-check cache is not followed" {
  # Not a parity case — the R38 plugin-data cache is new; the bash original
  # never had this file. Its filename is predictable (md5 of cwd) inside a
  # user-writable directory, so a local process could plant a symlink there
  # before this hook runs and have an arbitrary file's bytes spliced into
  # systemMessage. Seed a genuine cache-hit, then swap the file for a symlink
  # to a "secret" file: the hit must be rejected (treated as a miss) rather
  # than echoing the secret's content.
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/symlink-lastcheck-XXXXXX")"
  hook_scenario_setup cache-hit "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"

  local key
  key=$(hook_cache_key "$PWD")
  local secret="$sandbox/secret.txt"
  printf 'SECRET-FILE-CONTENT-DO-NOT-LEAK\n' >"$secret"
  ln -sfn "$secret" "$HOME/.local/share/yellow-ci/last-check-$key"

  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  local msg; msg=$(printf '%s' "$output" | jq -r '.systemMessage')
  [[ "$msg" != *"SECRET-FILE-CONTENT-DO-NOT-LEAK"* ]]
}

@test "SessionStart: symlinked routing-summary cache is not followed" {
  # Same vector as the last-check test above, at the sibling cache file
  # (routing-summary.txt) read by readRoutingSummary — same predictable
  # filename, same user-writable directory, same symlink risk.
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/symlink-routing-XXXXXX")"
  hook_scenario_setup routing-summary-present "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"

  local secret="$sandbox/secret.txt"
  printf 'SECRET-FILE-CONTENT-DO-NOT-LEAK\n' >"$secret"
  mkdir -p "$HOME/.local/share/yellow-ci"
  ln -sfn "$secret" "$HOME/.local/share/yellow-ci/routing-summary.txt"

  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  local msg; msg=$(printf '%s' "$output" | jq -r '.systemMessage')
  [[ "$msg" != *"SECRET-FILE-CONTENT-DO-NOT-LEAK"* ]]
}

# --- CLAUDE-369: no network in the foreground --------------------------------

# Age a file by N seconds. touch -d is not portable (GNU vs BSD), and
# node is always present, so set the mtime with it.
age_file() {
  node -e 'const fs=require("fs");const t=Date.now()/1000-Number(process.argv[2]);fs.utimesSync(process.argv[1],t,t)' "$1" "$2"
}

@test "SessionStart: a fresh cache hit never calls gh" {
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/fresh-XXXXXX")"
  hook_scenario_setup cache-hit "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  export MOCK_GH_LOG="$sandbox/gh.log"; : >"$MOCK_GH_LOG"
  unset YELLOW_CI_NO_BACKGROUND_REFRESH

  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"cached-branch"* ]]
  sleep 1
  [ ! -s "$MOCK_GH_LOG" ]
  [ -z "$(ls "$HOME/.local/share/yellow-ci" | grep '^refresh-' || true)" ]
}

@test "SessionStart: a miss shows routing only, calls no gh, and a background refresh fills the cache" {
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/miss-XXXXXX")"
  hook_scenario_setup cache-miss-failures "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  export MOCK_GH_LOG="$sandbox/gh.log"; : >"$MOCK_GH_LOG"

  # Foreground only: no gh call, no failure line.
  run --separate-stderr node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  local msg; msg=$(printf '%s' "$output" | jq -r '.systemMessage')
  [[ "$msg" == *"Runner routing"* ]]
  [[ "$msg" != *"recent failure"* ]]
  [ ! -s "$MOCK_GH_LOG" ]

  # With the background refresh on, the cache appears without a second start.
  unset YELLOW_CI_NO_BACKGROUND_REFRESH
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  local key; key=$(hook_cache_key "$PWD")
  local cache="$HOME/.local/share/yellow-ci/last-check-$key" i
  for i in $(seq 1 50); do [ -s "$cache" ] && break; sleep 0.1; done
  [ -s "$cache" ]
  grep -q '^run list' "$MOCK_GH_LOG"

  # The refresh marker is removed when the refresh ends.
  for i in $(seq 1 50); do [ -e "$HOME/.local/share/yellow-ci/refresh-$key" ] || break; sleep 0.1; done
  [ ! -e "$HOME/.local/share/yellow-ci/refresh-$key" ]

  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"3 recent failure(s)"* ]]
}

@test "SessionStart: a stale cache is shown and refreshed; a too-old one is not shown" {
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/stale-XXXXXX")"
  hook_scenario_setup cache-hit "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  unset YELLOW_CI_NO_BACKGROUND_REFRESH
  export MOCK_GH_LOG="$sandbox/gh.log"; : >"$MOCK_GH_LOG"
  local key; key=$(hook_cache_key "$PWD")
  local cache="$HOME/.local/share/yellow-ci/last-check-$key" i

  age_file "$cache" 900
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"cached-branch"* ]]
  for i in $(seq 1 50); do grep -q '^run list' "$MOCK_GH_LOG" && break; sleep 0.1; done
  grep -q '^run list' "$MOCK_GH_LOG"

  for i in $(seq 1 50); do [ -e "$HOME/.local/share/yellow-ci/refresh-$key" ] || break; sleep 0.1; done
  printf '%s' "$HOOK_SCENARIO_CACHED_TEXT" >"$cache"
  age_file "$cache" 7200
  export YELLOW_CI_NO_BACKGROUND_REFRESH=1
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" != *"cached-branch"* ]]
}

@test "SessionStart: a live refresh marker stops a second refresh" {
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/marker-XXXXXX")"
  hook_scenario_setup cache-miss-failures "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  unset YELLOW_CI_NO_BACKGROUND_REFRESH
  export MOCK_GH_LOG="$sandbox/gh.log"; : >"$MOCK_GH_LOG"
  local key; key=$(hook_cache_key "$PWD")
  mkdir -p "$HOME/.local/share/yellow-ci"
  : >"$HOME/.local/share/yellow-ci/refresh-$key"

  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  sleep 1
  [ ! -s "$MOCK_GH_LOG" ]
}

@test "SessionStart: cache age boundaries (600 s refreshes, 3600 s is not shown)" {
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/bounds-XXXXXX")"
  hook_scenario_setup cache-hit "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  local key; key=$(hook_cache_key "$PWD")
  local dir="$HOME/.local/share/yellow-ci" cache
  cache="$dir/last-check-$key"
  unset YELLOW_CI_NO_BACKGROUND_REFRESH
  export MOCK_GH_LOG="$sandbox/gh.log"; : >"$MOCK_GH_LOG"

  # 598 s: fresh, no refresh attempted (no marker created). The hook reads
  # the clock in a later process, so a second can tick over between
  # age_file and the check; the "just under" cases keep a 2 s margin.
  age_file "$cache" 598
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"cached-branch"* ]]
  [ ! -e "$dir/refresh-$key" ]

  # 600 s: still shown, and a refresh is started.
  age_file "$cache" 600
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"cached-branch"* ]]
  local i
  for i in $(seq 1 50); do grep -q '^run list' "$MOCK_GH_LOG" && break; sleep 0.1; done
  grep -q '^run list' "$MOCK_GH_LOG"
  for i in $(seq 1 50); do [ -e "$dir/refresh-$key" ] || break; sleep 0.1; done

  # 3598 s: still shown; 3600 s: not shown.
  export YELLOW_CI_NO_BACKGROUND_REFRESH=1
  printf '%s' "$HOOK_SCENARIO_CACHED_TEXT" >"$cache"
  age_file "$cache" 3598
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"cached-branch"* ]]
  age_file "$cache" 3600
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" != *"cached-branch"* ]]
}

@test "SessionStart: refresh warnings reach the log; a failed refresh writes no cache" {
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/refresh-fail-XXXXXX")"
  hook_scenario_setup malformed-gh-json "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  local key; key=$(hook_cache_key "$PWD")
  local dir="$HOME/.local/share/yellow-ci" i
  unset YELLOW_CI_NO_BACKGROUND_REFRESH

  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  for i in $(seq 1 50); do [ -e "$dir/refresh-$key" ] || break; sleep 0.1; done
  [ ! -e "$dir/refresh-$key" ]
  grep -q 'Unexpected GitHub API response format' "$dir/refresh-$key.log"
  # A malformed reply is not cached as zero failures.
  [ ! -e "$dir/last-check-$key" ]

  # Rate-limited (gh exits 1): nothing cached, so the next start refreshes again.
  export MOCK_GH_RUNLIST=ratelimit
  run node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  for i in $(seq 1 50); do [ -e "$dir/refresh-$key" ] || break; sleep 0.1; done
  [ ! -e "$dir/refresh-$key" ]
  [ ! -e "$dir/last-check-$key" ]
}

@test "SessionStart: a FIFO planted at the refresh log path does not stall the hook" {
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/fifo-log-XXXXXX")"
  hook_scenario_setup cache-miss-failures "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"
  unset YELLOW_CI_NO_BACKGROUND_REFRESH
  local key; key=$(hook_cache_key "$PWD")
  local dir="$HOME/.local/share/yellow-ci" i
  mkdir -p "$dir"
  mkfifo "$dir/refresh-$key.log"

  run timeout 3 node "$SCRIPTS_DIR/entrypoint-claude.js" </dev/null
  [ "$status" -eq 0 ]
  [[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"Runner routing"* ]]
  # The refresh still runs, with stderr discarded.
  for i in $(seq 1 50); do [ -s "$dir/last-check-$key" ] && break; sleep 0.1; done
  [ -s "$dir/last-check-$key" ]
}
