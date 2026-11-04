---
"yellow-review": minor
"yellow-core": patch
---

Add `/review:pr --report-only`: the same findings and ledger write as a normal
run, with no checkout, edits, commit, push or knowledge compounding. It reads
the current checkout when that is the clean PR head, and otherwise a detached
worktree of the PR head that a new `report-only-root` script adds and removes,
so `git status`, HEAD and the branch stay as they were. `/flow:work` Phase 5
now passes it; direct `/review:pr` and `/review:sweep` still apply fixes
(CLAUDE-213).
