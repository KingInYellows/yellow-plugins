---
"yellow-review": patch
---

Replace the invalid `"line": <int>,` JSON placeholder inside the strict
compact-return example fences with a valid example value (`42`) plus prose
stating the integer type constraint outside the fence (same defect class
as anti-pattern #30's non-JSON-content-in-strict-fence rule) —
fixed in the canonical schema in `review-pr.md` first, then its 7 reviewer
agent mirrors (reliability, project-compliance, project-standards,
plugin-contract, adversarial, maintainability, correctness).
