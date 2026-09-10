#!/usr/bin/env bats
# extract.bats — unit gate for the multi-body walker in
# lib/extract-redaction-bodies.awk.
#
# WHY THIS EXISTS
# redaction.bats runs the EXTRACTED redaction program; it never exercises the
# extractor itself. A walker that silently finds one body where a carrier ships
# two, or that reports zero bodies instead of failing, makes every drift and
# behaviour assertion in that suite pass vacuously — the same class of silent
# pass the derived body count exists to prevent. Every test here pins one
# walker behaviour against a synthetic fixture, so a future carrier written in
# any of the three known delimiter shapes needs no extractor change, and every
# error path stays loud.
#
# Fixtures carry no credential material, so failure output prints diffs and
# stderr verbatim. That is the opposite of redaction.bats' discipline and it is
# deliberate: nothing here is secret, and the walker's diagnostics are the thing
# under test.
#
# The two function-definition marker strings are ASSEMBLED from parts at
# runtime, never written contiguously. Written whole they would make this file
# look like a carrier of the redaction program to scripts/validate-council-roster.js
# (Rule R scans .bats files and this one is not in its SELF_FILES allowlist),
# and secret scanners treat a literal marker in a fixture as a finding. The awk
# under test sees identical bytes either way.

bats_require_minimum_version 1.7.0

setup() {
  load 'lib/extract-redaction-awk'
  REPO_ROOT="$(repo_root)"
  ORIG_PATH="$PATH"
  OUT="${BATS_TEST_TMPDIR}/out"
  FX="${BATS_TEST_TMPDIR}/fx"
  mkdir -p "$OUT" "$FX"
  # The walker, for the tests that invoke it directly instead of through
  # extract_redaction_bodies — the library is what supplies its -v markers, so
  # bypassing it is the only way to see the walker's own argument guard.
  WALKER="${BATS_TEST_DIRNAME}/lib/extract-redaction-bodies.awk"

  AWKS="$(available_awks)"
  require_awks "$AWKS"

  # One shim directory per implementation, each holding an `awk` symlink. The
  # library calls plain `awk` (both in the walker and in dedent_file) and takes
  # no override variable, so selecting an implementation means putting it first
  # on PATH — not passing a flag.
  SHIM_ROOT="${BATS_TEST_TMPDIR}/shim"
  local impl
  for impl in $AWKS; do
    mkdir -p "${SHIM_ROOT}/${impl}"
    ln -sf "$(command -v "$impl")" "${SHIM_ROOT}/${impl}/awk"
  done

  M_ANCHOR="function strip""_deco(s,   prev) {"
  M_INNER="function cred""_hit(s) {"
  E_NO_OPENER="no opener"
  E_NO_CLOSER="no closer"
  E_NO_INNER="missing cred""_hit marker"
  E_CRLF="CRLF line endings"
  E_NO_MARKERS="ANCHOR and INNER are required"
  E_INNER_MISMATCH="inner markers but"
  E_UNANCHORED="block looks like the redaction program but carries no anchor marker"
  E_REPLACED="is passed to awk as a program but its block is not the redaction program"
  E_NO_BODIES="no body files"
  # The shape scan's fingerprint. Unlike the two marker strings above it needs
  # no assembly: Rule R identifies a carrier by both function-definition
  # markers, and this is a variable name from the program's PEM state machine.
  M_FINGERPRINT="in_pem"
}

# --- Harness ---------------------------------------------------------------

# available_awks and require_awks are shared from the library rather than
# copied here: mawk (Debian's /usr/bin/awk) versus gawk is exactly the split
# the walker's no-gensub, no-interval-expression portability rules exist for,
# and a second copy of that list would let one suite silently test fewer
# implementations than the other.

# use_awk <impl> — make <impl> the `awk` the library resolves.
use_awk() {
  PATH="${SHIM_ROOT}/$1:${ORIG_PATH}"
}

# run_walker <fixture> — walk <fixture> into a freshly emptied output dir,
# capturing status and stderr separately. The walker prints nothing on stdout.
run_walker() {
  rm -rf "$OUT"
  mkdir -p "$OUT"
  run --separate-stderr extract_redaction_bodies "$1" "$OUT"
}

