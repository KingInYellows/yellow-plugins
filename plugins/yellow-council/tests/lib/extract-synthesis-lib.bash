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

extract_synthesis_lib() {
  local src="$1" out="$2"
  awk -v opener="$SYNTH_LIB_OPEN" -v closer="$SYNTH_LIB_CLOSE" '
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
      if (err != "") { print "extract_synthesis_lib: " FILENAME ": " err > "/dev/stderr"; exit 1 }
    }
  ' "$src" >| "$out"
}
