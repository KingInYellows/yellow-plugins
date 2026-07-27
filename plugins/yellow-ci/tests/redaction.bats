#!/usr/bin/env bats
# redaction.bats — Tests for hooks/scripts/lib/redact.sh

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"
  TEST_LIB_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/lib" && pwd)"
  # shellcheck source=../hooks/scripts/lib/redact.sh
  . "${SCRIPT_DIR}/lib/redact.sh"
  # shellcheck source=lib/redaction-fuzz.bash
  . "${TEST_LIB_DIR}/redaction-fuzz.bash"
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

@test "redact: GitHub App user access token (ghu_)" {
  result=$(echo "ghu_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234" | redact_secrets)
  [[ "$result" == *"[REDACTED:github-token]"* ]]
  [[ "$result" != *"ghu_"* ]]
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

# The Basic-auth payloads below are BUILT AT RUNTIME rather than written as
# literals. A committed base64 string that decodes to `user:password` is
# indistinguishable from a real leaked credential to a secret scanner, and
# GitGuardian fails the build on it — a fixture that only ever exercises
# redaction should not itself look like the thing it is testing for.
@test "redact: Authorization Basic scheme" {
  payload=$(printf 'fixture:not-a-real-credential' | base64 | tr -d '\n')
  result=$(echo "Authorization: Basic $payload" | redact_secrets)
  [[ "$result" == *"Basic [REDACTED]"* ]]
  [[ "$result" != *"$payload"* ]]
}

@test "redact: Authorization header lowercase" {
  payload=$(printf 'fixture:not-a-real-credential' | base64 | tr -d '\n')
  result=$(echo "authorization: basic $payload" | redact_secrets)
  [[ "$result" == *"basic [REDACTED]"* ]]
  [[ "$result" != *"$payload"* ]]
}

@test "redact: Proxy-Authorization header" {
  payload=$(printf 'fixture:not-a-real-credential' | base64 | tr -d '\n')
  result=$(echo "Proxy-Authorization: Basic $payload" | redact_secrets)
  [[ "$result" == *"Basic [REDACTED]"* ]]
  [[ "$result" != *"$payload"* ]]
}

@test "redact: Authorization header with no scheme (bare credential)" {
  # Built at runtime for the same reason as the Basic payloads above: a
  # literal `sk_live_...` is a real Stripe live-key prefix and trips secret
  # scanners on a fixture that exists only to prove redaction works.
  bare_cred=$(printf 'sk_live_%s' "$(printf 'a%.0s' {1..24})")
  result=$(echo "Authorization: $bare_cred" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"$bare_cred"* ]]
}

@test "redact: Authorization Digest scheme (comma-separated params)" {
  result=$(echo 'Authorization: Digest username="alice", realm="test", nonce="dcd98b7102dd2f0e", response="6629fae49393a05397450978507c4ef1"' | redact_secrets)
  [[ "$result" == *"Digest [REDACTED]"* ]]
  [[ "$result" != *"6629fae49393a05397450978507c4ef1"* ]]
  [[ "$result" != *"dcd98b7102dd2f0e"* ]]
}

@test "redact: Authorization header does not consume a trailing URL" {
  result=$(echo 'curl -H "Authorization: Bearer TESTTOKEN0123456789ABCD" https://api.example.com/v1?x=1' | redact_secrets)
  [[ "$result" == *"https://api.example.com/v1?x=1"* ]]
  # Assert the credential is actually gone, not just that the URL survived —
  # without this the test passes even if the token leaks in full.
  [[ "$result" != *"TESTTOKEN0123456789ABCD"* ]]
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

# --- Label-clobber-guard sentinel (documented) ---

@test "redact: bracket-prefixed generic secret value IS redacted (sentinel fix)" {
  # The generic key/value catch-all excludes only whitespace and a sentinel
  # control byte (\x01) from the value's first char — not '[' — so a real
  # secret whose value starts with '[' is no longer exempted from redaction.
  # Regression guard: this used to be a documented trade-off (leading-'['
  # values silently skipped the catch-all); the PROTECT/RESTORE sentinel
  # pair in redact.sh now closes that gap without clobbering specific labels
  # (see the next test).
  result=$(echo "password=[rawsecretvalue123]" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"rawsecretvalue123"* ]]
}

