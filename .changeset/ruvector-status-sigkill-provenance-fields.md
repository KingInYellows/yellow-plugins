---
'yellow-ruvector': patch
---

`/ruvector:status` provenance check: a dry-run that exits 137 is now
reported as `UNKNOWN` with SIGKILL wording that names both possible causes
(the 5 s `--kill-after` grace after an ignored TERM, or an external signal
such as the OOM killer) instead of asserting the 90 s deadline elapsed. The
`OK`/`MISMATCH` verdict now compares only the five stamp fields upstream
`compareProvenance` enforces (`embedderKind`, `modelId`, `dimension`,
`normalize`, `prefixPolicy`), projecting both sides by plain key indexing
(a present `false` is kept; missing and explicit `null` compare equal), so an
informational extra key on either side no longer flips a healthy store to
`MISMATCH` while a missing enforced field still does; a dry-run with no
`targetProvenance` at all is `UNKNOWN` rather than a null compare. New
`tests/status-provenance.bats` drives the extracted block with a stubbed
`npx`. The ADR-210 solution doc gains a "Non-atomic store write race"
section (symptom, verified ruvector 0.2.34 / 0.2.41 / 0.3.1 write sites,
recovery from the `.corrupt-<epoch>` quarantine, avoidance).
