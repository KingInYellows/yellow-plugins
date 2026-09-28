---
title: 'Fail-Open Observer Stage Patterns (statusline pipe, deadlines, backups)'
date: 2026-09-28
category: code-quality
track: knowledge
problem: "Opt-in observer stages that must fail open silently blank pipelines, swallow deadlines, or clobber backups"
tags: [fail-open, statusline, python, signal-alarm, oserror, backup, silent-failure, observer]
components:
  - plugins/yellow-core/lib/context-observer.py
  - plugins/yellow-core/lib/context-observer-setup.py
  - plugins/yellow-core/lib/context-observer.sh
---

# Fail-Open Observer Stage Patterns

## Context

PR #912 (yellow-core opt-in context observer) review P2 findings produced
four patterns that recur whenever a best-effort observer is spliced into an
existing user-owned flow. Each was a silent-failure path, not a crash.

## Guidance

1. **Compose a pass-through stage with a `cat` fallback.** When wrapping an
   existing statusline command, write
   `{ python3 <observer> || cat; } | <existing>`. If the observer fails to
   start (missing interpreter, bad path), `cat` forwards stdin so the
   downstream statusline still renders. A bare `python3 <observer> | <existing>`
   blanks the user's statusline on any startup failure.
2. **Deadline exceptions must not derive from `OSError`.** `TimeoutError`
   subclasses `OSError`, so a `signal.alarm` handler raising it is swallowed
   by every `except OSError:` I/O guard. Raise a dedicated
   `class Deadline(BaseException)` and catch it only at the top level.
3. **Distinguish unreadable from absent.** A loader that returns `None` for
   both "no record" and "record exists but unreadable" lets callers treat
   corruption as a fresh start. Return a distinct sentinel (for example
   `UNREADABLE`) and let the caller choose to skip or report.
4. **Never overwrite an earlier backup; report recovery distinctly.**
   Corrupt-settings recovery that writes a fixed `.corrupt.backup` destroys
   the previous backup on the second corruption. Use numbered backups
   (`.corrupt.backup`, `.corrupt.backup.2`, ...) and return a distinct
   action (`recovered`) so `--json` callers see that settings were reset,
   not that a normal enable happened.

Related smaller lessons from the same review:

- Newest-record scans must include the primary-slug path in the mtime
  comparison, or a stale primary record hides a newer same-session record.
- Add bats cases for future-dated timestamps (`observed_at` in the future)
  wherever age or staleness is computed.
- A slash command that gates behaviour behind an interactive prompt needs a
  `--yes` / explicit `enable|disable|status` path for agents.
- Do not persist advisory state (watermarks) that has no consumer; either
  expose it to the reader (`last_state`, `watermark_remaining`) or remove it.

## Why This Matters

All four failures degrade silently: the user sees an empty statusline, a
missed deadline, a false "fresh" state, or a lost backup, with no error to
trace.

## When to Apply

Any hook, statusline wrapper, or setup script that must never break the host
flow and that touches user-owned config.

## Examples

```bash
# wrap, do not replace
"statusLine": { "command": "{ python3 \"$OBS\" || cat; } | $EXISTING" }
```

```python
class Deadline(BaseException):
    pass

def on_deadline(signum, frame):
    raise Deadline()
```
