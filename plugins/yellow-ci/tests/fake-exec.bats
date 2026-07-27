#!/usr/bin/env bats
# R43 fake-exec matrix for yellow-ci (no external writes). Covers the
# executable surface with PATH-stub mocks:
#   - the SSH-safety contract shape + connection-failure categorization
#     (tests/mocks/ssh)
#   - runner-target config validation (hooks/scripts/lib/validate.sh)
#
# The gh-driven SessionStart behaviors R43 lists — failure diagnosis, rate
# limits, malformed responses — are exercised end-to-end by hook-parity.bats
# (cache-miss-failures / rate-limited-gh / malformed-gh-json), and redaction by
# redaction.bats. The runner-health probe ORCHESTRATION and the non-Linux skip
# live in skills/ci-runner-health/SKILL.md — LLM-interpreted markdown, not
# executable shell — so they are review-gated, mirroring gt-workflow's
# documented bats scope limitation (see the skip at the end).

MOCKS="$(cd "$(dirname "$BATS_TEST_FILENAME")/mocks" && pwd)"
SCRIPTS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"

setup() {
  . "$SCRIPTS_DIR/lib/validate.sh"
  PATH="$MOCKS:$PATH"
  export MOCK_SSH_LOG="$BATS_TEST_TMPDIR/ssh.log"
  : >"$MOCK_SSH_LOG"
}

# The exact SSH-safety options the runner-health playbook uses. Keep this list
# in step with the `ssh_opts` array in skills/ci-runner-health/SKILL.md — the
# last four were added when the playbook stopped relying on the invoking user's
# ssh_config for key-only auth.
ssh_health() {
  ssh -o StrictHostKeyChecking=accept-new \
      -o BatchMode=yes \
      -o ConnectTimeout=3 \
      -o ServerAliveInterval=60 \
      -o ForwardAgent=no \
      -o PreferredAuthentications=publickey \
      -o PasswordAuthentication=no \
      -o KbdInteractiveAuthentication=no \
      "$1" 'echo probe'
}

@test "ssh: health probe returns canned metrics (MOCK_SSH_MODE=ok)" {
  run ssh_health runner@192.168.1.50
  [ "$status" -eq 0 ]
  [[ "$output" == *"=== DISK ==="* ]]
  [[ "$output" == *"GitHub: 200"* ]]
}

@test "ssh: safety-contract options are actually passed (StrictHostKeyChecking, BatchMode)" {
  ssh_health runner@192.168.1.50 >/dev/null
  grep -q 'StrictHostKeyChecking=accept-new' "$MOCK_SSH_LOG"
  grep -q 'BatchMode=yes' "$MOCK_SSH_LOG"
}

@test "ssh: agent forwarding (-A) is rejected by the safety contract" {
  run ssh -o BatchMode=yes -A runner@192.168.1.50 'echo x'
  [ "$status" -eq 1 ]
  [[ "$output$stderr" == *"agent forwarding"* ]]
}

@test "ssh: connection timeout is categorizable (exit 255)" {
  export MOCK_SSH_MODE=timeout
  run ssh_health runner@192.168.1.50
  [ "$status" -eq 255 ]
  [[ "$output$stderr" == *"timed out"* ]]
}

@test "ssh: auth failure is categorizable (exit 255)" {
  export MOCK_SSH_MODE=auth
  run ssh_health runner@192.168.1.50
  [ "$status" -eq 255 ]
  [[ "$output$stderr" == *"Permission denied"* ]]
}

@test "ssh: connection refused is categorizable (exit 255)" {
  export MOCK_SSH_MODE=refused
  run ssh_health runner@192.168.1.50
  [ "$status" -eq 255 ]
  [[ "$output$stderr" == *"refused"* ]]
}

@test "runner-target validation: canonical config accepted" {
  cfg="$BATS_TEST_TMPDIR/ok.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
      - pool:ares
routing_rules:
  - prefer pool:ares for heavy CI
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: invalid runner name rejected" {
  cfg="$BATS_TEST_TMPDIR/bad.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: INVALID_UPPER
    type: pool
    mode: jit_ephemeral
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: canonical config with full metadata accepted" {
  cfg="$BATS_TEST_TMPDIR/full.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
      - pool:ares
    best_for:
      - heavy CI
      - Terraform plan
    avoid_for:
      - tiny status jobs
    notes:
      - default heavy autoscaling pool
routing_rules:
  - prefer pool:ares for heavy CI
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: invalid type rejected" {
  cfg="$BATS_TEST_TMPDIR/bad-type.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: not-a-real-type
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: invalid mode rejected" {
  cfg="$BATS_TEST_TMPDIR/bad-mode.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: always-on
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: invalid selector label (space) rejected" {
  cfg="$BATS_TEST_TMPDIR/bad-selector.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: missing type/mode rejected (not silently emitted empty)" {
  cfg="$BATS_TEST_TMPDIR/missing-type-mode.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing required field: type"* ]]
}

