---
'yellow-council': patch
---

Close credential-redaction bypasses and add a regression suite

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
  meant to bound the redaction step. `+` runs are now taken whole. A long `-`
  run still costs one pass per character, because the delimiter guard has to
  re-test after each removal; that remains a known open cost rather than a
  closed one.

An interim revision of this PR also normalized serialized markers (JSON strings
and markdown table cells) and capped line length with a fail-closed guard. Both
were reverted: reviewers demonstrated that each traded the leak for the opposite
failure. The length cap keyed "real key" off length alone, so any long line
merely MENTIONING a marker swallowed the report through EOF; the wrapper strip
ran after list/blockquote/numbered prefixes were already removed, so
`- "<marker>"` normalized to a bare marker and did the same. A key serialized as
a JSON string is therefore still classified as a mention and takes the bounded
window — the same accepted trade as an inline-prose mention, recorded in the
plugin Known Limitations. Handling serialized shapes safely needs the bounded
window's width floor reworked alongside it, which belongs in its own change.

A re-arm window left over from an earlier block was never retired when a new
BEGIN opened. `pem_watch` only decrements while outside a block, so a countdown
still running was frozen for the whole of the next block and resumed afterwards
with a stale count — and the re-arm path restores the real/prose mode from the
PREVIOUS block, so a later base64-shaped prose line could re-enter unbounded
redaction on the strength of a key that had already closed, swallowing the
report. Opening a block now closes any window that belongs to an earlier one.