@test "redact: specific labeled redaction survives the generic catch-all (label not clobbered)" {
  # Regression guard for the label-clobber bug this PR fixed: a 'token='-prefixed
  # ghp_ secret must stay [REDACTED:github-token], not be flattened to bare
  # [REDACTED] by the generic 'token=<value>' rule.
  result=$(echo "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234" | redact_secrets)
  [[ "$result" == *"[REDACTED:github-token]"* ]]
  [[ "$result" != *"ghp_"* ]]
  [[ "$result" != *"[REDACTED]"* ]]
}

@test "redact: forged [REDACTED-like value cannot bypass the catch-all" {
  # The PROTECT rule must only shield *complete* markers this pipeline
  # produced — not arbitrary attacker-controlled input that merely starts
  # with '[REDACTED'. Otherwise PROTECT->skip->RESTORE round-trips the
  # value back out unredacted.
  for forged in \
    "password=[REDACTEDsupersecret99]" \
    "password=[REDACTED-test-value99]" \
    "password=[REDACTED:evil]moresecret99" \
    "password=[REDACTED]moresecret99"; do
    result=$(echo "$forged" | redact_secrets)
    [[ "$result" == *"[REDACTED]"* ]]
    [[ "$result" != *"secret99"* ]]
    [[ "$result" != *"test-value99"* ]]
  done
}

@test "redact: raw sentinel byte in input cannot bypass the catch-all" {
  # \x01 is valid stdin data. If a caller can inject it, the catch-all's
  # sentinel exclusion would skip the value. Input sentinels are scrubbed
  # before any rule runs, so this must still redact.
  result=$(printf 'password=\x01supersecretvalue\n' | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"supersecretvalue"* ]]
}

@test "redact: labeled marker mid-line survives (not only at end of line)" {
  # PROTECT requires the marker be the whole value (followed by whitespace or
  # EOL). Guard that the whitespace branch works, not just the EOL branch.
  result=$(echo "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234 trailing words" | redact_secrets)
  [[ "$result" == *"[REDACTED:github-token] trailing words"* ]]
  [[ "$result" != *"ghp_"* ]]
}

@test "redact: labeled marker survives a following delimiter (not just whitespace/EOL)" {
  # The PROTECT boundary accepts any non-alphanumeric delimiter after the
  # marker's ']', so labels survive ',', '&', ')', etc. A stricter
  # whitespace-or-EOL boundary silently flattened these to bare [REDACTED].
  result=$(echo "https://x.com/?token=abc123def456&next=1" | redact_secrets)
  [[ "$result" == *"[REDACTED:url-param]&next=1"* ]]

  result=$(echo "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234," | redact_secrets)
  [[ "$result" == *"[REDACTED:github-token],"* ]]
  [[ "$result" != *"ghp_"* ]]
}

@test "redact: delimiter boundary does not reopen the forgery bypass" {
  # Guard that widening the boundary to non-alphanumeric did not let a forged
  # marker with an unseparated secret suffix through again.
  result=$(echo "password=[REDACTED:evil]moresecret99" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"moresecret99"* ]]
}

@test "redact: raw value that exactly matches the marker grammar is still fully redacted" {
  # A logged credential whose RAW value happens to equal the marker grammar
  # exactly (`[REDACTED]` or `[REDACTED:label]`, nothing else) must not
  # survive as a labeled marker it never earned. Protection is tied to
  # provenance (which specific rule produced it), not to shape, so this
  # falls through to the generic catch-all like any other secret-shaped
  # value instead of round-tripping through the sentinel unredacted.
  result=$(echo "token=[REDACTED:github-token]" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"[REDACTED:github-token]"* ]]
}

@test "redact: marker-shaped prefix does not shield a real secret suffix after a delimiter" {
  # A value that starts with marker-shaped text followed by a non-alphanumeric
  # delimiter and then real secret content must still be fully redacted. A
  # shape-based protection rule could stop at the delimiter and leave the
  # trailing real secret in cleartext; provenance-based protection can't,
  # since the prefix was never produced by a specific rule to begin with.
  result=$(echo "password=[REDACTED].therealsecretvalue123456" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"therealsecretvalue123456"* ]]
}

# --- Quoted values with embedded whitespace ---
#
# The generic catch-all's value pattern is a single contiguous non-whitespace
# run, so a shell-style `PASSWORD="two words"` assignment only ever matches
# (at most) the first token, leaking the remainder in cleartext. These guard
# the quoted-value rules that handle complete double- and single-quoted
# values, including embedded whitespace, for assignment forms and
# dash-prefixed flag forms.

