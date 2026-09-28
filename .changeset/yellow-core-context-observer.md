---
"yellow-core": minor
---

Add an opt-in context observer for session handoffs. `/statusline:setup` gains
Step 5b, which asks before composing `lib/context-observer.py` ahead of the
existing statusline command (default: leave it alone) and documents a manual
merge. The observer passes the statusline payload through byte-for-byte,
always exits 0, and records context-window numbers per session under
`~/.claude/projects/<slug>/context-observations/`, counting one advisory
crossing per drop below a 50 % remaining watermark (`YELLOW_CONTEXT_WATERMARK`)
and doing nothing else. `session-handoff` now fills `context_at_capture` from
a fresh, same-session record and reports `unknown` otherwise, including for
headless `claude -p` sessions; context never changes a preflight status.
Installing or updating yellow-core does not touch `statusLine`. README and
CLAUDE.md inventory updates follow separately.
