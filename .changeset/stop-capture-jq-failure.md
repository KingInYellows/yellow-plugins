---
'yellow-core': patch
---

Stop capture stages nothing when the jq dialogue filter fails, instead of an
unfiltered raw tail that could carry attachment records such as the prompt
snapshot and memory files. Documented under Known Limitations in yellow-core
CLAUDE.md.
