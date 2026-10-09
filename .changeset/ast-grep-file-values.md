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
and unknown directories, keeps the trusted `-c` config, the language and path
allow-lists and the output caps, and deletes the directory when done.
`code-researcher` gains the Write tool for these value files only.
