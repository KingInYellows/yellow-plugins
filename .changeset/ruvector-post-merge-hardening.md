---
'yellow-ruvector': patch
'yellow-core': patch
---

yellow-ruvector: a failed swap of the `current` install link puts a real
directory it moved aside back instead of deleting it, and `/ruvector:status`
bounds its `timeout`/`gtimeout` compatibility probe so a stalled wrapper cannot
hang it. yellow-core: `/setup:all` ignores a relative `XDG_DATA_HOME`, like the
launcher, so it never runs a `cli.js` found under the current project directory.