@test "runner-target validation: missing mode only rejected" {
  cfg="$BATS_TEST_TMPDIR/missing-mode.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing required field: mode"* ]]
}

@test "runner-target validation: missing preferred_selector rejected" {
  cfg="$BATS_TEST_TMPDIR/missing-selector.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing required field: preferred_selector"* ]]
}

@test "runner-target validation: blank name value rejected (present key, empty value)" {
  cfg="$BATS_TEST_TMPDIR/blank-name.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name:
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"blank name"* ]]
}

@test "runner-target validation: whitespace-only name value rejected" {
  cfg="$BATS_TEST_TMPDIR/whitespace-name.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name:    \n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"blank name"* ]]
}

@test "runner-target validation: second target with blank name rejected (first target valid)" {
  cfg="$BATS_TEST_TMPDIR/second-blank-name.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
  - name:
    type: static-host
    mode: persistent
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"blank name"* ]]
}

@test "runner-target validation: blank type value rejected (present key, empty value)" {
  cfg="$BATS_TEST_TMPDIR/blank-type.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type:
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: second target missing mode rejected (first target valid)" {
  cfg="$BATS_TEST_TMPDIR/second-missing-mode.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
  - name: atlas
    type: static-host
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"atlas"* ]]
}

@test "runner-target validation: best_for value with comma rejected (reserved cache delimiter)" {
  cfg="$BATS_TEST_TMPDIR/bad-comma.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
    best_for:
      - heavy CI, terraform
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: notes value with pipe rejected (reserved cache delimiter)" {
  cfg="$BATS_TEST_TMPDIR/bad-pipe.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
    notes:
      - shifts fields|malicious
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: avoid_for value with comma rejected across multiple targets" {
  cfg="$BATS_TEST_TMPDIR/bad-second-target.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
  - name: atlas
    type: static-host
    mode: persistent
    preferred_selector:
      - self-hosted
    avoid_for:
      - heavy jobs, gpu work
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
}

@test "runner-target validation: quoted routing rules with hostile content accepted" {
  cfg="$BATS_TEST_TMPDIR/quoted-hostile.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
routing_rules:
  - "owner: platform"
  - "# urgent"
  - "- leading dash"
  - "*star"
  - "yes"
  - "1.2.3"
  - "embedded \"quote\""
  - "embedded \\backslash\\"
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: unquoted routing rule with ': ' rejected (would parse as a mapping)" {
  cfg="$BATS_TEST_TMPDIR/unquoted-mapping.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
routing_rules:
  - owner: platform
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"mapping"* ]]
}

@test "runner-target validation: unquoted routing rule starting with '#' rejected (would truncate as a comment)" {
  cfg="$BATS_TEST_TMPDIR/unquoted-comment.yaml"
  printf 'schema: 1\nrouting_rules:\n  - # urgent\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant character"* ]]
}

@test "runner-target validation: unquoted routing rule starting with '-' rejected" {
  cfg="$BATS_TEST_TMPDIR/unquoted-leading-dash.yaml"
  printf 'schema: 1\nrouting_rules:\n  - - leading dash\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant character"* ]]
}

@test "runner-target validation: unquoted routing rule starting with '*' rejected" {
  cfg="$BATS_TEST_TMPDIR/unquoted-star.yaml"
  printf 'schema: 1\nrouting_rules:\n  - *star\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant character"* ]]
}

@test "runner-target validation: unquoted routing rule 'yes' rejected (boolean literal)" {
  cfg="$BATS_TEST_TMPDIR/unquoted-yes.yaml"
  printf 'schema: 1\nrouting_rules:\n  - yes\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"boolean/null literal"* ]]
}

