---
"yellow-review": minor
---

`/review:resolve` Step 7 now runs the whole write phase through a new
`apply-thread-actions` script: the orchestrator writes one JSONL plan (per
thread: disposition, follow-up issue text, reply and plain fallback, resolve)
and the script runs issue, reply and resolve per thread with the contract's
fallbacks (refusal, exit 7, issue cap, already-replied skip), stops every write
on exit 4, and appends one result row per thread. A 540 s time budget keeps
each call inside the Bash timeout; on exit 5 a re-run with the same files
resumes after the last finished stage. This replaces about three tool calls per
thread with one Write and one Bash call per PR. Contract: "Batch apply" in
`references/resolve/dispositions.md`.
