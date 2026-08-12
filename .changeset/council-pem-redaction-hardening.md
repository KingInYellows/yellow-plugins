---
'yellow-council': patch
---

Close four credential-redaction bypasses and add a regression suite

- `strip_deco` refused to strip git's `-` prefix from PEM delimiter lines, so
  a key echoed as diff deletions (`------BEGIN…`, six dashes) was classified
  as a prose mention and ran under the bounded window — a narrowly-wrapped
  body then leaked past the stray cutoff.
- The real-vs-prose test required the BEGIN marker to be the entire line, so
  a genuine key whose marker shared its line with prose was downgraded to the
  same bounded path. It now classifies on the marker *terminating* the line,
  which still treats a mid-sentence mention as prose.
- `cred_hit` tested only `match()`'s leftmost occurrence, so a short
  placeholder sharing a token's prefix shadowed a real credential later on the
  same line and the line was emitted unredacted.
- The post-close re-arm window ran unconditionally and could overwrite the
  mode of a block that had already begun inside it, misclassifying
  back-to-back blocks.

The re-arm now also requires a digit or base64 punctuation, so an ordinary
camelCase identifier no longer re-enters unbounded redaction and swallows
`Verdict:`/`Confidence:`/`Summary:` through EOF.

Adds `plugins/yellow-council/tests/redaction.bats`, which extracts the live
awk program from each file that ships it (rather than testing a copy that
drifts), asserts all copies are byte-identical, and pins both failure
directions — leaks and over-redaction — under every awk on the host.
