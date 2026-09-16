---
'yellow-ruvector': patch
---

Detect an embedder-provenance mismatch. A `.ruvector` store stamped by the
pre-0.2.34 hash embedder (64d) refuses every `hooks_remember` under the
default onnx-minilm embedder (384d) while `hooks_recall` keeps working, so
the write loss was silent. `session-start.sh` now adds one
`[ruvector] store is hash-embedded …` line to the SessionStart
`systemMessage` (jq only, silent for unstamped stores and when
`RUVECTOR_EMBEDDER=hash` / `RUVECTOR_ONNX=0`), and `/ruvector:status` gains
a `PROVENANCE: OK | MISMATCH | UNSTAMPED | UNKNOWN` step that compares the
store stamp with `hooks reembed --dry-run`'s `targetProvenance` and prints
the reembed + restart remediation.
