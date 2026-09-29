---
"yellow-core": minor
---

Add an opt-in context observer for session handoffs. `/statusline:setup` gains
Step 5b (also reachable as `/statusline:setup observer`), which asks before
composing `lib/context-observer.py` ahead of the existing statusline command
(default: leave it off), refreshes an outdated installed copy, and can disable
it again (or non-interactively with `observer enable|disable|status --yes`).
`lib/statusline-settings.py` is now the only writer of `statusLine.command`
(`statusline`, `status`, `plan`, `install`, `remove`, `prune`; every path has a
default and `--dry-run` writes nothing), so re-running
setup keeps an enabled observer, a symlinked settings.json stays a symlink, and
settings.json, the observer copy and the records follow `CLAUDE_CONFIG_DIR`
(the statusline script stays at `~/.claude/yellow-statusline.py`). The composed
stage is `{ command -v python3 >/dev/null && [ -r <observer> ] && exec python3
<observer>; exec cat; } | <existing>`: a missing observer or `python3` falls
back to `cat` so the statusline never blanks, and `exec` lets the statusline
render as soon as the observer releases stdout instead of waiting for the
record write. The generated statusline template moved to
`references/statusline-setup/statusline-template.py` unchanged. The observer passes the statusline payload through byte-for-byte,
always exits 0, and records context-window numbers per session under
`~/.claude/projects/<slug>/context-observations/`, counting one advisory
crossing per drop below a 50 % remaining watermark (`YELLOW_CONTEXT_WATERMARK`)
and doing nothing else. `session-handoff` now fills `context_at_capture` from
a fresh, same-session record (found by session id even when the session works
in a worktree or subdirectory) and reports `unknown` otherwise, including for
headless `claude -p` sessions; context never changes a preflight status. A new
`handoff.sh context` prints the context and a stable `reason` code for
`unknown` without running git.
Installing or updating yellow-core does not touch `statusLine`.
