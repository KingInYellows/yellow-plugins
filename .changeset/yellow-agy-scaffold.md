---
'yellow-agy': minor
'yellow-core': patch
---

Add yellow-agy, the experimental successor to yellow-jules: a local supervised
delegate on the Antigravity CLI (`agy`) under the owner's Google AI Pro sign-in.
This scaffold ships `/agy:setup`, a read-only check of where agy lives (on
`PATH` or through an exec-only WSL bridge), its version, any API-key or Vertex
variables in the caller's env or inside WSL, and whether overages are pinned
off. `/setup:all` now lists yellow-agy and probes `wsl.exe`.
