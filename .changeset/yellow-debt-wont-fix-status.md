---
'yellow-debt': minor
---

Add a first-class `wont-fix` status for findings that are valid but
deliberately not fixed. `transition_todo_state` accepts `pending`, `ready`,
`in-progress` and `deferred` → `wont-fix` and `wont-fix` → `pending`, stores an
optional `wont_fix_reason` (200 characters, counted in codepoints), and repairs
the hand-written `wont_fix` spelling. `/debt:triage` offers "Defer or won't
fix", and `/debt:status` counts the new status and prints a repair recipe for
legacy files.

A re-audit no longer recreates a closed finding: `audit-synthesizer` skips a new
finding that matches a kept todo by a code-anchored `fingerprint` (a `deferred`
finding still comes back), numbers new todos above the highest
existing id, and no longer deletes a `ready` todo whose slug contains
`-pending-` or a closed legacy todo whose file name still says `-pending-`.
Rejecting a finding (`deleted`) now also suppresses it on re-audit while its
code is unchanged, and `/debt:triage` option 3 is relabelled "Defer or won't
fix", which adds one prompt before the reason. The fingerprint library now
finds `yellow-core` in the versioned plugin cache; before, `validate_file_path`
was undefined in an installed plugin. A finding that comes back
after being deferred is marked `resurfaced_from` the deferred todo. Closing is
idempotent (repeating it says "already"), every transition prints a receipt, a
rejected one lists the allowed targets, and `/debt:status --json` lists the
files needing repair in `needs_repair`. A reason that starts with a dash is no
longer read as a `yq` option. A new `status-parity.bats` test fails when a
status is missing from any site that lists statuses.
