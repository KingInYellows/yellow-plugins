---
"yellow-core": patch
---

Harden the `/statusline:setup` settings backups and the context observer's
deadline. `statusline-settings.py` no longer reuses or writes through a
symlink at a backup name (a dangling link counts as taken), creates each new
backup with `O_EXCL|O_NOFOLLOW` at 0600 before applying the source's mode,
and writes the exact bytes it compared, CRLF included (CLAUDE-52).
`context-observer.py` cancels its `SIGALRM` deadline and ignores a pending one
once recording ends, so a deadline that lands just as recording finishes can
no longer escape as a traceback with a non-zero exit (CLAUDE-51).
