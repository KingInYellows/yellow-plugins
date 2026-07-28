#!/usr/bin/env bats
# Characterization tests for hooks/scripts/lib/resolve-runner-targets.sh
# Captures the observable behavior of resolve_runner_targets() (cache files
# written, return codes, merge precedence) BEFORE the G.1 decomposition so
# the extraction of rt_atomic_write() / emit_runner_json() is verifiably
# behavior-preserving.

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"
  # shellcheck source=../../yellow-core/lib/validate-fs.sh
  . "$(dirname "$BATS_TEST_FILENAME")/../../yellow-core/lib/validate-fs.sh"
  # shellcheck source=../hooks/scripts/lib/validate.sh
  . "${SCRIPT_DIR}/lib/validate.sh"
  # shellcheck source=../hooks/scripts/lib/resolve-runner-targets.sh
  . "${SCRIPT_DIR}/lib/resolve-runner-targets.sh"

  # Isolate HOME, XDG_CONFIG_HOME (global config) and XDG_DATA_HOME (R38 cache
  # dir) per test; unset CLAUDE_PLUGIN_DATA so the cache stays under the sandbox.
  TEST_HOME="$(mktemp -d)"
  TEST_XDG="$(mktemp -d)"
  TEST_WORK="$(mktemp -d)"
  export HOME="$TEST_HOME"
  export XDG_CONFIG_HOME="$TEST_XDG"
  export XDG_DATA_HOME="$TEST_HOME/.local/share"
  unset CLAUDE_PLUGIN_DATA
  GLOBAL_CFG="$TEST_XDG/yellow-ci/runner-targets.yaml"
  LOCAL_CFG="$TEST_WORK/.claude/yellow-ci-runner-targets.yaml"
  # R38: cache now lives under the plugin-data dir (rt_cache_dir), not ~/.cache.
  CACHE_DIR="$XDG_DATA_HOME/yellow-ci"
  mkdir -p "$(dirname "$GLOBAL_CFG")" "$(dirname "$LOCAL_CFG")"
  cd "$TEST_WORK"
}

teardown() {
  rm -rf "$TEST_HOME" "$TEST_XDG" "$TEST_WORK"
}

write_config() {
  # write_config <path> <runner-name> [routing-rule]
  local path="$1" rname="$2" rule="${3:-}"
  {
    printf 'schema: 1\n'
    printf 'runner_targets:\n'
    printf '  - name: %s\n' "$rname"
    printf '    type: pool\n'
    printf '    mode: jit_ephemeral\n'
    printf '    preferred_selector:\n'
    printf '      - self-hosted\n'
    printf '      - pool:%s\n' "$rname"
    printf '    best_for:\n'
    printf '      - heavy CI\n'
    if [ -n "$rule" ]; then
      printf 'routing_rules:\n'
      printf '  - %s\n' "$rule"
    fi
  } > "$path"
}

@test "resolve_runner_targets returns 1 and writes no cache when no config exists" {
  run resolve_runner_targets
  [ "$status" -eq 1 ]
  [ ! -f "$CACHE_DIR/routing-summary.txt" ]
  [ ! -f "$CACHE_DIR/runner-targets-merged.json" ]
}

@test "resolve_runner_targets writes both cache files from a global-only config" {
  write_config "$GLOBAL_CFG" "ares"
  run resolve_runner_targets
  [ "$status" -eq 0 ]
  [ -f "$CACHE_DIR/routing-summary.txt" ]
  [ -f "$CACHE_DIR/runner-targets-merged.json" ]
  grep -q "ares" "$CACHE_DIR/runner-targets-merged.json"
  grep -q "ares" "$CACHE_DIR/routing-summary.txt"
}

@test "resolve_runner_targets works from a local-only config" {
  write_config "$LOCAL_CFG" "atlas"
  run resolve_runner_targets
  [ "$status" -eq 0 ]
  grep -q "atlas" "$CACHE_DIR/runner-targets-merged.json"
}

@test "resolve_runner_targets merges global + local, local wins by name" {
  write_config "$GLOBAL_CFG" "ares"
  write_config "$LOCAL_CFG" "atlas"
  run resolve_runner_targets
  [ "$status" -eq 0 ]
  # Both runners present (global ares + local atlas appended).
  grep -q "ares" "$CACHE_DIR/runner-targets-merged.json"
  grep -q "atlas" "$CACHE_DIR/runner-targets-merged.json"
}

@test "resolve_runner_targets: local routing_rules replace global wholesale" {
  write_config "$GLOBAL_CFG" "ares" "prefer pool:ares for heavy CI"
  write_config "$LOCAL_CFG" "atlas" "prefer pool:atlas for everything"
  run resolve_runner_targets
  [ "$status" -eq 0 ]
  grep -q "prefer pool:atlas for everything" "$CACHE_DIR/runner-targets-merged.json"
  ! grep -q "prefer pool:ares for heavy CI" "$CACHE_DIR/runner-targets-merged.json"
}

@test "resolve_runner_targets: emitted JSON is well-formed" {
  write_config "$GLOBAL_CFG" "ares" "prefer pool:ares for heavy CI"
  resolve_runner_targets
  if command -v jq >/dev/null 2>&1; then
    run jq -e '.schema == 1 and (.runner_targets | length) == 1' \
      "$CACHE_DIR/runner-targets-merged.json"
    [ "$status" -eq 0 ]
  fi
}