@test "redact: double-quoted password with embedded whitespace" {
  result=$(echo 'PASSWORD="short secret suffix"' | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"short"* ]]
  [[ "$result" != *"secret suffix"* ]]
}

@test "redact: single-quoted token with embedded whitespace" {
  result=$(echo "TOKEN='a b c'" | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"a b c"* ]]
}

@test "redact: export-prefixed double-quoted api key with embedded whitespace" {
  result=$(echo 'export API_KEY="multi word value here"' | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"multi word value here"* ]]
}

@test "redact: long-flag quoted password with embedded whitespace" {
  result=$(echo '--password "spaced secret"' | redact_secrets)
  [[ "$result" == *"--password=[REDACTED:quoted]"* ]]
  [[ "$result" != *"spaced secret"* ]]
}

@test "redact: short -p flag quoted password with embedded whitespace" {
  result=$(echo 'mysql -u root -p "spaced secret" mydb' | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"spaced secret"* ]]
  [[ "$result" == *"mydb"* ]]
}

@test "redact: unquoted single-token password is still fully redacted (no regression)" {
  result=$(echo "PASSWORD=nospaces12345" | redact_secrets)
  [[ "$result" == *"[REDACTED]"* ]]
  [[ "$result" != *"nospaces12345"* ]]
}

@test "redact: colon-separated quoted secret" {
  result=$(echo 'secret: "a value with spaces"' | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"a value with spaces"* ]]
}

@test "redact: two quoted secrets on one line both redacted" {
  result=$(echo 'PASSWORD="a b" TOKEN="c d"' | redact_secrets)
  [[ "$result" != *"a b"* ]]
  [[ "$result" != *"c d"* ]]
}

@test "no-redact: quoted benign value with 'key' does not trigger (word not in denylist)" {
  result=$(echo 'Cache key "linux-x64-node20-abc123" restored successfully' | redact_secrets)
  [[ "$result" == 'Cache key "linux-x64-node20-abc123" restored successfully' ]]
}

@test "no-redact: quoted benign value after bare 'auth' substring without operator or dash" {
  result=$(echo 'Configuring OAuth "scope1 scope2" provider' | redact_secrets)
  [[ "$result" == 'Configuring OAuth "scope1 scope2" provider' ]]
}

# --- Escaped quotes inside quoted values ---
#
# A `[^"]*`-style value class treats an escaped `\"` (or `\'` in the
# single-quoted rules) as the closing delimiter, ending the match early and
# leaking everything after it in cleartext — and the `[REDACTED:quoted]`
# marker it still emits then shields that leaked suffix from the generic
# catch-all (provenance-tagged markers are exempt from re-matching). These
# guard that escaped delimiters are consumed as part of the value, not
# treated as the terminator, across every quoted-value rule (assignment and
# both flag forms).

@test "redact: double-quoted assignment with escaped inner quote" {
  result=$(printf '%s\n' 'PASSWORD="abc\"LEAKEDSUFFIX123"' | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"LEAKEDSUFFIX123"* ]]
  [[ "$result" != *"abc"* ]]
}

@test "redact: single-quoted assignment with escaped inner quote" {
  result=$(printf '%s\n' "TOKEN='a\\'LEAK2'" | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"LEAK2"* ]]
}

@test "redact: double-quoted value ending in an escaped backslash" {
  result=$(printf '%s\n' 'API_KEY="trailing\\"' | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"trailing"* ]]
}

@test "redact: long-flag double-quoted value with escaped inner quote" {
  result=$(printf '%s\n' '--password "esc\"aped leak3"' | redact_secrets)
  [[ "$result" == *"--password=[REDACTED:quoted]"* ]]
  [[ "$result" != *"leak3"* ]]
  [[ "$result" != *"esc"* ]]
}

@test "redact: short -p flag double-quoted value with escaped inner quote" {
  result=$(printf '%s\n' '-p "esc\"aped leak4"' | redact_secrets)
  [[ "$result" == *"[REDACTED:quoted]"* ]]
  [[ "$result" != *"leak4"* ]]
  [[ "$result" != *"esc"* ]]
}

# --- Sentinel-interaction regression (an earlier specific rule's marker
# breaking a quoted-value rule's ability to reach the true closing quote) ---
#
# ghp_/AKIA/etc. rules run BEFORE the quoted-value rules. If a quoted value
# contains one of those tokens, the specific rule substitutes it with its
# own `\x01REDACTED:<label>]` marker first. A quoted-value class that
# excludes \x01 then can't advance past that marker to reach the real
# closing quote — the match fails outright, and whatever came after the
# marker (inside the same quotes) falls through to the generic catch-all
# (partial redaction) or, for flag forms the catch-all doesn't recognize,
# is left completely unredacted. See redact.sh's "Sentinel interaction" note.

