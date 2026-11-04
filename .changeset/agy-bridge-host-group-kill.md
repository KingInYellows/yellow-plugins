---
'yellow-agy': patch
---

On the Windows/WSL bridge, a timed-out host command (git, mkdir, tee, rm) now
kills its Linux process group instead of only `wsl.exe`, and waits for that kill
before the call fails (CLAUDE-246). Host commands run under the same `setsid -w`
wrapper and pgid line as agy turns. Verified on Linux; the real Windows kill
path still needs a run on the owner's PC.
