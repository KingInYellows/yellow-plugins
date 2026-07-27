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

@test "non-Linux probe rejection + probe orchestration are markdown-scoped (not executable)" {
  skip "The runner-health probe orchestration and the 'Linux runner targets only' skip live in skills/ci-runner-health/SKILL.md — LLM-interpreted markdown, not executable shell; review-gated (mirrors gt-workflow's documented bats scope limitation)."
}