@test "redact: flag-form quoted value with an embedded GitHub token leaves no trailing cleartext" {
  result=$(printf '%s\n' '--password "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA TRAILINGLEAK1"' | redact_secrets)
  [[ "$result" != *"TRAILINGLEAK1"* ]]
  [[ "$result" != *"ghp_"* ]]
}

@test "redact: assignment-form quoted value with an embedded GitHub token leaves no trailing cleartext" {
  result=$(printf '%s\n' 'PASSWORD="ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB TRAILINGLEAK2"' | redact_secrets)
  [[ "$result" != *"TRAILINGLEAK2"* ]]
  [[ "$result" != *"ghp_"* ]]
}

@test "redact: -p flag quoted value with an embedded AWS key leaves no trailing cleartext" {
  result=$(printf '%s\n' '-p "AKIAIOSFODNN7EXAMPLE TRAILINGLEAK3"' | redact_secrets)
  [[ "$result" != *"TRAILINGLEAK3"* ]]
  [[ "$result" != *"AKIA"* ]]
}

@test "no-redact: over-redaction guard, an adjacent non-secret assignment is untouched" {
  # The value is a fixed placeholder, not a credential: these rules key on the
  # KEY name, never the value, so the literal text here is irrelevant to what
  # the test proves. Kept scanner-inert so secret detectors do not flag it.
  result=$(echo 'PASSWORD="REDACTME-PLACEHOLDER-A1" BUILD_ID="not-a-secret-12345"' | redact_secrets)
  [[ "$result" == *'BUILD_ID="not-a-secret-12345"'* ]]
  [[ "$result" != *"REDACTME-PLACEHOLDER-A1"* ]]
}

@test "no-redact: over-redaction guard, trailing prose after a quoted secret is untouched" {
  result=$(echo 'TOKEN="abc" and then normal text here' | redact_secrets)
  [[ "$result" == *"and then normal text here"* ]]
  [[ "$result" != *"abc"* ]]
}

# --- Property/fuzz test ---
#
# Three consecutive rounds of hand-enumerated fixtures each fixed the
# previous round's leak and introduced a new one (see redact.sh's "Sentinel
# interaction" note for the full chain). Enumerated cases only ever encode
# the LAST bug found, so this generates randomized quoted-credential lines
# (tests/lib/redaction-fuzz.bash) — combining quote style, escaped
# delimiters, embedded specific-rule tokens, and trailing content — and
# checks the invariant that actually matters: no byte of what went inside
# the quotes survives redaction, across a wide combination of shapes rather
# than a hand-picked few. Seeded (RANDOM=<seed>) so a failure is
# reproducible: re-run this generator standalone with the same seed and it
# reaches the same failing case at the same iteration index.

@test "redact: property — no byte of a fuzzed quoted secret survives redaction" {
  local seed=20260727
  local iterations=200
  RANDOM=$seed

  local i out secret
  for ((i = 0; i < iterations; i++)); do
    fuzz_generate_case
    out=$(printf '%s\n' "$FUZZ_LINE" | redact_secrets)

    for secret in "${FUZZ_SECRET_CHUNKS[@]}"; do
      if [[ "$out" == *"$secret"* ]]; then
        printf 'FUZZ FAILURE (seed=%d iteration=%d): secret chunk survived redaction\n' "$seed" "$i" >&2
        printf '  input:  %s\n' "$FUZZ_LINE" >&2
        printf '  output: %s\n' "$out" >&2
        printf '  leaked chunk: %s\n' "$secret" >&2
        return 1
      fi
    done

    if [ -n "$FUZZ_SAFE_MARKER" ] && [[ "$out" != *"$FUZZ_SAFE_MARKER"* ]]; then
      printf 'FUZZ FAILURE (seed=%d iteration=%d): over-redaction, a marker OUTSIDE the quotes was swallowed\n' "$seed" "$i" >&2
      printf '  input:  %s\n' "$FUZZ_LINE" >&2
      printf '  output: %s\n' "$out" >&2
      return 1
    fi
  done

  printf 'Fuzz OK: seed=%d iterations=%d, zero leaks, zero over-redactions\n' "$seed" "$iterations"
}
