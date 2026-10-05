---
'yellow-core': minor
'yellow-review': minor
---

Unattended reviews now capture learnings instead of stalling. Under
`--non-interactive`, `/review:pr` Step 9a no longer spawns the
`knowledge-compounder` (its confirmation gate cannot be answered unattended,
so it planned and wrote nothing). It writes an outcome narrative — each P0–P2
finding labelled with its ledger state, never claimed as test-verified — and
stages it with the new `lib/stage-learning.sh` for yellow-core's
compound-staging drain, under the main checkout's project slug.
`/review:sweep-all` drops its end-of-loop `/flow:compound` pass. yellow-core
adds `cs_stage_entry`, which caps, strips invisible characters, redacts and
neutralises fence and role lines before writing a Stop-hook-shaped entry, and
`cs_redact_secrets` now also redacts `ASIA`, `ABIA` and `ACCA` AWS key IDs.
Interactive `/review:pr` is unchanged.
