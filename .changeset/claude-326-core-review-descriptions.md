---
'yellow-core': patch
'yellow-review': patch
---

Rewrite yellow-core and yellow-review command, agent and skill descriptions
trigger-first and shorter (yellow-core 16,418 to 12,548 characters,
yellow-review 10,187 to 7,312). `/review:pr` trigger eval recall rose from 0.50
to 1.00; `/review:resolve` held at 1.00 with no near miss firing.
