---
'yellow-agy': minor
---

Add the yellow-agy adapter core: the per-host agy invocation builder (env
scrub, hook-disabling git config, exec-only WSL bridge, Windows command-line
limit), the read-only and implement permission profiles, turn argv, result
classification and the AGY_* error catalog. Library only; no command uses it
yet.
