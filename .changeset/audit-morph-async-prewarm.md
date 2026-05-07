---
"yellow-morph": patch
---

H-01 (audit 2026-05-07): run yellow-morph SessionStart prewarm in a detached
background subshell. The previous synchronous form held the session-start
critical path for up to 30s while `npm ci` installed `@morphllm/morphmcp`
into `${CLAUDE_PLUGIN_DATA}/node_modules/` — single largest user-visible
perf cost in the marketplace.

The refactored hook spawns the install work in a detached subshell
(`( ... ) >/dev/null 2>&1 & disown`) and yields to Claude Code in <10ms
on the parent. The subshell owns the install lock and trap-releases on
EXIT, so the parent's early exit does not orphan the lock. SessionStart
timeout reduced from 30s to 5s in `plugin.json` and `hooks/hooks.json`
(both kept in sync per drift check).

**Trade-off:** if the user invokes a morph tool within ~30s of session
start on a slow connection, they may still hit a cold cache —
`bin/start-morph.sh` runs install synchronously as the correctness
fallback. The hook is purely an optimization; missing the async window
is no worse than not having the hook at all.

Companion: also marks `prewarm-morph.sh` executable (M-02 backport — the
chmod also lands in PR #437; this PR carries it because PR 3 branched off
main, parallel topology).
