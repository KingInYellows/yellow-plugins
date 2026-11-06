---
'yellow-review': minor
---

Make the resolve line cap unattended-only (CLAUDE-272, CLAUDE-273).
Interactive `/review:resolve` runs have no line cap, and the resolver agent no
longer stops itself at 50 lines. An unattended run whose clusters go over the
50-line cap now pushes them with `commit-resolve-fixes --over-cap-draft`, which
converts the PR to a draft and leaves those threads open for human review,
instead of reverting the fix. The cap is documented as a reviewability limit,
not a security control. Also: a ledger test for a prune that lands before a
successful fold, and the sweep worktree hint now reads as two steps.
