#!/usr/bin/env bats
# Tests for check-resolve-text (credential refusal for text posted elsewhere)

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/check-resolve-text"

setup() {
  A="$BATS_TEST_TMPDIR/a.txt"
  B="$BATS_TEST_TMPDIR/b.txt"
  printf 'Out of scope: retry policy belongs in the client.\n' >| "$A"
  printf 'Follow-up from PR #7: src/a.ts\n' >| "$B"
}

@test "clean text exits 0" {
  run "$SCRIPT" "$A" "$B"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a credential shape in any file exits 2 and names it" {
  printf 'use AKIA''ABCDEFGHIJKLMNOP\n' >| "$B"
  run --separate-stderr "$SCRIPT" "$A" "$B"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"$B"* ]]
}

@test "a private key block exits 2" {
  printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "no arguments exits 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
}

@test "a missing file exits 2 like the sibling scripts" {
  run --separate-stderr "$SCRIPT" "$BATS_TEST_TMPDIR/nope"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"not readable"* ]]
}

@test "ordinary code that names credentials is not flagged" {
  printf '%s\n' 'token: string' 'password: z.string()' \
    'const API_KEY = process.env.API_KEY' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a very long single line is scanned to completion" {
  # The generous timeout only guards against a hang; speed is not asserted.
  command -v timeout >/dev/null 2>&1 || skip "timeout not installed"
  head -c 3000000 /dev/zero | tr '\0' 'a' >| "$A"
  run timeout 120 "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a line of many keyword matches under the cap finishes quickly and is clean" {
  command -v timeout >/dev/null 2>&1 || skip "timeout not installed"
  # 150 inword `bypass="false"` matches: below the per-line cap, not credentials.
  awk 'BEGIN { for (i = 0; i < 150; i++) printf "bypass=\"false\" "; printf "\n" }' >| "$A"
  run timeout 20 "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a line over the per-line match cap is refused, not scanned quadratically" {
  command -v timeout >/dev/null 2>&1 || skip "timeout not installed"
  # ~1.5 MB of non-credential matches; the cap bounds the work and refuses.
  awk 'BEGIN { for (i = 0; i < 100000; i++) printf "bypass=\"false\" "; printf "\n" }' >| "$A"
  run --separate-stderr timeout 20 "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"resolve-text: refused rule=too-many-matches line=1"* ]]
}

@test "an unquoted lowercase credential assignment exits 2" {
  printf '%s\n' 'password: hunter22' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf '%s\n' 'the api_key=abc12345xyz was committed' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "type annotations and prose about credentials are not flagged" {
  printf '%s\n' 'password: string' 'token: str' 'secret: Optional[str]' \
    'token: $TOKEN' 'The password: required field is validated.' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "an unquoted credential value containing a slash exits 2" {
  printf '%s\n' 'password: fake123/password' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "issue and PR URLs and long file paths are not flagged" {
  printf '%s\n' \
    'Filed https://github.com/KingInYellows/yellow-plugins/issues/123 for this.' \
    'See https://github.com/KingInYellows/yellow-plugins/pull/950#discussion_r12345' \
    'Edited src/components/UserProfile2/index.tsx and docs/brainstorms/2026-09-30-Review-resolve-hardening.md' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a bare mixed-case token with a digit and no slash still exits 2" {
  tok=$(printf 'aB3%.0s' {1..12})
  printf 'leaked %s here\n' "$tok" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "a slash-bearing token with base64 plus or equals still exits 2" {
  tok=$(printf 'aB3%.0s' {1..12})
  printf 'leaked %s+%s/%s here\n' "$tok" "$tok" "$tok" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'leaked %s/%s== here\n' "$tok" "$tok" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "a scanner failure exits 2 instead of reporting clean" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  printf '#!/bin/sh\nexit 2\n' >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"could not be scanned"* ]]
}

# Planted credentials below are obviously fake and assembled from pieces so
# this file contains no credential-shaped literal for repo or CI scanners.

pad() { head -c "$1" /dev/zero | tr '\0' 'A'; }

@test "each token prefix is flagged at its length floor and clean one below" {
  # prefix:floor (token length including the prefix)
  for spec in 'gh''p_:24' 'gh''o_:24' 'gh''u_:24' 'gh''s_:24' 'gh''r_:24' \
              'github''_pat_:30' 'AK''IA:20' 'xo''xb-:14' 'xo''xp-:14' \
              'sk''-:23' 'sk''_live_:24' 'rk''_live_:24' 'pk''_live_:24'; do
    prefix=${spec%:*}
    floor=${spec##*:}
    printf 'x %s%s y\n' "$prefix" "$(pad $((floor - ${#prefix})))" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 2 ] || { echo "not flagged at floor: $prefix"; false; }
    printf 'x %s%s y\n' "$prefix" "$(pad $((floor - ${#prefix} - 1)))" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged below floor: $prefix"; false; }
  done
}

@test "an uppercase NAME_KEY assignment with a literal value exits 2" {
  printf 'DB_PASSWORD=%s\n' "$(pad 8)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "a quoted keyword assignment exits 2" {
  printf '%s\n' 'const password = "hunter22"' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "unquoted keyword values: digit, all-letter and separated literals exit 2" {
  for t in 'secret: abc123def' 'password: hunter' 'password: correct-horse-battery'; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 2 ] || { echo "not flagged: $t"; false; }
  done
}

@test "a placeholder-only separated value is not flagged" {
  printf '%s\n' 'token: optional-string' 'password: required-value' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "unquoted values separated by punctuation such as . and @ exit 2" {
  for t in 'password: hunter@cats' 'token: correct.horse.battery' 'secret: horse+battery!staple'; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 2 ] || { echo "not flagged: $t"; false; }
  done
}

@test "placeholder-only punctuation-separated values and prose stay clean" {
  printf '%s\n' 'password: <placeholder>' 'token: the.value' 'secret: optional@string' \
    'The token: see the docs.' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "an Authorization or Bearer header with a 20+ character token exits 2" {
  printf 'Authorization: Bearer %s\n' "$(pad 20)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'sent bearer %s\n' "$(pad 20)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'Authorization: Bearer %s\n' "$(pad 19)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "credentials in URL userinfo exit 2" {
  printf 'clone https://deploy:%s@example.com/o/r.git\n' 'S3cr3t9x' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'postgres://app:%s@db.internal:5432/app\n' 'hunterhunter' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "URLs with a port, userinfo placeholders or a later @ are not flagged" {
  printf '%s\n' 'See https://example.com:443/path/a@b and https://user:${PASS}@example.com' \
    'postgres://app:<password>@db.internal/app' 'mailto:me@example.com' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a keyword inside a longer word is not a credential keyword" {
  printf '%s\n' 'bypass: something-else' 'We bypass: foobarbaz here' 'token=[REDACTED]' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a camelCase keyword and a digit-bearing value in a longer word still exit 2" {
  printf '%s\n' 'userPassword: hunter' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf '%s\n' 'mypassword: hunter22' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "a mixed-case URL, a long mixed-case path, a SHA and a thread ID are not flagged" {
  printf '%s\n' \
    'https://github.com/KingInYellows/Yellow-Plugins/blob/Main/plugins/Yellow-Review/Lib/Resolve-Text.sh' \
    'plugins/yellow-review/skills/PrReviewWorkflow2/scripts/Check-Resolve-Text' \
    'da39a3ee5e6b4b0d3255bfef95601890afd80709' \
    'Thread PRRT_kwDOLabcdE84Abcdef is out of scope.' \
    'LongCamelCaseIdentifierWithoutAnyDigitsInIt' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "rt_text_clean called bare under set -e returns on a clean file and fails on a hit" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  run sh -c '. "$1"; set -e; rt_text_clean "$2"; echo reached' sh "$LIB" "$A"
  [ "$status" -eq 0 ]
  [ "$output" = reached ]
  printf '%s\n' 'password: hunter22' >| "$A"
  run sh -c '. "$1"; set -e; rt_text_clean "$2"; echo reached' sh "$LIB" "$A"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "rt_looks_secret returns 2 and rt_text_clean fails on a missing file under sh, bash and zsh" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  for shell in sh bash zsh; do
    command -v "$shell" >/dev/null 2>&1 || continue
    run "$shell" -c '. "$1"; rt_looks_secret "$2"' "$shell" "$LIB" "$BATS_TEST_TMPDIR/nope"
    [ "$status" -eq 2 ] || { echo "$shell: rt_looks_secret status $status"; false; }
    run "$shell" -c '. "$1"; rt_text_clean "$2"' "$shell" "$LIB" "$BATS_TEST_TMPDIR/nope"
    [ "$status" -ne 0 ] || { echo "$shell: rt_text_clean treated a missing file as clean"; false; }
  done
}

@test "a base64-padded Authorization or Basic token of 20+ characters exits 2" {
  printf 'Authorization: Basic %s==\n' "$(pad 18)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'sent basic %s==\n' "$(pad 18)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'Authorization: %s==\n' "$(pad 18)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'Authorization: Basic %s==\n' "$(pad 17)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a token prefix after an = is flagged at its length floor and clean one below" {
  for spec in 'gh''p_:24' 'github''_pat_:30' 'AK''IA:20' 'xo''xb-:14' 'sk''-:23' 'sk''_live_:24'; do
    prefix=${spec%:*}
    floor=${spec##*:}
    printf 'x auth=%s%s y\n' "$prefix" "$(pad $((floor - ${#prefix})))" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 2 ] || { echo "not flagged after =: $prefix"; false; }
    printf 'x auth=%s%s y\n' "$prefix" "$(pad $((floor - ${#prefix} - 1)))" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged below floor after =: $prefix"; false; }
  done
}

@test "long camelCase identifiers with a digit are not flagged but random mixed-case tokens are" {
  printf '%s\n' \
    'Renamed reviewFindingsLedgerTransitionHelper2 and ReviewFindingsLedgerTransitionHelperFunction2.' \
    'Added parseThreadResponseForResolverRetry3 to the resolver.' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  printf 'leaked %s\n' 'qZ8xK2mLp9RtVw4YbN7cJd3HgF6sAe1U' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "the identifier exemption stops at 256 characters so appended key material is refused" {
  local unit='Abcd' body='' i
  for i in $(seq 1 63); do body="$body$unit"; done
  printf 'Renamed %sab12 today.\n' "$body" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  body=''
  for i in $(seq 1 65); do body="$body$unit"; done
  printf 'leaked %s%s\n' "$body" 'qZ8xK2mLp9RtVw4YbN7cJd3HgF6sAe1U' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

# Planted credentials are assembled from pieces, as above.

@test "a refusal names the rule and line on stderr and never prints the text" {
  tok="gh""p_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"
  printf 'first line is fine\nsecond has %s in it\n' "$tok" >| "$A"
  run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"resolve-text: refused rule=token-prefix line=2"* ]]
  [[ "$stderr" != *"$tok"* ]]
}

@test "a scanner failure reports scan failed on stderr" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  printf '#!/bin/sh\nexit 2\n' >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"resolve-text: scan failed"* ]]
  [[ "$stderr" != *"resolve-text: refused"* ]]
}

@test "usage and unreadable-file errors carry no resolve-text token" {
  run --separate-stderr "$SCRIPT"
  [ "$status" -eq 2 ]
  [[ "$stderr" != *"resolve-text:"* ]]
  run --separate-stderr "$SCRIPT" "$BATS_TEST_TMPDIR/nope"
  [ "$status" -eq 2 ]
  [[ "$stderr" != *"resolve-text:"* ]]
}

@test "RT_HIT_RULE and RT_HIT_LINE name the rule that matched, one rule per shape" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  check() {  # <expected rule> <line text>
    printf 'clean line\n%s\n' "$2" >| "$A"
    run sh -c '. "$1"; rt_looks_secret "$2"; printf "%s %s" "$RT_HIT_RULE" "$RT_HIT_LINE"' sh "$LIB" "$A"
    [ "$output" = "$1 2" ] || { echo "expected '$1 2', got '$output' for: $2"; false; }
  }
  check private-key '-----BEGIN RSA PRIVATE KEY-----'
  check name-key-assignment 'MY_API_KEY=abcdefgh12'
  check quoted-keyword-assignment 'password = "hunter22x"'
  check unquoted-keyword-value 'password: hunter22'
  check url-userinfo 'postgres://app:hunterhunter@db.internal/app'
  check authorization-header "Authorization: Bearer $(pad 24)"
  check token-prefix "x AK""IA$(pad 16) y"
  check long-token 'leaked qZ8xK2mLp9RtVw4YbN7cJd3HgF6sAe1U here'
}

@test "RT_HIT_RULE is empty after a clean scan or a missing file" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  run sh -c '. "$1"; RT_HIT_RULE=stale; rt_looks_secret "$2"; printf "[%s]" "$RT_HIT_RULE"' sh "$LIB" "$A"
  [ "$output" = "[]" ]
  run sh -c '. "$1"; RT_HIT_RULE=stale; rt_looks_secret "$2"; printf "[%s]" "$RT_HIT_RULE"' sh "$LIB" "$BATS_TEST_TMPDIR/nope"
  [ "$output" = "[]" ]
}

@test "a spaced API key label with a literal value is refused" {
  printf 'API key: hunter\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'api key = "abcd efgh"\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf 'api\tkey: hunterhunter\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "a spaced API key label with a placeholder or prose stays clean" {
  printf 'API key: string\nAPI key: <your key>\nThe API key is required for this call.\nRotate the api key before release.\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a percent-encoded URL password is flagged; percent placeholders stay clean" {
  printf '%s\n' 'https://deploy:p%40ss%21word@example.com/x' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
  printf '%s\n' 'https://user:%PASSWORD%@host' 'https://user:%s@host' \
    'https://user:%(password)s@host' 'https://user:${PASS}@host' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "every failing file is named on stderr in one call, and later files are still scanned" {
  printf 'use AKIA''ABCDEFGHIJKLMNOP\n' >| "$A"
  printf 'password: hunter2xyz\n' >| "$B"
  C="$BATS_TEST_TMPDIR/c.txt"
  printf 'clean text\n' >| "$C"
  run --separate-stderr "$SCRIPT" "$A" "$BATS_TEST_TMPDIR/nope" "$B" "$C"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"$A looks like"* ]]
  [[ "$stderr" == *"not readable: $BATS_TEST_TMPDIR/nope"* ]]
  [[ "$stderr" == *"$B looks like"* ]]
  [[ "$stderr" != *"$C"* ]]
}

@test "prose around a redaction marker is clean; a prose-embedded literal value is still refused" {
  printf '%s\n' 'the token=[REDACTED] is checked' 'the password: [REDACTED] was rotated' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  printf '%s\n' 'the token=abcdefgh is checked' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}
