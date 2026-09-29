---
'yellow-ci': patch
---

`/ci:setup-runner-targets`: the merged-cache block's fence now starts at
column 0. Its body sat at column 0 inside a list-item fence indented two
spaces, so CommonMark renderers ended the fence at the first line and showed
the shell comments as headings.
