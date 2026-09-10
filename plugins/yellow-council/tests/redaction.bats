#!/usr/bin/env bats
# redaction.bats — behavioural gate for the credential-redaction awk program
# shipped inline in the council reviewer agents, the council-patterns skill,
# and both redaction sites in the /council command.
#
# WHY THIS EXISTS
# The program is a PEM state machine that has been fixed round after round
# against reviewer-reported bypasses, each round argued in prose and verified
# by reading. Prose review cannot settle whether a change closes a leak
# without reopening another, because the two failure directions pull against
# each other:
#
#   under-redaction — a real key escapes (a LEAK; the severe direction)
#   over-redaction  — a coincidental base64-ish line swallows the rest of the
#                     report, so Verdict:/Confidence:/Summary: never survive
#                     and the reviewer is reported as UNKNOWN
#
# Every test below pins one direction or the other. Fixing one direction while
# silently breaking the other fails here instead of in the next review round.
#
# The program is EXTRACTED from the shipped markdown, never copied — see
# lib/extract-redaction-awk.bash. Every carrier is walked for every body it
# holds (council.md ships one per redaction site), and the walker finds them
# by CONTENT — it anchors on the program's own function definitions rather
# than on a file path or a line range, so a carrier that moves its copy still
# extracts.
#
# The identity gate lives in setup_file(), not in a @test, and it is FATAL:
# a body that is not byte-identical to the canonical after dedent aborts the
# whole file before a single behavioural test runs. Reporting drift as one
# failing row among a screen of green ones invites reading it as a flaky
# formatting nit; aborting the file makes the suite say what is true, which
# is that nothing here was verified against the shipped program.
#
# PEM markers are ASSEMBLED from parts rather than written literally. Secret
# scanners (betterleaks via sourcery, GitGuardian) match a literal
# BEGIN-PRIVATE-KEY line anywhere in the tree, including in test fixtures and
# in the explanatory comments of the redaction code itself; those false
# positives are already open review threads on this PR and each one blocks
# merge under required_conversation_resolution. Assembling the marker keeps
# the bytes out of the committed file without weakening any assertion — the
# awk program sees the identical string at runtime.

# setup_file, BATS_FILE_TMPDIR, and this guard function itself all arrive in
# bats 1.7.0. On an older bats the guard hard-fails; without it, setup_file
# would be an unreferenced function and the identity gate would silently not
# run while every behavioural test still passed.
bats_require_minimum_version 1.7.0

