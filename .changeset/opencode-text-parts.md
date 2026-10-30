---
"yellow-council": patch
---

Document that `opencode run --format json` text events are completed parts,
not streaming deltas, so the newline-joined extraction ahead of credential
redaction cannot split a key (CLAUDE-205).
