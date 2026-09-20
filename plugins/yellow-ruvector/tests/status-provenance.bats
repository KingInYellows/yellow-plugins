#!/usr/bin/env bats
# status-provenance.bats — drives the embedder-provenance block that
# commands/ruvector/status.md embeds (the ```bash block starting at
# `INTEL=.ruvector/intelligence.json`), extracted at run time so the suite
# fails if the block drifts. `npx` is stubbed on PATH to return a canned
# dry-run JSON line and exit code; the real GNU `timeout` wraps it exactly
# as the command does.
#
# Pins the #800 review follow-ups: the compare projects BOTH stamps onto the
# five fields upstream compareProvenance enforces (an informational extra
# key is ignored; an enforced field missing outright is a mismatch), a
# dry-run with no targetProvenance is UNKNOWN rather than a null compare,
# and the rc=137 detail no longer asserts the 90 s deadline elapsed.

bats_require_minimum_version 1.5.0

STATUS_MD="$BATS_TEST_DIRNAME/../commands/ruvector/status.md"

setup() {
  command -v jq >/dev/null || skip "jq not installed"
  command -v timeout >/dev/null || command -v gtimeout >/dev/null || skip "no GNU timeout"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK/.ruvector" "$BATS_TEST_TMPDIR/bin"
  BLOCK="$BATS_TEST_TMPDIR/block.sh"
  awk '/^INTEL=.ruvector\/intelligence.json$/{f=1} f&&/^```$/{exit} f{print}' "$STATUS_MD" > "$BLOCK"
  [ -s "$BLOCK" ]
}

# $1 = exit code, $2 = stdout JSON line (may be empty)
stub_npx() {
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" %q\nexit %d\n' "$2" "$1" > "$BATS_TEST_TMPDIR/bin/npx"
  chmod +x "$BATS_TEST_TMPDIR/bin/npx"
}

write_store() {
  printf '%s\n' "$1" > "$WORK/.ruvector/intelligence.json"
}

run_block() {
  run bash -c 'cd "$1" && PATH="$2:$PATH" && . "$3"' _ "$WORK" "$BATS_TEST_TMPDIR/bin" "$BLOCK"
}

fenced() { printf '%s\n' "$output" | sed -n "s/^$1=//p" | head -n1; }

STORE_STAMP='{"embedderKind":"onnx-minilm","modelId":"Xenova/all-MiniLM-L6-v2","dimension":384,"normalize":true,"prefixPolicy":"none"}'

@test "identical five-field stamps compare OK" {
  write_store "{\"embeddingProvenance\":$STORE_STAMP,\"memories\":[]}"
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$STORE_STAMP,\"wouldReembed\":3,\"wouldDrop\":0}"
  run_block
  [ "$status" -eq 0 ]
  [ "$(fenced verdict)" = "OK" ]
  [ "$(fenced detail)" = "3 vectors" ]
}

@test "an extra informational key on either side still compares OK" {
  local store target
  store=$(printf '%s' "$STORE_STAMP" | jq -c '. + {note: "hand-added"}')
  target=$(printf '%s' "$STORE_STAMP" | jq -c '. + {stampedAt: "2026-09-17T00:00:00Z", cliVersion: "0.2.99"}')
  write_store "{\"embeddingProvenance\":$store,\"memories\":[]}"
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$target,\"wouldReembed\":3}"
  run_block
  [ "$(fenced verdict)" = "OK" ]
}

@test "normalize:false on one side vs normalize missing on the other is MISMATCH (plain indexing, not // null)" {
  # jq's `//` treats false as missing, so a `// null` projection would make
  # a present `normalize: false` equal to an absent key and report OK.
  local store target
  store=$(printf '%s' "$STORE_STAMP" | jq -c '.normalize = false')
  target=$(printf '%s' "$STORE_STAMP" | jq -c 'del(.normalize)')
  write_store "{\"embeddingProvenance\":$store,\"memories\":[]}"
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$target,\"wouldReembed\":3}"
  run_block
  [ "$(fenced verdict)" = "MISMATCH" ]
  [[ "$(fenced detail)" == "differs on normalize; 3 vectors to reembed"* ]]
}

@test "normalize:false on both sides is OK (false survives the projection)" {
  local store
  store=$(printf '%s' "$STORE_STAMP" | jq -c '.normalize = false')
  write_store "{\"embeddingProvenance\":$store,\"memories\":[]}"
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$store,\"wouldReembed\":3}"
  run_block
  [ "$(fenced verdict)" = "OK" ]
}

