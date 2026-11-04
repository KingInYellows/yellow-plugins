---
'yellow-agy': patch
---

Fit every `/agy:*` call inside the wrappers' 600 s Bash timeout (CLAUDE-255). A
new `Budget` counts from process start: host commands (git, mkdir, tee, rm) are
cut to what is left and, until the turn spawns, leave a 60 s turn's worth free;
the turn's print timeout is shortened to fit; and a call that can no longer fit
a 60 s turn after the quota probe refuses with the new `AGY_BUDGET` code,
refunding the task or corrective round. Before, slow git could push the call
past the wrapper, which killed it before it settled.
