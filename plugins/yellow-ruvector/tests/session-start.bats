#!/usr/bin/env bats
# Tests for hooks/scripts/session-start.sh
bats_require_minimum_version 1.5.0
# The hook delegates to ruvector CLI (hooks session-start / hooks recall)
# under a 3s hooks.json watchdog. These tests prove the per-call timeout
# wrapping: a hanging ruvector binary must not stop {"continue": true} from
# being emitted within budget. NOTE: this suite is the repo's first bats file
# simulating a HANGING binary (sleep stub), not just a failing one.

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/session-start.sh"
  MOCK_BIN="$(mktemp -d)"
}

teardown() {
  # Retry once: external tooling (checkpoint watchers) can race rm -rf by
  # writing into fresh .git dirs; a raced cleanup must not fail the test.
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN" 2>/dev/null || { sleep 0.3; rm -rf "$PROJECT_ROOT" "$MOCK_BIN" 2>/dev/null || true; }
}

make_ruvector_stub() {
  # $1 = stub body (sh)
  printf '#!/bin/sh\n%s\n' "$1" > "$MOCK_BIN/ruvector"
  chmod +x "$MOCK_BIN/ruvector"
}

run_hook() {
  # $1 = hook stdin JSON; $2 (optional) = CLAUDE_PROJECT_DIR override
  printf '%s' "$1" | PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="${2:-$PROJECT_ROOT}" bash "$HOOK_SCRIPT"
}

make_worktree() {
  # $1 = branch name. Shared setup for the heal tests: init a repo in
  # PROJECT_ROOT, add a linked worktree at wt/, strip its .ruvector.
  git -C "$PROJECT_ROOT" init -q
  git -C "$PROJECT_ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  git -C "$PROJECT_ROOT" worktree add -q "$PROJECT_ROOT/wt" -b "$1"
  rm -rf "$PROJECT_ROOT/wt/.ruvector"
}

# Mirrors session-start.sh's own TIMEOUT_CMD resolution + GNU-compatibility
# probe: try each of timeout/gtimeout and accept the first that supports
# --kill-after=0.1 0.1 true. BusyBox/Alpine's timeout applet has no
# --kill-after flag, so `command -v timeout` alone is not sufficient: it
# succeeds there while the hook still falls back to unwrapped calls, which
# would let a hanging stub run past these tests' budget assertions. A non-GNU
# `timeout` may also precede a working `gtimeout` on PATH, so both candidates
# must be probed.
gnu_timeout_available() {
  local name tcmd
  for name in timeout gtimeout; do
    tcmd="$(command -v "$name" || true)"
    [ -n "$tcmd" ] && "$tcmd" --kill-after=0.1 0.1 true >/dev/null 2>&1 && return 0
  done
  return 1
}

@test "outputs continue:true with a healthy silent ruvector" {
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "includes recall output as systemMessage" {
  make_ruvector_stub 'case "$2" in recall) echo "mock-learning";; esac
exit 0'
  run run_hook '{"cwd":""}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  echo "$output" | jq -e '.systemMessage | contains("mock-learning")' > /dev/null
}

@test "exits silently when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "skips silently when binary absent even if npx present (no npx fallback)" {
  # npx resolution (~2700ms) would eat the 3s SessionStart budget before the
  # three CLI calls run; the hook must skip entirely, never invoking npx.
  MARKER="$MOCK_BIN/npx-was-called"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$MARKER" > "$MOCK_BIN/npx"
  chmod +x "$MOCK_BIN/npx"
  run bash -c 'printf "%s" "{}" | PATH="$1:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$2" bash "$3"' \
    _ "$MOCK_BIN" "$PROJECT_ROOT" "$HOOK_SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ ! -f "$MARKER" ]
}

