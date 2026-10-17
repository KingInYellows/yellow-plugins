---
"yellow-review": minor
"yellow-core": patch
---

Add an opt-in shadow log for `/review:pr` conditional-persona selection.
With `reviewer_selection: shadow` in `yellow-plugins.local.md`, Step 4 records
the personas the dispatch table's exact rules pick, the ones the orchestrator
picked, and the ones TypeSafe's Jev would pick from one request on the
redacted diff (public repositories, or those in
`reviewer_selection_private_repos`). Dispatch is unchanged. yellow-core's
`local-config` skill documents the two new keys.
