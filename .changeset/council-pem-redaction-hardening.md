---
'yellow-council': patch
---

Close four credential-redaction bypasses and add a regression suite

- `strip_deco` refused to strip git's `-` prefix from PEM delimiter lines, so
  a key echoed as diff deletions (`------BEGIN…`, six dashes) was classified
  as a prose mention and ran under the bounded window — a narrowly-wrapped
  body then leaked past the stray cutoff.
- The real-vs-prose test runs on the decoration-stripped line and requires the
  BEGIN marker to be the WHOLE line: a marker that merely terminates a line of
  prose stays a mention and runs under the bounded window, so an ordinary
  report quoting a header is not read as a key and redacted through EOF.
  Decoration is stripped before the test, so a blockquoted, listed, numbered
  or diff-prefixed real marker still reaches it anchored.
- `cred_hit` tested only `match()`'s leftmost occurrence, so a short
  placeholder sharing a token's prefix shadowed a real credential later on the
  same line and the line was emitted unredacted.
- The post-close re-arm window ran unconditionally and could overwrite the
  mode of a block that had already begun inside it, misclassifying
  back-to-back blocks.

- Decoration stripping was bounded by a CONSTANT (8, then 64). Output carrying
  more prefixes than the bound left the loop with prefixes still attached, so
  the anchored test above failed on a genuine key and the block leaked on the
  bounded path. The bound is now derived from the input length, which no
  attacker-chosen nesting depth can exceed, and exhausting it fails closed.

The re-arm now also requires a digit or base64 punctuation, so an ordinary
camelCase identifier no longer re-enters unbounded redaction and swallows
`Verdict:`/`Confidence:`/`Summary:` through EOF.

Adds `plugins/yellow-council/tests/redaction.bats`, which extracts the live
awk program from each file that ships it (rather than testing a copy that
drifts), asserts all copies are byte-identical, and pins both failure
directions — leaks and over-redaction — under every awk on the host.

Round two, from continued review of the above:

- Decoration stripping consumed a `+` run one character per pass while copying
  the remainder, so an attacker-supplied run was quadratic in its length — a
  100k-character run took roughly ten seconds and could outlast the timeout
  meant to bound the redaction step. `+` runs are now taken whole, and a line
  longer than any real marker fails closed rather than being normalized at all.
- A key serialized as JSON strings (OpenCode runs with `--format json`) or as
  markdown table cells wraps the marker rather than preceding it, so leading
  decoration stripping left the wrapper, the anchored classifier failed, and a
  narrow body leaked on the bounded path. Matched wrappers are now normalized
  on both the BEGIN and the END line — the END too, or the block never closes
  and redaction swallows `Verdict:` through EOF.
