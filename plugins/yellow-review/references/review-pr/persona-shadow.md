# Persona selection shadow log — `/review:pr` Step 4

Loaded by `/review:pr` Step 4 only when `yellow-plugins.local.md` sets
`reviewer_selection: shadow` or `reviewer_selection: jev`. A repo file that
leaves `reviewer_selection` unset falls back to the user-level file
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/yellow-plugins.local.md`, which turns the log on for every repository. Read
`reviewer_selection_private_repos` from that user-level file only, never
from the repository's file: the PR head is checked out, so a contributor
could add a private-repo opt-in there. Both mean shadow
for now: the log never changes which reviewers run. `/review:all` does not
run it. Skip it under `review_pipeline: legacy`.

It records, per review, three versions of the conditional-persona set so a
later eval can compare them against the review ledger's outcomes:

- `exact`: the table's deterministic rules (paths, extensions, keyword
  regexes, line counts), computed by `lib/persona-shadow.sh`.
- `orchestrator_triggered`: the conditional personas you selected from the
  table, before `review_depth`, `focus_areas` and `reviewer_set` applied.
- `jev_selected`: `exact` plus the fuzzy triggers TypeSafe's Jev answers in
  one request (security class at p >= 0.3, others at p >= 0.5).

Plus `dispatched`, your final set after every override.

## When

After the Step 4 selection is final (overrides and the security warning
applied) and before Step 5 dispatches anything. Run it once per review.

## Command

Write agent names only, one per line, from the conditional table (leave out
always-on personas and `codex-reviewer`). The PR title goes to a file
straight from `gh`, never through command text. Use the `DIFF_BASE` value
from Step 3a. Add one `--allow-repo <entry>` per entry in the user-level
`reviewer_selection_private_repos`, where an entry is `owner/repo` or
`owner/*` (every repository of that owner, matched case-insensitively);
with none, private repositories send nothing.

```bash
JP="${CLAUDE_PLUGIN_ROOT}/lib/persona-shadow.sh"
JP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/jp-shadow.XXXXXX") || JP_DIR=''
if [ -n "$JP_DIR" ]; then
  gh pr view <PR#> --json title -q .title >| "$JP_DIR/title" 2>/dev/null || : >| "$JP_DIR/title"
  printf '%s\n' <triggered conditional names> >| "$JP_DIR/triggered"
  printf '%s\n' <dispatched conditional names> >| "$JP_DIR/dispatched"
  "$JP" shadow --pr <PR#> --head "$(git rev-parse HEAD)" --base "<DIFF_BASE>" \
    --title-file "$JP_DIR/title" --triggered-file "$JP_DIR/triggered" \
    --dispatched-file "$JP_DIR/dispatched"
  rm -rf -- "$JP_DIR"
else
  printf 'persona-shadow: skipped (tmpdir)\n'
fi
```

The script always exits 0 and prints one line. Copy it into Step 10's
Coverage as `- Persona shadow: <text after "persona-shadow: ">`. Continue to
Step 5 whatever it says.

| Line | Meaning |
|------|---------|
| `logged` | Jev answered; the record has probabilities and `jev_selected` |
| `logged without Jev (<reason>)` | Record written without the Jev call: `no key`, `curl missing`, `repo visibility unknown`, `private repo`, `redactor missing`, `redaction failed`, `no valid answer` |
| `skipped (<reason>)` | Nothing written: bad arguments, `jq missing`, bad base, no git dir |

## What leaves the machine

Only on `logged`: the PR title, the changed paths with line counts, and the
diff hunks of non-test, non-generated, non-lockfile files, redacted with
yellow-core's `cs_redact_secrets`, fenced as untrusted reference data and
capped near 24,000 characters (largest files dropped first). Trust boundary:
`docs/security.md` "Persona selection shadow log". The record at
`<git-common-dir>/yellow-review/jev-persona/<pr>-<head>.json` (mode 600)
holds names, numbers and probabilities, never diff text.