@test "emits continue:true within 3s budget when ruvector hangs" {
  # A hanging binary must be killed per-call (0.9s resume + 0.8s x2 recall,
  # 2.8s worst case including --kill-after escalation) so JSON lands before
  # the 3s hooks.json watchdog would kill the process.
  gnu_timeout_available || \
    skip "no GNU-compatible timeout available; unwrapped-call fallback is a documented risk"
  make_ruvector_stub 'sleep 30'
  start_s="$(date +%s)"
  run --separate-stderr run_hook '{"cwd":""}'
  end_s="$(date +%s)"
  elapsed_s=$(( end_s - start_s ))
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ "$elapsed_s" -le 3 ]
}

@test "hanging recall still emits continue:true when session-start succeeds fast" {
  # Mixed case: resume returns instantly, both recalls hang — the per-call
  # caps must bound each recall independently.
  gnu_timeout_available || \
    skip "no GNU-compatible timeout available; unwrapped-call fallback is a documented risk"
  make_ruvector_stub 'case "$2" in recall) sleep 30;; esac
exit 0'
  start_s="$(date +%s)"
  run --separate-stderr run_hook '{"cwd":""}'
  end_s="$(date +%s)"
  elapsed_s=$(( end_s - start_s ))
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ "$elapsed_s" -le 3 ]
}

@test "worktree store-heal links .ruvector from the main checkout" {
  # A git worktree whose .ruvector is missing must get a symlink to the main
  # checkout's store BEFORE the .ruvector-missing early-exit, so the lazily
  # started MCP server never caches the machine-global ~/.ruvector fallback.
  command -v git >/dev/null 2>&1 || skip "git not available"
  make_worktree heal-test
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}' "$PROJECT_ROOT/wt"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ -L "$PROJECT_ROOT/wt/.ruvector" ]
  [ "$(readlink "$PROJECT_ROOT/wt/.ruvector")" = "$PROJECT_ROOT/.ruvector" ]
}

@test "store-heal is a no-op for a non-worktree checkout without .ruvector" {
  # Opt-in semantics preserved: a plain checkout that never initialized
  # ruvector must NOT gain a .ruvector dir or symlink from the hook.
  command -v git >/dev/null 2>&1 || skip "git not available"
  rm -rf "$RUVECTOR_DIR"
  git -C "$PROJECT_ROOT" init -q
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ ! -e "$RUVECTOR_DIR" ]
}

@test "version pin is synchronized between install.sh and the catalog npx spec" {
  # The MCP server (catalog npx args) and the CLI-hook path (install.sh
  # global default) must run the same ruvector version — skew lets a
  # pre-ADR-210 binary clobber the store's embedding-provenance stamp.
  install_default=$(grep -oE '^RUVECTOR_DEFAULT_VERSION="[^"]+"' \
    "$BATS_TEST_DIRNAME/../scripts/install.sh" | cut -d'"' -f2)
  catalog_spec=$(grep -oE '"ruvector@[0-9][^"]*"' \
    "$BATS_TEST_DIRNAME/../../../catalog/plugins/yellow-ruvector.json" | tr -d '"')
  [ -n "$install_default" ]
  [ -n "$catalog_spec" ]
  [ "ruvector@${install_default}" = "$catalog_spec" ]
}

@test "version pin in seed-solutions.md command doc matches install.sh" {
  # The command doc hardcodes concrete npx specs (it ships to installs
  # that have no catalog/ to reference) — every occurrence must match the
  # single source default in install.sh.
  install_default=$(grep -oE '^RUVECTOR_DEFAULT_VERSION="[^"]+"' \
    "$BATS_TEST_DIRNAME/../scripts/install.sh" | cut -d'"' -f2)
  [ -n "$install_default" ]
  doc="$BATS_TEST_DIRNAME/../commands/ruvector/seed-solutions.md"
  specs=$(grep -oE 'ruvector@[0-9][0-9.]*' "$doc" | sort -u)
  [ -n "$specs" ]
  [ "$specs" = "ruvector@${install_default}" ]
}

