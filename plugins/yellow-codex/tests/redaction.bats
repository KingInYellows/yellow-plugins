#!/usr/bin/env bats
# redaction.bats — yellow-codex's first bats suite. Pins the redact-THEN-cap
# order in commands/codex/review.md's diagnostics block.
#
# The bug this guards (PR #801 review thread): `codex_api_error` was
# extracted with `head -c 400` and the diagnostics pipe ran `head -c 500`
# BEFORE the redaction awk. A credential straddling the cap was cut into a
# fragment too short for its pattern (`sk-` + <20 chars never matches
# `sk-[a-zA-Z0-9_-]{20}…`), so the fragment reached stderr unredacted.
# rescue.md and setup.md already redact first; review.md now does too.
#
# The awk program under test is EXTRACTED from review.md at run time rather
# than copied here, so the suite fails if the block drifts, and the fixture
# credential is assembled from parts so this file never contains a literal
# key shape for a secret scanner to flag. The program runs under every awk
# on PATH (mawk on CI's ubuntu runner, gawk where installed) so the
# `{20}[...]*` mawk-compatible pattern shape is exercised regardless of
# which implementation `awk` resolves to locally.

bats_require_minimum_version 1.5.0

REVIEW_MD="$BATS_TEST_DIRNAME/../commands/codex/review.md"

# The line that closes each redaction awk and applies the cap, as an ERE:
# `}' | head -c 500 >&2`, optionally with the git-diff peek's file operand
# between. Shared by the extractor and the structural guard so a formatting
# change in review.md has one place to update. Written with bracket
# expressions instead of backslash escapes: it travels into awk through
# `-v`, where gawk applies string-escape processing (`\}` -> `}`, `\|` ->
# a live alternation) and mawk does not — `[}]`/`[$]`/`[|]` mean the same
# to grep -E, mawk and gawk.
CLOSING_RE='^ *[}]'"'"' ("[$]STDERR_FILE" )?[|] head -c 500 >&2$'

# The awk program between `| awk '{` (first one after the begin fence) and
# the closing line, quotes stripped. $1 = awk implementation.
extract_diagnostics_awk() {
  "${1:-awk}" -v closing="$CLOSING_RE" '
    /--- begin codex-diagnostics \(reference only\) ---/ { armed = 1; next }
    armed && !grabbing && /\| awk '\''\{$/ { grabbing = 1; print "{"; next }
    grabbing && $0 ~ closing { print "}"; exit }
    grabbing { print }
  ' "$REVIEW_MD"
}

available_awks() {
  local impl out=""
  for impl in mawk gawk; do
    command -v "$impl" >/dev/null 2>&1 && out="$out $impl"
  done
  [ -n "$out" ] || out=" awk"
  printf '%s' "${out# }"
}

@test "the extractor yields the same program under every awk on PATH (the -v pattern survives escape processing)" {
  local impl reference program
  reference=$(extract_diagnostics_awk awk)
  [ -n "$reference" ]
  [[ "$reference" == "{"* ]]
  [[ "$reference" == *"}" ]]
  [[ "$reference" == *"redacted credential at line"* ]]
  # A loosened stop condition would truncate the program: pin its shape.
  [ "$(printf '%s\n' "$reference" | grep -c 'gsub(')" -eq 10 ]
  [ "$(printf '%s\n' "$reference" | tail -n 2 | head -n 1)" = "      print" ]
  for impl in $(available_awks); do
    program=$(extract_diagnostics_awk "$impl")
    [ "$program" = "$reference" ]
  done
}

@test "a credential straddling the old 400-byte cap is fully redacted (redact before cap), under every awk on PATH" {
  local program
  program=$(extract_diagnostics_awk)
  [ -n "$program" ]

  # Build `api-error: <filler>sk-<40 chars>` so the key's prefix starts at
  # byte 389: a `head -c 400` ahead of the awk would leave `sk-` plus 9
  # characters — unmatched by every pattern — in the excerpt.
  local key_prefix="sk" key_body filler payload impl
  key_body=$(printf 'A%.0s' $(seq 1 40))
  filler=$(printf 'x%.0s' $(seq 1 377))
  payload="api-error: ${filler}${key_prefix}-${key_body} trailing text"
  [ "${#payload}" -gt 400 ]

  for impl in $(available_awks); do
    run bash -c 'printf "%s\n" "$1" | "$3" "$2" | head -c 500' _ "$payload" "$program" "$impl"
    [ "$status" -eq 0 ]
    [[ "$output" == *"--- redacted credential at line 1 ---"* ]]
    [[ "$output" != *"${key_prefix}-${key_body}"* ]]
    [[ "$output" != *"${key_prefix}-AAAA"* ]]
    [ "${#output}" -le 500 ]
  done
}

@test "review.md never caps ahead of a redaction awk and never caps the api-error extraction" {
  # Structural drift guards for the three sites the redact-then-cap fix
  # touched. No `head` (byte or line form, any count, redirect or pipe
  # form) may feed an awk …
  run grep -nE 'head (-c|-n|--bytes|--lines)[= ]?[0-9]+ *(<? *"\$STDERR_FILE" *)?\| *awk' "$REVIEW_MD"
  [ "$status" -ne 0 ]
  # … the only non-comment `head` invocations are the two post-awk caps …
  run grep -cE '^[^#]*head (-c|--bytes)' "$REVIEW_MD"
  [ "$output" -eq 2 ]
  # … no other byte-truncation idiom (a jq string slice, a printf
  # precision, a bash substring, cut -c) touches the diagnostics …
  run grep -nE '^[^#]*(\.message\[[0-9]*:[0-9]+\]|%\.[0-9]+s|codex_api_error:[0-9]*:[0-9]+|cut -c)' "$REVIEW_MD"
  [ "$status" -ne 0 ]
  # … and both sit after an awk closing brace.
  run grep -cE "$CLOSING_RE" "$REVIEW_MD"
  [ "$output" -eq 2 ]
}
