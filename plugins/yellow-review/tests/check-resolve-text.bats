#!/usr/bin/env bats
# Tests for check-resolve-text (credential refusal for text posted elsewhere)

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/check-resolve-text"

setup() {
  # Host-default tests must not depend on the caller's environment.
  unset RT_ALLOWED_HOST GH_HOST
  A="$BATS_TEST_TMPDIR/a.txt"
  B="$BATS_TEST_TMPDIR/b.txt"
  printf 'Out of scope: retry policy belongs in the client.\n' >| "$A"
  printf 'Follow-up from PR #7: src/a.ts\n' >| "$B"
}

# require_timeout: set TIMEOUT_BIN to `timeout` or `gtimeout` (macOS coreutils),
# or skip the calling test when neither is installed.
require_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    TIMEOUT_BIN=timeout
  elif command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_BIN=gtimeout
  else
    skip "neither timeout nor gtimeout is installed"
  fi
}

@test "clean text exits 0" {
  run "$SCRIPT" "$A" "$B"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a credential shape in any file exits 6 and names it" {
  printf 'use AKIA''ABCDEFGHIJKLMNOP\n' >| "$B"
  run --separate-stderr "$SCRIPT" "$A" "$B"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"$B"* ]]
}

@test "an executable named yr_awk on PATH is never run as the scanner" {
  bin="$BATS_TEST_TMPDIR/fakebin"
  mkdir -p "$bin"
  marker="$BATS_TEST_TMPDIR/yr_awk-ran"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$marker" >| "$bin/yr_awk"
  chmod +x "$bin/yr_awk"
  printf 'use AKIA''ABCDEFGHIJKLMNOP\n' >| "$B"
  PATH="$bin:$PATH" run --separate-stderr "$SCRIPT" "$A" "$B"
  [ "$status" -eq 6 ]
  [ ! -e "$marker" ]
}