@test "store-heal replaces a dangling .ruvector symlink (ln -sfn)" {
  # ln -s alone EEXISTs on a dead link, silently leaving the global-store
  # fallback in place — the exact failure mode the heal exists to close.
  command -v git >/dev/null 2>&1 || skip "git not available"
  make_worktree heal-dangling
  ln -s "$PROJECT_ROOT/does-not-exist" "$PROJECT_ROOT/wt/.ruvector"
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}' "$PROJECT_ROOT/wt"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ "$(readlink "$PROJECT_ROOT/wt/.ruvector")" = "$PROJECT_ROOT/.ruvector" ]
}

@test "store-heal warns but never replaces a plain-directory .ruvector in a worktree" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  make_worktree heal-plaindir
  mkdir -p "$PROJECT_ROOT/wt/.ruvector"
  echo '{"marker":true}' > "$PROJECT_ROOT/wt/.ruvector/intelligence.json"
  make_ruvector_stub 'exit 0'
  run --separate-stderr run_hook '{"cwd":""}' "$PROJECT_ROOT/wt"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ -d "$PROJECT_ROOT/wt/.ruvector" ]
  [ ! -L "$PROJECT_ROOT/wt/.ruvector" ]
  grep -q 'marker' "$PROJECT_ROOT/wt/.ruvector/intelligence.json"
  echo "$stderr" | grep -q 'diverged from the shared store'
}

@test "store-heal is a no-op when the main checkout also lacks .ruvector" {
  command -v git >/dev/null 2>&1 || skip "git not available"
  rm -rf "$RUVECTOR_DIR"
  make_worktree heal-nostore
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}' "$PROJECT_ROOT/wt"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ ! -e "$PROJECT_ROOT/wt/.ruvector" ]
}

@test "store-heal skips silently when git lacks --path-format (git < 2.31 fallback)" {
  # The heal comment documents graceful skip on old git; prove it with a
  # stub git that rejects --path-format the way git < 2.31 does.
  command -v git >/dev/null 2>&1 || skip "git not available"
  make_worktree heal-oldgit
  printf '#!/bin/sh\nfor a in "$@"; do case "$a" in --path-format=*) echo "error: unknown option" >&2; exit 129;; esac; done\nexec /usr/bin/git "$@"\n' > "$MOCK_BIN/git"
  chmod +x "$MOCK_BIN/git"
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}' "$PROJECT_ROOT/wt"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ ! -e "$PROJECT_ROOT/wt/.ruvector" ]
}

@test "error-fix retrieval floor is synchronized between memory-query and debugging skill" {
  # The 0.40 floor is duplicated by inline-replication (cross-plugin skills:
  # does not resolve). RULE 16 does not cover this constant yet; this test
  # is the drift guard until it does.
  canon=$(grep 'ruvector-error-fix-constants' \
    "$BATS_TEST_DIRNAME/../skills/memory-query/SKILL.md" \
    | grep -oE 'discard score < [0-9.]+')
  replica=$(grep -oE 'discard score < [0-9.]+' \
    "$BATS_TEST_DIRNAME/../../yellow-core/skills/debugging/SKILL.md" | sort -u)
  [ -n "$canon" ]
  [ -n "$replica" ]
  [ "$canon" = "$replica" ]
}

@test "store-heal resolves the worktree root from a nested launch directory" {
  # A session launched from a subdirectory inside a worktree must still
  # heal <worktree-root>/.ruvector (codex P1: nested cwd skipped the heal).
  command -v git >/dev/null 2>&1 || skip "git not available"
  make_worktree heal-nested
  mkdir -p "$PROJECT_ROOT/wt/pkg/sub"
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}' "$PROJECT_ROOT/wt/pkg/sub"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ -L "$PROJECT_ROOT/wt/.ruvector" ]
  [ "$(readlink "$PROJECT_ROOT/wt/.ruvector")" = "$PROJECT_ROOT/.ruvector" ]
  # Pin the documented nested-launch limitation: the heal plants the
  # symlink for FUTURE root-launched sessions, but THIS session's own
  # recall is deliberately skipped (running the CLI from the nested cwd
  # would hit the global store) — output must carry no systemMessage.
  echo "$output" | jq -e 'has("systemMessage") | not' > /dev/null
}
