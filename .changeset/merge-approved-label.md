---
'yellow-review': major
'yellow-core': patch
'yellow-linear': patch
---

Replace the `graphite-queue` label as the owner's merge approval with a new
`merge-approved` label (CLAUDE-345). `check-merge-ready` counts it for medium
and high tier PRs only when the latest addition of the label was made by a
listed human by hand (the REST issue events report `performed_via_github_app`
as null) after the head arrived; an addition made through a GitHub App never
approves, and unreadable label events are the new `label_events_unknown`
token. The report's Graphite-specific `queued` field and the merge-ready
`Queue` row are gone. yellow-core's local-config schema and yellow-linear's
README describe the new rule and the Graphite merge queue as one path among
others.
