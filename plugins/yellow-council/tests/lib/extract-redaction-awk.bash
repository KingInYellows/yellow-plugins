#!/usr/bin/env bash
# Extract every live copy of the credential-redaction awk program from the
# files that ship it.
#
# Carriers embed the program inline: commands/council/council.md carries one
# copy per redaction site (the Step 4 `local redact_awk='...'` assignment and
# the Step 7 `section_body=$(awk '...')` capture), and the reviewer agents and
# the council-patterns skill carry one each. Tests MUST run the extracted
# program rather than a copy pasted into the test tree: a copy drifts
# silently the moment one of the sources is edited, and a redaction bug that
# exists in the shipped file but not in the tested copy is exactly the
# failure this suite is here to prevent.
#
# Delimiter shapes that carry a body:
#   ```awk ... ```                    fenced block (SKILL.md)
#   awk ' ... ' "$SOMETHING_FILE" >   raw command (agents/review/*.md)
#   name=' ... '  and  name=$(awk ' ... ' "$path")   assignment (council.md)
#
# Return contract: `extract_redaction_bodies <file> <outdir>` writes
# `<outdir>/<basename>.<n>.body`, one file per body found, prints nothing on
# stdout, and returns the walker's exit status. Callers glob <outdir> with
# `nullglob`. Files rather than a captured string because one pass over a
# carrier yields several bodies and a string has no natural delimiter to split
# them back apart on, and because each body file feeds `cmp` and `diff -u`
# directly in the identity gate's failure output.
#
# Capturing the walker's stderr needs a variable declared on an EARLIER line:
# `local err="$(extract_redaction_bodies ...)"` masks the walker's status with
# `local`'s own success, so a failed walk reads as a clean one.
#
# PRECONDITION: body files are keyed by the carrier's BASENAME, so two
# carriers sharing a basename silently overwrite each other's bodies. A caller
# that walks a list of carriers asserts basename uniqueness first
# (redaction.bats' setup_file does).
#
# The body count is DERIVED, never stored, and failure is loud without one:
# the walker names the file, line, and condition for every anchor it cannot
# resolve, and cross-checks the inner-marker count against the anchor count so
# a corrupted anchor line — one the walk no longer sees but the roster
# validator still counts — fails instead of quietly yielding fewer bodies. A
# stored expected count would be one more thing to forget to update: the same
# class of omission that let council.md ship an unsynced copy.
#
# Rule R constraint on the two arrays below: scripts/validate-council-roster.js
# parses each of them out of this file with a non-greedy regex that stops at
# the first `)`. Keep them plain double-quoted bash array literals on
# consecutive lines, and keep every explanatory comment ABOVE the array —
# a comment inside the parens silently truncates the parse the moment it
# contains a closing paren.

# The one source of truth for the program text. Every other body must be
# byte-identical to this one after dedent.
CANONICAL_SOURCE="plugins/yellow-council/skills/council-patterns/SKILL.md"

# Repo-relative paths of every file carrying at least one copy of the
# program. A carrier absent from this list is never drift-tested; Rule R in
# scripts/validate-council-roster.js fails the build when a file on disk
# carries the program and is listed neither here nor in
# council-roster.json's redaction_known_untested.
REDACTION_SOURCES=(
  "plugins/yellow-council/agents/review/gemini-reviewer.md"
  "plugins/yellow-council/agents/review/opencode-reviewer.md"
  "plugins/yellow-council/skills/council-patterns/SKILL.md"
  "plugins/yellow-council/commands/council/council.md"
)

# The two function-definition strings that identify the program in a file.
# This array is the single source: extract-redaction-bodies.awk receives them
# as -v assignments and scripts/validate-council-roster.js parses them out of
# here, so neither keeps a second copy to drift against. Index 0 must appear
# inside a walked body; index 1 is the anchor each walk starts from.
REDACTION_ANCHOR_MARKERS=("function cred_hit(" "function strip_deco(")

# extract_redaction_bodies <file> <outdir> — write every body in <file> to
# <outdir>/<basename>.<n>.body, numbered in file order. Silent on success;
# on failure the walker names the file, the anchor line, and the condition
# on stderr and exits 2. The markers are passed in rather than written in the
# walker, which would otherwise read as a carrier itself to Rule R.
extract_redaction_bodies() {
  local file="$1"
  local outdir="$2"
  awk -v OUT="$outdir" -v BASE="${file##*/}" \
    -v ANCHOR="${REDACTION_ANCHOR_MARKERS[1]}" \
    -v INNER="${REDACTION_ANCHOR_MARKERS[0]}" \
    -f "$(dirname "${BASH_SOURCE[0]}")/extract-redaction-bodies.awk" "$file"
}