@test "a private key block exits 6" {
  printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
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
  require_timeout
  head -c 3000000 /dev/zero | tr '\0' 'a' >| "$A"
  run "$TIMEOUT_BIN" 120 "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a line of many keyword matches under the cap finishes quickly and is clean" {
  require_timeout
  # 150 inword `bypass="false"` matches: below the per-line cap, not credentials.
  awk 'BEGIN { for (i = 0; i < 150; i++) printf "bypass=\"false\" "; printf "\n" }' >| "$A"
  run "$TIMEOUT_BIN" 20 "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a line over the per-line match cap is refused, not scanned quadratically" {
  require_timeout
  # ~1.5 MB of non-credential matches; the cap bounds the work and refuses.
  awk 'BEGIN { for (i = 0; i < 100000; i++) printf "bypass=\"false\" "; printf "\n" }' >| "$A"
  run --separate-stderr "$TIMEOUT_BIN" 20 "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"resolve-text: refused rule=too-many-matches line=1"* ]]
}

@test "an unquoted lowercase credential assignment exits 6" {
  printf '%s\n' 'password: hunter22' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf '%s\n' 'the api_key=abc12345xyz was committed' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "type annotations and prose about credentials are not flagged" {
  printf '%s\n' 'password: string' 'token: str' 'secret: Optional[str]' \
    'token: $TOKEN' 'The password: required field is validated.' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "an unquoted credential value containing a slash exits 6" {
  printf '%s\n' 'password: fake123/password' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "issue and PR URLs and long file paths are not flagged" {
  printf '%s\n' \
    'Filed https://github.com/KingInYellows/yellow-plugins/issues/123 for this.' \
    'See https://github.com/KingInYellows/yellow-plugins/pull/950#discussion_r12345' \
    'Edited src/components/UserProfile2/index.tsx and docs/brainstorms/2026-09-30-Review-resolve-hardening.md' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a bare mixed-case token with a digit and no slash still exits 6" {
  tok=$(printf 'aB3%.0s' {1..12})
  printf 'leaked %s here\n' "$tok" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "a slash-bearing token with base64 plus or equals still exits 6" {
  tok=$(printf 'aB3%.0s' {1..12})
  printf 'leaked %s+%s/%s here\n' "$tok" "$tok" "$tok" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'leaked %s/%s== here\n' "$tok" "$tok" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "a scanner failure exits 6 instead of reporting clean" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  printf '#!/bin/sh\nexit 2\n' >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"could not be scanned"* ]]
}

# Planted credentials below are obviously fake and assembled from pieces so
# this file contains no credential-shaped literal for repo or CI scanners.

pad() { head -c "$1" /dev/zero | tr '\0' 'A'; }

# awk_expect <awk binary> <expected status> <text> [locale]: scan <text> (printf
# %b escapes) with <binary> exposed as `awk`, under <locale> when given.
awk_expect() {
  local dir="${BATS_TEST_TMPDIR}/awkbin-$1"
  mkdir -p "$dir"
  ln -sfn "$(command -v "$1")" "$dir/awk"
  printf '%b' "$3" >| "$A"
  PATH="$dir:${PATH}" LC_ALL="${4-}" run "$SCRIPT" "$A"
  [ "$status" -eq "$2" ] || { echo "$1 ${4:-default locale}: want $2 got $status for [$3]"; false; }
}

# accented_status <awk binary> [locale]: the expected status for an accented
# first word followed by ASCII words. Only a multibyte gawk can tell the letter
# from punctuation (prose, 0); byte-wise awk (mawk, gawk in C) fails closed (6).
accented_status() {
  local loc="${2-}"
  [ -n "$loc" ] || loc="${LC_ALL:-${LC_CTYPE:-${LANG-}}}"
  case "$1:$loc" in
    gawk:*[Uu][Tt][Ff]-8 | gawk:*[Uu][Tt][Ff]8) echo 0 ;;
    *) echo 6 ;;
  esac
}

# locale_installed <name>: C.UTF-8 is listed as C.utf8 by `locale -a`.
locale_installed() {
  locale -a 2>/dev/null | tr 'A-Z' 'a-z' | grep -qx "$(printf '%s' "$1" | tr -d '-' | tr 'A-Z' 'a-z')"
}

@test "each token prefix is flagged at its length floor and clean one below" {
  # prefix:floor (token length including the prefix)
  for spec in 'gh''p_:24' 'gh''o_:24' 'gh''u_:24' 'gh''s_:24' 'gh''r_:24' \
              'github''_pat_:30' 'AK''IA:20' 'xo''xb-:14' 'xo''xp-:14' \
              'sk''-:23' 'sk''_live_:24' 'rk''_live_:24' 'pk''_live_:24' \
              'tv''ly-:25' 'pp''lx-:45' 'sg''p_:24'; do
    prefix=${spec%:*}
    floor=${spec##*:}
    printf 'x %s%s y\n' "$prefix" "$(pad $((floor - ${#prefix})))" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged at floor: $prefix"; false; }
    printf 'x %s%s y\n' "$prefix" "$(pad $((floor - ${#prefix} - 1)))" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged below floor: $prefix"; false; }
  done
}

@test "an uppercase NAME_KEY assignment with a literal value exits 6" {
  printf 'DB_PASSWORD=%s\n' "$(pad 8)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "a quoted keyword assignment exits 6" {
  printf '%s\n' 'const password = "hunter22"' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "unquoted keyword values: digit, all-letter and separated literals exit 6" {
  for t in 'secret: abc123def' 'password: hunter' 'password: correct-horse-battery'; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $t"; false; }
  done
}

@test "a placeholder-only separated value is not flagged" {
  printf '%s\n' 'token: optional-string' 'password: required-value' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "unquoted values separated by punctuation such as . and @ exit 6" {
  for t in 'password: hunter@cats' 'token: correct.horse.battery' 'secret: horse+battery!staple'; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $t"; false; }
  done
}

@test "placeholder-only punctuation-separated values and prose stay clean" {
  printf '%s\n' 'password: <placeholder>' 'token: the.value' 'secret: optional@string' \
    'The token: see the docs.' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "an unquoted keyword value wrapped in punctuation is judged unwrapped" {
  for t in 'password: !hunter!' 'password: @hunter@' 'password: (hunter)' 'token: ~hunter~' \
    'secret: **hunter**' 'password: !hunter@cats!' 'token: ~correct-horse-battery~' \
    'password: (correct-horse-battery)'; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $t"; false; }
  done
  printf '%s\n' 'password: **string**' 'token: ~optional~' 'secret: (optional@string)' \
    'password: ***' 'token: --flag' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a keyword value wrapped in Markdown inline-code backticks is judged unwrapped" {
  for t in 'password: `hunter`' 'token: `correct-horse-battery`' 'secret: `hunter`.' 'password: `hunter22`'; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $t"; false; }
  done
  printf '%s\n' 'password: `string`' 'token: `$TOKEN`' 'The token: `abc`.' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "an Authorization or Bearer header with a 20+ character token exits 6" {
  printf 'Authorization: Bearer %s\n' "$(pad 20)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'sent bearer %s\n' "$(pad 20)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'Authorization: Bearer %s\n' "$(pad 19)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "credentials in URL userinfo exit 6" {
  printf 'clone https://deploy:%s@example.com/o/r.git\n' 'S3cr3t9x' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'postgres://app:%s@db.internal:5432/app\n' 'hunterhunter' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "URLs with a port, userinfo placeholders or a later @ are not flagged" {
  export RT_ALLOWED_HOST=example.com
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

@test "a camelCase keyword and a digit-bearing value in a longer word still exit 6" {
  printf '%s\n' 'userPassword: hunter' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf '%s\n' 'mypassword: hunter22' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
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

@test "rt_text_clean returns 2 on a missing file, 1 on a hit and 0 when clean, under sh, bash and zsh" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  printf '%s\n' 'password: hunter22' >| "$BATS_TEST_TMPDIR/hit.txt"
  for shell in sh bash zsh; do
    command -v "$shell" >/dev/null 2>&1 || continue
    run "$shell" -c '. "$1"; rt_text_clean "$2"' "$shell" "$LIB" "$BATS_TEST_TMPDIR/nope"
    [ "$status" -eq 2 ] || { echo "$shell: missing file status $status"; false; }
    run "$shell" -c '. "$1"; rt_text_clean "$2"' "$shell" "$LIB" "$BATS_TEST_TMPDIR/hit.txt"
    [ "$status" -eq 1 ] || { echo "$shell: hit status $status"; false; }
    run "$shell" -c '. "$1"; rt_text_clean "$2"' "$shell" "$LIB" "$A"
    [ "$status" -eq 0 ] || { echo "$shell: clean status $status"; false; }
  done
}

@test "a base64-padded Authorization or Basic token of 20+ characters exits 6" {
  printf 'Authorization: Basic %s==\n' "$(pad 18)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'sent basic %s==\n' "$(pad 18)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'Authorization: %s==\n' "$(pad 18)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'Authorization: Basic %s==\n' "$(pad 17)" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "an unpadded Basic credential of 18 or 19 characters exits 6" {
  for cred in 'user:pass1234' 'user:pass12345'; do
    tok=$(printf '%s' "$cred" | base64 | tr -d '\n=')
    echo "len ${#tok}"
    [ "${#tok}" -ge 18 ] && [ "${#tok}" -le 19 ]
    printf 'Authorization: Basic %s\n' "$tok" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    printf 'sent basic %s.\n' "$tok" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
  done
  # 18/19 characters of non-credential text stay clean
  for tok in 'AuthenticationHelp' 'AuthenticationHelpe'; do
    printf 'Authorization: Basic %s\n' "$tok" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ]
  done
}

@test "a token prefix after an = is flagged at its length floor and clean one below" {
  for spec in 'gh''p_:24' 'github''_pat_:30' 'AK''IA:20' 'xo''xb-:14' 'sk''-:23' 'sk''_live_:24' 'tv''ly-:25' 'pp''lx-:45' 'sg''p_:24'; do
    prefix=${spec%:*}
    floor=${spec##*:}
    printf 'x auth=%s%s y\n' "$prefix" "$(pad $((floor - ${#prefix})))" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged after =: $prefix"; false; }
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
  [ "$status" -eq 6 ]
}

@test "a Slack webhook URL and a glpat token are refused; ordinary services paths are not" {
  export RT_ALLOWED_HOST=example.com
  check_refused() {
    printf '%s\n' "$1" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
  }
  check_refused "posted to https://hooks.slack.com/services/T0A1B2C3D/B0E1F2G3H/$(printf '%s%s' aB3dE5gH7jK9 mN1pQ3sT5uVw)"
  check_refused "token glpat-$(printf '%s%s' aB3dE5gH7jK9 mN1pQ3sT)"
  printf '%s\n' 'see https://example.com/services/Tracker/Billing/handlers and com/services/Tracker/Billing/Retry2' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a path with a token-shaped segment is refused; Java paths, acronyms and SHA segments are not" {
  printf '%s\n' 'leaked path/to/qZ8xK2mLp9RtVw4YbN7cJd3H/x' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf '%s\n' \
    'src/main/java/com/acme/ReviewFindingsLedgerTransitionHelperFactory2/Impl' \
    'src/main/java/com/acme/HTTPServerRequestHandlerFactory3/Impl' \
    'objects/da39a3ee5e6b4b0d3255bfef95601890afd80709/Readme/Impl1' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
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
  [ "$status" -eq 6 ]
}

# Planted credentials are assembled from pieces, as above.

@test "a refusal names the rule and line on stderr and never prints the text" {
  tok="gh""p_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"
  printf 'first line is fine\nsecond has %s in it\n' "$tok" >| "$A"
  run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"resolve-text: refused rule=token-prefix line=2"* ]]
  [[ "$stderr" != *"$tok"* ]]
}

@test "a scanner failure reports scan failed on stderr" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  printf '#!/bin/sh\nexit 2\n' >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
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
    run sh -c '. "$1"; rt_text_clean "$2"; printf "%s %s" "$RT_HIT_RULE" "$RT_HIT_LINE"' sh "$LIB" "$A"
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
  run sh -c '. "$1"; RT_HIT_RULE=stale; rt_text_clean "$2"; printf "[%s]" "$RT_HIT_RULE"' sh "$LIB" "$A"
  [ "$output" = "[]" ]
  run sh -c '. "$1"; RT_HIT_RULE=stale; rt_text_clean "$2"; printf "[%s]" "$RT_HIT_RULE"' sh "$LIB" "$BATS_TEST_TMPDIR/nope"
  [ "$output" = "[]" ]
}

@test "a spaced API key label with a literal value is refused" {
  printf 'API key: hunter\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'api key = "abcd efgh"\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'api\tkey: hunterhunter\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "a spaced API key label with a placeholder or prose stays clean" {
  printf 'API key: string\nAPI key: <your key>\nThe API key is required for this call.\nRotate the api key before release.\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a percent-encoded URL password is flagged; percent placeholders stay clean" {
  export RT_ALLOWED_HOST=host
  printf '%s\n' 'https://deploy:p%40ss%21word@example.com/x' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
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
  [ "$status" -eq 6 ]
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
  [ "$status" -eq 6 ]
}

@test "a URL password that merely contains a percent placeholder is refused; whole-password placeholders stay clean" {
  export RT_ALLOWED_HOST=host
  for t in 'https://u:Hunter2%s@example.com/x' 'https://u:p%zz1word@host' \
    'https://deploy:p%40ss%21word@example.com/x'; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
  done
  printf '%s\n' 'https://user:%PASSWORD%@host' 'https://user:%s@host' \
    'https://user:%(password)s@host' 'https://user:${PASS}@host' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a keyword alone on a line checks the next non-blank line as its value" {
  check() {
    printf '%b' "$2" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    [[ "$stderr" == *"rule=$1 "* ]]
  }
  check unquoted-keyword-value 'password:\n  hunter\n'
  check unquoted-keyword-value 'token:\n  abcdefghij\n'
  check unquoted-keyword-value 'db_password:\n\n  - hunter22\n'
  check unquoted-keyword-value 'password:\r\n  hunter\r\n'
  check quoted-keyword-assignment 'api_key:\n    "s3cr3tvalue"\n'
}

@test "next-line values that are placeholders, prose or out of reach stay clean" {
  while IFS= read -r t; do
    printf '%b' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ]
  done <<'CASES'
password:\n  string\n
token:\n  <your token>\n
password:\n\nNext paragraph of prose.\n
password:\n  Rotation is scheduled for Friday\n
Keep the password:\nthe team agreed to rotate it\n
Keep the password:\nsomething\n
password:\nok\nhunterhunter\n
bypass:\n  something\n
CASES
}

@test "CRLF line endings do not hide an all-letter literal; a CRLF placeholder stays clean" {
  printf 'password: hunter\r\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'password: string\r\ntoken: <your token>\r\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "rt_code_clean --strict skips keyword rules but keeps high-precision ones" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  # shellcheck source=../lib/resolve-text.sh
  . "$LIB"
  for t in 'password = "hunter22"' 'API_KEY=abcd1234efgh5678' 'token: string' 'password: hunter22'; do
    printf '%s\n' "$t" >| "$A"
    if [ "$t" != 'token: string' ]; then
      run rt_code_clean "$A"
      [ "$status" -eq 1 ] || { echo "keyword rules missed: $t"; false; }
    fi
    run rt_code_clean --strict "$A"
    [ "$status" -eq 0 ] || { echo "strict flagged: $t"; false; }
  done
  for t in 'x ghp_abcdefghijklmnopqrstuvwxyz0123456789' 'AKIA''ABCDEFGHIJKLMNOP' \
           'ASIA''ABCDEFGHIJKLMNOP' 'gl''pat-abcdefghijklmnopqrstu1234' \
           'xoxb-1234567890-abcdef' 'sk-ant-abcdefghijklmnopqrstuvwxyz' \
           'AIzaSyA1234567890abcdefghijklmnopqrstuvw' \
           'aB3dEf6hIj9kLm2n''Op5qRs8tUv1wXy4zAb' '-----BEGIN PRIVATE KEY-----'; do
    printf '%s\n' "$t" >| "$A"
    run rt_code_clean --strict "$A"
    [ "$status" -eq 1 ] || { echo "strict missed: $t"; false; }
  done
}

@test "rt_code_clean --strict keeps the URL-userinfo rule and the keyword-in-word anchoring" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  # shellcheck source=../lib/resolve-text.sh
  . "$LIB"
  printf 'clone https://deploy:%s@example.com/o/r.git\n' 'S3cr3t9x' >| "$A"
  run rt_code_clean --strict "$A"
  [ "$status" -eq 1 ]
  printf '%s\n' 'bypass: something-else' >| "$A"
  run rt_code_clean --strict "$A"
  [ "$status" -eq 0 ]
}

@test "rt_code_clean ignores what only text posted publicly refuses, and rt_text_clean does not" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  # shellcheck source=../lib/resolve-text.sh
  . "$LIB"
  printf '%s\n' '@Injectable() class A {}' 'see https://evil.example/x and ![i](x.png)' >| "$A"
  run rt_code_clean "$A"
  [ "$status" -eq 0 ]
  run rt_text_clean "$A"
  [ "$status" -eq 1 ]
}

@test "rt_code_clean returns 2 on a missing file and clears a stale RT_HIT_RULE" {
  LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh"
  run sh -c '. "$1"; RT_HIT_RULE=stale; rt_code_clean "$2"; printf "%s [%s]" "$?" "$RT_HIT_RULE"' sh "$LIB" "$BATS_TEST_TMPDIR/nope"
  [ "$output" = "2 []" ]
}

# rt_added_lines (lib/resolve-text.sh): fixed diffs, exact output.

@test "rt_added_lines prints added lines without the plus and skips file headers" {
  run bash -c ". '$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh'; rt_added_lines" <<'DIFF'
diff --git a/f.txt b/f.txt
index 111..222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,3 @@
 context
-removed
+added one
+ indented add
DIFF
  [ "$status" -eq 0 ]
  [ "$output" = $'added one\n indented add' ]
}

@test "rt_added_lines keeps an added line that itself starts with ++ or --" {
  run bash -c ". '$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh'; rt_added_lines" <<'DIFF'
diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1 +1,2 @@
+++ x
+-- y
DIFF
  [ "$output" = $'++ x\n-- y' ]
}

@test "rt_added_lines ignores the no-newline marker and removed lines" {
  run bash -c ". '$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh'; rt_added_lines" <<'DIFF'
diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1 +1 @@
-old
\ No newline at end of file
+new
\ No newline at end of file
DIFF
  [ "$output" = new ]
}

@test "rt_added_lines prints nothing for a hunk-less diff and for empty input" {
  run bash -c ". '$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh'; rt_added_lines" <<'DIFF'
diff --git a/bin b/bin
new file mode 100755
index 0000000..e69de29
--- /dev/null
+++ b/bin
DIFF
  [ -z "$output" ]
  run bash -c ". '$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh'; rt_added_lines" </dev/null
  [ -z "$output" ]
}

@test "rt_added_lines resets at the next file header across several files" {
  run bash -c ". '$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-text.sh'; rt_added_lines" <<'DIFF'
diff --git a/a b/a
--- a/a
+++ b/a
@@ -0,0 +1 @@
+from a
diff --git a/b b/b
--- a/b
+++ b/b
+++ not a hunk line
@@ -0,0 +1 @@
+from b
DIFF
  [ "$output" = $'from a\nfrom b' ]
}

@test "a value that merely contains a placeholder character is refused" {
  while IFS= read -r t; do
    printf '%s\n' "$t" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $t"; false; }
  done <<'CASES'
password: hunter$2x
token=abc$def99
secret: abc{def}ghi99
password: hunter$cats
token: <hunter99
https://u:hunter${x}@host/p
https://u:p<w>x@host
https://u:p$w@host
https://u:p[w]x@host
https://u:${PASS:-hunter2}@host
CASES
}

@test "a refused placeholder-lookalike keeps its rule name" {
  check() {  # <expected rule> <line text>
    printf '%s\n' "$2" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    [[ "$stderr" == *"rule=$1 "* ]] || { echo "wrong rule for: $2 ($stderr)"; false; }
  }
  check unquoted-keyword-value 'password: hunter$2x'
  check unquoted-keyword-value 'secret: abc{def}ghi99'
  check url-userinfo 'https://u:hunter${x}@host/p'
}

@test "a whole-value placeholder or call stays clean" {
  export RT_ALLOWED_HOST=host
  while IFS= read -r t; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged: $t"; false; }
  done <<'CASES'
password: $PASSWORD
token: ${TOKEN}
password: <your password>
password: <your-password>
secret: [REDACTED]
token=[REDACTED]
password: z.string()
token = process.env.api_key
secret: Optional[str]
token: Promise<string>
https://user:${PASS}@host
https://user:$PASS@host
https://user:<password>@host
https://user:[REDACTED]@host
https://user:%PASSWORD%@host
CASES
}

@test "an inline YAML comment after a credential value does not hide it" {
  printf 'password:\n  hunter22 # note\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'password: hunter22 # note\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  printf 'password:\n  "hunter22" # note\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "a hash inside a token is part of the token" {
  # Refused by the existing separated-literal rule, not by comment handling.
  printf 'token: abc#def\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "passphrase and passcode labels are credential keywords" {
  check() {  # <line text>
    printf '%b\n' "$1" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $1"; false; }
  }
  check 'passphrase: correcthorse'
  check 'pass_phrase = "abcd efgh"'
  check 'pass-phrase: hunter22'
  check 'passcode: hunter22'
  check 'passphrase:\n  correcthorse'
  check 'DB_PASSPHRASE=abcdefgh1234'
}

@test "a placeholder passphrase and in-word labels stay clean" {
  while IFS= read -r t; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged: $t"; false; }
  done <<'CASES'
passphrase: string
passcode: <your passcode>
bypass: something
CASES
}

@test "a YAML block scalar after a credential keyword is checked" {
  check() {  # <line text>
    printf '%b\n' "$1" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $1"; false; }
  }
  check 'password: |\n  hunter'
  check 'password: >-\n  abcdefghij'
  check 'token: |2\n   s3cr3tvalue'
  check 'password: |\n\n  hunter22'
  check 'password:\n  |\n  hunter22'
}

@test "a block scalar of placeholders or prose stays clean and a dedented line expires it" {
  printf 'password: |\n  <your password>\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  printf 'password: |\n\nNext paragraph of prose.\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  printf 'bypass: |\n  something\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  # A dedented line ends the block: later lines are ordinary text.
  printf 'password: |\n  <your password>\nhunter22\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

# Logical records: every value line of a block scalar is checked, a trailing
# YAML comment on the header or a value line is ignored, and quoted values are
# judged whole. Block rule: after a block header the first non-blank line is
# always evaluated (indented or not); after that the block runs while lines
# are indented more than the header and ends at the first line that is not.

refuses() {  # <expected rule> <printf %b text>
  printf '%b' "$2" >| "$A"
  run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 6 ] || { echo "not flagged: $2"; false; }
  [[ "$stderr" == *"rule=$1 "* ]] || { echo "wrong rule for: $2 ($stderr)"; false; }
}

stays_clean() {  # <printf %b text>
  printf '%b' "$1" >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ] || { echo "flagged: $1"; false; }
}

@test "a credential on any value line of a block scalar is refused, not only the first" {
  refuses unquoted-keyword-value 'password: |\n  <your password>\n  hunter22\n'
  refuses unquoted-keyword-value 'password: >-\n  string\n  <x>\n  hunter22\n'
  refuses unquoted-keyword-value 'password: |\n  string\n\n  hunter22\n'
  refuses unquoted-keyword-value 'password:\n  |\n  string\n  hunter22\n'
  refuses unquoted-keyword-value '- password: |\n    string\n    hunter22\n'
  refuses unquoted-keyword-value 'password: |\r\n  <x>\r\n  hunter22\r\n'
  refuses quoted-keyword-assignment 'token: |\n  string\n  "s3cr3tvalue"\n'
}

@test "a block scalar ends at the first non-blank line indented no more than the header" {
  stays_clean 'password: |\n  <your password>\nhunter22\n'
  stays_clean 'password: |\n  string\n\nhunter22\n'
  stays_clean '  password: |\n    string\n  hunter22\n'
  # The first line after the header is evaluated even when it lost its indent.
  refuses unquoted-keyword-value 'password: |\nhunter22\n'
  refuses unquoted-keyword-value 'password: |\n\nhunter22\n'
}

@test "a trailing YAML comment on a header or value line does not hide the value" {
  refuses unquoted-keyword-value 'password: | # note\n  hunter22\n'
  refuses unquoted-keyword-value 'password: >-   # note\n  hunter22\n'
  refuses unquoted-keyword-value 'password: |2 # note\n  <x>\n  hunter22\n'
  refuses unquoted-keyword-value 'password: # note\n  hunter22\n'
  refuses unquoted-keyword-value 'password:\n  | # note\n  hunter22\n'
  refuses unquoted-keyword-value 'password: |\n  string\n  hunter22 # note\n'
  refuses unquoted-keyword-value 'password:\n# note\n  hunter22\n'
  stays_clean 'password: | # note\n  <your password>\n'
  stays_clean 'password: # note\n  string\n'
}

@test "block scalar controls: next-line and block placeholders, prose and a dedented paragraph stay clean" {
  stays_clean 'password:\n  string\n'
  stays_clean 'password: |\n  <your password>\n'
  stays_clean 'password: |\n\nNext paragraph of prose.\n'
  stays_clean 'Keep the password: the team agreed to rotate it\n'
  stays_clean 'bypass: |\n  string\n  something\n'
}

@test "separated code labels are credential keywords in every rule" {
  while IFS= read -r t; do
    printf '%b\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged: $t"; false; }
  done <<'CASES'
pass_code: hunter22
pass-code: hunter22
passcode = hunter22
PASS_CODE: hunter22
pass_code = "abcd efgh"
pass-code: 'correct horse'
pass-code:\n  hunter22
pass_code: |\n  hunter22
pass_code: |\n  string\n  hunter22
DB_PASS_CODE=abcdefgh1234
DB_PASS_PHRASE=abcdefgh1234
DB_PASS_CODE: abcdefgh1234
pass_phrase: correcthorse
pass-phrase: hunter22
PASSPHRASE: hunter22
CASES
}

@test "separated code labels keep the in-word and placeholder rules" {
  while IFS= read -r t; do
    printf '%b\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged: $t"; false; }
  done <<'CASES'
pass_code: string
pass-code: <your code>
PASS_CODE: [REDACTED]
pass_code = "$PASS_CODE"
bypass_code: something
bypass-code: something
DB_PASS_CODE=${CODE}
CASES
}

@test "a quoted credential is judged whole, whatever its first segment" {
  refuses quoted-keyword-assignment 'password = "ab cd efgh ijkl"\n'
  refuses quoted-keyword-assignment 'passphrase: "to be or not"\n'
  refuses quoted-keyword-assignment "passphrase: 'to be or not'\\n"
  refuses quoted-keyword-assignment '{"password": "ab cd efgh"}\n'
  refuses quoted-keyword-assignment 'password = "a b c d"\n'
  refuses quoted-keyword-assignment 'passphrase:\n  "to be or not"\n'
  refuses quoted-keyword-assignment 'password = "unterminated hunter\n'
  refuses quoted-keyword-assignment 'password: "string" and token: "hunter22"\n'
  printf '%s\n' 'password = "ab\"cd efgh"' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "a quoted whole placeholder, type word or short value stays clean" {
  while IFS= read -r t; do
    printf '%s\n' "$t" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged: $t"; false; }
  done <<'CASES'
token: "string"
password = "<your password>"
secret: "[REDACTED]"
password: "$PASSWORD"
token: "${TOKEN}"
token: "optional string"
password = "abc"
bypass = "ab cd efgh"
bypass="false"
CASES
}

# Multi-line quoted values: a quote left open at the end of a keyword line is
# carried onto the following lines (at most 20 lines or 2000 characters) and
# the joined value is judged like a one-line quoted value. A quote that never
# closes fails closed unless the visible text is a placeholder.
@test "a quoted credential that closes on a later line is judged whole" {
  refuses quoted-keyword-assignment 'password: "abc\n  123"\n'
  refuses quoted-keyword-assignment "token: 'abc\\n123'\\n"
  refuses quoted-keyword-assignment 'password: "abc\r\n  123"\r\n'
  refuses quoted-keyword-assignment "token: 'abc\\r\\n123'\\r\\n"
  refuses quoted-keyword-assignment 'password: "correct horse\n  battery staple"\n'
  refuses quoted-keyword-assignment 'password: "ab\\"c\n  d"\n'
  refuses quoted-keyword-assignment 'password:\n  "abc\n  123"\n'
  refuses quoted-keyword-assignment '- password: "abc\n    123"\n'
  # The hit names the line the quote opened on.
  printf 'ok line\npassword: "abc\n  123"\n' >| "$A"
  run --separate-stderr "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"line=2"* ]] || { echo "$stderr"; false; }
}

@test "a quote that never closes fails closed unless the visible text is a placeholder" {
  refuses quoted-keyword-assignment 'password: "hunter22 and more text\nnext line of prose\n'
  refuses quoted-keyword-assignment 'password: "hunter22\r\nsecond line\r\n'
  refuses quoted-keyword-assignment "token: 'abc\\n"
  refuses quoted-keyword-assignment 'password: "ab\n'
  stays_clean 'password: "<your password>\n'
  stays_clean 'token: "string\n  optional\n'
  stays_clean 'password: "\n'
  # Past 20 lines the carry stops and the text so far is judged.
  local i body='password: "'
  for i in $(seq 1 25); do body="$body\\nfiller line $i"; done
  refuses quoted-keyword-assignment "$body\\n"'tail"\n'
}

@test "a multi-line quoted placeholder or in-word keyword stays clean" {
  stays_clean 'token: "<your\n  token>"\n'
  stays_clean 'token: "[redacted\n  value]"\n'
  stays_clean 'password: "string\n  optional"\n'
  stays_clean 'token: "a\n  b"\n'
  stays_clean 'bypass: "something\n  else here"\n'
  stays_clean 'password: "string"\nplain prose line\n'
}

@test "a long unclosed quote on a huge hostile file stays linear" {
  local i
  require_timeout
  # Placeholder-only text never flags, so every open quote runs to its bound.
  {
    for i in $(seq 1 800); do
      printf 'token: "string\n'
      yes string | head -n 25
    done
  } >| "$A"
  run "$TIMEOUT_BIN" 30 "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

# Block scalar with an explicit indicator: the lines indented more than the
# header are ONE credential value (quoted-value rule: 4+ characters, not a
# whole placeholder, not all placeholder words). A non-indented line after the
# header is not block content: it is only the single-token first-line check.
@test "a spaced credential in an indicator block scalar is judged whole" {
  refuses unquoted-keyword-value 'password: |\n  correct horse battery staple\n'
  refuses unquoted-keyword-value 'passphrase: >-\n  to be or not to be\n'
  refuses unquoted-keyword-value 'password: |\r\n  correct horse battery staple\r\n'
  refuses unquoted-keyword-value 'password: |2 # note\n   correct horse\n   battery staple\n'
  refuses unquoted-keyword-value 'password:\n  |\n  correct horse battery staple\n'
  refuses unquoted-keyword-value '- token: >\n    ab cd\n    ef gh\n'
  refuses unquoted-keyword-value 'password: |\n  string\n\n  correct horse\n'
}

@test "block scalar placeholders, type words and unindented prose stay clean" {
  stays_clean 'password: "string"\n'
  stays_clean 'password: |\n  <your password>\n'
  stays_clean 'password: |\n  string\n'
  stays_clean 'password: |\n  optional string\n'
  stays_clean 'password: |\n\nNext paragraph of prose.\n'
  stays_clean 'password: |\n  string\nNext paragraph of prose here.\n'
  stays_clean 'bypass: |\n  correct horse battery staple\n'
  stays_clean 'Keep the password: the team agreed to rotate it\n'
  stays_clean 'password:\n  correct horse\n'
}

# Compound secret labels share the one keyword definition (`kw`), so every
# path (unquoted, quoted, next line, carry, block scalar) sees them.
@test "compound secret-key labels with a literal value are refused" {
  refuses unquoted-keyword-value 'secret_key: hunter\n'
  refuses unquoted-keyword-value 'secret-key = hunter\n'
  refuses unquoted-keyword-value 'secret key: hunter\n'
  refuses unquoted-keyword-value 'secretKey: hunter\n'
  refuses unquoted-keyword-value 'clientSecretKey: hunter\n'
  refuses unquoted-keyword-value 'client_secret: hunter\n'
  refuses unquoted-keyword-value 'api_secret: hunter\n'
  refuses unquoted-keyword-value 'private_key: hunter\n'
  refuses unquoted-keyword-value 'privateKey: hunter\n'
  refuses unquoted-keyword-value 'access_key: hunter\n'
  refuses unquoted-keyword-value 'AccessKey = hunter\n'
  refuses unquoted-keyword-value 'secret_key = abc123xyz\n'
  refuses unquoted-keyword-value 'my_secret_key: hunter\n'
}

@test "uppercase compound secret labels are refused" {
  refuses name-key-assignment 'SECRET_KEY=abcdefgh12\n'
  refuses name-key-assignment 'CLIENT_SECRET: abcdefgh12\n'
  refuses name-key-assignment 'PRIVATE_KEY = "abcdefgh12"\n'
  refuses name-key-assignment 'AWS_ACCESS_KEY=abcdefgh12\n'
  refuses unquoted-keyword-value 'SECRET_KEY: hunter\n'
  refuses unquoted-keyword-value 'PRIVATE-KEY: hunter\n'
}

@test "compound secret labels are refused in quoted, next-line and block forms" {
  refuses quoted-keyword-assignment '"secret_key": "hunter"\n'
  refuses quoted-keyword-assignment "secret_key: 'correct horse'\\n"
  refuses quoted-keyword-assignment 'private_key = "correct horse battery"\n'
  refuses quoted-keyword-assignment 'secret_key: "correct\n  horse"\n'
  refuses unquoted-keyword-value 'secret_key:\n  hunter\n'
  refuses unquoted-keyword-value '- private_key:\n    hunter\n'
  refuses unquoted-keyword-value 'secret_key: |\n  correct horse battery staple\n'
  refuses unquoted-keyword-value 'private_key: >-\n  correct horse battery staple\n'
  refuses unquoted-keyword-value 'secret_key: |\n  string\n  hunter22\n'
}

@test "compound secret labels with placeholders, types or prose stay clean" {
  stays_clean 'secret_key: string\n'
  stays_clean 'secret_key: <your key>\n'
  stays_clean 'private_key: <your private key>\n'
  stays_clean 'secretKey: $SECRET_KEY\n'
  stays_clean 'access_key: "string"\n'
  stays_clean 'secret_key: "<your key>"\n'
  stays_clean 'secret_key: |\n  <your key>\n'
  stays_clean 'secret_key:\n  string\n'
  stays_clean 'secret_key: z.string()\n'
  stays_clean 'The secret key is stored in the vault\n'
  stays_clean 'Rotate the private key and the access key regularly.\n'
  stays_clean 'const SECRET_KEY = process.env.SECRET_KEY\n'
}

@test "a compound secret label inside a word keeps the in-word rule" {
  stays_clean 'thesecretkey: hunter\n'
  stays_clean 'mysecretkey: |\n  correct horse battery staple\n'
  stays_clean 'bypassaccess_key: hunter\n'
  refuses unquoted-keyword-value 'thesecretkey: abc123xyz\n'
}

@test "an unquoted spaced value after a line-start keyword is judged whole" {
  refuses unquoted-keyword-value 'password: my correct horse battery staple\n'
  refuses unquoted-keyword-value '  - passphrase: to be or not\n'
  refuses unquoted-keyword-value 'export secret_key=my very secret words\n'
  refuses unquoted-keyword-value 'token: a b c d e f\n'
  refuses unquoted-keyword-value 'db_password: my correct horse\n'
  refuses unquoted-keyword-value 'password: my correct horse # note\n'
  refuses unquoted-keyword-value 'password: my correct horse battery staple\r\n'
  refuses unquoted-keyword-value '  - passphrase: to be or not\r\n'
  refuses unquoted-keyword-value 'export secret_key=my very secret words\r\n'
  refuses unquoted-keyword-value 'token: a b c d e f\r\n'
}

@test "mid-sentence prose, placeholders and type words after a keyword stay clean" {
  stays_clean 'Keep the password: the team agreed to rotate it\n'
  stays_clean 'Rotate the token: it expires tomorrow\n'
  stays_clean 'Keep the password: the team agreed to rotate it\r\n'
  stays_clean 'password: string\n'
  stays_clean 'password: <your password>\n'
  stays_clean 'password: optional string\n'
  stays_clean 'password: string or number\n'
  stays_clean 'password: str = None\n'
  stays_clean 'password: my\n'
  stays_clean 'password: a b\n'
  stays_clean 'password: optional string\r\n'
  stays_clean 'password: <your password> # fill in\n'
}

@test "the whole-value rule leaves the in-word keyword and next-line prose alone" {
  stays_clean 'bypass: my correct horse battery staple\n'
  stays_clean 'mysecretkey: my correct horse\n'
  stays_clean 'password:\n  Rotation is scheduled for Friday\n'
}

@test "a markdown image, an @mention and a foreign URL are refused with their own rule" {
  check() {  # <expected rule> <line text>
    printf 'clean line\n%s\n' "$2" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    [[ "$stderr" == *"resolve-text: refused rule=$1 line=2"* ]] || { echo "wrong rule for: $2 ($stderr)"; false; }
  }
  check markdown-image 'see ![chart](https://github.com/o/r/raw/x.png)'
  check mention 'cc @octocat for a look'
  check mention 'ping (@octocat)'
  check foreign-url 'details at https://evil.example/x.'
  check foreign-url 'https://github.com@evil.example/x'
}

@test "github.com links, code-span handles, emails and userinfo placeholders are not flagged" {
  printf '%s\n' 'see (https://github.com/o/r/pull/7#discussion_r1), and <https://github.com/o/r>.' \
    'the `@ts-ignore` comment, a@b.com, https://user:<password>@github.com:443/x' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "RT_ALLOWED_HOST and GH_HOST name the one host a URL may use" {
  printf 'see https://ghe.example/o/r/pull/7\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
  RT_ALLOWED_HOST=ghe.example run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  GH_HOST=ghe.example run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  GH_HOST=ghe.example RT_ALLOWED_HOST=other.example run "$SCRIPT" "$A"
  [ "$status" -eq 6 ]
}

@test "with several files a refusal line ends in=<file>; with one file it does not" {
  printf 'password: hunter22\n' >| "$B"
  run --separate-stderr "$SCRIPT" "$A" "$B"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"resolve-text: refused rule="*" in=$B"* ]]
  run --separate-stderr "$SCRIPT" "$B"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"resolve-text: refused rule="* ]]
  [[ "$stderr" != *" in="* ]]
}

@test "a hostile file name cannot add a field or a line to the refusal line" {
  H="$BATS_TEST_TMPDIR/bad name
rule=forged line=9.txt"
  printf 'password: hunter22\n' >| "$H"
  run --separate-stderr "$SCRIPT" "$A" "$H"
  [ "$status" -eq 6 ]
  # Exactly one token line, and its label holds only the safe characters.
  [ "$(printf '%s\n' "$stderr" | grep -c '^resolve-text: ')" -eq 1 ]
  line=$(printf '%s\n' "$stderr" | grep '^resolve-text: ')
  label=${line##* in=}
  [ -n "$label" ]
  [ -z "$(printf '%s' "$label" | tr -d 'A-Za-z0-9._/?-')" ]
  [[ "$line" != *"rule=forged"* ]]
}

@test "a refused file wins over an unreadable one: exit 6, and both are named" {
  printf 'password: hunter22\n' >| "$B"
  run --separate-stderr "$SCRIPT" "$BATS_TEST_TMPDIR/nope" "$B"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"not readable"* ]]
  [[ "$stderr" == *"resolve-text: refused"* ]]
}

