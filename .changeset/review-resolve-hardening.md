---
'yellow-review': minor
---

Add the building blocks for hardening `/review:resolve` so every unresolved
review thread can end in an honest, durable state, and the dispositions
contract they implement (`references/resolve/dispositions.md`). A thread gets a
disposition (`fixed`, `addressed`, `oos`, `disagree`, `unclear`); replies and
follow-up issues carry an idempotency marker, so re-runs post no duplicates.
`/review:resolve` and `pr-comment-resolver` are not wired to the contract yet;
their behavior is unchanged until a later PR of this stack.

New scripts under `skills/pr-review-workflow/scripts/`: `get-pr-blockers`,
`reply-pr-thread`, `file-followup-issue` and `check-resolve-text`.
`get-pr-comments` gains an opt-in `--include-outdated` flag and additive
per-thread and per-comment fields; its default filter is unchanged.