# dedent_file <in> <out> — strip the longest leading run of spaces and tabs
# common to every non-blank line. Blank lines are ignored when computing the
# minimum and are emitted empty, so a body indented for its carrier compares
# byte-for-byte against the canonical.
dedent_file() {
  local in="$1"
  local out="$2"
  awk '
    function lead(s,   n) {
      n = 0
      while (substr(s, n + 1, 1) == " " || substr(s, n + 1, 1) == "\t") n++
      return n
    }
    NR == FNR {
      if ($0 ~ /^[ \t]*$/) next
      n = lead($0)
      if (!have || n < min) { min = n; have = 1 }
      next
    }
    {
      if ($0 ~ /^[ \t]*$/) print ""
      else print substr($0, min + 1)
    }
  ' "$in" "$in" > "$out"
}

# check_body_identity <bodies-dir> <canonical-file> — dedent every *.body in
# <bodies-dir> to a sibling .dedent and compare it against <canonical-file>.
# Returns 1 if any body drifted, 0 otherwise; fails when the directory holds
# no body at all, because a clean return over an empty glob is the vacuous
# pass this whole design exists to prevent.
#
# EVERY mismatch is reported before returning: a fix pass that updates some
# carriers and misses one should see all of them named in a single run, not
# discover them one CI round at a time.
check_body_identity() {
  local dir="$1" canonical="$2"
  local drift=0 raw stem carrier n dedent cmpout
  shopt -s nullglob
  local -a raws=( "${dir}"/*.body )
  shopt -u nullglob
  [ "${#raws[@]}" -gt 0 ] || {
    echo "no body files under ${dir}: nothing was compared against ${canonical}" >&2
    return 1
  }
  for raw in "${raws[@]}"; do
    stem="${raw##*/}"; stem="${stem%.body}"
    carrier="${stem%.*}"
    n="${stem##*.}"
    dedent="${raw%.body}.dedent"
    dedent_file "$raw" "$dedent" || {
      echo "dedent failed for ${stem}.body: every compare below it would run against a truncated program" >&2
      return 1
    }
    cmp -s "$canonical" "$dedent" && continue
    drift=1
    # cmp exits non-zero here precisely BECAUSE the bodies differ, which is
    # the condition being reported; `|| true` keeps that expected status from
    # aborting the capture under errexit. Drift is enforced by the accumulator
    # above, never by this command's status.
    cmpout="$(LC_ALL=C cmp "$canonical" "$dedent" 2>&1 || true)"
    echo "DRIFT: ${carrier} (body ${n}) is out of date. Source of truth: ${CANONICAL_SOURCE}. ${cmpout#*differ: }. To update: re-extract the ${CANONICAL_SOURCE} program and re-indent into this carrier; never edit this copy alone." >&2
    # LOCATIONS ONLY, never content. A drifted carrier can hold an
    # accidentally pasted credential, and a content diff prints it verbatim
    # into the CI log — the disclosure the program under comparison exists to
    # prevent. `grep -E '^@@'` keeps the hunk headers and drops every source
    # line, so the reader still gets the ranges that drifted; the cap still
    # bounds a body that drifted in many places.
    # Guarded like the cmp above: diff exits 1 by design because the files
    # differ, and grep exits 1 when the diff carries no hunk header at all.
    diff -u "$canonical" "$dedent" 2>&1 | grep -E '^@@' | head -20 >&2 || true
    echo "  hunk locations only. For the drifted content, run locally: diff -u ${canonical} ${dedent}" >&2
  done
  [ "$drift" -eq 0 ] || return 1
  return 0
}

# available_awks — every awk implementation present on this host.
# mawk is Debian/Ubuntu's default /usr/bin/awk and lacks interval expressions
# ({n,}), which is why the redaction program uses match()+RLENGTH and why the
# walker avoids gensub; gawk is the common developer default. A fix verified
# on only one of them is not verified.
available_awks() {
  local a
  for a in mawk gawk awk; do
    command -v "$a" >/dev/null 2>&1 && echo "$a"
  done
}

# require_awks — the emptiness check that available_awks CANNOT perform itself.
# Callers run it as `for impl in $(available_awks)`, i.e. inside a command
# substitution, so a `return 1` there is discarded and the loop simply iterates
# zero times: the suite would pass because it ran nothing. Assert on the
# captured value instead, in setup(), where a failure actually aborts the test.
require_awks() {
  [ -n "$1" ] || {
    echo "no awk implementation found (looked for mawk, gawk, awk)" >&2
    return 1
  }
}

# repo_root — absolute path to the repository root, from this file's location.
repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd
}
