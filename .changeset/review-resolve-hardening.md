---
'yellow-review': minor
---

Harden `/review:resolve` so every unresolved review thread ends in an honest,
durable state. Each thread gets a disposition (`fixed`, `addressed`, `oos`,
`disagree`, `unclear`); a thread is resolved only after its reply posts, and a
`fixed` thread only after a verified push. Out-of-scope threads can file a
follow-up issue (capped at 3 per PR when unattended). Replies and issues carry
an idempotency marker, so re-runs post no duplicates.

New scripts under `skills/pr-review-workflow/scripts/`: `get-pr-blockers`,
`reply-pr-thread`, `file-followup-issue`, `commit-resolve-fixes` and
`run-verify-command`. `get-pr-comments` gains an opt-in `--include-outdated`
flag and additive per-thread and per-comment fields; its default output is
unchanged. The contract lives in `references/resolve/dispositions.md`.
