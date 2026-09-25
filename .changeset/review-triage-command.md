---
'yellow-review': minor
---

Add `/review:triage`: it reconciles a PR's review-findings ledger against the
fetched PR head (published fixes become `fixed`, reverted or abandoned ones
`reopened`, vanished anchors `stale`), then walks the remaining findings with
Apply, Dismiss (with `depends_on` paths), Restore file and Skip.
`--non-interactive` applies nothing and never deletes a ledger; attended triage
of a merged or closed PR asks first, and `--prune <PR#>` deletes the ledger of a
merged or closed PR. `/review:pr` and `/review:all` now capture a fork PR's head
ref into a variable and validate it before any command sees it.