@test "resolve_runner_targets: invalid global config is skipped, valid local still resolves" {
  printf 'not a valid runner targets file\n' > "$GLOBAL_CFG"
  write_config "$LOCAL_CFG" "atlas"
  run resolve_runner_targets
  [ "$status" -eq 0 ]
  grep -q "atlas" "$CACHE_DIR/runner-targets-merged.json"
}

@test "resolve_runner_targets: a bare '-' (null) routing_rules item invalidates the whole global config" {
  {
    printf 'schema: 1\n'
    printf 'runner_targets:\n'
    printf '  - name: ares\n'
    printf '    type: pool\n'
    printf '    mode: jit_ephemeral\n'
    printf '    preferred_selector:\n'
    printf '      - self-hosted\n'
    printf 'routing_rules:\n'
    printf '  - prefer pool:ares for heavy CI\n'
    printf '  -\n'
  } > "$GLOBAL_CFG"
  run resolve_runner_targets
  # The runner_targets section alone is still valid, but the null routing
  # rule item makes the whole file invalid (validate_runner_targets_file
  # rejects it as one unit), so resolve_runner_targets falls back to "no
  # config" rather than silently emitting the file with the rule dropped.
  [ "$status" -eq 1 ]
  [ ! -f "$CACHE_DIR/runner-targets-merged.json" ]
}

@test "resolve_runner_targets: quoted hostile routing rules round-trip verbatim through the merged cache" {
  {
    printf 'schema: 1\n'
    printf 'runner_targets:\n'
    printf '  - name: ares\n'
    printf '    type: pool\n'
    printf '    mode: jit_ephemeral\n'
    printf '    preferred_selector:\n'
    printf '      - self-hosted\n'
    printf 'routing_rules:\n'
    printf '  - "owner: platform"\n'
    printf '  - "# urgent"\n'
    printf '  - "- leading dash"\n'
    printf '  - "*star"\n'
    printf '  - "yes"\n'
    printf '  - "1.2.3"\n'
    printf '  - "embedded \\"quote\\""\n'
    printf '  - "embedded \\\\backslash\\\\"\n'
  } > "$GLOBAL_CFG"
  run resolve_runner_targets
  [ "$status" -eq 0 ]
  # Unconditional — no `command -v jq` guard. jq is an optional runtime
  # dependency (see CLAUDE.md), so gating this assertion on its presence let
  # the regression it exists to catch (round-trip corruption of quoted
  # hostile routing rules) pass silently on any box without jq installed.
  # python3 is guaranteed present in this repo's tooling (see
  # scripts/validate-schemas.yml, plugins/*/commands/*/setup.md) — use it
  # directly instead of an optional external dependency, so a missing parser
  # fails the test rather than skipping the check.
  run python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
expected = [
    "owner: platform",
    "# urgent",
    "- leading dash",
    "*star",
    "yes",
    "1.2.3",
    "embedded \"quote\"",
    "embedded \\backslash\\",
]
assert data["routing_rules"] == expected, data.get("routing_rules")
' "$CACHE_DIR/runner-targets-merged.json"
  [ "$status" -eq 0 ]
}

@test "resolve_runner_targets: quoted hostile name/selector/metadata round-trip verbatim through the merged cache" {
  {
    printf 'schema: 1\n'
    printf 'runner_targets:\n'
    printf '  - name: "on"\n'
    printf '    type: pool\n'
    printf '    mode: jit_ephemeral\n'
    printf '    preferred_selector:\n'
    printf '      - "true"\n'
    printf '      - "1.2.3"\n'
    printf '      - "tier:"\n'
    printf '    best_for:\n'
    printf '      - "owner: platform"\n'
    printf '    avoid_for:\n'
    printf '      - "yes"\n'
    printf '    notes:\n'
    printf '      - "- leading dash"\n'
    printf '      - "#urgent"\n'
  } > "$GLOBAL_CFG"
  run resolve_runner_targets
  [ "$status" -eq 0 ]
  # Unconditional — see the routing-rules round-trip test above for why this
  # uses python3 (guaranteed present) rather than an optional-dependency jq
  # guard that would let this regression pass silently when jq is absent.
  run python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
runner = data["runner_targets"][0]
assert runner["name"] == "on", runner["name"]
assert runner["preferred_selector"] == ["true", "1.2.3", "tier:"], runner["preferred_selector"]
assert runner["best_for"] == ["owner: platform"], runner["best_for"]
assert runner["avoid_for"] == ["yes"], runner["avoid_for"]
assert runner["notes"] == ["- leading dash", "#urgent"], runner["notes"]
for value in [runner["name"]] + runner["preferred_selector"] + runner["best_for"] + runner["avoid_for"] + runner["notes"]:
    assert isinstance(value, str), (value, type(value))
    assert "\"" not in value, value
' "$CACHE_DIR/runner-targets-merged.json"
  [ "$status" -eq 0 ]
}

@test "resolve_runner_targets: stale cache is removed when config disappears" {
  write_config "$GLOBAL_CFG" "ares"
  resolve_runner_targets
  [ -f "$CACHE_DIR/runner-targets-merged.json" ]
  rm -f "$GLOBAL_CFG"
  run resolve_runner_targets
  [ "$status" -eq 1 ]
  [ ! -f "$CACHE_DIR/runner-targets-merged.json" ]
  [ ! -f "$CACHE_DIR/routing-summary.txt" ]
}
