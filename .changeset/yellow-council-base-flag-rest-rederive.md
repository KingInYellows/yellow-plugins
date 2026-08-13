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

The truncation is now bounded by bytes as well as lines. `head -200` alone is
not a size bound — 200 lines of a minified bundle or a generated lockfile can
exceed the 200K the truncation exists to stay under, so the truncated result
came back as large as the input and blew the pack budget anyway.

The byte cap is set from the tightest downstream consumer rather than from the
raw diff alone: the assembled pack also carries the stat header, up to three 4K
changed-file excerpts and the fence framing, and must clear both the 100K pack
budget and OpenCode's 120000-byte argv rejection. A 150000-byte diff portion
exceeded both on its own and would have marked that reviewer UNAVAILABLE on
every large-diff run.

Correction to the above: the earlier derivation assumed at most three 4K
changed-file excerpts, which is the `debug`/`question` limit — `review` mode has
no file-count cap and appends every changed file, and the `git diff --stat` was
unbounded as well, so a wide change still blew the budget with the diff portion
capped. The stat is now bounded, changed-file excerpts are added until a 30K
combined budget is reached (then a count of omissions), and the assembled-pack
ceiling of 100K is stated with the per-section arithmetic beside it.

The ceiling is now a measured post-assembly check rather than arithmetic: the
pack is written out, `wc -c` is taken, and changed-file excerpts are dropped
from the end until it is under 100000 bytes. A content-only budget counted
neither the per-file path/heading/fence framing — which a diff touching hundreds
of tiny files pays for every one of them — nor the byte cost of non-ASCII
content over its character count.

Two more from review of that check: the truncation trigger is lowered from 200K
to the 60K diff budget, since a diff between the two skipped truncation entirely
and dropping every excerpt still could not bring the pack under OpenCode's
guard; and the measurement copy must be `mktemp`-staged (0600) and removed on
every path, because it holds the pack unredacted and a Write-created file would
persist at the ordinary umask.
