#!/usr/bin/env bats
# Tests for hooks/lib/context7-cache.sh — context7 cache pre-warm helpers.
#
# Strategy: source the lib, override _lc_resolve_library_id and _lc_now
# with stubs so tests are deterministic and don't hit the real context7 API.

setup() {
  TEST_TMP="$(mktemp -d)"
  CLAUDE_PLUGIN_DATA="$TEST_TMP/plugin-data"
  CLAUDE_PROJECT_DIR="$TEST_TMP/project"
  mkdir -p "$CLAUDE_PLUGIN_DATA" "$CLAUDE_PROJECT_DIR"
  export CLAUDE_PLUGIN_DATA CLAUDE_PROJECT_DIR

  # shellcheck source=../hooks/lib/context7-cache.sh
  . "$BATS_TEST_DIRNAME/../hooks/lib/context7-cache.sh"
}

teardown() {
  if [ -n "${TEST_TMP:-}" ] && [ -d "$TEST_TMP" ]; then
    rm -rf "$TEST_TMP"
  fi
}

# Override the HTTP call so tests are deterministic and offline.
_stub_resolve_returns() {
  eval "_lc_resolve_library_id() { case \"\$1\" in
    react)    printf '/facebook/react' ;;
    lodash)   printf '/lodash/lodash' ;;
    axios)    printf '/axios/axios' ;;
    *)        return 0 ;;
  esac; }"
}

# Pin the clock for skip-if-fresh tests.
_stub_now_returns() {
  eval "_lc_now() { printf '%s' '$1'; }"
}

# --- _lc_cache_path ---

@test "cache_path: derives md5-suffixed path from CLAUDE_PROJECT_DIR" {
  run _lc_cache_path
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^${CLAUDE_PLUGIN_DATA}/context7-cache-[a-f0-9]{32}\.json$ ]]
}

@test "cache_path: fails when CLAUDE_PLUGIN_DATA unset" {
  unset CLAUDE_PLUGIN_DATA
  run _lc_cache_path
  [ "$status" -ne 0 ]
}

# --- _lc_prewarm: no lockfile ---

@test "prewarm: no lockfile → logs warning and exits 0 without creating cache" {
  _stub_resolve_returns
  run _lc_prewarm
  [ "$status" -eq 0 ]
  [[ "$output" =~ "No lockfile found" ]]
  # No cache file should be written
  [ -z "$(find "$CLAUDE_PLUGIN_DATA" -name 'context7-cache-*.json' 2>/dev/null)" ]
}

# --- _lc_prewarm: CLAUDE_PLUGIN_DATA unset ---

@test "prewarm: CLAUDE_PLUGIN_DATA unset → warns and skips" {
  unset CLAUDE_PLUGIN_DATA
  _stub_resolve_returns
  run _lc_prewarm
  [ "$status" -eq 0 ]
  [[ "$output" =~ "CLAUDE_PLUGIN_DATA unset" ]]
}

# --- _lc_prewarm: anonymous warm ---

@test "prewarm: package.json present → resolves and writes cache (anonymous)" {
  cat >"$CLAUDE_PROJECT_DIR/package.json" <<'JSON'
{"dependencies": {"react": "^18.0.0", "axios": "^1.0.0"}, "devDependencies": {"lodash": "^4.0.0"}}
JSON
  _stub_resolve_returns
  _stub_now_returns 1000000000

  run _lc_prewarm
  [ "$status" -eq 0 ]

  local cache_file
  cache_file=$(find "$CLAUDE_PLUGIN_DATA" -name 'context7-cache-*.json' | head -1)
  [ -n "$cache_file" ]

  # tier1 should contain all 3 resolved libraries
  local count
  count=$(jq '.tier1 | length' "$cache_file")
  [ "$count" = "3" ]

  # warmed_at matches the stubbed clock
  local warmed
  warmed=$(jq -r '.warmed_at' "$cache_file")
  [ "$warmed" = "1000000000" ]

  # schema field present
  local schema
  schema=$(jq -r '.schema' "$cache_file")
  [ "$schema" = "1" ]
}

# --- _lc_prewarm: skip if fresh ---

