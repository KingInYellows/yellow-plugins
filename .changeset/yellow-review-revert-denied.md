---
"yellow-review": minor
---

Add `run-verify-command --revert-denied`: `/review:resolve` now reverts unreported trusted-config edits (agent instruction and tool-config files, `rp_trusted_config`) automatically after a refusal, without a path list, and reports `deniedClean`, `reverted` and `revertedCount` (`noop` when nothing changed). Other deny-listed paths such as `.env*`, keys, CI and Docker files are asked about or left in place, an untracked nested repository is left in place without stopping the other reverts, and a refusal before the verify call still runs the gitignored-file guard. `/review:resolve-stack` and `/review:sweep-all` dirty-tree cleanup use the same predicate through `--revert-denied`. Combining revert and check-ignored mode flags now exits 2 instead of resolving by argument order. The blocker lookup and stack self-verify also get their own Bash timeouts.
