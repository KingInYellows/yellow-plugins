---
'yellow-ci': patch
'yellow-debt': patch
'yellow-ruvector': patch
---

Document the bash/zsh contract for sourced shell libraries in each plugin's
CLAUDE.md: which libraries are bash-only and must be sourced in a
`bash /dev/fd/3 3<<'TAG'` child, and which are dual-shell.
