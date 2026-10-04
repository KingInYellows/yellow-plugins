#!/usr/bin/env bash
# Extract the Step 5b synthesis helpers from commands/council/council.md.
#
# council.md carries council_normalize_text, council_assign_labels and
# council_fence_block inline in its Step 5b bash fence, between two marker
# comment lines. Tests run that extracted text rather than a copy pasted into
# the test tree, for the same reason redaction.bats does: a copy drifts
# silently the moment the shipped fence is edited.
#
# Return contract: `extract_synthesis_lib <file> <outfile>` writes the lines
# strictly between the markers to <outfile> and returns 0. It fails loudly
# (non-zero, message on stderr) unless the file holds exactly one opening
# marker followed by exactly one closing marker.

SYNTH_LIB_OPEN='# >>> council-synthesis-lib'
SYNTH_LIB_CLOSE='# <<< council-synthesis-lib'

# extract_marked_lib <file> <outfile> <marker-name> — the same extraction for
# any `# >>> <marker-name>` / `# <<< <marker-name>` pair. council.md carries
# three: council-synthesis-lib (Step 5b), council-quota-lib (Step 4) and
# council-lineage-lib (Step 1). Marker names are compared as whole-line
# prefixes, so one name must not be a prefix of another.
extract_marked_lib() {
  local src="$1" out="$2" name="$3"
  awk -v opener="# >>> ${name}" -v closer="# <<< ${name}" -v fn="extract_marked_lib(${name})" '
    index($0, opener) == 1 {
      if (opens++ || inside) { err = "more than one opening marker (line " NR ")"; exit 1 }
      inside = 1; next
    }
    index($0, closer) == 1 {
      if (!inside) { err = "closing marker without an opening marker (line " NR ")"; exit 1 }
      inside = 0; next
    }
    inside { print }
    END {
      if (err == "" && opens == 0) err = "no opening marker"
      if (err == "" && inside) err = "no closing marker"
      if (err != "") { print fn ": " FILENAME ": " err > "/dev/stderr"; exit 1 }
    }
  ' "$src" >| "$out"
}

extract_synthesis_lib() {
  extract_marked_lib "$1" "$2" council-synthesis-lib
}

# extract_fence_after <file> <heading-prefix> <outfile> — write the body of the
# first ```bash fence that follows the first line starting with
# <heading-prefix>. Fails loudly when the heading or its fence is missing, so
# a renamed step cannot turn a test into a no-op.
extract_fence_after() {
  local src="$1" heading="$2" out="$3"
  awk -v heading="$heading" '
    !found && index($0, heading) == 1 { found = 1; next }
    found && !inside && $0 == "```bash" { inside = 1; next }
    inside && $0 == "```" { done = 1; exit }
    inside { print }
    END {
      if (!found) { print "extract_fence_after: heading not found: " heading > "/dev/stderr"; exit 1 }
      if (!done) { print "extract_fence_after: no complete bash fence after: " heading > "/dev/stderr"; exit 1 }
    }
  ' "$src" >| "$out"
}
