---
"yellow-morph": patch
---

Hardening of the @morphllm/morphmcp install path:

- Extract shared install primitives into `plugins/yellow-morph/lib/install-morphmcp.sh` (path validation, mkdir-lock, npm ci wrapper, cleanup). `bin/start-morph.sh`, `hooks/scripts/prewarm-morph.sh`, and `/morph:setup` Step 3 now source the lib instead of each carrying its own copy of the install protocol — single source of truth for the install contract.
- Add stale-lock recovery to the mkdir install lock: each holder writes its PID into `$LOCK_DIR/pid` on acquisition. Subsequent acquirers detect a dead owner via `kill -0` and clear the lock once before retrying. Recovers automatically from SIGKILL / OOM of a prior holder instead of forcing 20s of timeout-then-manual-cleanup on every later install.
- Tighten the npm ci environment from `unset MORPH_API_KEY` to `env -i` with an explicit allowlist (HOME, PATH, NPM_CONFIG_USERCONFIG, NPM_CONFIG_GLOBALCONFIG, NPM_CONFIG_PREFIX). Postinstall scripts in transitive deps no longer inherit any session secrets — not just MORPH_API_KEY but also ANTHROPIC_API_KEY, GITHUB_TOKEN, and anything else exported into Claude Code's process environment.
