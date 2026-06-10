---
"yellow-council": patch
---

fix: persist reviewer verdicts/confidences/fenced-paths to a deterministic state file in /council Step 4 and re-load it at the top of Steps 7-9 — associative arrays populated in one bash block do not survive into later blocks, so the report-assembly and cleanup steps previously read empty REVIEWER_* arrays
