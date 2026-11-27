---
'yellow-core': patch
'yellow-claudemod': patch
'yellow-linear': patch
---

Read `claude plugin list --json` from the repository root in `/stack:status`,
`/stack:select`, the stack-provider router and guard, `/setup:all`,
`/statusline:setup`, `/claudemod:setup`, `/linear:setup` and `/linear:delegate`.
The CLI applies project and local enable overrides only for its current
directory, so from a subdirectory a project-level disable of a user-level plugin
read as enabled (CLAUDE-392).
