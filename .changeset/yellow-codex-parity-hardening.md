---
"yellow-codex": patch
"yellow-council": patch
---

Harden the six items deferred from the #695/#697/#698 review stack: validate
BASE_REF against a branch-name allowlist before shell substitution in
/codex:review; unify every inline stderr-peek redaction block onto the canonical
11-pattern list with a mutation-safe PEM state machine; make /codex:review Step
4b credential redaction JSON-aware so it no longer corrupts the structured
REVIEW_OUTPUT; cut the codex-reviewer FINDINGS cap only at complete
finding-record boundaries with per-record field-shape validation (plus a
committed Step 6 conformance test); make the codex-patterns review snippet's
consume-before-rm ordering explicit; and fence extracted reviewer summaries at
council.md's synthesis consumption site.