@test "runner-target validation: unquoted routing rule '1.2.3' rejected (numeric-looking)" {
  cfg="$BATS_TEST_TMPDIR/unquoted-numeric.yaml"
  printf 'schema: 1\nrouting_rules:\n  - 1.2.3\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"looks numeric"* ]]
}

@test "runner-target validation: malformed quoted routing rule (unescaped inner quote) rejected" {
  cfg="$BATS_TEST_TMPDIR/malformed-quote.yaml"
  printf 'schema: 1\nrouting_rules:\n  - "bad "quote" here"\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Malformed quoted routing rule"* ]]
}

@test "runner-target validation: malformed quoted routing rule (unsupported escape) rejected" {
  cfg="$BATS_TEST_TMPDIR/malformed-escape.yaml"
  printf 'schema: 1\nrouting_rules:\n  - "line\\nbreak"\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Malformed quoted routing rule"* ]]
}

@test "runner-target validation: safe unquoted routing rule still accepted (no runner_targets section)" {
  cfg="$BATS_TEST_TMPDIR/local-override-safe.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
routing_rules:
  - prefer pool:atlas for everything
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: unsafe unquoted routing rule rejected on a routing_rules-only (local override) file" {
  cfg="$BATS_TEST_TMPDIR/local-override-unsafe.yaml"
  printf 'schema: 1\nrouting_rules:\n  - owner: platform\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"mapping"* ]]
}

# --- preferred_selector quoting (round 6 gap: unquoted YAML-significant labels) ---

