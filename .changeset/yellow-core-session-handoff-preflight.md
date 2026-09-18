---
'yellow-core': minor
---

Session continuity foundation, part 1: `session-handoff` now publishes notes
through `skills/session-handoff/scripts/handoff.sh` with a shell-measured
`handoff_format: 1` front matter (hashed repository and worktree identity,
HEAD, branch, dirty fingerprint, source session, plugin version, body digest),
redacted atomic writes, and a read-only `preflight` that reports
`ready | mismatched | unsupported | blocked` with reason codes before a
successor continues. Resume now requires an explicitly named handoff path; the
newest-file rule is gone. Legacy notes without front matter still load as
`legacy`. Adds `lib/plugin-identity.sh` (which yellow-core copy is running
versus the checkout) and bats suites `tests/handoff.bats` and
`tests/plugin-identity.bats`. README and CLAUDE.md inventory updates follow
once PR #750 lands.
