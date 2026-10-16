---
"yellow-core": patch
---

Fix the background-compounding Stop capture for Claude Code 2.1.300+. The
staged `transcript_tail` now keeps only the last 100 `user` and `assistant`
transcript records, so the new `prompt_snapshot` attachments (full system
prompt and tool schemas) and other attachment records no longer fill it or
reach the Haiku drain. The tail is also passed to jq on stdin: a tail over
Linux's 128 KiB per-argument limit used to make jq fail and the entry was
silently dropped.
