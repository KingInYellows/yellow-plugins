# Walk one carrier file and write every embedded copy of the council
# credential-redaction awk program to OUT/BASE.<n>.body.
#
# Usage (from extract-redaction-awk.bash, never from a shell string):
#   awk -v OUT=<dir> -v BASE=<name> -v ANCHOR=<marker> -v INNER=<marker> \
#       -f extract-redaction-bodies.awk <file>
#
# Anchoring is by CONTENT, not by file path: any line holding ANCHOR starts a
# body, the walk goes backward to the nearest opener of the three known
# delimiter shapes and forward to that shape's own closer, and the interior
# must carry INNER. A carrier in a known shape therefore needs no change here.
#
# ANCHOR and INNER arrive as -v assignments and are never written here.
# REDACTION_ANCHOR_MARKERS in extract-redaction-awk.bash is their single
# source: the walker, scripts/validate-council-roster.js, and the suites all
# read that one array, so no second copy exists to drift against.
#
# The marker-driven walk is backed by a SHAPE scan (below) that needs neither
# marker, because a copy that loses both of them at once is invisible to every
# marker-derived count.
#
# Portability: no gensub, no interval expressions, no --re-interval, and
# [ \t] rather than [[:space:]]. Verified identical under mawk, gawk, and
# /usr/bin/awk.

# The one string that identifies the program without using either marker: a
# variable name from its PEM state machine. In every carrier it occurs only
# inside the program. It is deliberately NOT one of the Rule R marker strings,
# so writing it literally here cannot make this file read as a carrier to
# scripts/validate-council-roster.js.
BEGIN { FINGERPRINT = "in_pem" }

function fail(ln, cond) {
  printf "%s: line %d: %s\n", FILENAME, ln, cond > "/dev/stderr"
  failed = 1
}

