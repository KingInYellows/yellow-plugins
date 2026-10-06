# yellow-ruvector 2.0.0 — open verification follow-ups

> **Status (2026-10-06):** Not started, 0 of 2 boxes. Opened by #908 and #910
> (merged); no PR since has measured either item. F1 is still open:
> `RUVECTOR_INSTALL_WAIT` defaults to 25 in
> `plugins/yellow-ruvector/bin/start-ruvector.sh:41` and no timeout measurement
> is recorded in the plugin docs. F2 is still open: `tests/pre-tool-use.bats`
> still has the single-run "stays fast against a 5000-pair file" test and no p95
> number is recorded. Both need a live Claude Code and a representative
> machine. No open PR. Not ready to archive.

Two checks from `plans/complete/yellow-ruvector-0-3-3-plugin-managed-install.md`
that shipped unverified. Both need an environment the implementation sessions
did not have.

## Tasks

- [x] F1 (from 1.1a): Measure Claude Code's MCP startup timeout when
      `MCP_TIMEOUT` is unset. Start a stdio server that sleeps before its
      handshake and bisect the sleep. If the measured timeout is not a few
      seconds above 25 s, lower `RUVECTOR_INSTALL_WAIT`'s default in
      `plugins/yellow-ruvector/bin/start-ruvector.sh` to fit, and record the
      value in the plugin `CLAUDE.md` MCP Server section and the plugin
      `README.md` (user-facing timeout and `MCP_TIMEOUT` guidance).
      **Result (2026-10-06, Claude Code 2.1.291, WSL2, `claude -p --strict-mcp-config`,
      `MCP_TIMEOUT` unset):** a server sleeping 20, 24, 25 or 26 s before its
      handshake connected; 27, 28, 29, 30, 45 and 60 s failed (25, 26, 27 s each
      repeated, same result). The timeout is about 26 s from server spawn, only
      1 to 2 s above the old 25 s default, so the default is now 20 s.
- [ ] F2 (from 3.4): Verify the PreToolUse co-edit lookup keeps p95 under 150 ms
      against a 5 000-pair `coedit.json`. The current `tests/pre-tool-use.bats`
      test ("stays fast against a 5000-pair file") times one run against an 800
      ms bound. Measure p95 over repeated runs, each with a fresh session id or
      an emptied `coedit-sessions/` (`coedit_suggest_once` skips the lookup for
      a file this session already surfaced, so reused sessions time no-ops), on
      a representative machine; if it meets the target, record the number here,
      and if not, fix the lookup. Keep any CI assertion loose enough for shared
      runners.
