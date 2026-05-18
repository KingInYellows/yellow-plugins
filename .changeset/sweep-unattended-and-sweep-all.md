---
"yellow-review": minor
---

Remove the human gate from /review:sweep and add /review:sweep-all for
unattended batch sweeping of all open PRs. /review:pr gains a
`--non-interactive` flag (used internally by /review:sweep) that suppresses
its Step 9 push-confirmation prompt and Step 9b "save learnings" prompt.

- `/review:sweep` now runs `/review:pr --non-interactive` then
  `/review:resolve --non-interactive` with no AskUserQuestion gates anywhere —
  fully fire-and-forget on a single PR.
- `/review:sweep-all` (new) enumerates your open non-draft PRs, shows one
  upfront M3 confirmation listing PR count + titles, then loops sweep over
  each PR sequentially with skip-and-continue on per-PR failure, an
  end-of-loop summary table, and a single `/workflows:compound` pass to
  capture learnings (skipped if zero PRs were swept).
- `/review:pr --non-interactive` is opt-in for standalone use too — calling
  `/review:pr` without the flag retains the current interactive behavior.
