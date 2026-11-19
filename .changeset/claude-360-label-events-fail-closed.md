---
'yellow-review': patch
---

`check-merge-ready` no longer drops a `merge-approved` label event whose time
does not parse: one such event leaves the label approval unknown
(`label_events_unknown`), since it could be a hidden removal (CLAUDE-360). With
the label off the PR, unreadable label events now give a definite
`approval_required` instead of unknown. Adds tests for same-second label changes
and a label added at the head's arrival time, and documents `humanApproval.via`
and `.at` in the script's output schema.
