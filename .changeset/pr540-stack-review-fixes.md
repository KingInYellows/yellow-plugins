---
"yellow-core": patch
---

Review fixes for PR #542:
- session-start.sh: handle symlinked .drain-lock in deadlock recovery
- session-start.sh: sanitize STAGING_DIR/CWD before fence interpolation in
  drain prompt (strip CR/LF + escape literal close-delimiter)
- compound-staging.sh: cs_drain_budget_warn takes optional live auth route
  so route switches take effect immediately instead of waiting for the 5h
  rolling window to roll
