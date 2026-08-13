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

The skill's truncation snippet recomputes the diff in its own bash block, so
the caller's empty-diff guard does not cover it. Left unsubstituted, the `BASE`
placeholder made `git diff` exit 128 while the redirect still created the file,
`wc -c` read 0, and the block exited successfully with an empty diff — fanning
out reviewers over nothing, which returns an unfounded APPROVE. The snippet now
rejects an unsubstituted placeholder, requires `BASE` to resolve to a commit,
and aborts when `git diff` fails or produces an empty file.

The truncation block also never emitted its result. It wrote the truncated diff
to a randomized `$DIFF_FILE` and ended, but it runs in its own Bash call, so
neither the variable nor the path reaches the pack-assembly step that consumes
it — a review large enough to trigger truncation fanned out with no diff at all,
which every reviewer answers with an unfounded APPROVE. The block now prints the
diff on stdout and removes the file, and `council.md` states that the captured
stdout is the handoff.
