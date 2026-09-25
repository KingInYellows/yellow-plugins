---
"yellow-core": patch
"gt-workflow": patch
---

Stop `/flow:plan` from re-emitting untrusted Linear issue titles into plan metadata; emit validated issue IDs only and teach `/gt-stack-plan` to parse ID-only `## Linear Issues` lines.
