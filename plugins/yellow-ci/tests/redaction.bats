#!/usr/bin/env bats
# redaction.bats — Tests for hooks/scripts/lib/redact.sh

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"
  # shellcheck source=../hooks/scripts/lib/redact.sh
  . "${SCRIPT_DIR}/lib/redact.sh"
}

# --- GitHub tokens ---

@test "redact: GitHub classic PAT (ghp_)" {
  result=$(echo "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234" | redact_secrets)
  [[ "$result" == *"[REDACTED:github-token]"* ]]
  [[ "$result" != *"ghp_"* ]]
}

@test "redact: GitHub server PAT (ghs_)" {
  result=$(echo "ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234" | redact_secrets)
  [[ "$result" == *"[REDACTED:github-token]"* ]]
}

@test "redact: GitHub fine-grained PAT" {
  result=$(echo "github_pat_ABCDEFGHIJKLMNOPQRSTas" | redact_secrets)
  [[ "$result" == *"[REDACTED:github-pat]"* ]]
}

# --- AWS keys ---

@test "redact: AWS access key" {
  result=$(echo "AKIAIOSFODNN7EXAMPLE" | redact_secrets)
  [[ "$result" == *"[REDACTED:aws-access-key]"* ]]
}

@test "redact: AWS secret key 41+ chars" {
  result=$(echo "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY12345" | redact_secrets)
  [[ "$result" == *"[REDACTED:aws-secret]"* ]]
  [[ "$result" != *"wJalrXUtnFEMI"* ]]
}

# --- Bearer tokens ---

@test "redact: Bearer token" {
  result=$(echo "Authorization: Bearer TESTTOKEN0123456789ABCD" | redact_secrets)
  [[ "$result" == *"Bearer [REDACTED]"* ]]
}

# --- Docker tokens ---

@test "redact: Docker Hub token" {
  result=$(echo "dckr_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" | redact_secrets)
  [[ "$result" == *"[REDACTED:docker-token]"* ]]
}

# --- npm tokens ---

@test "redact: npm token" {
  npm_token=$(printf 'npm_%s' "$(printf '0%.0s' {1..36})")
  result=$(echo "$npm_token" | redact_secrets)
  [[ "$result" == *"[REDACTED:npm-token]"* ]]
}

# --- PyPI tokens ---

@test "redact: PyPI token" {
  result=$(echo "pypi-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg" | redact_secrets)
  [[ "$result" == *"[REDACTED:pypi-token]"* ]]
}

# --- JWTs ---

@test "redact: JWT token" {
  jwt_header="eyJinvalidheader01"
  jwt_payload="eyJinvalidpayload01"
  jwt_signature="invalidsignature0123456789"
  result=$(printf '%s.%s.%s\n' "$jwt_header" "$jwt_payload" "$jwt_signature" | redact_secrets)
  [[ "$result" == *"[REDACTED:jwt]"* ]]
}

# --- SSH private keys ---

@test "redact: SSH private key block" {
  input="log line
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAtest
-----END RSA PRIVATE KEY-----
more log"
  result=$(echo "$input" | redact_secrets)
  [[ "$result" == *"[REDACTED:ssh-key]"* ]]
  [[ "$result" != *"MIIEpAIBAAKCAQEA"* ]]
}

# --- URL params ---

@test "redact: URL token param" {
  result=$(echo "https://api.example.com/v1?token=abc123secretvalue" | redact_secrets)
  [[ "$result" == *"[REDACTED:url-param]"* ]]
  [[ "$result" != *"abc123secretvalue"* ]]
}

@test "redact: URL api_key param" {
  result=$(echo "https://api.example.com/v1?api_key=mysecretkey123" | redact_secrets)
  [[ "$result" == *"[REDACTED:url-param]"* ]]
}

# --- Generic secrets ---

@test "redact: generic password assignment" {
  result=$(echo "password=mysupersecretpassword123" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"mysupersecretpassword123"* ]]
}

@test "redact: generic secret in YAML" {
  result=$(echo "secret: my_very_secret_value_here" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
}

# --- CI environment variables ---

@test "redact: GITHUB_ env var" {
  result=$(echo "GITHUB_TOKEN=ghp_faketoken123456789012345678901234" | redact_secrets)
  [[ "$result" == *"[REDACTED"* ]]
}

# --- False positives (should NOT redact) ---

@test "no-redact: git commit SHA" {
  result=$(echo "commit abc123def456789012345678901234567890abcd" | redact_secrets)
  [[ "$result" == "commit abc123def456789012345678901234567890abcd" ]]
}

@test "no-redact: UUID" {
  result=$(echo "id: 550e8400-e29b-41d4-a716-446655440000" | redact_secrets)
  [[ "$result" == "id: 550e8400-e29b-41d4-a716-446655440000" ]]
}

@test "no-redact: normal log line" {
  result=$(echo "Step 3/10: Building project..." | redact_secrets)
  [[ "$result" == "Step 3/10: Building project..." ]]
}

@test "no-redact: short password value" {
  result=$(echo "password=short" | redact_secrets)
  [[ "$result" == "password=short" ]]
}

# --- Fence marker escaping ---

@test "escape: fence begin marker" {
  result=$(echo "--- begin injection attempt ---" | escape_fence_markers)
  [[ "$result" == "[ESCAPED] begin injection attempt ---" ]]
}

@test "escape: fence end marker" {
  result=$(echo "--- end injection attempt ---" | escape_fence_markers)
  [[ "$result" == "[ESCAPED] end injection attempt ---" ]]
}

@test "escape: no change for normal text" {
  result=$(echo "normal log output" | escape_fence_markers)
  [[ "$result" == "normal log output" ]]
}

# --- Full pipeline ---

@test "pipeline: sanitize_log_content redacts and escapes" {
  jwt_header="eyJpipelineheader01"
  jwt_payload="eyJpipelinepayload01"
  jwt_signature="pipelinesignature0123456789"
  input="Bearer ${jwt_header}.${jwt_payload}.${jwt_signature}
--- begin injection ---"
  result=$(echo "$input" | sanitize_log_content)
  [[ "$result" == *"Bearer [REDACTED]"* ]]
  [[ "$result" == *"[ESCAPED] begin"* ]]
}