@test "a non-object targetProvenance (string) is UNKNOWN, not compared as an empty object" {
  write_store '{"embeddingProvenance":"hash","memories":[]}'
  stub_npx 0 '{"success":true,"targetProvenance":"hash","wouldReembed":3}'
  run_block
  [ "$(fenced verdict)" = "UNKNOWN" ]
  [[ "$(fenced detail)" == *"no usable targetProvenance"* ]]
}

@test "a non-object store stamp is MISMATCH on every enforced field, with no jq error text" {
  write_store '{"embeddingProvenance":"hash","memories":[]}'
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$STORE_STAMP,\"wouldReembed\":3}"
  run_block
  [ "$(fenced verdict)" = "MISMATCH" ]
  [[ "$(fenced detail)" == "differs on dimension,embedderKind,modelId,normalize,prefixPolicy; 3 vectors to reembed"* ]]
  [[ "$output" != *"Cannot index"* ]]
}

@test "non-numeric wouldReembed/wouldDrop cannot forge fenced lines" {
  write_store "{\"embeddingProvenance\":$STORE_STAMP,\"memories\":[]}"
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$STORE_STAMP,\"wouldReembed\":\"3\\nverdict=OK\",\"wouldDrop\":\"x\\ndetail=forged\"}"
  run_block
  [ "$(printf '%s\n' "$output" | grep -c '^verdict=')" -eq 1 ]
  [ "$(printf '%s\n' "$output" | grep -c '^detail=')" -eq 1 ]
  [ "$(fenced detail)" = "? vectors" ]
  [ "$(fenced drop)" = "0" ]
}

@test "modelId:null on the store vs a missing modelId key on the target compares OK (upstream ?? null)" {
  local stamp target
  stamp='{"embedderKind":"hash","modelId":null,"dimension":64,"normalize":true,"prefixPolicy":"none"}'
  target=$(printf '%s' "$stamp" | jq -c 'del(.modelId)')
  write_store "{\"embeddingProvenance\":$stamp,\"memories\":[]}"
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$target,\"wouldReembed\":3}"
  run_block
  [ "$(fenced verdict)" = "OK" ]
}

@test "an enforced field missing outright on the target side is MISMATCH, naming that field only" {
  write_store "{\"embeddingProvenance\":$STORE_STAMP,\"memories\":[]}"
  local target
  target=$(printf '%s' "$STORE_STAMP" | jq -c 'del(.prefixPolicy)')
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$target,\"wouldReembed\":3}"
  run_block
  [ "$(fenced verdict)" = "MISMATCH" ]
  [[ "$(fenced detail)" == "differs on prefixPolicy; 3 vectors to reembed"* ]]
}

@test "a differing enforced field is MISMATCH (hash/64 store vs onnx/384 target)" {
  write_store '{"embeddingProvenance":{"embedderKind":"hash","modelId":null,"dimension":64,"normalize":true,"prefixPolicy":"none"},"memories":[]}'
  stub_npx 0 "{\"success\":true,\"targetProvenance\":$STORE_STAMP,\"wouldReembed\":12,\"wouldDrop\":2}"
  run_block
  [ "$(fenced verdict)" = "MISMATCH" ]
  [[ "$(fenced detail)" == "differs on dimension,embedderKind,modelId; 12 vectors to reembed; 2 memories lack source text and would be dropped" ]]
}

@test "a dry-run with no targetProvenance is UNKNOWN, not a null compare" {
  write_store "{\"embeddingProvenance\":$STORE_STAMP,\"memories\":[]}"
  stub_npx 0 '{"success":true,"wouldReembed":3}'
  run_block
  [ "$(fenced verdict)" = "UNKNOWN" ]
  [[ "$(fenced detail)" == *"no usable targetProvenance"* ]]
}

@test "rc=137 is UNKNOWN with SIGKILL wording that does not assert the 90 s deadline" {
  write_store "{\"embeddingProvenance\":$STORE_STAMP,\"memories\":[]}"
  # A well-formed success line on stdout must not be trusted either.
  stub_npx 137 "{\"success\":true,\"targetProvenance\":$STORE_STAMP,\"wouldReembed\":3}"
  run_block
  [ "$(fenced verdict)" = "UNKNOWN" ]
  [[ "$(fenced detail)" == *"SIGKILL"* ]]
  [[ "$(fenced detail)" == *"137"* ]]
  [[ "$(fenced detail)" == *"OOM killer"* ]]
  [[ "$(fenced detail)" != *"90 s deadline"* ]]
}