@test "prewarm: cache age < 24h → skips without modifying file" {
  cat >"$CLAUDE_PROJECT_DIR/package.json" <<'JSON'
{"dependencies": {"react": "^18.0.0"}}
JSON
  _stub_now_returns 2000000000
  local cache_path
  cache_path=$(_lc_cache_path)
  # Seed a fresh cache: warmed 1 hour ago
  printf '{"schema":"1","warmed_at":1999996400,"tier1":{"seeded":{"library_id":"/seed/seed","fetched_at":1999996400}},"tier2":{},"lockfile_fingerprint":{}}' >"$cache_path"
  local before
  before=$(cat "$cache_path")

  _stub_resolve_returns
  run _lc_prewarm
  [ "$status" -eq 0 ]

  # File unchanged
  local after
  after=$(cat "$cache_path")
  [ "$before" = "$after" ]
}

# --- _lc_prewarm: corrupted cache → rewrites cleanly ---

@test "prewarm: corrupted cache JSON → treated as stale, rewrites" {
  cat >"$CLAUDE_PROJECT_DIR/package.json" <<'JSON'
{"dependencies": {"react": "^18.0.0"}}
JSON
  local cache_path
  cache_path=$(_lc_cache_path)
  printf 'NOT VALID JSON {{' >"$cache_path"

  _stub_resolve_returns
  _stub_now_returns 1500000000
  run _lc_prewarm
  [ "$status" -eq 0 ]

  # Cache should now be valid JSON with react
  run jq -r '.tier1.react.library_id' "$cache_path"
  [ "$status" -eq 0 ]
  [ "$output" = "/facebook/react" ]
}

# --- _lc_prewarm: authenticated warm (CONTEXT7_API_KEY set) ---

@test "prewarm: with CONTEXT7_API_KEY set → uses auth path (stub still returns same)" {
  cat >"$CLAUDE_PROJECT_DIR/package.json" <<'JSON'
{"dependencies": {"react": "^18.0.0"}}
JSON
  export CONTEXT7_API_KEY="test-token-xyz"
  _stub_resolve_returns
  _stub_now_returns 1700000000

  run _lc_prewarm
  [ "$status" -eq 0 ]

  local cache_file
  cache_file=$(find "$CLAUDE_PLUGIN_DATA" -name 'context7-cache-*.json' | head -1)
  [ -n "$cache_file" ]
  local id
  id=$(jq -r '.tier1.react.library_id' "$cache_file")
  [ "$id" = "/facebook/react" ]
  unset CONTEXT7_API_KEY
}

# --- _lc_resolve_library_id: token not in argv when CONTEXT7_API_KEY set ---

@test "resolve_library_id: CONTEXT7_API_KEY is not passed as a curl argv argument" {
  local argv_log="$TEST_TMP/curl-argv.txt"
  # Stub curl: write all arguments to a log file, then emit a valid response.
  curl() {
    printf '%s\n' "$@" >"$argv_log"
    printf '{"results":[{"id":"/facebook/react","title":"React"}]}'
  }
  export -f curl

  export CONTEXT7_API_KEY="super-secret-token-abc123"
  run _lc_resolve_library_id "react"
  [ "$status" -eq 0 ]
  [ "$output" = "/facebook/react" ]

  # The bearer token must NOT appear in curl's argv.
  run grep -q "super-secret-token-abc123" "$argv_log"
  [ "$status" -ne 0 ]

  unset CONTEXT7_API_KEY
  unset -f curl
}

# --- _lc_scan_lockfiles ---

@test "scan_lockfiles: extracts names from package.json dependencies + devDependencies" {
  cat >"$CLAUDE_PROJECT_DIR/package.json" <<'JSON'
{"dependencies": {"react": "^18.0.0", "axios": "^1.0.0"}, "devDependencies": {"lodash": "^4.0.0"}}
JSON
  run _lc_scan_lockfiles
  [ "$status" -eq 0 ]
  [[ "$output" =~ axios ]]
  [[ "$output" =~ lodash ]]
  [[ "$output" =~ react ]]
}

@test "scan_lockfiles: extracts names from Cargo.lock" {
  cat >"$CLAUDE_PROJECT_DIR/Cargo.lock" <<'TOML'
[[package]]
name = "serde"
version = "1.0.0"

[[package]]
name = "tokio"
version = "1.0.0"
TOML
  run _lc_scan_lockfiles
  [ "$status" -eq 0 ]
  [[ "$output" =~ serde ]]
  [[ "$output" =~ tokio ]]
}

@test "scan_lockfiles: caps output at _LC_PREWARM_MAX (5)" {
  cat >"$CLAUDE_PROJECT_DIR/package.json" <<'JSON'
{"dependencies": {"react": "18", "lodash": "4", "axios": "1", "vue": "3", "express": "4", "next": "14", "webpack": "5", "babel": "7"}}
JSON
  run _lc_scan_lockfiles
  [ "$status" -eq 0 ]
  local count
  count=$(printf '%s\n' "$output" | wc -l | tr -d ' ')
  [ "$count" -le 5 ]
}

