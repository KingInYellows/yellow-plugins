---
'yellow-agy': patch
---

On the Windows/WSL bridge, a timed-out host command (git, mkdir, tee, rm) now
kills its Linux process group instead of only `wsl.exe`, and waits for that kill
before the call fails (CLAUDE-246). Host commands run under the same `setsid -w`
wrapper and pgid line as agy turns. The `wsl.exe -e kill -s KILL -- -<pgid>`
group kill was confirmed on the owner's Windows PC.
