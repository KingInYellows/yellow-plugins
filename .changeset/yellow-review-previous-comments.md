---
"yellow-review": minor
---

Add `previous-comments-reviewer`, a conditional `/review:pr` persona that
checks earlier review feedback (bot and human, resolved threads included) was
actually addressed in the code, and flags threads marked resolved without the
requested change. It runs only when the PR has prior reviews or comments. New
`prior-comments-context` script builds its fenced, sanitized input, and
`get-pr-comments` gains `--include-resolved` (CLAUDE-219).