@test "a mention behind Markdown opening delimiters is refused; code spans and emails stay clean" {
  check() {  # <expected rule> <line text>
    printf 'clean line\n%s\n' "$2" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    [[ "$stderr" == *"resolve-text: refused rule=$1 line=2"* ]] || { echo "wrong rule for: $2 ($stderr)"; false; }
  }
  check mention 'thanks **@octocat**'
  check mention '**@octocat** please look'
  check mention 'thanks _@octocat_'
  check mention 'see [@octocat]'
  check mention 'see [@octocat](https://github.com/octocat)'
  check mention 'ask ~~@octocat~~'
  check mention 'ask **[@octocat]**'
  printf '%s\n' 'the `@ts-ignore` and `**@octocat**` spans, first_@b.com, a@b.com, *emphasis* only' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a backslash in the URL authority cannot smuggle the allowed host in as userinfo" {
  check() {  # <line text>
    printf 'clean line\n%s\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    [[ "$stderr" == *"resolve-text: refused rule=foreign-url line=2"* ]] || { echo "wrong rule for: $1 ($stderr)"; false; }
  }
  check 'see https://evil.com\@github.com/path'
  check 'see https://evil.com\@github.com'
  check 'see https://github.com\@evil.com/path'
  printf '%s\n' 'see https://github.com/o/r/pull/7 and https://user:<password>@github.com:443/x' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a whole bracketed value is a placeholder only when it is a known sentinel form" {
  refuses() {  # <line text>
    printf '%s\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not refused: $1"; false; }
  }
  refuses 'password: <correcthorsebattery>'
  refuses 'password: <hunter2x>'
  refuses 'token: [correcthorse]'
  refuses 'token=[hunter22]'
  refuses 'secret: <your hunter2x>'
  refuses 'password: "<your correcthorsebattery token>"'
  refuses 'password: <your correcthorsebattery token>'
  refuses 'token: <the hunter secret key>'
  refuses 'token: <your key code token pass>'
  refuses 'https://user:<correcthorse>@host/x'
  printf '%s\n' 'password: <password>' 'password: <your password>' 'token: <your private key>' \
    'secret: [REDACTED]' 'token: "[redacted value]"' 'api key: <your-api-key>' \
    'token: <your access token>' 'token: <your api key>' 'secret: <my secret key>' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a pwd label is a credential keyword" {
  refuses() {  # <line text>
    printf '%s\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not refused: $1"; false; }
  }
  refuses 'pwd: hunter'
  refuses 'pwd=correcthorse'
  refuses 'pwd: "correct horse"'
  refuses 'PWD=hunter22'
  printf '%s\n' 'pwd: <your password>' 'pwd: string' 'cwd: hunter' 'run `pwd` to print the directory' 'pwd: /home/me/project' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a question mark or hash ends the URL authority before userinfo is stripped" {
  check() {  # <line text>
    printf 'clean line\n%s\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    [[ "$stderr" == *"resolve-text: refused rule=foreign-url line=2"* ]] || { echo "wrong rule for: $1 ($stderr)"; false; }
  }
  check 'see https://evil.com?x=@github.com/'
  check 'see https://evil.com?x=@github.com'
  check 'see https://evil.com#@github.com/'
  check 'see https://evil.com#frag@github.com'
  check 'see https://evil.com?@github.com'
  printf '%s\n' 'see https://github.com?tab=readme and https://github.com#top and https://github.com/o/r?x=1#y' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "an unquoted four-digit passcode is a credential, other short numbers are not" {
  refuses() {  # <line text>
    printf '%b\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not refused: $1"; false; }
  }
  refuses 'passcode: 1234'
  refuses 'PASSCODE=0042'
  refuses 'pass_code: 9876'
  refuses 'pass-code = 12345'
  refuses 'passcode:\n  1234'
  refuses 'passcode:\n  1234 # office door'
  refuses 'passcode: |\n  4321'
  refuses 'passcode: (1234)'
  refuses 'passcode: [1234]'
  refuses 'passcode: **1234**'
  refuses 'passcode: ~1234~'
  refuses 'passcode:\n  (1234)'
  printf '%s\n' 'passcode: 123' 'passcode: (123)' 'token: (1234)' 'passcode: <your passcode>' 'passcode: string' 'token: 4096' 'password: 2024' 'secret: 1234' 'The passcode: is required.' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a plural credentials label is a credential keyword" {
  refuses() {  # <line text>
    printf '%b\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not refused: $1"; false; }
  }
  refuses 'credentials: hunter'
  refuses 'credentials=correcthorse'
  refuses 'Credentials: "correct horse"'
  refuses 'credentials: hunter2x'
  refuses 'credentials:\n  correcthorse'
  refuses 'my_credentials: correcthorse'
  printf '%s\n' 'credentials: string' 'credentials: <your credentials>' 'credentials: $CREDENTIALS' 'The credentials are required for this call.' 'credentials: [REDACTED]' 'credentials: optional string' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a protocol-relative link to another host is a foreign URL" {
  check() {  # <line text>
    printf 'clean line\n%s\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ]
    [[ "$stderr" == *"resolve-text: refused rule=foreign-url line=2"* ]] || { echo "wrong rule for: $1 ($stderr)"; false; }
  }
  check 'see [details](//evil.example/path)'
  check 'see <//evil.example/path>'
  check 'see <a href="//evil.example/x">x</a>'
  check "see <a href='//evil.example/x'>x</a>"
  check 'see [x](//github.com@evil.example/y)'
  printf '%s\n' 'see [d](//github.com/o/r/pull/7) and // a code comment and a path a//b' 'x = "http://github.com/a" // note' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "protocol-relative attribute forms: unquoted and spaced around = are foreign URLs" {
  check() {  # <line text>
    printf '%s\n' "$1" >| "$A"
    run --separate-stderr "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not refused: $1"; false; }
    [[ "$stderr" == *"rule=foreign-url "* ]] || { echo "wrong rule for: $1 ($stderr)"; false; }
  }
  check '<a href=//evil.example/x>x</a>'
  check '<a href = "//evil.example/x">x</a>'
  check "<a href = '//evil.example/x'>x</a>"
  check '<a href = //evil.example/x>x</a>'
  check '<img src=//evil.example/x.png>'
  check '<a href =  "//evil.example/x">x</a>'
  # The allowed host in the same forms stays clean.
  printf '%s\n' '<a href=//github.com/o/r>x</a>' '<a href = "//github.com/o/r">x</a>' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "protocol-relative rewrite leaves comments, a//b and a full URL before a comment clean" {
  printf '%s\n' 'see // a code comment' 'a//b' 'x = "http://github.com/a" // note' \
    'x = // note' 'x=// note' 'path = a//b' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a multi-word credential on the line after a bare keyword is refused; prose stays clean" {
  refuses unquoted-keyword-value 'password:\n  my correct horse battery staple\n'
  refuses unquoted-keyword-value 'password:\n  correct horse battery\n'
  refuses unquoted-keyword-value '- token:\n    my correct horse battery staple # note\n'
  refuses unquoted-keyword-value 'password:\r\n  my correct horse battery staple\r\n'
  stays_clean 'password:\n  Rotation is scheduled for Friday\n'
  stays_clean 'password:\n  correct horse\n'
  stays_clean 'password:\n  optional string or number\n'
  stays_clean 'bypass:\n  my correct horse battery staple\n'
  stays_clean 'password:\n\nNext paragraph of prose.\n'
}

@test "prose, basic auth and vendor prefixes agree under gawk and mawk" {
  # PATH shim: the scanner calls `awk`, so each binary is exposed under that name.
  with_awk() { # <binary> <expected status> <text>
    dir="${BATS_TEST_TMPDIR}/awkbin-$1"
    mkdir -p "$dir"
    ln -sfn "$(command -v "$1")" "$dir/awk"
    printf '%b' "$3" >| "$A"
    PATH="$dir:${PATH}" run "$SCRIPT" "$A"
    [ "$status" -eq "$2" ] || { echo "$1: want $2 got $status for [$3]"; false; }
  }
  tok4=$(printf 'a:b' | base64 | tr -d '\n')
  tok8=$(printf 'ab:cde' | base64 | tr -d '\n')
  tv=$(printf 'tv%s-' 'ly')
  px=$(printf 'pp%s-' 'lx')
  sg=$(printf 'sg%s_' 'p')
  a20=$(printf 'A%.0s' $(seq 1 20))
  a19=$(printf 'A%.0s' $(seq 1 19))
  a40=$(printf 'A%.0s' $(seq 1 40))
  a39=$(printf 'A%.0s' $(seq 1 39))
  for bin in gawk mawk; do
    command -v "$bin" >/dev/null 2>&1 || { echo "missing $bin"; false; }
    with_awk "$bin" 6 'password:\n  my correct horse battery staple\n'
    with_awk "$bin" 0 'password:\n  Rotation is scheduled for Friday\n'
    with_awk "$bin" "$(accented_status "$bin")" 'password:\n  Élève a trois mots ici\n'
    with_awk "$bin" "$(accented_status "$bin")" 'password:\n  élève a trois mots ici\n'
    with_awk "$bin" 6 "Authorization: Basic ${tok4}\n"
    with_awk "$bin" 6 "Authorization: Basic ${tok8}\n"
    with_awk "$bin" 0 'Authorization: Basic AAAA\n'
    with_awk "$bin" 0 'Authorization: Basic Authentication\n'
    with_awk "$bin" 0 'Authorization: Authentication\n'
    with_awk "$bin" 6 "Authorization: Bearer $(pad 20)\n"
    with_awk "$bin" 0 "Authorization: Bearer $(pad 19)\n"
    with_awk "$bin" 6 "x ${tv}${a20} y\n"
    with_awk "$bin" 0 "x ${tv}${a19} y\n"
    with_awk "$bin" 6 "x ${px}${a40} y\n"
    with_awk "$bin" 0 "x ${px}${a39} y\n"
    with_awk "$bin" 6 "x ${sg}${a20} y\n"
    with_awk "$bin" 0 "x ${sg}${a19} y\n"
  done
}

@test "stacked leading decorations separated by whitespace are all stripped before the prose test, under gawk and mawk" {
  for bin in gawk mawk; do
    command -v "$bin" >/dev/null 2>&1 || { echo "missing $bin"; false; }
    # bullet + space + curly quote, then an ASCII multiword credential
    awk_expect "$bin" 6 'password:\n  \xe2\x80\xa2 \xe2\x80\x9cmy correct horse battery staple\n'
    # three stacked decorations with mixed whitespace
    awk_expect "$bin" 6 'password:\n  \xe2\x80\xa2 \xc2\xab\t\xe2\x80\x9cmy correct horse battery staple\n'
    # non-ASCII prose after stacked decorations stays clean
    awk_expect "$bin" "$(accented_status "$bin")" 'password:\n  \xe2\x80\xa2 \xe2\x80\x9c\xc3\xa9l\xc3\xa8ve a trois mots ici\n'
  done
}

@test "Basic tokens: padding, colon position, trailing punctuation and malformed shapes agree under gawk and mawk" {
  one=$(printf 'ab:cd' | base64 | tr -d '\n')
  two=$(printf 'ab:c' | base64 | tr -d '\n')
  colonfirst=$(printf ':abc' | base64 | tr -d '\n')
  colonlast=$(printf 'abc:' | base64 | tr -d '\n')
  for bin in gawk mawk; do
    command -v "$bin" >/dev/null 2>&1 || { echo "missing $bin"; false; }
    # padded with one and with two =
    awk_expect "$bin" 6 "Authorization: Basic ${one}\n"
    awk_expect "$bin" 6 "Authorization: Basic ${two}\n"
    # sentence punctuation after the token
    awk_expect "$bin" 6 "Authorization: Basic ${two}.\n"
    awk_expect "$bin" 6 "Authorization: Basic ${one},\n"
    # no padding at all
    awk_expect "$bin" 6 "Authorization: Basic ${two%%=*}\n"
    # a colon first or last is an empty user or password, still a credential
    awk_expect "$bin" 6 "Authorization: Basic ${colonfirst}\n"
    awk_expect "$bin" 6 "Authorization: Basic ${colonlast}\n"
    # = in the middle, and a length that cannot be base64
    awk_expect "$bin" 0 'Authorization: Basic YW=I6Yw==\n'
    awk_expect "$bin" 0 'Authorization: Basic YWI6Y\n'
    awk_expect "$bin" 0 'Authorization: Basic Authentication.\n'
  done
}

@test "Basic prose, a malformed padded token and short vendor prefixes followed by + or / are clean under gawk and mawk" {
  tv=$(printf 'tv%s-' 'ly')
  sg=$(printf 'sg%s_' 'p')
  for bin in gawk mawk; do
    command -v "$bin" >/dev/null 2>&1 || { echo "missing $bin"; false; }
    # decodes with an interior colon, but not to printable ASCII
    awk_expect "$bin" 0 'This handler uses Basic httpOnly mode.\n'
    # padding followed by another base64 character is no token
    awk_expect "$bin" 0 'Authorization: Basic YWI6Yw=Z\n'
    # excess or miscounted padding is malformed base64, not a credential
    awk_expect "$bin" 0 'Authorization: Basic YWI6Yw===\n'
    awk_expect "$bin" 0 'Authorization: Basic YWI6Yw=\n'
    awk_expect "$bin" 6 'Authorization: Basic YWI6Yw==\n'
    # non-zero unused bits are non-canonical base64, so malformed and clean
    awk_expect "$bin" 0 'Authorization: Basic YWI6Yx==\n'
    awk_expect "$bin" 6 'Authorization: Basic YTo=\n'
    awk_expect "$bin" 0 'Authorization: Basic YTp=\n'
    # the floor counts the leading run, not the whole word
    awk_expect "$bin" 0 "x ${tv}abcdefghij+abcdefghij y\n"
    awk_expect "$bin" 0 "x ${sg}abcdefghij/abcdefghij y\n"
    awk_expect "$bin" 6 "x ${tv}abcdefghijabcdefghijabcde+abc y\n"
  done
}

@test "short Basic credentials with an empty side or UTF-8 text are refused; a lone colon and colon-free binary prose are not" {
  for bin in gawk mawk; do
    for cred in 'key:' ':pw' 'jörg:pw' 'ab:wörd'; do
      tok=$(printf '%s' "$cred" | base64 | tr -d '\n')
      [ "${#tok}" -lt 20 ]
      awk_expect "$bin" 6 "Authorization: Basic ${tok}\n"
    done
    # a bare colon has no secret side; httpOnly decodes to malformed UTF-8
    awk_expect "$bin" 0 'Authorization: Basic Og==\n'
    awk_expect "$bin" 0 'This handler uses Basic httpOnly mode.\n'
    # a control byte (here a tab) is not text
    tok=$(printf 'a\tb:c' | base64 | tr -d '\n')
    awk_expect "$bin" 0 "Authorization: Basic ${tok}\n"
  done
}

@test "sgp_ prefix counts the alphanumeric leading run only, under gawk and mawk" {
  sg=$(printf 'sg%s_' 'p')
  for bin in gawk mawk; do
    awk_expect "$bin" 0 "x ${sg}abcdefghij-abcdefghij_ y\n"
    awk_expect "$bin" 0 "x ${sg}abcdefghij_abcdefghij_abcdefghij y\n"
    awk_expect "$bin" 6 "x ${sg}abcdefghijabcdefghij y\n"
    awk_expect "$bin" 6 "x ${sg}abcdefghijabcdefghij-abc y\n"
  done
}

@test "Basic tokens: two on one line, an upper-case header and a bare scheme are all found" {
  tok4=$(printf 'a:b' | base64 | tr -d '\n')
  for bin in gawk mawk; do
    awk_expect "$bin" 6 "see Authorization: Basic AAAA then Authorization: Basic ${tok4}\n"
    awk_expect "$bin" 6 "AUTHORIZATION: BASIC ${tok4}\n"
    awk_expect "$bin" 6 "got basic ${tok4} back\n"
    awk_expect "$bin" 0 'see Authorization: Basic AAAA and Authorization: Basic AAAB\n'
  done
}

@test "ordinary prose that follows the word basic stays clean; a bare basic token is the pinned exception" {
  tok4=$(printf 'a:b' | base64 | tr -d '\n')
  for bin in gawk mawk; do
    for text in 'basic setup' 'basic usage' 'basic tests' 'This is the basic example.' \
                'See the basic overview and the basic concepts.' 'basic configuration' 'basic authentication'; do
      awk_expect "$bin" 0 "${text}\n"
    done
    awk_expect "$bin" 6 "basic ${tok4}\n"
  done
}

@test "an unlisted leading symbol (checkmark, arrow, emoji) cannot exempt a multi-word credential" {
  for bin in gawk mawk; do
    awk_expect "$bin" 6 'password:\n  \xe2\x9c\x93 correct horse battery staple\n'
    awk_expect "$bin" 6 'password:\n  \xe2\x86\x92 correct horse battery staple\n'
    awk_expect "$bin" 6 'password:\n  \xf0\x9f\x94\x91 correct horse battery staple\n'
    awk_expect "$bin" 0 'password:\n  \xe2\x9c\x93 Rotation is scheduled for Friday\n'
  done
}

@test "short Basic credentials in a legacy charset (ISO-8859-1 octets) are refused, under gawk and mawk" {
  for bin in gawk mawk; do
    # RFC 7617 allows a non-UTF-8 charset: the decoded bytes are not valid
    # UTF-8 but still look like user:pass, so they must not post.
    for cred in 'j\366rg:pw' 'ab:w\366rd' 'jos\351:x' 'ab:c\303'; do
      tok=$(printf "$cred" | base64 | tr -d '\n')
      [ "${#tok}" -lt 20 ]
      awk_expect "$bin" 6 "Authorization: Basic ${tok}\n"
    done
    # no colon, a control byte and a lone colon stay clean
    tok=$(printf 'j\366rgpw' | base64 | tr -d '\n')
    awk_expect "$bin" 0 "Authorization: Basic ${tok}\n"
    tok=$(printf 'j\366\tg:pw' | base64 | tr -d '\n')
    awk_expect "$bin" 0 "Authorization: Basic ${tok}\n"
    awk_expect "$bin" 0 'This handler uses Basic httpOnly mode.\n'
  done
}

@test "short Basic credentials whose UTF-8 continuation bytes fall in 0x80-0x9F are refused, under gawk and mawk" {
  for bin in gawk mawk; do
    # U+0100 is C4 80 and U+1F511 is F0 9F 94 91: valid UTF-8, not C1 controls.
    for cred in '\304\200b:cd' 'ab:\360\237\224\221x'; do
      tok=$(printf "$cred" | base64 | tr -d '\n')
      [ "${#tok}" -lt 20 ]
      awk_expect "$bin" 6 "Authorization: Basic ${tok}\n"
      awk_expect "$bin" 6 "sent Basic ${tok} here\n"
    done
    # A C1 byte outside any UTF-8 sequence is still a control.
    tok=$(printf 'a\200b:cd' | base64 | tr -d '\n')
    awk_expect "$bin" 0 "Authorization: Basic ${tok}\n"
  done
}

@test "an all-non-ASCII leading word is prose, not decoration; symbols are still stripped, under gawk and mawk" {
  ran=0
  for loc in C C.UTF-8; do
    locale_installed "$loc" || continue
    for bin in gawk mawk; do
      ran=$((ran + 1))
      # CJK, Cyrillic and Greek words followed by lowercase English stay prose
      awk_expect "$bin" 0 'password:\n  \xe5\xaf\x86\xe7\xa0\x81 correct horse battery staple\n' "$loc"
      awk_expect "$bin" 0 'password:\n  \xd0\xbf\xd0\xb0\xd1\x80\xd0\xbe\xd0\xbb\xd1\x8c correct horse battery staple\n' "$loc"
      awk_expect "$bin" 0 'password:\n  \xce\xb1\xce\xb2 correct horse battery staple\n' "$loc"
      # symbols and emoji, alone or stacked, are still decoration
      awk_expect "$bin" 6 'password:\n  \xe2\x9c\x93 correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xe2\x9a\xa0\xef\xb8\x8f \xf0\x9f\x94\x91 correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xe3\x80\x8c correct horse battery staple\n' "$loc"
    done
  done
  [ "$ran" -ge 2 ]
}

@test "Latin-1 multiply and divide signs are decoration; E2-lead letters (Glagolitic, Coptic, Tifinagh) are words, under gawk and mawk" {
  ran=0
  for loc in C C.UTF-8; do
    locale_installed "$loc" || continue
    for bin in gawk mawk; do
      ran=$((ran + 1))
      awk_expect "$bin" 6 'password:\n  \xc3\x97 correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xc3\xb7 correct horse battery staple\n' "$loc"
      # accented C3 letters stay words
      awk_expect "$bin" "$(accented_status "$bin" "$loc")" 'password:\n  \xc3\xa9l\xc3\xa8ve correct horse battery staple\n' "$loc"
      # Glagolitic, Coptic, Tifinagh, Georgian Supplement
      awk_expect "$bin" 0 'password:\n  \xe2\xb0\x80\xe2\xb0\x81 correct horse battery staple\n' "$loc"
      awk_expect "$bin" 0 'password:\n  \xe2\xb2\x80\xe2\xb2\x81 correct horse battery staple\n' "$loc"
      awk_expect "$bin" 0 'password:\n  \xe2\xb4\xb0\xe2\xb4\xb1 correct horse battery staple\n' "$loc"
      # real symbols and supplemental punctuation are still decoration
      awk_expect "$bin" 6 'password:\n  \xe2\x9c\x93 correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xe2\xb8\xa2 correct horse battery staple\n' "$loc"
    done
  done
  [ "$ran" -ge 2 ]
}

@test "a bare Basic word needs an interior colon: Only is prose, a header keeps edge colons" {
  edge=$(printf ':y' | base64 | tr -d '\n')
  for bin in gawk mawk; do
    awk_expect "$bin" 0 'This endpoint supports Basic Only mode\n'
    awk_expect "$bin" 0 "bare basic ${edge}\n"
    awk_expect "$bin" 6 'Authorization: Basic Only\n'
    # a later interior colon counts: empty user, password containing a colon
    colons=$(printf ':pa:ss' | base64 | tr -d '\n')
    awk_expect "$bin" 6 "bare basic ${colons}\n"
    awk_expect "$bin" 6 "Authorization: Basic ${edge}\n"
    awk_expect "$bin" 6 'This endpoint supports Basic YTpi mode\n'
    # unpadded 3-character token (`a:`): a header flags it, bare prose does not
    awk_expect "$bin" 6 'Authorization: Basic YTo\n'
    awk_expect "$bin" 0 'Authorization: Basic Hey\n'
    awk_expect "$bin" 0 'This endpoint supports Basic Hey mode\n'
    awk_expect "$bin" 0 'bare basic YTo mode\n'
  done
}

@test "a leading non-ASCII quote, bullet, dash or no-break space cannot exempt a multi-word credential; accented letters stay prose" {
  ran=0
  for loc in C C.UTF-8; do
    locale_installed "$loc" || continue
    for bin in gawk mawk; do
      ran=$((ran + 1))
      awk_expect "$bin" 6 'password:\n  “correct horse battery staple”\n' "$loc"
      awk_expect "$bin" 6 'password:\n  • correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  — correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xc2\xa0correct horse battery staple\n' "$loc"
      awk_expect "$bin" "$(accented_status "$bin" "$loc")" 'password:\n  élève a trois mots ici\n' "$loc"
      awk_expect "$bin" "$(accented_status "$bin" "$loc")" 'password:\n  Élève a trois mots ici\n' "$loc"
      awk_expect "$bin" 0 'password:\n  “Correct horse battery staple”\n' "$loc"
    done
  done
  [ "$ran" -ge 2 ]
}

@test "a non-ASCII prefix attached to the first word cannot exempt a multi-word credential; byte-wise awk fails closed" {
  ran=0
  for loc in C C.UTF-8; do
    locale_installed "$loc" || continue
    for bin in gawk mawk; do
      ran=$((ran + 1))
      # fullwidth quotation mark, curly quote, guillemet, emoji, fullwidth
      # punctuation (EF BC 80-8F and EF BD 9B-A5), all glued to the word
      awk_expect "$bin" 6 'password:\n  \xef\xbc\x82correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xe2\x80\x9ccorrect horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xc2\xabcorrect horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xf0\x9f\x94\x91correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xef\xbc\x81correct horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xef\xbd\x9bcorrect horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xef\xbd\xa5correct horse battery staple\n' "$loc"
      # punctuation outside the symbol blocks: Arabic comma, ideographic comma
      awk_expect "$bin" 6 'password:\n  \xd8\x8ccorrect horse battery staple\n' "$loc"
      awk_expect "$bin" 6 'password:\n  \xe3\x80\x81correct horse battery staple\n' "$loc"
      # Byte-wise awk (mawk, gawk in C) cannot tell a letter from punctuation,
      # so it fails closed on any non-ASCII prefix glued to the first word.
      # Only a multibyte gawk keeps letter-leading words as prose.
      if [ "$bin" = gawk ] && [ "$loc" = C.UTF-8 ]; then
        awk_expect "$bin" 0 'password:\n  éclair recipe is great\n' "$loc"
        awk_expect "$bin" 0 'password:\n  \xef\xbc\x90correct horse battery staple\n' "$loc"
        awk_expect "$bin" 0 'password:\n  \xef\xbc\xa1correct horse battery staple\n' "$loc"
      else
        awk_expect "$bin" 6 'password:\n  éclair recipe is great\n' "$loc"
      fi
    done
  done
  [ "$ran" -ge 2 ]
}

@test "the tvly-, pplx- and sgp_ prefixes end at an invalid character; sgp_ takes an alphanumeric body only" {
  body=$(printf 'A-B_%.0s' $(seq 1 12))
  for prefix in 'tv''ly-' 'pp''lx-'; do
    printf 'x %s%s y\n' "$prefix" "$body" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 6 ] || { echo "not flagged with - and _ in the body: $prefix"; false; }
  done
  for prefix in 'tv''ly-' 'pp''lx-' 'sg''p_'; do
    printf 'x %s%s!%s y\n' "$prefix" "$(pad 10)" "$(pad 10)" >| "$A"
    run "$SCRIPT" "$A"
    [ "$status" -eq 0 ] || { echo "flagged across an invalid character: $prefix"; false; }
  done
}
