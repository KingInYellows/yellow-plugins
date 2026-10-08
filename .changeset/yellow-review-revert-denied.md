---
"yellow-review": minor
---

Add `run-verify-command --revert-denied`: `/review:resolve` now reverts unreported deny-listed edits automatically after a refusal, without a path list, and reports `deniedClean`, `reverted` and `revertedCount` (`noop` when nothing changed). Combining revert and check-ignored mode flags now exits 2 instead of resolving by argument order. The blocker lookup and stack self-verify also get their own Bash timeouts.
