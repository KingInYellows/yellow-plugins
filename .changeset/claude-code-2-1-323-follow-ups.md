---
'yellow-claudemod': patch
'yellow-core': patch
'yellow-review': patch
'yellow-agy': patch
---

Claude Code 2.1.323 follow-ups (CLAUDE-338): yellow-claudemod declares
`engines["claude-code"]: ">=2.1.301"` and imports `./policy` without a `.ts`
extension, clearing the new TS5097 validator warning. The git-worktree manager,
the review-gate shadow run and yellow-agy now name the Claude Code Bash sandbox
when `git worktree add` or `remove` fails read-only.
