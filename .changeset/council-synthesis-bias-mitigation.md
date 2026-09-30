---
'yellow-council': minor
---

Rebuild `/council` synthesis to resist synthesizer bias: reviewer text is
normalized (markdown and severity formats flattened, code, citations and
evidence quotes kept byte-for-byte) and relabeled with per-run random
`S1`–`S4` labels before synthesis; Pass A enumerates findings before comparing
them and scores each on a four-dimension rubric (correctness self-assessed for
now) combined without weighting; an order-swapped Pass B marks verdict flips as
`low-confidence-synthesis` ties and reports their share in the headline. Adds
`--single-pass` and `COUNCIL_DOUBLE_PASS_SYNTHESIS` to skip Pass B.
