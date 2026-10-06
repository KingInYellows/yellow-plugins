# yellow-ruvector 2.0.0 — open verification follow-ups

> **Status (2026-10-06):** Done, 2 of 2 boxes. F1 measured Claude Code's MCP
> startup timeout at about 26 s and lowered `RUVECTOR_INSTALL_WAIT`'s default
> from 25 to 20 s; F2 measured the co-edit lookup at p95 73 ms against the
> 150 ms target with no code change. Results are under each task. Ready to
> archive once the PR merges.

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
- [x] F2 (from 3.4): Verify the PreToolUse co-edit lookup keeps p95 under 150 ms
      against a 5 000-pair `coedit.json`. The current `tests/pre-tool-use.bats`
      test ("stays fast against a 5000-pair file") times one run against an 800
      ms bound. Measure p95 over repeated runs, each with a fresh session id or
      an emptied `coedit-sessions/` (`coedit_suggest_once` skips the lookup for
      a file this session already surfaced, so reused sessions time no-ops), on
      a representative machine; if it meets the target, record the number here,
      and if not, fix the lookup. Keep any CI assertion loose enough for shared
      runners.
      **Result (2026-10-06, WSL2 on 8 cores, `pre-tool-use.sh` with the same
      5 000-pair `coedit.json` shape as the bats test, a fresh session id per
      run, 100 runs, a suggestion surfaced every time):** p95 69 ms outside a
      git repo (p50 61, p99 82, max 86) and 73 ms inside one (p50 61, p99 86,
      max 87), against the 150 ms target. The lookup needed no change. The bats
      test keeps its single-run 800 ms bound, loose enough for shared runners.