@test "runner-target validation: unquoted selector label 'true' rejected (boolean literal)" {
  cfg="$BATS_TEST_TMPDIR/selector-true.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - true\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: unquoted selector label '1.2.3' rejected (numeric-looking)" {
  cfg="$BATS_TEST_TMPDIR/selector-numeric.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - 1.2.3\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: unquoted selector label 'tier:' rejected (trailing colon parses as mapping)" {
  cfg="$BATS_TEST_TMPDIR/selector-trailing-colon.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - tier:\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: unquoted selector label 'on' rejected (boolean literal)" {
  cfg="$BATS_TEST_TMPDIR/selector-on.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - on\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: quoted hostile selector labels (true, 1.2.3, tier:, on) accepted" {
  cfg="$BATS_TEST_TMPDIR/selector-quoted-hostile.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - "true"
      - "1.2.3"
      - "tier:"
      - "on"
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: quoted selector label still enforces the label charset" {
  cfg="$BATS_TEST_TMPDIR/selector-quoted-bad-charset.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - "self hosted"
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Invalid preferred_selector label"* ]]
}

# --- best_for/avoid_for/notes quoting (round 6 gap: free-text metadata is more exposed) ---

@test "runner-target validation: unquoted best_for 'owner: platform' rejected (mapping shape)" {
  cfg="$BATS_TEST_TMPDIR/metadata-mapping.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    best_for:\n      - owner: platform\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: unquoted best_for starting with '#' rejected (comment truncation)" {
  cfg="$BATS_TEST_TMPDIR/metadata-comment.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    best_for:\n      - #urgent\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: quoted best_for '#urgent' accepted (a real YAML parser would otherwise truncate it as a comment)" {
  cfg="$BATS_TEST_TMPDIR/metadata-comment-quoted.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
    best_for:
      - "#urgent"
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: unquoted notes starting with '-' rejected (nested sequence shape)" {
  cfg="$BATS_TEST_TMPDIR/metadata-leading-dash.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    notes:\n      - - leading dash\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: unquoted avoid_for 'yes' rejected (boolean literal)" {
  cfg="$BATS_TEST_TMPDIR/metadata-yes.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    avoid_for:\n      - yes\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: quoted hostile metadata values (': ', leading '#', leading '-', 'yes') accepted" {
  cfg="$BATS_TEST_TMPDIR/metadata-quoted-hostile.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
    best_for:
      - "owner: platform"
    avoid_for:
      - "yes"
    notes:
      - "- leading dash"
      - "# leading hash"
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

# --- name quoting (round 6 gap: DNS-safe charset overlaps YAML booleans/numbers) ---

@test "runner-target validation: unquoted runner name 'on' rejected (boolean literal, DNS-safe-regex-valid)" {
  cfg="$BATS_TEST_TMPDIR/name-on.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: on\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: unquoted runner name '42' rejected (numeric, DNS-safe-regex-valid)" {
  cfg="$BATS_TEST_TMPDIR/name-numeric.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: 42\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: quoted runner name 'on' accepted and still DNS-safe-validated" {
  cfg="$BATS_TEST_TMPDIR/name-quoted-on.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: "on"
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

# --- routing_rules null sequence item (round 6 gap: bare '-' is YAML null, silently dropped) ---

@test "runner-target validation: bare '-' routing_rules item rejected (YAML null, was silently dropped)" {
  cfg="$BATS_TEST_TMPDIR/routing-null-item.yaml"
  printf 'schema: 1\nrouting_rules:\n  - prefer pool:ares for heavy CI\n  -\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"null"* ]]
}

@test "runner-target validation: bare '- ' (trailing space) routing_rules item rejected" {
  cfg="$BATS_TEST_TMPDIR/routing-null-item-trailing-space.yaml"
  printf 'schema: 1\nrouting_rules:\n  - prefer pool:ares for heavy CI\n  - \n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"null"* ]]
}

# --- flow-collection hazard shapes (cubic P2: unquoted "- [wrong]"/"- {a: b}"
# passed validation as text while a real YAML parser reads them as a flow
# sequence/mapping — verified against `python3 -c "import yaml..."`) ---

@test "runner-target validation: unquoted notes '[wrong]' rejected (parses as a YAML list, not a string)" {
  cfg="$BATS_TEST_TMPDIR/notes-flow-seq.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    notes:\n      - [wrong]\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: unquoted notes '{a:1}' rejected (parses as a YAML mapping, not a string)" {
  cfg="$BATS_TEST_TMPDIR/notes-flow-map.yaml"
  # No ": " (colon-space) in the value, so this can't be caught by the
  # pre-existing implicit-mapping check — only a dedicated leading-'{' check
  # catches it. `python3 -c "import yaml; print(yaml.safe_load(open('...')))"`
  # confirms this parses to {'notes': [{'a:1': None}]}, not the string "{a:1}".
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    notes:\n      - {a:1}\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

@test "runner-target validation: quoted notes '\"[wrong]\"' and '\"{a: b}\"' accepted (real string, not a collection)" {
  cfg="$BATS_TEST_TMPDIR/notes-flow-quoted.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: ares
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - self-hosted
    notes:
      - "[wrong]"
      - "{a: b}"
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: unquoted routing rule starting with '[' rejected (flow sequence)" {
  cfg="$BATS_TEST_TMPDIR/routing-flow-seq.yaml"
  printf 'schema: 1\nrouting_rules:\n  - [wrong]\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant character"* ]]
}

# --- per-field schema bounds (maxItems/maxLength) the executable gate must
# enforce (cubic PRRT_kwDOQ3SUys6UMVNC: an 11-label preferred_selector import
# passed silently before this) ---

_gen_selector_count() {
  local count="$1"
  {
    printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n'
    for ((i = 1; i <= count; i++)); do printf '      - sel%d\n' "$i"; done
  }
}

@test "runner-target validation: preferred_selector at 10 items (maxItems boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/selector-10.yaml"
  _gen_selector_count 10 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: preferred_selector at 11 items rejected (maxItems: 10)" {
  cfg="$BATS_TEST_TMPDIR/selector-11.yaml"
  _gen_selector_count 11 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"too many preferred_selector items (11, max 10)"* ]]
}

_gen_metadata_count() {
  local field="$1" count="$2"
  {
    printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    %s:\n' "$field"
    for ((i = 1; i <= count; i++)); do printf '      - item %d\n' "$i"; done
  }
}

@test "runner-target validation: best_for at 10 items (maxItems boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/best-for-10.yaml"
  _gen_metadata_count best_for 10 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: best_for at 11 items rejected (maxItems: 10)" {
  cfg="$BATS_TEST_TMPDIR/best-for-11.yaml"
  _gen_metadata_count best_for 11 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"too many best_for items (11, max 10)"* ]]
}

@test "runner-target validation: avoid_for at 10 items (maxItems boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/avoid-for-10.yaml"
  _gen_metadata_count avoid_for 10 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: avoid_for at 11 items rejected (maxItems: 10)" {
  cfg="$BATS_TEST_TMPDIR/avoid-for-11.yaml"
  _gen_metadata_count avoid_for 11 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"too many avoid_for items (11, max 10)"* ]]
}

@test "runner-target validation: notes at 10 items (maxItems boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/notes-10.yaml"
  _gen_metadata_count notes 10 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: notes at 11 items rejected (maxItems: 10)" {
  cfg="$BATS_TEST_TMPDIR/notes-11.yaml"
  _gen_metadata_count notes 11 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"too many notes items (11, max 10)"* ]]
}

_gen_metadata_item_len() {
  local field="$1" len="$2" text
  text=$(printf 'x%.0s' $(seq 1 "$len"))
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    %s:\n      - %s\n' "$field" "$text"
}

@test "runner-target validation: best_for item at 200 chars (maxLength boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/best-for-len200.yaml"
  _gen_metadata_item_len best_for 200 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: best_for item at 201 chars rejected (maxLength: 200)" {
  cfg="$BATS_TEST_TMPDIR/best-for-len201.yaml"
  _gen_metadata_item_len best_for 201 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"best_for value exceeds 200 char limit (201 chars)"* ]]
}

