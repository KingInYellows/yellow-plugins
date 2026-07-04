#!/usr/bin/env bats
# Tests for lib/repo-profile.sh — git-SHA-keyed repo-profile cache
# (hit / miss / dirty-input invalidation / NO-CACHE degradation / atomic put).

setup() {
  . "$BATS_TEST_DIRNAME/../lib/repo-profile.sh"

  WORK="$(mktemp -d)"
  export HOME="$WORK/home"
  mkdir -p "$HOME"
  unset CLAUDE_PLUGIN_DATA

  REPO="$WORK/repo"
  mkdir -p "$REPO"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.email test@example.com
  git -C "$REPO" config user.name test
  printf '{"name":"fixture"}\n' > "$REPO/package.json"
  printf '# readme\n' > "$REPO/README.md"
  mkdir -p "$REPO/src"
  printf 'code\n' > "$REPO/src/app.js"
  git -C "$REPO" add -A
  git -C "$REPO" commit -qm init

  PROFILE="$WORK/profile.json"
  printf '{"profile_schema_version": 1, "stack": {"lang": "js"}}\n' > "$PROFILE"

  cd "$REPO"
}

teardown() {
  cd /
  [ -n "${WORK:-}" ] && [ -d "$WORK" ] && rm -rf "$WORK"
}

# --- key derivation ---

@test "rp_derive_key prints root and head shas in a normal repo" {
  run rp_derive_key
  [ "$status" -eq 0 ]
  root="${output%% *}"
  head="${output##* }"
  [ "$root" = "$head" ]  # single-commit repo: root IS head
  [ "${#root}" -eq 40 ]
}

@test "rp_derive_key fails outside a git work tree" {
  cd "$WORK"
  run rp_derive_key
  [ "$status" -ne 0 ]
}

@test "rp_derive_key fails proactively in a shallow clone" {
  # rev-list --max-parents=0 succeeds with a wrong SHA in shallow clones —
  # the guard must be the is-shallow-repository check, not error trapping.
  git -C "$REPO" commit -q --allow-empty -m second
  SHALLOW="$WORK/shallow"
  git clone -q --depth 1 "file://$REPO" "$SHALLOW" 2>/dev/null
  cd "$SHALLOW"
  run rp_derive_key
  [ "$status" -ne 0 ]
}

# --- get: NO-CACHE degradation ---

@test "rp_get prints NO-CACHE outside a git repo" {
  cd "$WORK"
  run rp_get
  [ "$status" -eq 0 ]
  [ "$output" = "NO-CACHE" ]
}

@test "rp_get prints NO-CACHE when the cache root is unwritable" {
  [ "$(id -u)" -eq 0 ] && skip "chmod is not enforced for root"
  mkdir -p "$HOME/.cache/yellow-plugins"
  chmod 555 "$HOME/.cache/yellow-plugins"
  run rp_get
  chmod 755 "$HOME/.cache/yellow-plugins"
  [ "$status" -eq 0 ]
  [ "$output" = "NO-CACHE" ]
}

# --- miss → put → hit round trip ---

@test "rp_get prints MISS with a write path on empty cache" {
  run rp_get
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "MISS" ]
  [[ "${lines[1]}" == "$HOME/.cache/yellow-plugins/repo-profile/"*.json ]]
}

@test "rp_put then rp_get round-trips to a HIT with the same JSON" {
  rp_put "$PROFILE"
  run rp_get
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "HIT" ]
  printf '%s\n' "${lines[@]:1}" | jq -e '.stack.lang == "js"' >/dev/null
}

@test "rp_get honors CLAUDE_PLUGIN_DATA over the HOME fallback" {
  export CLAUDE_PLUGIN_DATA="$WORK/plugin-data"
  rp_put "$PROFILE"
  [ -d "$CLAUDE_PLUGIN_DATA/repo-profile" ]
  run rp_get
  [ "${lines[0]}" = "HIT" ]
}

@test "head movement invalidates by construction (new key, MISS)" {
  rp_put "$PROFILE"
  printf 'more\n' >> "$REPO/src/app.js"
  git -C "$REPO" commit -qam second
  run rp_get
  [ "${lines[0]}" = "MISS" ]
}

# --- dirty-input invalidation ---

@test "dirty profile-input path (manifest) blocks a HIT" {
  rp_put "$PROFILE"
  printf '{"name":"changed"}\n' > "$REPO/package.json"
  run rp_get
  [ "${lines[0]}" = "MISS" ]
}

@test "untracked new profile-input path blocks a HIT" {
  rp_put "$PROFILE"
  printf 'FROM scratch\n' > "$REPO/Dockerfile"
  run rp_get
  [ "${lines[0]}" = "MISS" ]
}

@test "dirty NON-input path still HITs" {
  rp_put "$PROFILE"
  printf 'changed\n' >> "$REPO/src/app.js"
  run rp_get
  [ "${lines[0]}" = "HIT" ]
}

# --- entry validation ---

@test "schema version mismatch is a MISS, not a HIT" {
  printf '{"profile_schema_version": 999}\n' > "$PROFILE"
  # rp_put refuses wrong-version objects outright
  run rp_put "$PROFILE"
  [ "$status" -ne 0 ]
  # a wrong-version entry planted directly is not served
  key=$(rp_derive_key)
  entry="$HOME/.cache/yellow-plugins/repo-profile/${key%% *}/${key##* }.json"
  mkdir -p "${entry%/*}"
  printf '{"profile_schema_version": 999}\n' > "$entry"
  run rp_get
  [ "${lines[0]}" = "MISS" ]
}

@test "malformed entry JSON is a MISS and does not error" {
  key=$(rp_derive_key)
  entry="$HOME/.cache/yellow-plugins/repo-profile/${key%% *}/${key##* }.json"
  mkdir -p "${entry%/*}"
  printf '{ not json' > "$entry"
  run rp_get
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "MISS" ]
}

# --- atomic put ---

@test "rp_put leaves no .tmp residue and the entry parses" {
  rp_put "$PROFILE"
  key=$(rp_derive_key)
  entry_dir="$HOME/.cache/yellow-plugins/repo-profile/${key%% *}"
  run find "$entry_dir" -name '*.tmp.*'
  [ -z "$output" ]
  jq -e . "$entry_dir/${key##* }.json" >/dev/null
}

@test "rp_put rejects invalid JSON without installing an entry" {
  printf '{ nope' > "$PROFILE"
  run rp_put "$PROFILE"
  [ "$status" -ne 0 ]
  run rp_get
  [ "${lines[0]}" = "MISS" ]
}

@test "rp_put fails cleanly when the cache dir is unwritable" {
  [ "$(id -u)" -eq 0 ] && skip "chmod is not enforced for root"
  mkdir -p "$HOME/.cache/yellow-plugins/repo-profile"
  chmod 555 "$HOME/.cache/yellow-plugins/repo-profile"
  run rp_put "$PROFILE"
  chmod 755 "$HOME/.cache/yellow-plugins/repo-profile"
  [ "$status" -ne 0 ]
}

@test "rp_put refuses to write from a tree with dirty profile inputs" {
  printf '{"name":"dirty"}\n' > "$REPO/package.json"
  run rp_put "$PROFILE"
  [ "$status" -ne 0 ]
  run rp_get
  [ "${lines[0]}" = "MISS" ]
}
