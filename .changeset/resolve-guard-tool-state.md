---
'yellow-review': patch
---

Stop the `/review:resolve` ignored-file guard from refusing valid fixes over
tool-owned state. The `--ignored-since` scan now skips yellow-ruvector's
`.ruvector/coedit.json` pair store (rewritten whenever a resolver edits a
second file) and vitest's `node_modules/.vite/vitest/results.json` run cache,
each only while it is a regular file. Every other gitignored file, including
the rest of `.ruvector/` and `node_modules/`, still stops the run.
