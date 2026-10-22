---
"yellow-review": patch
---

The review-findings ledger now merges a finding observed once with a verified
scope and once without one. An unscoped observation joins a scope-verified
finding with the same file, category, rule and anchor hash when that scope
still holds at its line; a scoped observation absorbs a matching unscoped
finding whose line maps unchanged into its scope span. A merge happens only
when exactly one finding qualifies and neither side carries an occurrence key,
so identical code in two scopes stays separate. `/review:triage` no longer
shows these as duplicates.