# shape_of(s) — the delimiter shape line s opens, or "" if it opens none.
# closes(s, sh) — whether line s closes a block of shape sh.
# One definition of each, shared by the anchor walk and the shape scan: a
# second copy of these patterns would let one of the two learn a new carrier
# shape while the other silently kept walking past it.
function shape_of(s) {
  if (s ~ /^```awk$/) return "fence"
  if (s ~ /^awk '$/) return "bare"
  if (s ~ /^[ \t]*(local[ \t]+)?[A-Za-z_][A-Za-z0-9_]*=(\$\(awk[ \t]+)?'$/) return "var"
  return ""
}

# The var closer's variable-name class mirrors shape_of's opener exactly
# ([A-Za-z_][A-Za-z0-9_]*, not [A-Za-z_]+): a path variable carrying a digit —
# section_file2 — opens a block the closer would otherwise never match, and the
# walk would run to EOF reporting "no closer" on a well-formed carrier.
function closes(s, sh) {
  if (sh == "fence") return s ~ /^```$/
  if (sh == "bare") return s ~ /^'[ \t]*"\$[A-Za-z_]*FILE"[ \t]*>/
  if (sh == "var") return s ~ /^[ \t]*'([ \t]*"\$[A-Za-z_][A-Za-z0-9_]*"\))?[ \t]*$/
  return 0
}

# plain_var_name(s) — the variable name in the single-quoted assignment shape
# `NAME='` (or `local NAME='`), and "" for every other line, including the
# `NAME=$(awk '` capture shape, whose program is consumed inline and names no
# variable. Drives the site-presence check in END.
function plain_var_name(s,   t, p) {
  if (s !~ /^[ \t]*(local[ \t]+)?[A-Za-z_][A-Za-z0-9_]*='$/) return ""
  t = s
  sub(/^[ \t]*/, "", t)
  sub(/^local[ \t]+/, "", t)
  p = index(t, "=")
  return substr(t, 1, p - 1)
}

{ line[NR] = $0 }

END {
  if (OUT == "" || BASE == "") {
    printf "%s: OUT and BASE are required\n", FILENAME > "/dev/stderr"
    exit 2
  }
  if (ANCHOR == "" || INNER == "") {
    printf "%s: ANCHOR and INNER are required\n", FILENAME > "/dev/stderr"
    exit 2
  }

  # Reject CRLF before walking. A trailing \r would ride into every body and
  # break the byte compare far from its cause, and the shapes below anchor
  # on $, which a \r defeats.
  for (i = 1; i <= NR; i++) {
    if (index(line[i], "\r") > 0) {
      printf "%s: line %d: CRLF line endings\n", FILENAME, i > "/dev/stderr"
      exit 2
    }
  }

  anchors = 0
  bodies = 0
  prev_closer = 0

  for (i = 1; i <= NR; i++) {
    if (index(line[i], ANCHOR) == 0) continue

    # An anchor at or before the previous body's closer sits INSIDE that body
    # — a comment naming the function, say — so it is text already extracted,
    # not a second copy. Skip it silently and do not count it: counting it
    # would make the cross-check below report a corruption that is not there.
    if (i <= prev_closer) continue

    anchors++

    # Backward to the nearest opener. Crossing the closer of a body already
    # written means this anchor's own opener is missing and the walk would
    # otherwise adopt the previous body's — report it rather than nest.
    opener = 0
    shape = ""
    for (j = i - 1; j >= 1; j--) {
      if (prev_closer > 0 && j <= prev_closer) break
      shape = shape_of(line[j])
      if (shape != "") { opener = j; break }
    }
    if (opener == 0) {
      fail(i, "no opener (anchor outside any known delimiter shape, or a prose mention of the function name)")
      continue
    }

    # Forward to the closer matching that shape only.
    closer = 0
    for (j = i + 1; j <= NR; j++) {
      if (closes(line[j], shape)) { closer = j; break }
    }
    if (closer == 0) { fail(i, "no closer"); continue }

    # A partial paste that carries the anchor but not the second marker is
    # not the program; the validator would disagree with this walker about
    # whether the file is a carrier.
    hit = 0
    for (j = opener + 1; j < closer; j++) {
      if (index(line[j], INNER) > 0) { hit = 1; break }
    }
    if (hit == 0) { fail(i, "missing cred" "_hit marker"); continue }

    bodies++
    out = OUT "/" BASE "." bodies ".body"
    for (j = opener + 1; j < closer; j++) print line[j] > out
    # A full disk or an unwritable OUT surfaces at close(), not at print: an
    # unchecked close leaves a truncated body that compares as drift.
    if (close(out) != 0) {
      printf "%s: write error closing %s\n", FILENAME, out > "/dev/stderr"
      exit 2
    }
    # Remember the span so the shape scan below can tell a block this walk
    # already extracted from one it has never seen.
    span_open[bodies] = opener
    span_close[bodies] = closer
    prev_closer = closer
  }

  # Shape scan. Every count in this file is derived from the two markers, so a
  # body that loses BOTH of them at once — a renamed pair of function headers,
  # a deleted definition — drops the anchor count and the inner count together,
  # the cross-check below still agrees, and the changed copy is never compared
  # against the canonical. Recognising a block by its DELIMITER SHAPE plus a
  # fingerprint that is not a marker is the check that survives that edit.
  # Blocks this walk already wrote are skipped by span, so the four unrelated
  # one-liner awk assignments council.md ships in the var shape stay silent:
  # none of them carries the fingerprint.
  for (i = 1; i <= NR; i++) {
    shape = shape_of(line[i])
    if (shape == "") continue

    inside = 0
    for (b = 1; b <= bodies; b++) {
      if (i >= span_open[b] && i <= span_close[b]) { inside = 1; break }
    }
    if (inside) continue

    closer = 0
    for (j = i + 1; j <= NR; j++) {
      if (closes(line[j], shape)) { closer = j; break }
    }
    # An unterminated block is not evidence that it carries the program, and
    # scanning on to EOF would sweep in the text of a properly walked body
    # further down the file and report it as unanchored.
    if (closer == 0) continue

    for (j = i + 1; j < closer; j++) {
      if (index(line[j], FINGERPRINT) > 0) {
        fail(i, "block looks like the redaction program but carries no anchor marker (renamed or removed function definition?)")
        break
      }
    }
  }

  # Derived site-presence check, for the edit the two scans above cannot see:
  # a `NAME='` block whose program was REPLACED wholesale. Such a block carries
  # neither marker (so no count moves) and not the fingerprint (so the shape
  # scan passes over it), yet the redaction site that runs it is still there.
  # The consumption site is the evidence: council.md's Step 4 assigns the
  # program to `redact_awk` and pipes six sites through `awk "$redact_awk"`, so
  # a variable consumed that way whose block this walk did not extract is a
  # redaction site running an unverified program.
  #
  # Only the `NAME='` shape is derivable this way. Step 7's
  # `section_body=$(awk '` capture consumes its program inline and names no
  # variable, so there is no `awk "$NAME"` site to look for; a wholesale
  # replacement there is left to the roster validator's carrier count.
  for (i = 1; i <= NR; i++) {
    vname = plain_var_name(line[i])
    if (vname == "") continue

    walked = 0
    for (b = 1; b <= bodies; b++) {
      if (span_open[b] == i) { walked = 1; break }
    }
    if (walked) continue

    used = 0
    target = "awk \"$" vname "\""
    for (j = 1; j <= NR; j++) {
      if (index(line[j], target) > 0) { used = 1; break }
    }
    if (used) {
      fail(i, "variable " vname " is passed to awk as a program but its block is not the redaction program")
    }
  }

  if (failed) exit 2

  # Derived cross-check. An INNER count above the anchor count means an anchor
  # line exists but no longer matches — a typo in the function header, a
  # reflowed signature — and the walk silently skipped a copy the roster
  # validator still counts as shipped. Counting rather than storing an expected
  # total keeps the design free of a number to forget.
  #
  # A walked body contributes ONE no matter how many times INNER occurs inside
  # it, because a comment in the program that repeats the function name is text
  # the walk already extracted, not a second copy — the same reasoning that
  # makes the anchor walk skip an anchor at or before prev_closer. Every INNER
  # line OUTSIDE every walked span still counts individually: that is exactly
  # the corrupted anchor whose body was never walked.
  inner_lines = 0
  for (b = 1; b <= bodies; b++) {
    for (j = span_open[b] + 1; j < span_close[b]; j++) {
      if (index(line[j], INNER) > 0) { inner_lines++; break }
    }
  }
  for (i = 1; i <= NR; i++) {
    if (index(line[i], INNER) == 0) continue
    inside = 0
    for (b = 1; b <= bodies; b++) {
      if (i >= span_open[b] && i <= span_close[b]) { inside = 1; break }
    }
    if (inside == 0) inner_lines++
  }
  if (inner_lines != anchors) {
    printf "%s: %d inner markers but %d anchors: an anchor line is missing or corrupted\n", FILENAME, inner_lines, anchors > "/dev/stderr"
    exit 2
  }

  # Unreachable by construction today: every anchor either writes a body or
  # calls fail(), and fail() exits above. Kept as a belt-and-suspenders
  # invariant so a future refactor that adds a non-body, non-fail path cannot
  # under-report copies in silence.
  if (bodies != anchors) {
    printf "%s: count mismatch: %d anchors, %d bodies\n", FILENAME, anchors, bodies > "/dev/stderr"
    exit 2
  }
  exit 0
}
