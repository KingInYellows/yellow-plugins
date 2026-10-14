#!/usr/bin/env bash
# Extraction helpers for the council test suites.
#
# `extract_marked_lib <file> <outfile> <marker-name>` cuts a marker-delimited
# helper block out of commands/council/council.md (council-quota-lib in Step 4,
# council-lineage-lib in Step 2b). Tests run that extracted text rather than a
# copy pasted into the test tree, for the same reason redaction.bats does: a
# copy drifts silently the moment the shipped fence is edited.
# `extract_fence_after <file> <heading-prefix> <outfile>` cuts a whole fence.
#
# The Step 5 synthesis helpers are no longer inline: they live in
# lib/council-synthesis.sh, which synthesis.bats sources directly.
#
# Return contract: both helpers write their output to <outfile> and return 0,
# and fail loudly (non-zero, message on stderr) when the marker pair or the
# heading and its fence are missing or malformed.

# extract_marked_lib <file> <outfile> <marker-name> — print the lines strictly
# between `# >>> <marker-name>` and `# <<< <marker-name>`. Marker names are
# compared as whole-line prefixes, so one name must not be a prefix of another.
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
