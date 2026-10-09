---
'yellow-research': patch
'yellow-debt': patch
---

Pass ast-grep values to the CLI through files instead of heredocs, and never
paste any value or path into shell source. `code-researcher` and yellow-debt's
duplication and complexity scanners run two fixed blocks unchanged. The first
takes a per-user lock in a private 0700 state directory
(`$XDG_RUNTIME_DIR/yellow-ast-grep`, else `~/.cache/yellow-ast-grep`), creates a
values directory with `mktemp -d` and records it in a pointer file. The agent
writes the pattern, language, path or relational rule into that directory with
the Write tool, and the second block reads the pointer and each value with
`$(cat -- file)`. No value is ever shell text, so neither a pattern nor a
directory name can break out of quoting. A concurrent search gets "busy", and a
lock older than 15 minutes is treated as stale and released without deleting
anything. The recipe refuses missing, empty or unsafe values and keeps the
language and path allow-lists and the output caps. It only accepts a directory
directly under the resolved TMPDIR that holds the first step's marker, and
leaves any other directory untouched. It creates its trusted `-c` config with
`mktemp`, so a planted file or symlink is never written through. When it
finishes it deletes only its own files and then the empty directory, never
`rm -rf`, and releases the lock. `code-researcher` gains the Write tool for
these value files only.

Document the new `Write` permission and temp-file workflow in the
yellow-research README and CLAUDE.md, yellow-debt's CLAUDE.md and
`docs/security.md`.
