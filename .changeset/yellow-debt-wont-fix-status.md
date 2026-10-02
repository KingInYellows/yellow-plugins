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
finding that matches any kept todo by a code-anchored `fingerprint`, numbers new
todos above the highest existing id, and no longer deletes a `ready` todo whose
slug contains `-pending-`. A reason that starts with a dash is no longer read as
a `yq` option. A new `status-parity.bats` test fails when a status is missing
from any site that lists statuses.
