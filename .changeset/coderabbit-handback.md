---
'yellow-review': minor
---

`/review:resolve` hands CodeRabbit threads back to CodeRabbit: before resolving
a thread CodeRabbit opened, the write phase replies `@coderabbitai resolve` in
that thread (new `handback-pr-thread` script, plan key `handback`), so
CodeRabbit records the thread as resolved and stops reopening it. The GraphQL
resolve still follows; `YELLOW_REVIEW_CODERABBIT_HANDBACK=0` turns the
hand-back off (CLAUDE-56).
