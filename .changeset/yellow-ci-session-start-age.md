---
'yellow-ci': patch
---

SessionStart now shows a cached CI result for up to 7 days with its age ("as of
3 h ago") instead of hiding it after 1 hour, so someone who starts one session a
day still sees CI failures. Git worktrees share their main checkout's cache, the
background refresh logs why it skipped or failed, and an unwritable data
directory prints a warning instead of silently disabling the refresh.
