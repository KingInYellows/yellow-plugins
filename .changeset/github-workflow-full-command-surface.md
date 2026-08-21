---
"github-workflow": minor
---

Add the full `github-stack:*` command surface (plan, submit, amend, sync,
nav, cleanup, merge) and the `github-stack-runtime.js` adapter that backs
them. All mutating `gh stack` calls now go through the adapter's
argument-array-only, validated, confirmation-gated execution — no command or
skill invokes `gh stack <verb>` directly. `modify`/`switch` remain
unsupported (TUI-only upstream); conflict recovery uses
`rebase --continue`/`--abort`.
