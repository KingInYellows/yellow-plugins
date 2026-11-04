---
'yellow-review': patch
'yellow-core': patch
'yellow-devin': patch
---

Persona reviewers now return anchor-25-and-below findings at that anchor
instead of dropping them, so `/review:pr` and `/review:all` suppress and count
them at the single confidence gate. `/devin:review-prs` applies the same gate
after collecting persona findings. (CLAUDE-256)
