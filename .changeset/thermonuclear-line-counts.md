---
'yellow-review': patch
---

`/review:pr` Step 5 now appends a `<file-line-counts>` block when — and only
when — `thermonuclear-reviewer` is in the dispatched set, giving that persona
the authoritative before/after line totals its size-threshold rule needs.

A unified diff cannot supply them: hunk headers describe changed regions, not
file totals, and summing `+`/`-` lines is arithmetic a reviewer gets wrong
silently. The orchestrator already resolves `DIFF_BASE` in Step 3a, so it
computes the counts with `git diff -z --numstat` plus `git cat-file -e` /
`git show`, handling adds (base 0), deletes and binaries (skipped), and
renames (base measured on the old path, so a rename does not read as a
crossing). Base content is read at `git merge-base "$DIFF_BASE" HEAD`, not at
`DIFF_BASE`'s tip, so the counts span exactly what the three-dot diff spans —
reading the tip instead reports a phantom shrink or a phantom crossing on any
branch whose base has advanced since it was cut, which is the normal state of
a branch in a stack. Paths are read NUL-delimited so a filename containing a
space or quote stays intact, and the values go through the same
literal-delimiter-then-XML sanitization as the pr-context fence.

The loop variable is `new_path`, never `path`: in zsh `path` is a special
array tied to `$PATH`, so naming it `path` replaces the command search path
and `git`/`awk` disappear — the loop then keeps running and emits
`base=0 head=` for every file instead of failing closed. Both counts are
read from commits (merge-base and `HEAD`) via `awk 'END{print NR}'` rather
than the worktree via `wc -l`, so they describe the same two endpoints the
diff spans and do not undercount a file lacking a trailing newline — an
off-by-one landing exactly at the 1000/1001 boundary. A row whose counts
come back empty or non-numeric is dropped with a warning rather than
emitted half-measured; each value is tested independently
(`${base:-x}${head:-x}`) because concatenating them lets an empty `head`
hide behind the literal `0` that every added file's `base` starts at.
Object types are probed with `git cat-file -t ... = blob` rather than
`-e`, since `-e` also succeeds for a tree: a file replaced by a directory
of the same name would otherwise have git's tree listing counted as file
content.

The block is fenced as `--- begin file-line-counts (reference only) ---` /
`--- end file-line-counts ---`, and both delimiters join the
literal-delimiter substitution list. Paths are PR-supplied, and `-z` yields
them raw, so a filename containing a newline would otherwise emit a second,
fully-forged `<path> base=N head=M` row — enough to fabricate a threshold
crossing on a file the PR never touched, or to state a benign base for one
it did. Rows whose path contains a control character are dropped with a
warning to stderr rather than silently.

When the block cannot be produced it is omitted entirely rather than emitted
partially — the reviewer fails closed on a missing block by suppressing every
size finding, whereas a partial block would look authoritative.

No other persona receives the block, and no dispatch table changed:
`thermonuclear-reviewer` remains reachable only through `reviewer_set.include`.
