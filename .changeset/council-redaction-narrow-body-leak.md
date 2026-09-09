---
'yellow-council': patch
---

Close two leaks in the credential-redaction awk program for narrowly wrapped
keys. A key whose BEGIN delimiter shares its line with prose runs under the
bounded stray window, and a decoy END inside a real key hands the rest of the
body to the re-arm window; both treated any body line under 20 characters as
stray and released, printing the rest of the key and its END marker into the
committed council report (a real 2048-bit key wrapped at 12 characters leaked
134 of 136 body lines). Body lines of 12 to 19 characters that carry a digit
or `+`, `/`, `=` and a non-hex character now count as key material, a pure
base64 line of the width the last key-shaped line established continues the
body unless it reads as a plain word, both rules re-arm after a decoy END
while the chain is unbroken, and the span cap rises to 400 so a 4096-bit key
wrapped narrowly is not released mid-body. Single words, equal-length words
and short commit SHAs on their own lines still count as stray; digit-bearing
identifiers can keep the bounded window open, but three subsequent plain
lines still release it, so a quoted marker followed by a short list cannot
swallow the report.
A bare BEGIN line that arrives inside the bounded window a prose mention
opened now re-runs the entry test and starts a real block, so a genuine key
quoted-then-pasted is redacted at any wrap width instead of releasing after
three narrow lines.
All five shipped copies are re-extracted from SKILL.md and gated for
identity.
