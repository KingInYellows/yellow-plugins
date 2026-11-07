---
'yellow-codex': patch
---

`codex-reviewer` now runs its Codex step with a 6-minute Bash tool timeout and
waits on the command if Claude Code moves it to the background. Codex reviews
take 3-4 minutes, and at the tool's default 120 s timeout the background agent
returned before Codex finished, with no verdict.