@test "runner-target validation: avoid_for item at 201 chars rejected (maxLength: 200)" {
  cfg="$BATS_TEST_TMPDIR/avoid-for-len201.yaml"
  _gen_metadata_item_len avoid_for 201 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"avoid_for value exceeds 200 char limit (201 chars)"* ]]
}

@test "runner-target validation: notes item at 201 chars rejected (maxLength: 200)" {
  cfg="$BATS_TEST_TMPDIR/notes-len201.yaml"
  _gen_metadata_item_len notes 201 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"notes value exceeds 200 char limit (201 chars)"* ]]
}

@test "runner-target validation: quoted best_for item at 201 semantic chars still rejected (length checked on unwrapped value)" {
  cfg="$BATS_TEST_TMPDIR/best-for-quoted-len201.yaml"
  local text
  text=$(printf 'x%.0s' $(seq 1 201))
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    best_for:\n      - "%s"\n' "$text" >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"best_for value exceeds 200 char limit (201 chars)"* ]]
}

_gen_routing_rule_len() {
  local len="$1" text
  text=$(printf 'x%.0s' $(seq 1 "$len"))
  printf 'schema: 1\nrouting_rules:\n  - %s\n' "$text"
}

@test "runner-target validation: routing rule at 200 chars (maxLength boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/rule-len200.yaml"
  _gen_routing_rule_len 200 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: routing rule at 201 chars rejected (maxLength: 200)" {
  cfg="$BATS_TEST_TMPDIR/rule-len201.yaml"
  _gen_routing_rule_len 201 >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"routing rule exceeds 200 char limit (201 chars)"* ]]
}

@test "runner-target validation: quoted routing rule at 201 semantic chars still rejected (length checked on unwrapped value)" {
  cfg="$BATS_TEST_TMPDIR/rule-quoted-len201.yaml"
  local text
  text=$(printf 'x%.0s' $(seq 1 201))
  printf 'schema: 1\nrouting_rules:\n  - "%s"\n' "$text" >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"routing rule exceeds 200 char limit (201 chars)"* ]]
}

@test "runner-target validation: 20 runner targets (maxItems boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/targets-20.yaml"
  {
    printf 'schema: 1\nrunner_targets:\n'
    for ((i = 1; i <= 20; i++)); do
      printf '  - name: runner%02d\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n' "$i"
    done
  } >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: 21 runner targets rejected (maxItems: 20)" {
  cfg="$BATS_TEST_TMPDIR/targets-21.yaml"
  {
    printf 'schema: 1\nrunner_targets:\n'
    for ((i = 1; i <= 21; i++)); do
      printf '  - name: runner%02d\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n' "$i"
    done
  } >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Too many runner targets (21, max 20)"* ]]
}

@test "runner-target validation: 20 routing rules (maxItems boundary) accepted" {
  cfg="$BATS_TEST_TMPDIR/rules-20.yaml"
  {
    printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\nrouting_rules:\n'
    for ((i = 1; i <= 20; i++)); do printf '  - rule number %d\n' "$i"; done
  } >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: 21 routing rules rejected (maxItems: 20)" {
  cfg="$BATS_TEST_TMPDIR/rules-21.yaml"
  {
    printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\nrouting_rules:\n'
    for ((i = 1; i <= 21; i++)); do printf '  - rule number %d\n' "$i"; done
  } >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Too many routing rules (21, max 20)"* ]]
}