# body_count — how many body files the last walk wrote.
body_count() {
  local n=0 f
  shopt -s nullglob
  for f in "$OUT"/*.body; do n=$((n + 1)); done
  shopt -u nullglob
  printf '%s\n' "$n"
}

assert_ok() { # <impl> <what>
  [ "$status" -eq 0 ] || {
    echo "walker exited ${status} under ${1} for ${2} (expected 0)" >&2
    echo "stderr: ${stderr}" >&2
    return 1
  }
}

assert_fails_with() { # <impl> <expected-stderr-substring>
  [ "$status" -eq 2 ] || {
    echo "expected exit 2 under ${1}, got ${status}" >&2
    echo "stderr: ${stderr}" >&2
    return 1
  }
  case "$stderr" in
    *"$2"*) : ;;
    *)
      echo "expected stderr under ${1} to contain: ${2}" >&2
      echo "stderr: ${stderr}" >&2
      return 1
      ;;
  esac
}

assert_body_count() { # <impl> <expected>
  local got
  got="$(body_count)"
  [ "$got" -eq "$2" ] || {
    echo "expected ${2} body file(s) under ${1}, found ${got}" >&2
    ls -1 "$OUT" >&2 || true
    return 1
  }
}

assert_same() { # <impl> <want> <got>
  cmp -s "$2" "$3" || {
    echo "extracted body differs from the fixture interior under ${1}" >&2
    diff -u "$2" "$3" | head -20 >&2
    return 1
  }
}

# --- Fixture builders ------------------------------------------------------

# emit_body <pad> — the smallest interior the walker accepts: the anchor line
# it starts from and the inner marker it requires, each prefixed with <pad>.
emit_body() {
  printf '%s\n' \
    "${1}${M_ANCHOR}" \
    "${1}  return s" \
    "${1}}" \
    "${1}${M_INNER}" \
    "${1}  return 0" \
    "${1}}"
}

# emit_gapped_body <pad> <ws-only-line> — emit_body plus an internal blank line
# and a whitespace-only line, the two shapes dedent_file must ignore when it
# computes the minimum indent and must emit empty.
emit_gapped_body() {
  printf '%s\n' \
    "${1}${M_ANCHOR}" \
    "${1}  return s" \
    "" \
    "${1}}" \
    "${2}" \
    "${1}${M_INNER}" \
    "${1}  return 0" \
    "${1}}"
}

# emit_program_body <pad> <name-suffix> — emit_body plus the line the walker's
# shape scan fingerprints, with <name-suffix> spliced into BOTH function names.
# An empty suffix emits a well-formed body; a non-empty one emits the copy that
# lost both markers at once, which no marker-derived count can see.
#
# Only the shape-scan tests build fixtures with this. A fingerprint in the
# fixtures above would make the scan fire inside the tests that pin the
# marker-driven diagnostics, and each of those would then report the shape
# failure instead of the condition it exists to check.
emit_program_body() {
  local pad="$1" sfx="$2" anchor inner
  anchor="${M_ANCHOR/(/${sfx}(}"
  inner="${M_INNER/(/${sfx}(}"
  printf '%s\n' \
    "${pad}${anchor}" \
    "${pad}  ${M_FINGERPRINT} = 0" \
    "${pad}  return s" \
    "${pad}}" \
    "${pad}${inner}" \
    "${pad}  return 0" \
    "${pad}}"
}

# anchor_line <fixture> <n> — the file line number of the <n>th anchor.
anchor_line() {
  grep -n -F -- "$M_ANCHOR" "$1" | sed -n "${2}p" | cut -d: -f1
}

# --- Shapes ----------------------------------------------------------------

@test "fence shape yields one body identical to the fenced interior" {
  local fx="${FX}/fence.md" want="${FX}/fence.want" impl
  {
    printf '%s\n' "Prose before the block."
    printf '%s\n' '```awk'
    emit_body ""
    printf '%s\n' '```'
    printf '%s\n' "Prose after the block."
  } >"$fx"
  emit_body "" >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/fence.md.1.body"
  done
}

@test "bare command shape yields one body identical to the command interior" {
  local fx="${FX}/bare.md" want="${FX}/bare.want" impl
  {
    printf '%s\n' "Redact the raw capture before writing it out:"
    printf '%s\n' ""
    printf '%s\n' "awk '"
    emit_body ""
    printf '%s\n' "' \"\$RAW_FILE\" > \"\$FENCED_OUTPUT\""
  } >"$fx"
  emit_body "" >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/bare.md.1.body"
  done
}

@test "var shape yields both assignment bodies, in file order, indent preserved" {
  # The two openers council.md actually ships — Step 4's `local name='` at
  # indent 2 and Step 7's `name=$(awk '` at indent 6 — in one file. This is the
  # case that made the walker necessary: an extractor that stops at the first
  # body reports a carrier as synced while its second copy drifts.
  local fx="${FX}/var-two.md" want1="${FX}/var-two.want1" want2="${FX}/var-two.want2" impl
  {
    printf '%s\n' "Step 4 assigns the program to a variable:"
    printf '%s\n' "    local redact_awk='"
    emit_body "    "
    printf '%s\n' "    '"
    printf '%s\n' ""
    printf '%s\n' "Step 7 captures a section through the same program:"
    printf '%s\n' "      section_body=\$(awk '"
    emit_body "      "
    printf '%s\n' "      ' \"\$SECTION_FILE\")"
  } >"$fx"
  emit_body "    " >"$want1"
  emit_body "      " >"$want2"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 2
    assert_same "$impl" "$want1" "${OUT}/var-two.md.1.body"
    assert_same "$impl" "$want2" "${OUT}/var-two.md.2.body"
  done
}

@test "a var opener and closer whose variable name carries a digit still walk" {
  # The closer's variable-name class must mirror the opener's. When it read
  # [A-Za-z_]+ a second capture in the same file — section_body2 closed by
  # `' "$section_file2")` — matched no closer at all, and a well-formed carrier
  # failed with "no closer" the moment a maintainer numbered the pair.
  local fx="${FX}/var-digit.md" want="${FX}/var-digit.want" impl
  {
    printf '%s\n' "      section_body2=\$(awk '"
    emit_body "      "
    printf '%s\n' "      ' \"\$section_file2\")"
  } >"$fx"
  emit_body "      " >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/var-digit.md.1.body"
  done
}

@test "dedent_file strips the carrier indent and empties blank-ish lines" {
  local fx="${FX}/dedent.md" want="${FX}/dedent.want" got="${FX}/dedent.got" impl
  {
    printf '%s\n' "      section_body=\$(awk '"
    emit_gapped_body "      " "   "
    printf '%s\n' "      ' \"\$SECTION_FILE\")"
  } >"$fx"
  # The whitespace-only line is narrower than the body indent on purpose: if
  # dedent_file counted it toward the minimum, the common prefix would drop to
  # 3 and every real line would keep 3 spaces of carrier indent.
  emit_gapped_body "" "" >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    dedent_file "${OUT}/dedent.md.1.body" "$got"
    assert_same "$impl" "$want" "$got"
  done
}

# --- Error paths -----------------------------------------------------------

@test "a file with no anchor exits 0 and writes nothing" {
  local fx="${FX}/none.md" impl
  {
    printf '%s\n' "This carrier documents redaction but ships no program."
    printf '%s\n' '```awk'
    printf '%s\n' "BEGIN { print \"not the program\" }"
    printf '%s\n' '```'
  } >"$fx"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 0
  done
}

@test "an anchor with no opener exits 2 naming the anchor line" {
  local fx="${FX}/no-opener.md" ln impl
  {
    printf '%s\n' "A copy pasted into prose, with no delimiter of any shape:"
    printf '%s\n' ""
    emit_body ""
    printf '%s\n' "and the document continues."
  } >"$fx"
  ln="$(anchor_line "$fx" 1)"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "line ${ln}: ${E_NO_OPENER}"
    assert_body_count "$impl" 0
  done
}

@test "an anchor with no closer exits 2 naming the anchor line" {
  local fx="${FX}/no-closer.md" ln impl
  {
    printf '%s\n' "An unterminated fence:"
    printf '%s\n' '```awk'
    emit_body ""
    printf '%s\n' "and no closing fence before EOF."
  } >"$fx"
  ln="$(anchor_line "$fx" 1)"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "line ${ln}: ${E_NO_CLOSER}"
    assert_body_count "$impl" 0
  done
}

@test "a body without the inner marker exits 2 rather than counting as a copy" {
  # A partial paste carrying only the anchor is not the program. Letting it
  # through would make the walker and validate-council-roster.js disagree about
  # whether the file is a carrier — the validator requires both markers.
  local fx="${FX}/partial.md" ln impl
  {
    printf '%s\n' '```awk'
    printf '%s\n' "$M_ANCHOR"
    printf '%s\n' "  return s"
    printf '%s\n' "}"
    printf '%s\n' '```'
  } >"$fx"
  ln="$(anchor_line "$fx" 1)"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "line ${ln}: ${E_NO_INNER}"
    assert_body_count "$impl" 0
  done
}

@test "CRLF input is rejected before the walk rather than mis-walked" {
  # A trailing \r would ride into every body and break the byte compare far
  # from its cause, and both closer patterns anchor on $.
  local fx="${FX}/crlf.md" impl
  {
    printf '%s\r\n' "Prose before the block."
    printf '%s\r\n' '```awk'
    printf '%s\r\n' "$M_ANCHOR"
    printf '%s\r\n' "  return s"
    printf '%s\r\n' "}"
    printf '%s\r\n' "$M_INNER"
    printf '%s\r\n' "  return 0"
    printf '%s\r\n' "}"
    printf '%s\r\n' '```'
  } >"$fx"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "line 1: ${E_CRLF}"
    assert_body_count "$impl" 0
  done
}

@test "a second anchor sharing the first body's opener fails rather than nesting" {
  # The backward walk stops at the previous body's closer. Without that stop it
  # would adopt the first body's opener and emit a second body spanning both
  # copies, which compares clean against nothing and hides the missing fence.
  local fx="${FX}/shared-opener.md" want="${FX}/shared-opener.want" ln2 impl
  {
    printf '%s\n' "First copy, correctly fenced:"
    printf '%s\n' '```awk'
    emit_body ""
    printf '%s\n' '```'
    printf '%s\n' ""
    printf '%s\n' "Second copy, pasted in without a fence of its own:"
    emit_body ""
  } >"$fx"
  emit_body "" >"$want"
  ln2="$(anchor_line "$fx" 2)"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "line ${ln2}: ${E_NO_OPENER}"
    # The first body is still written — the failure is scoped to the anchor
    # that could not be resolved, not to the whole file.
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/shared-opener.md.1.body"
  done
}

@test "a lone quote line inside a var body ends that body" {
  # Documented constraint, not a bug: the var closer is whitespace-then-quote,
  # so any such line inside the program terminates the body early. It cannot
  # arise in a real carrier because redaction.bats' "no copy of the program
  # contains a single quote" test forbids an apostrophe anywhere in a shipped
  # copy — that test is what keeps this shape out of the tree.
  local fx="${FX}/lone-quote.md" want="${FX}/lone-quote.want" impl
  {
    printf '%s\n' "    local redact_awk='"
    printf '%s\n' "    ${M_ANCHOR}"
    printf '%s\n' "    ${M_INNER}"
    printf '%s\n' "    '"
    printf '%s\n' "    tail_marker = 1"
    printf '%s\n' "    '"
  } >"$fx"
  printf '%s\n' "    ${M_ANCHOR}" "    ${M_INNER}" >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/lone-quote.md.1.body"
    if grep -q "tail_marker" "${OUT}/lone-quote.md.1.body"; then
      echo "body ran past the lone quote line under ${impl}" >&2
      return 1
    fi
  done
}

@test "an anchor mention inside an already-walked body is not a second copy" {
  # A comment naming the function, inside the fence, carries the anchor
  # string. It is text the walk already extracted, not a second copy: the walk
  # skips anything at or before the previous body's closer and does not count
  # it, so the derived cross-check below stays true on a well-formed carrier.
  local fx="${FX}/inner-mention.md" want="${FX}/inner-mention.want" impl
  local note="  # ${M_ANCHOR} runs to a fixpoint"
  {
    printf '%s\n' '```awk'
    printf '%s\n' "$M_ANCHOR" "  return s" "}" "$note" "$M_INNER" "  return 0" "}"
    printf '%s\n' '```'
  } >"$fx"
  printf '%s\n' "$M_ANCHOR" "  return s" "}" "$note" "$M_INNER" "  return 0" "}" >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/inner-mention.md.1.body"
    grep -qF -- "$note" "${OUT}/inner-mention.md.1.body" || {
      echo "the comment naming the anchor was dropped from the body under ${impl}" >&2
      return 1
    }
  done
}

@test "an inner-marker mention inside an already-walked body is not a second copy" {
  # The mirror of the anchor case above, for the OTHER marker. The cross-check
  # counts one per walked body that carries the inner marker at all, not one
  # per line holding it, so a comment inside the program that names the
  # function cannot push the inner count above the anchor count and report a
  # corruption that is not there.
  local fx="${FX}/inner-marker-mention.md" want="${FX}/inner-marker-mention.want" impl
  local note="  # ${M_INNER} is called once per line"
  {
    printf '%s\n' '```awk'
    printf '%s\n' "$M_ANCHOR" "  return s" "}" "$note" "$M_INNER" "  return 0" "}"
    printf '%s\n' '```'
  } >"$fx"
  printf '%s\n' "$M_ANCHOR" "  return s" "}" "$note" "$M_INNER" "  return 0" "}" >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/inner-marker-mention.md.1.body"
    grep -qF -- "$note" "${OUT}/inner-marker-mention.md.1.body" || {
      echo "the comment naming the inner marker was dropped from the body under ${impl}" >&2
      return 1
    }
  done
}

@test "a corrupted anchor line with an intact inner marker exits 2" {
  # The case the derived cross-check exists for: a stray space in the function
  # header means the walk matches no anchor at all, so it writes no body and
  # raises no per-anchor error — while validate-council-roster.js still counts
  # the file as a carrier on the strength of the untouched inner marker.
  # Comparing the two counts turns that silent skip into a loud exit.
  local fx="${FX}/corrupt-anchor.md" corrupt impl
  corrupt="${M_ANCHOR/function /function  }"
  {
    printf '%s\n' '```awk'
    printf '%s\n' "$corrupt" "  return s" "}" "$M_INNER" "  return 0" "}"
    printf '%s\n' '```'
  } >"$fx"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "$E_INNER_MISMATCH"
    assert_body_count "$impl" 0
  done
}

@test "the walker refuses to run without its marker strings" {
  # Invoked directly, bypassing extract_redaction_bodies: the library is what
  # supplies ANCHOR and INNER from REDACTION_ANCHOR_MARKERS, and an empty -v
  # would otherwise make index() match every line and walk nonsense.
  local fx="${FX}/markerless.md" impl
  {
    printf '%s\n' '```awk'
    emit_body ""
    printf '%s\n' '```'
  } >"$fx"

  for impl in $AWKS; do
    run --separate-stderr "$impl" -v OUT="$OUT" -v BASE=markerless.md -f "$WALKER" "$fx"
    assert_fails_with "$impl" "$E_NO_MARKERS"
    assert_body_count "$impl" 0
  done
}

# --- Shape scan ------------------------------------------------------------

@test "a body that loses both markers is caught by shape, not by count" {
  # The hole the shape scan exists for. Rename BOTH function headers in one of
  # two bodies and every marker-derived number stays consistent — one anchor,
  # one inner marker, one body written — so the walk reports success, the
  # cross-check agrees, and the identity gate never sees the changed copy.
  # Only the delimiter shape plus a non-marker fingerprint still says a second
  # program is sitting there.
  local fx="${FX}/both-renamed.md" ln impl
  {
    printf '%s\n' "Step 4 assigns the program to a variable:"
    printf '%s\n' "    local redact_awk='"
    emit_program_body "    " ""
    printf '%s\n' "    '"
    printf '%s\n' ""
    printf '%s\n' "Step 7 captures a section through a renamed copy:"
    printf '%s\n' "      section_body=\$(awk '"
    emit_program_body "      " "2"
    printf '%s\n' "      ' \"\$SECTION_FILE\")"
  } >"$fx"
  ln="$(grep -n -F -- 'section_body=$(awk ' "$fx" | cut -d: -f1)"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "line ${ln}: ${E_UNANCHORED}"
    # The intact body is still written: the failure is scoped to the block
    # that could not be accounted for, not to the whole file.
    assert_body_count "$impl" 1
  done
}

@test "an unrelated awk block without the fingerprint does not trip the shape scan" {
  # council.md ships four short awk one-liners (file_verdict, file_confidence,
  # summary, findings) in the same var shape as the program. They are opener
  # lines the shape scan walks and none carries the fingerprint, so the scan
  # must pass over them rather than report every awk block in a carrier as a
  # copy that lost its markers.
  local fx="${FX}/unrelated-awk.md" want="${FX}/unrelated-awk.want" impl
  {
    printf '%s\n' "      file_verdict=\$(awk '"
    printf '%s\n' "        inf && /^Verdict: / { v[++nv] = \$0 }"
    printf '%s\n' "        END { if (nv == 1) print v[1] }"
    printf '%s\n' "      ' \"\$FENCED_FILE\")"
    printf '%s\n' ""
    printf '%s\n' "      section_body=\$(awk '"
    emit_program_body "      " ""
    printf '%s\n' "      ' \"\$SECTION_FILE\")"
  } >"$fx"
  emit_program_body "      " "" >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/unrelated-awk.md.1.body"
  done
}

# --- Site presence ---------------------------------------------------------

@test "a replaced var-assignment body is caught by its awk consumption site" {
  # The edit neither scan above can see: the `local redact_awk='` block is
  # replaced wholesale, so it carries no marker (no count moves) and no
  # fingerprint (the shape scan passes over it) — while the six
  # `awk "$redact_awk"` sites in council.md go on running whatever is there.
  # The consumption site is the evidence that a program was supposed to be in
  # that block.
  local fx="${FX}/replaced-body.md" ln impl
  {
    printf '%s\n' "Step 4 assigns the program to a variable:"
    printf '%s\n' "  local redact_awk='"
    printf '%s\n' "    BEGIN { print }"
    printf '%s\n' "  '"
    printf '%s\n' ""
    printf '%s\n' "  summary=\$(printf '%s' \"\$x\" | awk \"\$redact_awk\")"
  } >"$fx"
  ln="$(grep -n -F -- "local redact_awk='" "$fx" | cut -d: -f1)"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_fails_with "$impl" "line ${ln}: variable redact_awk ${E_REPLACED}"
    assert_body_count "$impl" 0
  done
}

@test "a var-assignment body the walk extracted is not reported as replaced" {
  # The same shape, intact. The check keys off blocks this walk did NOT write,
  # so a carrier that still ships the program at its assignment site stays
  # silent even though the consumption site is right there.
  local fx="${FX}/kept-body.md" want="${FX}/kept-body.want" impl
  {
    printf '%s\n' "Step 4 assigns the program to a variable:"
    printf '%s\n' "  local redact_awk='"
    emit_body "    "
    printf '%s\n' "  '"
    printf '%s\n' ""
    printf '%s\n' "  summary=\$(printf '%s' \"\$x\" | awk \"\$redact_awk\")"
  } >"$fx"
  emit_body "    " >"$want"

  for impl in $AWKS; do
    use_awk "$impl"
    run_walker "$fx"
    assert_ok "$impl" "$fx"
    assert_body_count "$impl" 1
    assert_same "$impl" "$want" "${OUT}/kept-body.md.1.body"
  done
}

# --- Identity gate ---------------------------------------------------------

@test "check_body_identity on an empty bodies directory fails rather than passing" {
  # The vacuous pass the whole design exists to prevent: an extraction that
  # wrote nothing leaves the glob empty, and a gate that iterates zero files
  # and returns 0 reports every carrier as synced without reading one.
  local dir="${FX}/empty-bodies" canonical="${FX}/empty-canonical.awk"
  mkdir -p "$dir"
  emit_body "" >"$canonical"

  run --separate-stderr check_body_identity "$dir" "$canonical"
  [ "$status" -eq 1 ] || {
    echo "expected exit 1 over an empty bodies directory, got ${status}" >&2
    echo "stderr: ${stderr}" >&2
    return 1
  }
  case "$stderr" in
    *"$E_NO_BODIES"*) : ;;
    *)
      echo "empty-directory failure did not say that nothing was compared" >&2
      echo "stderr: ${stderr}" >&2
      return 1
      ;;
  esac
}


@test "check_body_identity accepts identical bodies and names every drifted one" {
  # The gate redaction.bats runs fatally in setup_file, exercised here against
  # synthetic bodies. What matters is the SHAPE of the report: a drifted body
  # names its carrier, the cmp position, and the diff hunk LOCATIONS but never
  # the drifted lines themselves, and an untouched sibling is not dragged in
  # with it.
  local dir="${FX}/bodies" canonical="${FX}/canonical.awk"
  mkdir -p "$dir"
  emit_body "" >"$canonical"
  emit_body "" >"${dir}/carrier-a.md.1.body"
  emit_body "" >"${dir}/carrier-b.md.2.body"

  run --separate-stderr check_body_identity "$dir" "$canonical"
  [ "$status" -eq 0 ] || {
    echo "identical bodies reported drift (status ${status})" >&2
    echo "stderr: ${stderr}" >&2
    return 1
  }

  # One byte in one body — the mutation a bad merge or a hand-edit leaves.
  sed 's/return 0/return 1/' "${dir}/carrier-b.md.2.body" >"${FX}/mutated"
  mv "${FX}/mutated" "${dir}/carrier-b.md.2.body"

  run --separate-stderr check_body_identity "$dir" "$canonical"
  [ "$status" -eq 1 ] || {
    echo "expected exit 1 for a drifted body, got ${status}" >&2
    echo "stderr: ${stderr}" >&2
    return 1
  }
  case "$stderr" in
    *"DRIFT: carrier-b.md (body 2)"*) : ;;
    *)
      echo "drift report did not name the mutated carrier and body number" >&2
      echo "stderr: ${stderr}" >&2
      return 1
      ;;
  esac
  case "$stderr" in
    *line*) : ;;
    *)
      echo "drift report carried no cmp line number" >&2
      echo "stderr: ${stderr}" >&2
      return 1
      ;;
  esac
  case "$stderr" in
    *carrier-a.md*)
      echo "the untouched carrier was reported as drifted" >&2
      echo "stderr: ${stderr}" >&2
      return 1
      ;;
    *) : ;;
  esac
  case "$stderr" in
    *@@*) : ;;
    *)
      echo "drift report carried no diff hunk header, so it names no line range" >&2
      echo "stderr: ${stderr}" >&2
      return 1
      ;;
  esac
  # Locations, never content. A drifted carrier can hold an accidentally
  # pasted credential, and a content diff writes it verbatim into the CI log.
  # Both sides of the mutation are checked: the canonical line and the line
  # that replaced it. Print no stderr here — dumping it on failure would leak
  # exactly what the assertion is checking is absent.
  case "$stderr" in
    *"return 1"* | *"return 0"*)
      echo "drift report printed body content, not just hunk locations" >&2
      return 1
      ;;
    *) : ;;
  esac
}

# --- The real tree ---------------------------------------------------------

@test "every REDACTION_SOURCES carrier walks cleanly, canonical yields exactly one" {
  # Derived, never stored: this asserts the SHAPE of the result (clean exit,
  # at least one body per carrier, exactly one canonical body), not a total.
  # A stored count is one more thing to forget when a carrier gains a copy.
  local impl f n
  for impl in $AWKS; do
    use_awk "$impl"
    for f in "${REDACTION_SOURCES[@]}"; do
      run_walker "${REPO_ROOT}/${f}"
      assert_ok "$impl" "$f"
      n="$(body_count)"
      [ "$n" -ge 1 ] || {
        echo "no body extracted from ${f} under ${impl}" >&2
        return 1
      }
    done
    run_walker "${REPO_ROOT}/${CANONICAL_SOURCE}"
    assert_ok "$impl" "$CANONICAL_SOURCE"
    assert_body_count "$impl" 1
  done
}
