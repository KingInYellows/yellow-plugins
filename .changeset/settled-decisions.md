---
'yellow-core': minor
---

Settled decisions carry across the flow workflow (CLAUDE-212). A decision the
user made with a tradeoff in view is recorded as
`(session-settled: user-directed|user-approved — chosen over <alternative>: <reason>)`
in brainstorm docs, specs, plans and shells, so later steps build on it instead
of reopening it. `/flow:plan` collects them from the brainstorm doc, a
`Settled decisions:` block in its arguments, or the conversation, grades any
contradicting research, and with the new `--non-interactive` flag writes no plan
and returns `settled-decision-invalidated` when one cannot work. `/flow:work`
stops and asks instead of switching away from one silently. The protocol,
adapted from Compound Engineering, is
`references/flow-plan/settled-decisions.md`.
