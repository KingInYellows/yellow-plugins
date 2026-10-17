---
'yellow-council': patch
---

`/council` now saves the report by copying the file Step 7c assembled (with the
claude leg's redaction and fence rebuild) into `docs/council/` with `cp`,
instead of having the model rebuild it for a `Write`. A saved report can no
longer skip the claude-leg redaction. Step 8 Cancel removes the kept staging
directory.
