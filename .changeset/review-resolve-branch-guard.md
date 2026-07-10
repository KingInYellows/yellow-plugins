---
"yellow-review": patch
---

Add a correct-branch precondition to `/review:resolve`. When a PR number is
passed explicitly, the command now verifies the checked-out branch maps to that
PR (via `gh pr view --json number`) before resolving, committing, or pushing,
and hard-stops with a distinct message when the current branch maps to a
different PR, has no associated PR, or the check itself errors (fail-closed) —
preventing fixes from being committed to the wrong branch. The precondition is
mode-independent (fires the same with and without `--non-interactive`) and is
recorded as a convention in the pr-review-workflow skill. Explicit numeric PR
tokens are canonicalized before comparison, and `gh` error text is fenced as
untrusted reference output with auth/network-specific retry guidance.
