---
'yellow-council': patch
---

Route gemini-reviewer and opencode-reviewer to `sonnet` / `medium` (were `haiku`
/ `low`). In the CLAUDE-200 eval, Haiku at either effort sometimes skipped the
CLI call and reviewed the pack itself, or replaced the canonical
credential-redaction program with an ad-hoc one; Sonnet followed the procedure
in every run.
