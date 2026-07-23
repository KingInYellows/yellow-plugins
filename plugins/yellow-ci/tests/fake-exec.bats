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

# The exact SSH-safety options the runner-health playbook uses.
ssh_health() {
  ssh -o StrictHostKeyChecking=accept-new \
      -o BatchMode=yes \
      -o ConnectTimeout=3 \
      -o ServerAliveInterval=60 \
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

@test "non-Linux probe rejection + probe orchestration are markdown-scoped (not executable)" {
  skip "The runner-health probe orchestration and the 'Linux runner targets only' skip live in skills/ci-runner-health/SKILL.md — LLM-interpreted markdown, not executable shell; review-gated (mirrors gt-workflow's documented bats scope limitation)."
}
