---
"yellow-council": patch
---

Fix `/council review --base <ref>`, which was silently non-functional since the
plugin shipped.

The `--base` parsing lives in its own fenced bash block, and each block runs as
a fresh subprocess, but it never re-derived `$REST` (Step 2 derives it in a
different block). So `set -- $REST` left `$#` at 0, the parse loop never ran,
`EXPLICIT_BASE` stayed empty, and every invocation fell through to the
upstream-tracking / `origin/main` default — including one passing an explicit
`--base`. That directly contradicted the contract stated three lines above it:
"An invalid or non-existent ref must fail loudly rather than silently falling
back, otherwise the advertised flag would be non-functional."

`MODE`/`REST` are now re-derived at the top of that block, matching Step 6's
existing convention.
