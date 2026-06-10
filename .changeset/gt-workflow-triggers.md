---
"gt-workflow": patch
---

fix: rewrite the descriptions of gt-amend, gt-cleanup, gt-nav, gt-sync, and smart-submit to include explicit "Use when..." trigger phrases and a when-NOT-to-use pointer to the neighboring command — previously 5 of 7 commands described what they ARE rather than when to fire, causing under-triggering in conversational routing; also collapses gt-amend's multi-line description scalar (silent-truncation hazard)
