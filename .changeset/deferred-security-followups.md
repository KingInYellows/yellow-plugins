---
"yellow-council": patch
"yellow-codex": patch
---

Security follow-ups deferred from the PR #666/#667 review loops

- yellow-council: `gemini-reviewer` now stages the untrusted council pack
  via the Write tool (bounded to `$PACK_FILE`) instead of a fixed-delimiter
  heredoc, matching the `opencode-reviewer` conversion — closes the heredoc
  delimiter collision on attacker-influenced pack text.
- yellow-codex: `/codex:rescue` fails loudly when the staged
  task-description file is missing or empty, and `[ESCAPED]`-substitutes
  literal task-description fence delimiters in the untrusted text before
  interpolation so a pasted bug report cannot break out of the injection
  fence.