@test "scan_lockfiles: yarn.lock scoped packages (@scope/name) are extracted" {
  cat >"$CLAUDE_PROJECT_DIR/yarn.lock" <<'YARN'
"@babel/core@^7.0.0":
  version "7.21.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.21.0.tgz"

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
YARN
  run _lc_scan_lockfiles
  [ "$status" -eq 0 ]
  [[ "$output" =~ "@babel/core" ]]
  [[ "$output" =~ "lodash" ]]
}

@test "scan_lockfiles: package.json direct deps appear before package-lock.json transitive deps" {
  # package.json has react as a direct dep
  cat >"$CLAUDE_PROJECT_DIR/package.json" <<'JSON'
{"dependencies": {"react": "^18.0.0"}}
JSON
  # package-lock.json has many transitive @babel/helper-* packages that sort first alphabetically
  cat >"$CLAUDE_PROJECT_DIR/package-lock.json" <<'LOCKJSON'
{
  "lockfileVersion": 3,
  "packages": {
    "node_modules/@babel/helper-annotate-as-pure": {"version": "7.0.0"},
    "node_modules/@babel/helper-compilation-targets": {"version": "7.0.0"},
    "node_modules/react": {"version": "18.0.0"}
  }
}
LOCKJSON
  run _lc_scan_lockfiles
  [ "$status" -eq 0 ]
  # react must be present
  [[ "$output" =~ "react" ]]
  # react must appear before any @babel/helper-* line
  local react_line babel_line
  react_line=$(printf '%s\n' "$output" | grep -n '^react$' | cut -d: -f1)
  babel_line=$(printf '%s\n' "$output" | grep -n '^@babel/' | head -1 | cut -d: -f1)
  [ -n "$react_line" ]
  if [ -n "$babel_line" ]; then
    [ "$react_line" -lt "$babel_line" ]
  fi
}

# --- _lc_atomic_write ---

@test "atomic_write: writes file successfully" {
  local target="$TEST_TMP/atomic-test.json"
  run _lc_atomic_write "$target" '{"hello":"world"}'
  [ "$status" -eq 0 ]
  [ -f "$target" ]
  local content
  content=$(cat "$target")
  [ "$content" = '{"hello":"world"}' ]
}

@test "atomic_write: creates parent directory if missing" {
  local target="$TEST_TMP/nested/dir/file.json"
  run _lc_atomic_write "$target" '{"a":1}'
  [ "$status" -eq 0 ]
  [ -f "$target" ]
}

# --- _lc_lockfile_fingerprint ---

@test "lockfile_fingerprint: returns a non-zero integer mtime for a real file" {
  touch "$CLAUDE_PROJECT_DIR/package-lock.json"
  run _lc_lockfile_fingerprint
  [ "$status" -eq 0 ]
  local mtime
  mtime=$(printf '%s' "$output" | jq -r '.["package-lock.json"]')
  # mtime must be a positive integer (not 0 and not empty)
  [[ "$mtime" =~ ^[0-9]+$ ]]
  [ "$mtime" -gt 0 ]
}

@test "lockfile_fingerprint: absent lockfiles are omitted from output" {
  # No lockfiles in project dir — result should be empty object
  run _lc_lockfile_fingerprint
  [ "$status" -eq 0 ]
  local keys
  keys=$(printf '%s' "$output" | jq 'keys | length')
  [ "$keys" = "0" ]
}

# --- _lc_should_skip: lockfile mtime invalidation ---

@test "should_skip: returns non-zero when lockfile mtime changes after cache was written" {
  cat >"$CLAUDE_PROJECT_DIR/package-lock.json" <<'JSON'
{"lockfileVersion":3,"packages":{"node_modules/react":{"version":"18.0.0"}}}
JSON
  _stub_now_returns 2000000000
  _stub_resolve_returns

  # Warm the cache so fingerprint is recorded
  _lc_prewarm

  # Verify should_skip returns 0 (within TTL + fingerprint matches)
  run _lc_should_skip
  [ "$status" -eq 0 ]

  # Force mtime forward by a second to avoid within-second race (touch granularity
  # is 1s on most filesystems; without -d the new mtime can equal the original).
  touch -d '+1 second' "$CLAUDE_PROJECT_DIR/package-lock.json"

  # Now should_skip must return non-zero (fingerprint mismatch)
  run _lc_should_skip
  [ "$status" -ne 0 ]
}

