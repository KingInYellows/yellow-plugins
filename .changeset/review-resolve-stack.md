---
'yellow-review': minor
---

feat(yellow-review): resolve-stack command + stack-traversal skill

Adds `/review:resolve-stack` — walks the current Graphite stack bottom-up and
runs `/review:resolve` on every open PR fully autonomously (no prompts),
pushing and restacking as it goes. Built for clearing reviewer comments spread
across a multi-PR stack in one unattended pass.

- `plugins/yellow-review/commands/review/resolve-stack.md` — new gateless
  command: pre-flight checks, base-to-tip stack walk, per-PR delegation to
  `/review:resolve --non-interactive`, independent self-verification via
  `get-pr-comments`, log-and-continue error handling, final aggregate summary
  with a "needs manual attention" section.
- `plugins/yellow-review/skills/stack-traversal/SKILL.md` — new internal
  reference skill (`user-invokable: false`) documenting the canonical bottom-up
  Graphite walk shared by `/review:all` and `/review:resolve-stack`.
- `plugins/yellow-review/commands/review/resolve-pr.md` — adds a
  `--non-interactive` mode that suppresses the spawn-cap, CONFLICT, and
  push-confirmation `AskUserQuestion` gates (spawn-cap is replaced by a hard
  20-cluster cap). Default behavior is unchanged.
- `plugins/yellow-review/commands/review/review-all.md` — mirror-comment citing
  the new `stack-traversal` skill as the traversal source of truth (no logic
  change).
