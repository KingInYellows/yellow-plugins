---
"yellow-review": patch
"yellow-core": patch
---

`/review:resolve` names the open follow-up issue (`Follow-up #N is no longer needed.`) when a thread it once marked `oos` is later fixed or addressed. The
`cs_redact_secrets` header in yellow-core's `lib/compound-staging.sh` now
describes its pattern list as separate from yellow-ci's, not a subset, and
gives the right yellow-ci path.
