---
'gt-workflow': patch
'github-workflow': patch
'yellow-devin': patch
---

The PreToolUse `git push` backstop now reads `tool_input.command`. It
previously read a root-level `command` that no host sends (a field path
carried over from the deleted `check-git-push.sh`), so a real Claude Code or
Codex PreToolUse payload containing `git push` was allowed through. The
parity fixtures now use the real nested envelope, and a new fixture pins the
old flat shape as non-blocking. A present-but-non-string `tool_input.command`
now fails closed instead of being coerced to an allow. github-workflow's
sibling policy file changes only in its comments (it already read the nested
path). `/devin:review-prs`'s degraded-mode "Fix locally" path (`GT_AVAILABLE`
false or PR in `GT_DEGRADED_PRS`) now stops after the local commit instead of
running a raw `git push`, since this guard denies that command under
`READY_GRAPHITE`; it records the PR as committed-but-unsubmitted in the final
summary instead.