# --- _lc_scan_lockfiles: scoped npm packages ---

@test "scan_lockfiles: extracts scoped packages (@types/node, @babel/core) from package-lock.json" {
  cat >"$CLAUDE_PROJECT_DIR/package-lock.json" <<'JSON'
{
  "lockfileVersion": 3,
  "packages": {
    "node_modules/@types/node": {"version": "20.0.0"},
    "node_modules/@babel/core": {"version": "7.0.0"},
    "node_modules/react": {"version": "18.0.0"},
    "node_modules/react/node_modules/loose-envify": {"version": "1.0.0"}
  }
}
JSON
  run _lc_scan_lockfiles
  [ "$status" -eq 0 ]
  [[ "$output" =~ "@types/node" ]]
  [[ "$output" =~ "@babel/core" ]]
  [[ "$output" =~ "react" ]]
  # Nested path (two slashes after stripping node_modules/) must NOT appear
  [[ ! "$output" =~ "loose-envify" ]]
}

# --- _lc_lookup: cache reader for consumer agents ---

@test "lookup: returns empty when cache file is absent" {
  run _lc_lookup "react"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "lookup: returns cached library_id on fresh hit" {
  local cache_path
  cache_path=$(_lc_cache_path)
  local now
  now=$(_lc_now)
  printf '{"schema":"1","warmed_at":%s,"tier1":{"react":{"library_id":"/facebook/react","fetched_at":%s}},"tier2":{},"lockfile_fingerprint":{}}' "$now" "$now" >"$cache_path"

  run _lc_lookup "react"
  [ "$status" -eq 0 ]
  [ "$output" = "/facebook/react" ]
}

@test "lookup: returns empty on cache miss (library not in tier1)" {
  local cache_path
  cache_path=$(_lc_cache_path)
  local now
  now=$(_lc_now)
  printf '{"schema":"1","warmed_at":%s,"tier1":{"react":{"library_id":"/facebook/react","fetched_at":%s}},"tier2":{},"lockfile_fingerprint":{}}' "$now" "$now" >"$cache_path"

  run _lc_lookup "missing-library"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "lookup: returns empty when cached entry is older than TIER1 TTL" {
  local cache_path
  cache_path=$(_lc_cache_path)
  _stub_now_returns 2000000000
  # Entry fetched > 24h ago (86401 seconds)
  printf '{"schema":"1","warmed_at":1999913599,"tier1":{"react":{"library_id":"/facebook/react","fetched_at":1999913599}},"tier2":{},"lockfile_fingerprint":{}}' >"$cache_path"

  run _lc_lookup "react"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "lookup: returns empty on corrupted cache JSON" {
  local cache_path
  cache_path=$(_lc_cache_path)
  printf 'NOT VALID JSON {{' >"$cache_path"

  run _lc_lookup "react"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "lookup: returns empty when name argument is empty" {
  run _lc_lookup ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- bin/lc-cache-lookup wrapper (agent-facing) ---

@test "bin/lc-cache-lookup: returns cached id when invoked from any cwd" {
  local cache_path
  cache_path=$(_lc_cache_path)
  local now
  now=$(_lc_now)
  printf '{"schema":"1","warmed_at":%s,"tier1":{"axios":{"library_id":"/axios/axios","fetched_at":%s}},"tier2":{},"lockfile_fingerprint":{}}' "$now" "$now" >"$cache_path"

  cd "$TEST_TMP"
  run bash "$BATS_TEST_DIRNAME/../bin/lc-cache-lookup" "axios"
  [ "$status" -eq 0 ]
  [ "$output" = "/axios/axios" ]
}

@test "bin/lc-cache-lookup: exits 0 with empty output when no arg" {
  run bash "$BATS_TEST_DIRNAME/../bin/lc-cache-lookup"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- idempotency guard ---

@test "library re-sourcing is idempotent (_LC_CACHE_LOADED guard)" {
  # If re-sourcing had side effects, we'd see errors here from set -u
  # shellcheck source=../hooks/lib/context7-cache.sh
  . "$BATS_TEST_DIRNAME/../hooks/lib/context7-cache.sh"
  # shellcheck source=../hooks/lib/context7-cache.sh
  . "$BATS_TEST_DIRNAME/../hooks/lib/context7-cache.sh"
  [ "$_LC_CACHE_LOADED" = "1" ]
}
