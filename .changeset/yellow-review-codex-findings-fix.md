---
"yellow-review": patch
---

Fix `/review:pr` silently dropping every `codex-reviewer` finding. Step 6
sub-step 0 now extracts the findings block from `codex-reviewer`'s
structured `verdict=`-prefixed return before applying the existing
legacy-prose normalizer, and `codex-reviewer` is added to both copies of
the normalizer list (Step 5 dispatch-table note and Step 6 sub-step 0),
which previously omitted it — causing Step 1 validation to drop the whole
return as malformed on every PR review. Also unlinks `codex-reviewer`'s
`fenced_output_path` temp file right after extracting the findings block,
since `/review:pr` (unlike `/council`) never reads it — closing a
per-review `/tmp` file leak.
