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
  printf 'use AKIAABCDEFGHIJKLMNOP\n' >| "$B"
  run --separate-stderr "$SCRIPT" "$A" "$B"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"$B"* ]]
}

@test "a private key block exits 2" {
  printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 2 ]
}

@test "no arguments exits 2; a missing file exits 1" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" "$BATS_TEST_TMPDIR/nope"
  [ "$status" -eq 1 ]
}

@test "ordinary code that names credentials is not flagged" {
  printf '%s\n' 'token: string' 'password: z.string()' \
    'const API_KEY = process.env.API_KEY' >| "$A"
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
}

@test "a very long single line is scanned quickly" {
  head -c 3000000 /dev/zero | tr '\0' 'a' >| "$A"
  start=$SECONDS
  run "$SCRIPT" "$A"
  [ "$status" -eq 0 ]
  [ $((SECONDS - start)) -lt 5 ]
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
