---
'gt-workflow': patch
---

The PreToolUse `git push` backstop now reads `tool_input.command`. It
previously read a root-level `command` that no host sends (a field path
carried over from the deleted `check-git-push.sh`), so a real Claude Code or
Codex PreToolUse payload containing `git push` was allowed through. The
parity fixtures now use the real nested envelope, and a new fixture pins the
old flat shape as non-blocking.
