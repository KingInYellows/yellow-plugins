---
'yellow-research': patch
'yellow-debt': patch
---

Pass ast-grep values to the CLI through files instead of heredocs.
`code-researcher` and yellow-debt's duplication and complexity scanners now
create a private values directory with `mktemp -d`, write the pattern,
language, path or relational rule into it with the Write tool, and run a
recipe that reads each value with `$(cat -- file)`. No value is ever shell
text, so a pattern can no longer close the old fixed heredoc delimiter when an
agent skips randomizing it. The recipe refuses missing, empty or unsafe values
and keeps the language and path allow-lists and the output caps. It only
accepts a directory directly under the resolved TMPDIR that holds the first
step's marker, and leaves any other directory untouched. It creates its
trusted `-c` config with `mktemp`, so a planted file or symlink is never
written through. When it finishes it deletes only its own files and then the
empty directory, never `rm -rf`. `code-researcher` gains the Write tool for
these value files only.
