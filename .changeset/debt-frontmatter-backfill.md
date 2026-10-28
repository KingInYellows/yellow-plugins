---
'yellow-debt': patch
---

Add `debt_backfill_todos` to `lib/validate.sh`: it fills a missing `id`,
`status`, `severity` or `priority` in older todos from the file name, never
changes a present value, and reports todos missing `category` or
`affected_files` for a hand edit (CLAUDE-4).
