---
'yellow-ci': patch
---

SessionStart no longer calls `gh` in the foreground. It reads the result cache
first and refreshes it in a detached background process, so a cache miss costs
about 55 ms p95 instead of 1.2-1.5 s and a hit about 48 ms instead of 300 ms.
Results are shown for 10 minutes, shown and refreshed up to 1 hour, then only
refreshed (was a 60 s TTL) (CLAUDE-369).
