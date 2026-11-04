---
'yellow-core': minor
---

Ground solution-doc citations before they land. `validate-solutions` now checks
each new or modified doc's body for repo paths, commit SHAs and relative links
that exist nowhere, and for leftover `{{...}}` placeholders (`ERROR-SOL-003`),
ported from Compound Engineering's validate-doc-claims. `knowledge-compounder`
grounds its draft before M3 and runs `validate-solutions.js --doc` on the
written doc when the repo ships it.
