#!/usr/bin/env bats
# setup-all-ruvector-probe.bats — the ruvector probe in commands/setup/all.md
# (extracted at run time, from the "# yellow-ruvector installs ruvector"
# comment through its `unset -f` line): every plugin-data candidate is
# probed, and a broken one does not hide a healthy one after it.

bats_require_minimum_version 1.5.0

setup() {
  export HOME="$BATS_TEST_TMPDIR/home"
  export CLAUDE_CONFIG_DIR="$HOME/.claude"
  unset XDG_DATA_HOME
  STUBS="$BATS_TEST_TMPDIR/stubs"
  mkdir -p "$STUBS"
  cat > "$STUBS/node" <<'NODE'
#!/bin/sh
case "$1" in */broken/*|*yellow-ruvector-a/*) exit 1 ;; esac
echo 0.3.3
NODE
  chmod +x "$STUBS/node"
  BLOCK="$BATS_TEST_TMPDIR/probe.sh"
  sed -n '/^# yellow-ruvector installs ruvector/,/^unset -f _rv_sys _rv_base_ok/p' \
    "$BATS_TEST_DIRNAME/../commands/setup/all.md" > "$BLOCK"
  [ -s "$BLOCK" ]
}

candidate() {
  local d="$CLAUDE_CONFIG_DIR/plugins/data/$1/current/node_modules/ruvector/bin"
  mkdir -p "$d"; : > "$d/cli.js"
}

probe() { run bash -c 'PATH="$1:$PATH" bash "$2"' _ "$STUBS" "$BLOCK"; }

@test "a broken first candidate does not hide a healthy later one" {
  candidate yellow-ruvector-a
  candidate yellow-ruvector-b
  probe
  [ "$status" -eq 0 ]
  [[ "$output" == *"ruvector:           OK (plugin-managed 0.3.3)"* ]]
}

@test "only broken candidates report a broken install" {
  candidate yellow-ruvector-a
  probe
  [[ "$output" == *"plugin-managed install broken"* ]]
}

@test "no candidate reports not installed" {
  probe
  [[ "$output" == *"ruvector:           NOT INSTALLED (plugin-managed)"* ]]
}