# --- `?`/`-` leading-indicator narrowing (cubic PRRT_kwDOQ3SUys6UMbDD: `?` is
# only the YAML explicit-mapping-key indicator when followed by a space or
# end-of-value — a legacy value like "?priority" is a plain string and must
# not be rejected; PyYAML-verified, see validate.sh's _rt_yaml_hazard_shape
# comment) ---

@test "runner-target validation: unquoted routing rule '?priority' accepted (no space after '?' — plain string per YAML)" {
  cfg="$BATS_TEST_TMPDIR/question-no-space.yaml"
  printf 'schema: 1\nrouting_rules:\n  - ?priority\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: unquoted routing rule '? priority' still rejected (space after '?' — explicit mapping key)" {
  cfg="$BATS_TEST_TMPDIR/question-space.yaml"
  printf 'schema: 1\nrouting_rules:\n  - ? priority\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant character"* ]]
}

@test "runner-target validation: bare '?' routing rule still rejected (explicit mapping key, no value)" {
  cfg="$BATS_TEST_TMPDIR/question-bare.yaml"
  printf 'schema: 1\nrouting_rules:\n  - ?\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant character"* ]]
}

@test "runner-target validation: unquoted best_for '-standalone' accepted (no space after '-' — plain string per YAML)" {
  cfg="$BATS_TEST_TMPDIR/dash-no-space.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    best_for:\n      - -standalone\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: bare '-' best_for item still rejected (block-sequence indicator, no value)" {
  cfg="$BATS_TEST_TMPDIR/dash-bare-best-for.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode: jit_ephemeral\n    preferred_selector:\n      - self-hosted\n    best_for:\n      - -\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YAML-significant"* ]]
}

# --- GNU-grep-only portability (cubic P1/P2: `grep -P` and GNU-only `\s`/`\w`
# escapes inside `grep -E` are absent from BSD/macOS grep — a `grep` stub on
# PATH that rejects `-P` like BSD grep does, real grep for everything else,
# reproduces the failure mode without needing an actual macOS host) ---

_stub_grep_without_dash_P() {
  cat >"$BATS_TEST_TMPDIR/grep" <<'SH'
#!/bin/bash
for arg in "$@"; do
  case "$arg" in
    -*P*) echo "grep: unknown option -- P" >&2; exit 2 ;;
  esac
done
exec /usr/bin/grep "$@"
SH
  chmod +x "$BATS_TEST_TMPDIR/grep"
  PATH="$BATS_TEST_TMPDIR:$PATH"
}

@test "runner-target validation: canonical fully-quoted config still validates without grep -P (BSD/macOS grep simulation)" {
  _stub_grep_without_dash_P
  cfg="$BATS_TEST_TMPDIR/canonical-quoted.yaml"
  cat >"$cfg" <<'YAML'
schema: 1
runner_targets:
  - name: "ares"
    type: pool
    mode: jit_ephemeral
    preferred_selector:
      - "self-hosted"
      - "pool:ares"
    best_for:
      - "heavy CI"
    notes:
      - "default heavy autoscaling pool"
routing_rules:
  - "prefer pool:ares for heavy CI"
YAML
  run validate_runner_targets_file "$cfg"
  [ "$status" -eq 0 ]
}

@test "runner-target validation: tabs still rejected without grep -P (was a fail-open false negative: grep -qP exit 2 made the 'if' false)" {
  _stub_grep_without_dash_P
  cfg="$BATS_TEST_TMPDIR/tab-file.yaml"
  printf 'schema: 1\nrunner_targets:\n  - name: ares\n    type: pool\n    mode:\tjit_ephemeral\n    preferred_selector:\n      - self-hosted\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Tabs found"* ]]
}

@test "runner-target validation: malformed quoted routing rule still rejected without grep -P" {
  _stub_grep_without_dash_P
  cfg="$BATS_TEST_TMPDIR/malformed-quote-noP.yaml"
  printf 'schema: 1\nrouting_rules:\n  - "bad "quote" here"\n' >"$cfg"
  run validate_runner_targets_file "$cfg"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Malformed quoted routing rule"* ]]
}

@test "non-Linux probe rejection + probe orchestration are markdown-scoped (not executable)" {
  skip "The runner-health probe orchestration and the 'Linux runner targets only' skip live in skills/ci-runner-health/SKILL.md — LLM-interpreted markdown, not executable shell; review-gated (mirrors gt-workflow's documented bats scope limitation)."
}
