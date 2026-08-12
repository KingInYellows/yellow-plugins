#!/usr/bin/env bats
# redaction.bats — behavioural gate for the credential-redaction awk program
# shipped inline in the council reviewer agents and the council-patterns skill.
#
# WHY THIS EXISTS
# The program is a PEM state machine that has been fixed four times against
# reviewer-reported bypasses, each round argued in prose and verified by
# reading. Prose review cannot settle whether a change closes a leak without
# reopening another, because the two failure directions pull against each
# other:
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
# lib/extract-redaction-awk.bash.
#
# PEM markers are ASSEMBLED from parts rather than written literally. Secret
# scanners (betterleaks via sourcery, GitGuardian) match a literal
# BEGIN-PRIVATE-KEY line anywhere in the tree, including in test fixtures and
# in the explanatory comments of the redaction code itself; those false
# positives are already open review threads on this PR and each one blocks
# merge under required_conversation_resolution. Assembling the marker keeps
# the bytes out of the committed file without weakening any assertion — the
# awk program sees the identical string at runtime.

setup() {
  load 'lib/extract-redaction-awk'
  REPO_ROOT="$(repo_root)"
  AWK_PROG="${BATS_TEST_TMPDIR}/redact.awk"
  extract_redaction_awk "${REPO_ROOT}/${REDACTION_SOURCES[0]}" >"$AWK_PROG"

  D5="-----"
  BEGIN_PK="${D5}BEGIN PRIVATE KEY${D5}"
  END_PK="${D5}END PRIVATE KEY${D5}"
  BEGIN_RSA="${D5}BEGIN RSA PRIVATE KEY${D5}"
  END_RSA="${D5}END RSA PRIVATE KEY${D5}"

  # A key body line long enough to satisfy the 20-char base64 floor, and a
  # narrow one deliberately below it (the wrap-width leak vector).
  WIDE_BODY="MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCxYz"
  NARROW_BODY="MIIEvQIBADANBg"
}

# run_redaction <awk-implementation> — filter stdin through the program.
run_redaction() {
  "$1" -f "$AWK_PROG"
}

# available_awks — every awk implementation present on this host.
# mawk is Debian/Ubuntu's default /usr/bin/awk and lacks interval expressions
# ({n,}), which is why the program uses match()+RLENGTH; gawk is the common
# developer default. A fix verified on only one of them is not verified.
available_awks() {
  local a
  for a in mawk gawk awk; do
    command -v "$a" >/dev/null 2>&1 && echo "$a"
  done
}

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
  local input="$1" keep="$2" impl out
  for impl in $(available_awks); do
    out="$(printf '%s\n' "$input" | run_redaction "$impl")"
    if [[ "$out" != *"$keep"* ]]; then
      echo "OVER-REDACTION under ${impl}: '${keep}' was swallowed" >&2
      echo "--- output ---" >&2
      echo "$out" >&2
      return 1
    fi
  done
}

# --- Drift guard -----------------------------------------------------------

@test "all shipped copies of the redaction program are byte-identical" {
  # The program is authored in three files. A fix applied to one and not the
  # others is the single most repeated defect in this code's history, and it
  # is invisible to every behavioural test below (which run only the first
  # copy). This is the test that catches it.
  local first="" f current
  for f in "${REDACTION_SOURCES[@]}"; do
    current="$(extract_redaction_awk "${REPO_ROOT}/${f}" | md5sum | cut -d' ' -f1)"
    [ -n "$current" ] || { echo "extracted nothing from ${f}" >&2; return 1; }
    if [ -z "$first" ]; then
      first="$current"
    elif [ "$current" != "$first" ]; then
      echo "DRIFT: ${f} differs from ${REDACTION_SOURCES[0]}" >&2
      return 1
    fi
  done
}

@test "every extracted copy is a syntactically valid awk program" {
  local f impl
  for f in "${REDACTION_SOURCES[@]}"; do
    extract_redaction_awk "${REPO_ROOT}/${f}" >"${BATS_TEST_TMPDIR}/p.awk"
    for impl in $(available_awks); do
      echo "" | "$impl" -f "${BATS_TEST_TMPDIR}/p.awk" >/dev/null
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
