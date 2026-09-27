---
'yellow-ruvector': minor
---

Surface co-edit history. The first time a session edits a file (tracked for the
session's 200 most recently suggested files, so an older one can be suggested
again), the PreToolUse hook now adds up to 3 files usually edited together with
it (seen together at least 3 times, still existing) as fenced
`additionalContext` — jq only, no ruvector CLI or Node start. Partner names from
`.ruvector/coedit.json` are re-validated before they reach model context (inside
the project, existing files, no control characters). New
`/ruvector:related <file>` command lists the top 50 partners with counts. The
PreToolUse hook no longer runs ruvector's `hooks pre-edit` / `hooks pre-command`
(their output was always discarded) and no longer fires on Bash.
