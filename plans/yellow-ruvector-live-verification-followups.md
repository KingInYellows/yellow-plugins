# yellow-ruvector 2.0.0 — open verification follow-ups

Two checks from `plans/complete/yellow-ruvector-0-3-3-plugin-managed-install.md`
that shipped unverified. Both need an environment the implementation sessions
did not have.

## Tasks

- [ ] F1 (from 1.1a): Measure Claude Code's MCP startup timeout when
      `MCP_TIMEOUT` is unset. Start a stdio server that sleeps before its
      handshake and bisect the sleep. If the measured timeout is not a few
      seconds above 25 s, lower `RUVECTOR_INSTALL_WAIT`'s default in
      `plugins/yellow-ruvector/bin/start-ruvector.sh` to fit, and record the
      value in the plugin `CLAUDE.md` MCP Server section and the plugin
      `README.md` (user-facing timeout and `MCP_TIMEOUT` guidance).
- [ ] F2 (from 3.4): Verify the PreToolUse co-edit lookup keeps p95 under 150 ms
      against a 5 000-pair `coedit.json`. The current `tests/pre-tool-use.bats`
      test ("stays fast against a 5000-pair file") times one run against an 800
      ms bound. Measure p95 over repeated runs, each with a fresh session id or
      an emptied `coedit-sessions/` (`coedit_suggest_once` skips the lookup for
      a file this session already surfaced, so reused sessions time no-ops), on
      a representative machine; if it meets the target, record the number here,
      and if not, fix the lookup. Keep any CI assertion loose enough for shared
      runners.
