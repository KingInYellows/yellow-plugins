---
'yellow-ruvector': minor
---

Detect an embedder-provenance mismatch. A `.ruvector` store stamped by the
pre-0.2.34 hash embedder (64d) refuses every `hooks_remember` under the
default onnx-minilm embedder (384d) while `hooks_recall` keeps working, so
the write loss was silent. `session-start.sh` now adds one
`[ruvector] store is hash-embedded …` line to the SessionStart
`systemMessage` (jq only, silent for unstamped stores and when
`RUVECTOR_EMBEDDER=hash` / `RUVECTOR_ONNX=0`), and `/ruvector:status` gains
a `PROVENANCE: FRESH | OK | MISMATCH | UNSTAMPED | UNKNOWN` step (verdict
computed in the command's bash block from a whole-stamp comparison with
`hooks reembed --dry-run`'s `targetProvenance`, bounded at 90 s) that prints
the reembed + restart remediation. A stamp-less store that already holds
vectors is reported too (`ERR_LEGACY_STORE_READONLY`).
