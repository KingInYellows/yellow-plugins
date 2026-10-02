# Brainstorm: first-class won't-fix status for yellow-debt

Date: 2026-10-01

## What We're Building

Add `wont-fix` as a new terminal status in yellow-debt's todo state machine, so
a valid finding that is deliberately not being fixed has a supported way to be
closed instead of a hand-edited, invalid `status`.

**Trigger.** In another repo using this plugin, an agent closed seven findings
as "won't fix". Two of them (DEBT-052 and 094) had `status: wont_fix` fixed
for that batch only. The status helper has no transition for it, so any future
`wont_fix` file drifts the same way.

**Root cause (verified in `plugins/yellow-debt`).**

- The state machine allows six statuses: `pending`, `ready`, `in-progress`,
  `deferred`, `complete`, `deleted`. `wont_fix` appears nowhere in the repo.
- Status is stored twice: in the frontmatter and in the filename
  (`{id}-{status}-{severity}-{slug}[-{hash}].md`). `DEBT_TODO_NAME_RE` rejects
  any other status, so a hand-edited value is invisible to `debt_resolve_todo`,
  `/debt:triage` and `/debt:fix`, and the filename and frontmatter disagree.
- `/debt:status` warns "Unknown status" and counts the file as an error.
- `deleted` means "false positive" and is reachable only from `pending` and
  `ready`. `deferred` returns to `pending`. Neither can express "valid finding,
  deliberately not fixing".

**Scope.**

- New status `wont-fix`, hyphenated to match `in-progress` and the filename
  regex (the underscore form `wont_fix` does not match).
- Reachable from `pending`, `ready`, `in-progress` and `deferred` via
  `validate_transition` / `transition_todo_state`.
- `/debt:triage` gets a fifth choice: "Won't fix — valid, deliberately not
  fixing". Findings in other states are closed by calling
  `transition_todo_state <file> wont-fix "<reason>"` from a bash child, the
  same way `/debt:fix` documents a manual rollback to `ready`. No new command.
- Reopenable: `wont-fix` -> `pending`, so a mistaken or outdated close goes
  back through triage rather than needing a hand edit.
- Optional `wont_fix_reason` frontmatter field (see Key Decisions).
- `/debt:status` counts `wont-fix` separately (new counter and JSON key) and,
  on `wont_fix`, `wontfix` or `wont fix`, adds a hint to use `wont-fix`.
- One Bats parity test guards against the status list drifting again.

**Out of scope.** A new `/debt:close` command, a helper alias for the
underscore spelling, centralizing the status list, and anything listed under
Open Questions.

## Why This Approach

The failure was a status list that lives in six places and drifted. The chosen
approach (B) adds `wont-fix` at each place and adds one Bats test that checks
each status in the helper's list also appears in the other sites. A missed site
then fails CI instead of surfacing in someone else's repo.

The six sites, derived by grep rather than memory (per
`docs/solutions/code-quality/frontmatter-sweep-and-canonical-skill-drift.md`):

- `plugins/yellow-debt/lib/validate.sh`: `DEBT_TODO_NAME_RE` and
  `validate_transition`; `transition_todo_state` for reason handling
- `plugins/yellow-debt/commands/debt/status.md`: status case, counters, JSON
  output, dashboard
- `plugins/yellow-debt/commands/debt/triage.md`: new choice and decisions text
- `plugins/yellow-debt/skills/debt-conventions/SKILL.md`: "Invalid Status
  Values"
- `plugins/yellow-debt/README.md`: transitions list and frontmatter example
- `plugins/yellow-debt/hooks/scripts/session-start.sh`: deliberately keeps
  counting only `pending|ready`; the parity test checks that subset

Alternatives considered:

- **A. Edit in place, no guard.** Smallest diff, but the next status added
  drifts the same way and nothing flags a missed site.
- **C. Centralize the status list in `validate.sh`.** Bigger than the bug. The
  standalone 3-second session-start hook cannot source the library, and
  `README.md` / `SKILL.md` still need hand edits.

Tier exclusivity (from
`docs/solutions/logic-errors/classification-tier-mutual-exclusivity.md`):
`wont-fix` must stay distinct from `deleted` (false positive) and `deferred`
(later), with no overlap in which transitions reach it.

## Key Decisions

1. **Own status, not `deleted` or `deferred` plus a reason.** `deleted` would
   mislabel a real finding as a false positive. `deferred` means "later" and
   returns to `pending`. (User chose A.)
2. **Entry from every open state, via triage plus the helper, no new command.**
   `pending`, `ready`, `in-progress`, `deferred` -> `wont-fix`. `debt-fixer`'s
   rejection path is unchanged (back to `ready`). (User chose B.)
3. **Reopenable to `pending`.** One added transition, mirroring
   `deferred` -> `pending`. The finding is re-triaged rather than resuming work.
   Clears `wont_fix_reason`. (User chose B.)
4. **`wont_fix_reason` is optional, max 200 characters, newlines stripped,
   written exactly as `deferred_reason` is.** Triage passes the text through a
   file (private temp directory plus Write tool), never through shell text. The
   helper clears it on any other transition. This was a routine call made by
   the facilitator and stated in Question 4; the user raised no objection and
   saw it again, with the doc summary, at the Save gate.
5. **Documented spelling is `wont-fix`; targeted hint for the rest.**
   `/debt:status` warns on `wont_fix`, `wontfix` and `wont fix` with a hint to
   use `wont-fix`. The helper keeps a single accepted spelling and no alias, so
   a bad spelling fails loudly at the helper rather than drifting. (User chose
   B.)
6. **Approach B: add in place plus one parity test.** (User chose B.)

Unchanged and checked: the session-start hook (counts only `pending|ready`),
`/debt:sync` (pushes accepted findings), and `debt-fixer`'s rejection path.

## Open Questions

- **Doc mismatch on `deleted`.** `triage.md` says a rejected file "will be
  removed from todos/debt/", but `transition_todo_state` only renames it and
  keeps the file. Separate cleanup.
- **Audit re-detection.** (Resolved: the synthesizer's Step 5a now skips a
  finding that matches a kept todo.) The synthesizer's dedup did not check
  existing todos, so a later `/debt:audit` could re-create a todo for a finding
  already closed as `wont-fix` (or `deleted`).
- **Existing `wont_fix` files in other repos.** Not migrated by this change.
  The `/debt:status` hint points at the fix; whether to ship a repair helper is
  deferred.
- **Release mechanics.** Needs a changeset, plugin `README.md` and `CLAUDE.md`
  updates, `pnpm validate:agents`, `pnpm lint:plugins`,
  `pnpm validate:shell-compat`, and `bats tests/` from the plugin directory.
- **Parity-test wording sensitivity.** The test greps prose and markdown, so a
  legitimate wording change may need a test tweak. Decide the exact patterns
  during planning.