# setup_file — extract every body once, then gate on identity. Runs once for
# the whole file; a non-zero return aborts it with a single
# `not ok N setup_file failed` row and no test rows at all.
setup_file() {
  load 'lib/extract-redaction-awk'
  REPO_ROOT="$(repo_root)"

  local bodies="${BATS_FILE_TMPDIR}/bodies"
  local canonical="${BATS_FILE_TMPDIR}/canonical.awk"
  mkdir -p "$bodies"

  # Basename uniqueness precondition. Body files are keyed by the carrier's
  # basename, so two carriers sharing one would overwrite each other's bodies:
  # the later carrier's copy would be compared twice and the earlier one never,
  # and the gate would report green over a drifted file.
  local i j bi bj
  for ((i = 0; i < ${#REDACTION_SOURCES[@]}; i++)); do
    bi="${REDACTION_SOURCES[i]##*/}"
    for ((j = i + 1; j < ${#REDACTION_SOURCES[@]}; j++)); do
      bj="${REDACTION_SOURCES[j]##*/}"
      [ "$bi" != "$bj" ] || {
        echo "duplicate carrier basename ${bi}: ${REDACTION_SOURCES[i]} and ${REDACTION_SOURCES[j]} both extract to ${bi}.<n>.body" >&2
        return 1
      }
    done
  done

  # Extract every carrier. The walker prints nothing on success and names the
  # file, the anchor line, and the condition on stderr when it cannot walk a
  # body; surface that verbatim rather than reducing it to "extraction
  # failed", because the condition IS the diagnosis.
  local f err
  for f in "${REDACTION_SOURCES[@]}"; do
    if ! err="$(extract_redaction_bodies "${REPO_ROOT}/${f}" "$bodies" 2>&1)"; then
      echo "extraction failed for ${f}:" >&2
      [ -n "$err" ] && echo "$err" >&2
      return 1
    fi
  done

  # Every carrier must yield at least one body. The COUNT is deliberately not
  # asserted anywhere: the walker already fails when its inner-marker count
  # and its anchor count disagree, and a number written down here is one more
  # thing to forget when a carrier gains a copy — the exact omission that let
  # council.md ship an unsynced program through round after round of fixes.
  local base
  local -a found
  for f in "${REDACTION_SOURCES[@]}"; do
    base="${f##*/}"
    shopt -s nullglob
    found=( "${bodies}/${base}".*.body )
    shopt -u nullglob
    [ "${#found[@]}" -gt 0 ] || {
      echo "no body extracted from ${f}: it is listed in REDACTION_SOURCES but carries no recognizable copy" >&2
      return 1
    }
  done

  # Dedent precondition. dedent_file strips a common leading run of spaces
  # and tabs; it does not join continued lines. A body carrying a trailing
  # backslash would still dedent, but the shell that hosts it would have
  # swallowed the newline, so the shipped program and the extracted one are
  # no longer the same text and every downstream compare is meaningless.
  shopt -s nullglob
  local -a raws=( "${bodies}"/*.body )
  shopt -u nullglob
  local raw
  for raw in "${raws[@]}"; do
    if grep -q '\\$' "$raw"; then
      echo "line continuation in $(basename "$raw"): a trailing backslash makes the extracted body diverge from what the shell runs" >&2
      # Line numbers only: a raw carrier line can hold a pasted credential
      # and this runs before the sanitized drift report.
      grep -n '\\$' "$raw" | cut -d: -f1 | sed 's/^/  line /' >&2
      return 1
    fi
  done

  # Build the canonical from CANONICAL_SOURCE, by name. Nothing indexes into
  # REDACTION_SOURCES: the canonical is a named constant precisely so that
  # reordering that array cannot silently change what everything else is
  # compared against.
  local canonical_base="${CANONICAL_SOURCE##*/}"
  # Diagnostics below name the DECLARATION (lib file and line), never the
  # value: CANONICAL_SOURCE is repository controlled and a pasted credential
  # standing in for it would otherwise print into the terminal or CI log.
  local canonical_decl
  canonical_decl="extract-redaction-awk.bash:$(grep -n '^CANONICAL_SOURCE=' "${REPO_ROOT}/plugins/yellow-council/tests/lib/extract-redaction-awk.bash" | head -1 | cut -d: -f1)"
  [ -f "${bodies}/${canonical_base}.1.body" ] || {
    echo "no body extracted from the canonical named at ${canonical_decl}" >&2
    return 1
  }
  [ ! -f "${bodies}/${canonical_base}.2.body" ] || {
    echo "the canonical named at ${canonical_decl} carries more than one body; the canonical must be unambiguous" >&2
    return 1
  }
  dedent_file "${bodies}/${canonical_base}.1.body" "$canonical" || {
    echo "dedenting the canonical body named at ${canonical_decl} failed; everything below would compare against a truncated program" >&2
    return 1
  }
  # An empty canonical is syntactically valid awk that prints nothing for any
  # input, which makes every leak-direction assertion below pass vacuously
  # ("the secret is absent" because NOTHING is emitted).
  [ -s "$canonical" ] || {
    echo "dedenting the canonical body named at ${canonical_decl} produced an empty program" >&2
    return 1
  }

  # Identity gate. check_body_identity accumulates EVERY mismatch before it
  # returns, and leaves the .dedent files the drift tests below reuse.
  check_body_identity "$bodies" "$canonical" || return 1
}

setup() {
  load 'lib/extract-redaction-awk'
  REPO_ROOT="$(repo_root)"
  require_awks "$(available_awks)"
  # The dedented canonical setup_file already built and gated. Behavioural
  # tests run the ONE program every carrier is required to match, so a green
  # behavioural row means the shipped bytes were exercised, not a copy that
  # happened to be first in some array.
  AWK_PROG="${BATS_FILE_TMPDIR}/canonical.awk"
  # Fail loudly if the canonical is missing or empty. An empty awk program is
  # syntactically valid and prints nothing for any input, which makes every
  # leak-direction assertion below pass vacuously ("the secret is absent"
  # because NOTHING is emitted). setup_file already checks this, but a bats
  # that skipped the hook, or a future refactor that moves the build, would
  # otherwise disable the half of this suite that matters most in silence.
  [ -s "$AWK_PROG" ] || {
    echo "no canonical program at ${AWK_PROG}: setup_file did not run or produced nothing from the file CANONICAL_SOURCE names in the lib" >&2
    return 1
  }

  D5="-----"
  BEGIN_PK="${D5}BEGIN PRIVATE KEY${D5}"
  END_PK="${D5}END PRIVATE KEY${D5}"
  BEGIN_RSA="${D5}BEGIN RSA PRIVATE KEY${D5}"
  END_RSA="${D5}END RSA PRIVATE KEY${D5}"

  # A key body line long enough to satisfy the 20-char base64 floor, and a
  # narrow one deliberately below it (the wrap-width leak vector).
  # Built at runtime, not written literally. A committed 54-char base64 blob
  # trips the same high-entropy scanners the assembled markers above dodge, and
  # each false positive opens a review thread that blocks merge under
  # required_conversation_resolution. The awk program sees identical bytes.
  NARROW_BODY="MIIEvQIBADANBg"
  WIDE_BODY="${NARROW_BODY}kqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCxYz"
}

# run_redaction <awk-implementation> — filter stdin through the program.
run_redaction() {
  "$1" -f "$AWK_PROG"
}

# available_awks and require_awks are shared from lib/extract-redaction-awk.bash,
# which setup() loads: both suites must run under every awk on the host, and a
# second copy of that list would let one suite silently test fewer.

# assert_redacted_under_all <input> <secret-substring>
# The secret must not survive under ANY available awk.
assert_redacted_under_all() {
  local input="$1" secret="$2" impl out hits
  for impl in $(available_awks); do
    out="$(printf '%s\n' "$input" | run_redaction "$impl")"
    if [[ "$out" == *"$secret"* ]]; then
      # Report the SHAPE of the failure, never the secret or the raw output.
      # These fixtures are synthetic, but a redaction suite that prints the
      # unredacted value on failure writes it into CI logs — which is the
      # exact disclosure the code under test exists to prevent, and the habit
      # carries over the first time someone reproduces with a real capture.
      # Report the SHAPE only. An earlier version masked the secret out of the
      # output with sed, but sed takes a BRE: a secret containing '.', '*',
      # '[', '^', '$' or '\' would not match its own mask pattern and the raw
      # line printed unredacted — the guard leaking the exact value it exists
      # to withhold. Grep with -F (literal) to COUNT, and never print a line
      # known to contain the secret.
      hits="$(printf '%s\n' "$out" | grep -cF -- "$secret")"
      echo "LEAK under ${impl}: the secret survived redaction on ${hits} line(s)." >&2
      echo "Secret length ${#secret}, starts '${secret:0:4}'. Value and output withheld." >&2
      echo "Lines NOT containing it, for context:" >&2
      printf '%s\n' "$out" | grep -vF -- "$secret" >&2 || true
      return 1
    fi
  done
}

# assert_survives_under_all <input> <substring>
# The substring must survive under ANY available awk (over-redaction guard).
assert_survives_under_all() {
  local input="$1" keep="$2" impl out lines chars markers
  for impl in $(available_awks); do
    out="$(printf '%s\n' "$input" | run_redaction "$impl")"
    if [[ "$out" != *"$keep"* ]]; then
      # Report the SHAPE of the failure, never the raw output. Several of
      # these fixtures feed genuine key-shaped bytes (WIDE_BODY, BEGIN_PK) as
      # input to pin the bounded-path release, so an over-redaction
      # regression could leave that material sitting unredacted in $out —
      # dumping it here would be the exact disclosure this suite exists to
      # catch, not just describe. Mirror assert_redacted_under_all's
      # discipline: report counts and redaction-marker positions, which
      # never carry secret bytes, instead of the content itself.
      lines="$(printf '%s\n' "$out" | wc -l)"
      chars="${#out}"
      markers="$(printf '%s\n' "$out" | grep -oE -- '--- redacted (credential|PEM key block) at line [0-9]+ ---' | tr '\n' ';')"
      echo "OVER-REDACTION under ${impl}: expected substring did not survive: '${keep}'" >&2
      echo "Output withheld: ${lines} line(s), ${chars} char(s)." >&2
      if [ -n "$markers" ]; then
        echo "Redaction markers present: ${markers}" >&2
      else
        echo "No redaction markers present in output — the substring is absent, not redacted." >&2
      fi
      return 1
    fi
  done
}

# --- Drift guard -----------------------------------------------------------

# body_files — populate BODY_FILES with every raw body setup_file extracted,
# or fail. A zero-length glob means setup_file never ran (an old bats that
# skipped the hook, or a harness change), and every loop below would then
# iterate zero times and report green having checked nothing.
#
# Sets a global rather than printing the list: a `while read < <(body_files)`
# runs the helper in a process substitution, whose exit status the loop
# discards, so the emptiness guard would print its diagnosis and the test
# would still pass. That is the same vacuous-pass shape this suite guards
# against everywhere else.
body_files() {
  shopt -s nullglob
  BODY_FILES=( "${BATS_FILE_TMPDIR}"/bodies/*.body )
  shopt -u nullglob
  [ "${#BODY_FILES[@]}" -gt 0 ] || {
    echo "no body files under ${BATS_FILE_TMPDIR}/bodies: setup_file did not run" >&2
    return 1
  }
}

@test "all shipped copies of the redaction program are byte-identical" {
  # The program is authored in every carrier and shipped once per redaction
  # site. A fix applied to some copies and not the others is the single most
  # repeated defect in this code's history, and
  # it is invisible to every behavioural test below (which run only the
  # canonical). setup_file already gates this fatally; this test keeps the
  # invariant as a NAMED row in the TAP output, and catches the case where
  # setup_file was skipped rather than passed.
  body_files || return 1
  local raw dedent
  for raw in "${BODY_FILES[@]}"; do
    dedent="${raw%.body}.dedent"
    [ -f "$dedent" ] || {
      echo "no dedented copy for $(basename "$raw"): setup_file did not complete the identity gate" >&2
      return 1
    }
    cmp -s "${BATS_FILE_TMPDIR}/canonical.awk" "$dedent" || {
      echo "DRIFT: $(basename "$raw") differs from the canonical extracted from the file CANONICAL_SOURCE names in the lib" >&2
      return 1
    }
  done
}

@test "no copy of the program contains a single quote" {
  # Every body outside the fenced SKILL.md block is embedded inside a
  # single-quoted shell string
  # (`awk '...' "$FILE"`, `local redact_awk='...'`, `$(awk '...' "$path")`).
  # One apostrophe in a COMMENT closes that string early and turns the rest of
  # the command into a shell syntax error, while leaving the awk itself valid
  # — so the syntax test below passes and the shipped command is broken. An
  # apostrophe reached main once this way.
  #
  # Checked on the RAW body, before dedent: the quote matters wherever it sits
  # in the carrier, and dedent only removes leading whitespace anyway.
  body_files || return 1
  local raw
  for raw in "${BODY_FILES[@]}"; do
    if grep -q "'" "$raw"; then
      echo "single quote in $(basename "$raw") at line(s):" >&2
      # Line numbers only, never the line: the offending line may sit next
      # to pasted credential material and this prints into CI logs.
      grep -n "'" "$raw" | cut -d: -f1 | sed 's/^/  /' >&2
      return 1
    fi
  done
}

@test "every extracted copy is a syntactically valid awk program" {
  body_files || return 1
  local raw dedent impl
  for raw in "${BODY_FILES[@]}"; do
    dedent="${raw%.body}.dedent"
    # An empty file is trivially valid awk, so without this the test would
    # pass against a broken extraction.
    [ -s "$dedent" ] || {
      echo "empty or missing dedented copy for $(basename "$raw")" >&2
      return 1
    }
    # Status checked explicitly. Under `set -e` a bare invocation inside a
    # loop is not the last command of the test body, so a parse error would
    # print to stderr and the row would still pass.
    for impl in $(available_awks); do
      "$impl" -f "$dedent" </dev/null >/dev/null || { echo "syntax error in $(basename "$raw") under $impl" >&2; return 1; }
    done
  done
}

# --- Under-redaction (leak) direction --------------------------------------

@test "a clean multi-line key is fully redacted" {
  # Baseline regression guard. If this ever fails, the program is broken
  # outright rather than subtly bypassed.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s' \
    "Verdict: REJECT" "$BEGIN_PK" "$WIDE_BODY" "$WIDE_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$WIDE_BODY"
}

@test "a key echoed as git deletion lines is fully redacted" {
  # A removed key in a reviewed diff arrives with git's '-' prefix attached:
  # the BEGIN line becomes six dashes. strip_deco() refuses to strip a leading
  # dash from anything matching ^----- , so the marker never normalises, the
  # anchored real-key test fails, and the block runs under the BOUNDED stray
  # window instead of the unbounded fail-closed path. With a narrow body the
  # 3-line stray cutoff then releases redaction mid-key.
  local input
  input="$(printf -- '-%s\n-%s\n-%s\n-%s\n-%s\n-%s' \
    "$BEGIN_PK" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "a prose line ending with a key marker stays on the bounded path" {
  # DELIBERATE SCOPE. Classification requires the marker to be the whole line
  # AFTER decoration stripping. A round of this PR removed that anchor so a
  # real key whose BEGIN shared a line with prose would be treated as real —
  # but reviewers correctly pointed out the cost: ordinary prose that merely
  # ENDS by quoting the header ("The header format is exactly: <marker>")
  # then classifies as a real key and redacts the whole report to EOF.
  #
  # The anchor is restored. With strip_deco fixed, the reachable case — a key
  # echoed from a diff — normalises to a marker-only line and still gets the
  # unbounded path (see the deletion-lines test). A genuine key with prose
  # ahead of its BEGIN on the same line is not a shape the reviewer CLIs
  # emit, and it stays on the bounded path rather than trading a live
  # over-redaction for it.
  # BOUNDED, not zero-cost: the stray counter still redacts three lines
  # before releasing (same trade-off the mention test below pins). What must
  # NOT happen is the unbounded path, which runs to EOF and would take the
  # verdict no matter how far away it sits.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s' \
    "The header format is exactly: ${BEGIN_PK}" \
    "and reviewers should not paste keys into findings." \
    "That is all this finding is about." \
    "Nothing further to report here." \
    "" "Verdict: APPROVE" "Summary: fine")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
  assert_survives_under_all "$input" "Summary: fine"
}

@test "a key echoed as diff ADDITION lines is fully redacted" {
  # Same bounded-path downgrade, reached a different way: the anchored test
  # The '+' side of the same diff shape as the deletion test: strip_deco must
  # normalise it to a marker-only line so the key takes the unbounded path.
  # Six body lines, not three: the stray counter releases on the THIRD
  # non-key-shaped line, so a fixture with exactly three narrow lines ends
  # before any of them would print and the leak stays invisible.
  local input
  input="$(printf '+%s\n+%s\n+%s\n+%s\n+%s\n+%s\n+%s\n+%s' \
    "$BEGIN_PK" \
    "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" \
    "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "a key echoed from a COMBINED diff is fully redacted" {
  # `git diff --cc` (merge output) carries one prefix character PER PARENT,
  # so "--"/"++" is normal. A single strip leaves "------BEGIN…" with the
  # wrong dash count, the anchored test fails, and the block drops to the
  # bounded path where a narrow body leaks.
  local input
  input="$(printf -- '--%s\n--%s\n--%s\n--%s\n--%s\n--%s' \
    "$BEGIN_PK" "$NARROW_BODY" "$NARROW_BODY" \
    "$NARROW_BODY" "$NARROW_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "a key nested in a blockquote inside a list item is fully redacted" {
  # Decoration NESTS. `- > <header>` needs the list strip and the blockquote
  # strip in the other order than a single ordered pass applies them, so one
  # layer survived, the marker never normalised, and the block dropped to the
  # bounded path. The stripper now runs to a fixpoint, so order stops
  # mattering.
  local input
  input="$(printf -- '- > %s\n- > %s\n- > %s\n- > %s\n- > %s' \
    "$BEGIN_PK" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "a key behind more diff prefixes than any fixed ceiling is fully redacted" {
  # Bounding prefix stripping by a CONSTANT is the recurring bug, not the
  # specific constant: the bound was 8, then 64, and each time output carrying
  # more prefixes than the bound exited the loop with prefixes still attached,
  # failed the anchored classifier, and leaked on the bounded path.
  #
  # This fixture must therefore not hardcode a count either — an 11-prefix
  # fixture is what let the 64-ceiling ship green. Generate a run that exceeds
  # any constant a future edit is likely to reintroduce.
  # Decorate ONLY the BEGIN line. Prefixing every line hides the bug: the body
  # lines then exceed the base64 floor on their own and get redacted anyway,
  # so the fixture passes against the very ceiling it is meant to catch. It is
  # the classification of the BEGIN line that the ceiling corrupts, and a
  # narrow undecorated body is what then slips the bounded path's stray count.
  local prefix input
  prefix="$(printf '+%.0s' $(seq 1 100))"
  input="$(printf -- '%s%s\n%s\n%s\n%s\n%s\n%s' \
    "$prefix" "$BEGIN_PK" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" \
    "$NARROW_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "prefix stripping scales with input length rather than a constant" {
  # The companion to the test above: the bound is derived from length(s), so
  # raising the prefix count by 5x must not change the outcome. A future edit
  # that swaps the derived bound back for any constant turns these red.
  local prefix input
  prefix="$(printf '+%.0s' $(seq 1 500))"
  input="$(printf -- '%s%s\n%s\n%s\n%s\n%s\n%s' \
    "$prefix" "$BEGIN_PK" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" \
    "$NARROW_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "a long plus-run is consumed in bulk rather than one pass per character" {
  # Stripping one character per pass while copying the remainder is quadratic
  # in the run length. A "+" can never be part of a PEM delimiter, so the whole
  # run is taken in a single substitution; only "-" needs character-at-a-time
  # care, and a hostile "-" flood remains a known open cost (see strip_deco).
  # Assert BOTH halves: the secret is redacted, AND it finishes quickly — the
  # redaction alone would pass even at quadratic cost, just slowly.
  #
  # A raw `elapsed < N` wall-clock assertion is nondeterministic: it depends
  # on host speed, load, and awk flavor (gawk measured ~20x slower than mawk
  # on identical input), so a correct linear implementation can fail
  # spuriously on a slow or busy runner while a quadratic one could squeak by
  # on a fast one. Two changes replace the stopwatch with a bound that cannot
  # flake:
  #   - the run is 5x the length the quadratic cost was originally measured
  #     at (100k, ~10s), so a reintroduced quadratic pass costs on the order
  #     of 25x longer — an unambiguous, order-of-magnitude gap from the
  #     linear cost, not a margin near the threshold.
  #   - `timeout` bounds each awk invocation directly instead of measuring
  #     elapsed time after the run finishes. A regression is caught by the
  #     process being killed within BOUND seconds, not by waiting out
  #     whatever a quadratic pass over 500k chars actually takes.
  local prefix input impl out status
  # Built with head+tr, not `seq 1 500000 | printf` (a 500k-argument command
  # line risks ARG_MAX) and not `${prefix// /+}` on a 500k-char string, which
  # is itself quadratic in bash: that construction measured 57s here versus
  # 0.0s for head+tr with byte-identical output. The awk program handles this
  # fixture in well under a second, so a slow test would be timing bash's
  # string handling rather than the redaction pass it exists to bound.
  prefix="$(head -c 500000 /dev/zero | tr '\0' '+')"
  input="$(printf -- '%s%s\n%s\n%s\n%s\n%s\n%s' \
    "$prefix" "$BEGIN_PK" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" \
    "$NARROW_BODY" "$END_PK")"
  for impl in $(available_awks); do
    out="$(printf '%s\n' "$input" | timeout 30 "$impl" -f "$AWK_PROG")"
    status=$?
    if [ "$status" -eq 124 ]; then
      echo "decoration stripping exceeded 30s under ${impl} — the plus-run is not being consumed in bulk" >&2
      return 1
    fi
    [ "$status" -eq 0 ] || {
      echo "${impl} exited ${status} unexpectedly processing the plus-run fixture" >&2
      return 1
    }
    if [[ "$out" == *"$NARROW_BODY"* ]]; then
      echo "LEAK under ${impl}: the secret survived redaction on the plus-run fixture." >&2
      return 1
    fi
  done
}

@test "a long prose line mentioning a marker still releases the report" {
  # A previous round bounded decoration stripping with a flat length cap that
  # failed CLOSED. Keying "this is a real key" off LENGTH ALONE promoted any
  # long line that merely MENTIONED a marker to a real key, and real mode never
  # resets until END or EOF — so one long paragraph swallowed Verdict: and the
  # reviewer was scored UNKNOWN.
  local input
  input="$(printf '%s mentions %s here\nprose one\nprose two\nprose three\nprose four\nVerdict: APPROVE' \
    "$(printf 'x%.0s' $(seq 1 10000))" "$BEGIN_PK")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
}

@test "a decorated quoted mention stays on the bounded path" {
  # The same round stripped matched quote/table wrappers AFTER list, blockquote
  # and numbered prefixes were already gone, so `- "<marker>"` normalised to a
  # bare marker and was classified REAL — swallowing the report through EOF.
  # Any of the three decoration shapes reproduces it.
  local prefix input
  for prefix in '- ' '> ' '3. '; do
    input="$(printf '%s"%s"\nprose one\nprose two\nprose three\nprose four\nVerdict: APPROVE' \
      "$prefix" "$BEGIN_PK")"
    assert_survives_under_all "$input" "Verdict: APPROVE" || {
      echo "swallowed with prefix: ${prefix}" >&2
      return 1
    }
  done
}

@test "a new block retires the previous block's re-arm window" {
  # pem_watch only decrements while !in_pem, so a countdown still running when
  # a new BEGIN opens is frozen for that whole block and resumes afterwards
  # with a stale count — and the re-arm path restores pem_real from
  # pem_prev_real, which belongs to the OLDER block. A base64-ish prose line
  # arriving later then re-entered UNBOUNDED real mode on the strength of a key
  # that had already closed, swallowing the report.
  local input
  input="$(printf '%s\n%s\n%s\nnote: the header is %s\nshort prose\nmore prose\nthird prose\naGVsbG8gd29ybGQgMTIzNDU2Nzg5\nVerdict: APPROVE' \
    "$BEGIN_PK" "$WIDE_BODY" "$END_PK" "$BEGIN_PK")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
}

@test "an inline key pair also retires the previous re-arm window" {
  # The multiline branch clears pem_watch; the self-contained BEGIN...END arm
  # changes no other state and was initially left out. A later base64-shaped
  # line then restored the FIRST block's unbounded real mode through EOF.
  local input
  input="$(printf '%s\n%s\n%s\n%s %s\nshort prose\nmore prose\nthird prose\naGVsbG8gd29ybGQgMTIzNDU2Nzg5\nVerdict: APPROVE' \
    "$BEGIN_PK" "$WIDE_BODY" "$END_PK" "$BEGIN_PK" "$END_PK")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
}

@test "a line of pure dashes does not hang the prefix stripper" {
  # The repeated strip is bounded; a horizontal rule must terminate.
  local input
  input="$(printf '%s\n%s' "--------------------------------" "Verdict: APPROVE")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
}

@test "a short placeholder does not shadow a real token later on the same line" {
  # cred_hit() uses match(), which returns only the LEFTMOST occurrence. When
  # a short placeholder sharing the prefix appears first, RLENGTH reflects the
  # placeholder, falls under minlen, and the whole line — real token included
  # — is emitted unredacted.
  local secret="sk-ant-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0"
  local input="example sk-ant-xxx then the real one ${secret}"
  assert_redacted_under_all "$input" "$secret"
}

@test "a narrowly-wrapped RSA key is fully redacted" {
  # The wrap-width vector on the real-key path: body lines below the 20-char
  # base64 floor must not release redaction.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s\n%s' \
    "$BEGIN_RSA" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$END_RSA")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "a decoy END does not expose the remaining key body" {
  # A hostile producer injects a bare END mid-body to terminate redaction
  # early. The bounded re-arm window exists to catch the resumed body.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s\n%s' \
    "$BEGIN_PK" "$WIDE_BODY" "$END_PK" "" "$WIDE_BODY" "$END_PK")"
  assert_redacted_under_all "$input" "$WIDE_BODY"
}

# --- Over-redaction direction ----------------------------------------------

@test "the report tail survives a coincidental base64-shaped word after a key" {
  # THE COUNTERWEIGHT to the re-arm tests above. After a genuine END, an
  # ordinary long identifier can satisfy the base64 shape test. Re-entering
  # the UNBOUNDED real-key branch on that single line redacts everything to
  # EOF, so the reviewer's verdict never survives and the council reports
  # UNKNOWN. Redaction must not swallow the report.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s' \
    "$BEGIN_PK" "$WIDE_BODY" "$END_PK" \
    "additionalRecommendationsForReviewers" \
    "Verdict: APPROVE" "Confidence: high" "Summary: looks fine")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
  assert_survives_under_all "$input" "Confidence: high"
  assert_survives_under_all "$input" "Summary: looks fine"
}

@test "an ordinary report with no secrets passes through untouched" {
  local input
  input="$(printf '%s\n%s\n%s\n%s' \
    "Findings:" "P1: something is wrong at foo.c:12" \
    "Verdict: REJECT" "Summary: needs work")"
  assert_survives_under_all "$input" "P1: something is wrong at foo.c:12"
  assert_survives_under_all "$input" "Verdict: REJECT"
}

@test "a bare git SHA does not trigger PEM redaction of the report" {
  # 40-char hex satisfies a length-only base64 test; the program excludes it
  # via the [G-Zg-z+/=] requirement. Without that, ordinary reviewer prose
  # citing a commit would swallow the report.
  local input
  input="$(printf '%s\n%s\n%s' \
    "See commit a852e8b8ffbad9c58f0d1a5cb1782dc0d4ab815a" \
    "Verdict: APPROVE" "Summary: fine")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
}

@test "the bounded window terminates after a prose mention of a key marker" {
  # The stray-mention path. A report that merely QUOTES a BEGIN marker while
  # describing a finding — which is exactly what a reviewer looking at THIS
  # file does — must not have its verdict swallowed.
  #
  # SCOPE: the design deliberately redacts up to three lines after such a
  # mention before the stray counter releases (see the "Stray prose mention"
  # comment in the program). This test pins the promise the design actually
  # makes — that the window TERMINATES and the report tail survives — not a
  # stricter zero-line one. A mention placed immediately adjacent to
  # `Verdict:` still loses it; closing that would require entering PEM mode
  # only after a lookahead confirms key-shaped body, which reintroduces the
  # unbounded-swallow direction this suite exists to prevent.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s' \
    "P1: the fixture embeds a ${BEGIN_PK} marker in plain prose" \
    "which the scanner flagged as a false positive." \
    "The redaction block already handles this case." \
    "No action needed for that finding." \
    "" "Findings: none blocking" "Verdict: APPROVE" "Summary: fine")"
  assert_survives_under_all "$input" "Verdict: APPROVE"
  assert_survives_under_all "$input" "Summary: fine"
  assert_survives_under_all "$input" "Findings: none blocking"
}

@test "a base64-shaped prose line after a clean END cannot swallow the report" {
  # The re-arm shape test accepts any alphanumeric run carrying a digit and a
  # non-hex letter, which ordinary prose satisfies. Inheriting the previous
  # block's UNBOUNDED mode on that evidence let one benign sentence after a
  # genuine END redact everything through EOF, so Verdict:/Confidence:/Summary:
  # never survived and the reviewer scored UNKNOWN off a false positive.
  #
  # The re-arm itself is deliberately still sensitive — it must fire so a
  # genuinely resumed body stays redacted (see the decoy-END tests) — so what
  # is pinned here is the BOUND, not the absence of re-arm: without armor
  # evidence the block re-enters the bounded path and the report tail lives.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s' \
    "$BEGIN_RSA" "$WIDE_BODY" "$END_RSA" \
    "HereIsSomeBase64LookingData12345AndMore7" \
    "stray one" "stray two" "Summary: the report tail must survive")"
  assert_survives_under_all "$input" "Summary: the report tail must survive"
  # The key itself must still be redacted — this must not become a leak test.
  assert_redacted_under_all "$input" "$WIDE_BODY"
}

@test "the line that ends the stray window is emitted, not redacted" {
  # The window is THREE non-key lines wide, and the third one is the line that
  # proves the window is over. An earlier revision overwrote `line` with the
  # redaction marker before the state machine ran, so that third line was
  # redacted anyway and the window cost four lines instead of three. With a
  # mention quoted immediately before the report tail, that one-line overrun
  # was the difference between `Summary:` surviving and being swallowed.
  #
  # Pins the boundary exactly: lines 2 and 3 after the mention are inside the
  # window and may be redacted; the third non-key line is outside it and must
  # be emitted verbatim. A regression that reinstates the overrun fails here
  # even though the "window terminates" test above still passes, because that
  # one only asserts the tail eventually survives, not where the edge is.
  local input
  input="$(printf '%s\n%s\n%s\n%s' \
    "P2: prose quoting a ${BEGIN_PK} marker inline" \
    "stray one" "stray two" "Summary: the third stray line must survive")"
  assert_survives_under_all "$input" "Summary: the third stray line must survive"
}

# --- Block boundary --------------------------------------------------------

@test "a second key block is classified on its own merits" {
  # The re-arm window runs unconditionally and can overwrite pem_real for a
  # block that already began inside it, so back-to-back blocks inherit the
  # previous block's mode instead of being classified fresh.
  #
  # The two blocks must differ in mode for this to bite: a PROSE-mode mention
  # first, then a REAL key inside the 5-line window. Inheriting prose mode
  # downgrades the real key to the bounded path, where a narrow body leaks
  # past the 3-line stray cutoff. Two real blocks would clobber pem_real=1
  # with 1 and prove nothing.
  # Block 2 must OPEN with a wide body line: the re-arm only fires on a
  # base64 line of at least 20 chars, so a narrow first line never reaches
  # the clobber. Wide line fires it (pem_real := prose), the narrow lines
  # after then leak past the bounded path's stray cutoff.
  local input
  input="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s' \
    "note: a mention of ${BEGIN_PK} in prose" \
    "some ordinary prose here" "$END_PK" \
    "$BEGIN_RSA" "$WIDE_BODY" \
    "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$NARROW_BODY" "$END_RSA")"
  assert_redacted_under_all "$input" "$NARROW_BODY"
}

@test "an inline single-line key is redacted without entering PEM mode" {
  # BEGIN and END on one line is self-contained: redact that line only, and
  # leave the following report intact.
  local input
  input="$(printf '%s\n%s\n%s' \
    "leaked: ${BEGIN_PK} ${WIDE_BODY} ${END_PK}" \
    "Verdict: REJECT" "Summary: key was exposed")"
  assert_redacted_under_all "$input" "$WIDE_BODY"
  assert_survives_under_all "$input" "Verdict: REJECT"
}
