# Feature: first-class `wont-fix` status for yellow-debt

Source brainstorm:
`docs/brainstorms/2026-10-01-give-yellow-debt-a-first-class-way-to-cl-brainstorm.md`

## Problem Statement

yellow-debt has no way to close a valid finding that is deliberately not being
fixed. In another repo an agent hand-wrote `status: wont_fix` on seven
findings; two (DEBT-052, DEBT-094) were repaired for that batch only. The
helper still has no transition for it, so the next such close drifts the same
way: frontmatter and filename disagree, `debt_resolve_todo` skips the file, and
`/debt:status` counts it as an error. Separately, a re-audit regenerates
pending todos without checking closed ones, so a closed finding comes back.

## Current State

- `plugins/yellow-debt/lib/validate.sh`
  - `DEBT_TODO_NAME_RE` (line 27) allows six statuses: `pending`, `ready`,
    `in-progress`, `deferred`, `complete`, `deleted`.
  - `validate_transition` (lines 291-302) has no `wont-fix` edges.
  - `transition_todo_state` (lines 202-289) reads the current state from
    frontmatter, writes `deferred_reason` via `yq --arg` (newlines stripped,
    `cut -c1-200`), and clears it on any other transition. Its filename
    rewrite (lines 267-275) special-cases only `in-progress-*`; the
    `*) rest="${rest#*-}"` arm would turn `001-wont-fix-high-x.md` into
    `001-pending-fix-high-x.md` on reopen, which fails the regex.
- `commands/debt/triage.md` uses all four `AskUserQuestion` options (Accept,
  Reject, Defer, Stop); four is the tool's hard cap.
- `commands/debt/status.md` runs under `set -euo pipefail` with
  `declare -A by_status`; unknown statuses warn and increment `ERROR_COUNT`.
- `agents/synthesis/audit-synthesizer.md` Step 5 deletes `*-pending-*.md`, and
  Step 7 numbers new todos from `001` with no check against kept todos.
  Filenames end in `-HASH` (`SHA256(category:file:lines)`, first 8 chars).

<!-- deepen-plan: codebase -->
> **Codebase:** The `-HASH` is not a dependable key. Nothing computes
> `SHA256(category:file:lines)` in shell: `$content_hash` is an
> agent-exported variable (`audit-synthesizer.md:209-225`), so an LLM picks
> it. The synthesizer's frontmatter mapping table (`:189-199`) omits
> `content_hash`; only the README template (`README.md:158`) shows it. In
> filenames the hash is an optional last segment that the regex cannot tell
> apart from a slug word, and many fixtures and docs use hash-less names. This
> is why decision 7 now uses a shell-computed, code-anchored fingerprint.
<!-- /deepen-plan -->

## Proposed Solution

Approach B from the brainstorm: add `wont-fix` at every site in place, plus one
Bats parity test so a missed site fails CI.

Decisions (user-confirmed unless marked):

1. `wont-fix` is its own status, hyphenated (fits the filename regex).
2. Edges: `pending|ready|in-progress|deferred → wont-fix`, and
   `wont-fix → pending` (reopen, re-triaged). `debt-fixer`'s rejection path is
   unchanged.
3. Legacy repair: `validate_transition` also accepts `wont_fix → wont-fix`
   (source side only). The only accepted target spelling stays `wont-fix`.
4. Optional `wont_fix_reason`: ≤200 chars, newlines stripped, set with
   `yq --arg`, passed from triage through a private temp dir + Write tool.
   Cleared on every other transition, including reopen (matches
   `deferred → pending`).
5. Triage: option 3 becomes "Defer or won't fix — valid, not fixing now"; its
   follow-up asks Defer / Won't fix / Cancel, then the reason prompt. Reject
   is unchanged. Findings past triage are closed with the documented helper
   recipe; no new command.
6. `/debt:status`: new counter, dashboard line and `wont_fix` JSON key; a hint
   arm for `wont_fix|wontfix|"wont fix"` that prints the repair recipe.
7. Re-audit: the synthesizer skips a new finding that matches **any kept
   todo** (`ready`, `in-progress`, `deferred`, `complete`, `wont-fix`,
   `deleted`) by a **code-anchored fingerprint**, not line numbers, and
   numbers new todos above the highest existing id. The fingerprint is
   `sha256(category, path, flagged code with all spaces/tabs/CR removed)`,
   computed in shell and stored in frontmatter as `fingerprint: fp/v1:…`,
   plus an `anchor_hash` of the first non-blank flagged line. Exact
   fingerprint match first; fallback: same category and path, and the kept
   todo's `anchor_hash` equals the hash of one line in the new range. Only a
   unique match suppresses; ties resurface. (Scope and key chosen by the user
   during deepen-plan.)
8. (Planner call) Linear: closing a synced todo does not touch its Linear
   issue. The recipe and docs say to close it by hand; `linear_issue_id` is
   kept.
9. (Planner call) A running `/debt:fix` on a todo closed as `wont-fix` fails
   closed at its next `debt_resolve_todo … in-progress`; document this and
   test it, no fixer code change.
10. CI runs the yellow-debt Bats suite as a required step with kislyuk `yq`.
    (User-confirmed during deepen-plan.)

<!-- deepen-plan: external -->
> **Research:** Decision 7 follows the common scanner recipe. Semgrep's
> `syntactic_id` hashes (rule, path, dedented matched code, occurrence index).
> GitHub code scanning's `primaryLocationLineHash` hashes the flagged line's
> content with all spaces and tabs removed. SonarQube matches in ordered
> passes, ending with "same rule + line hash". None uses the line number as
> identity, and none uses the message as the primary key. LLM line ranges
> drift by a few lines between runs, so an exact hash needs a fallback pass,
> and ambiguous matches should resurface rather than suppress (a false merge
> hides a real finding). Prefix the stored value with a version (`fp/v1:`)
> so the normalization can change later. Sources under References.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Decision 9 assumes one shared tree. `debt-fixer` runs with
> `isolation: worktree` (`agents/remediation/debt-fixer.md:5`), and the root
> `.gitignore:38` ignores `todos/`. Whether the fixer's worktree sees a
> rename made in the main checkout is unverified; the planned 3.2 test only
> simulates a single tree. Fixer sites that would fail closed if it does:
> `debt_resolve_todo "$1" in-progress` at `debt-fixer.md:164, 205, 267` and
> the `transition_todo_state` calls at `:71` and `:122`. Verify this during
> task 2.4 and word the fix.md note to match what actually happens.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: State machine (`lib/validate.sh`)

- [x] 1.1: Add `wont-fix` to the `DEBT_TODO_NAME_RE` status group; extend the
      filename-contract comment.
- [x] 1.2: Add `validate_transition` edges: `pending→wont-fix`,
      `ready→wont-fix`, `in-progress→wont-fix`, `deferred→wont-fix`,
      `wont-fix→pending`, and the legacy `wont_fix→wont-fix`.
- [x] 1.3: Add a `wont-fix-*) rest="${rest#wont-fix-}" ;;` arm to the
      filename rewrite in `transition_todo_state`.

<!-- deepen-plan: codebase -->
> **Codebase:** The legacy repair works end to end. `transition_todo_state`
> reads the current state from frontmatter (`validate.sh:228`), and nothing
> compares filename status to frontmatter status. For `052-pending-high-…`
> with `status: wont_fix`, the existing `*)` arm yields `052-wont-fix-high-…`,
> so the new `wont-fix-*)` arm is needed only for the reopen direction.
<!-- /deepen-plan -->

- [x] 1.4: Replace the reason block with a symmetric one: clean the reason
      first (strip `\n\r`, truncate to 200 **codepoints** with
      `jq -rn --arg s "$reason" '$s[0:200]'`) and test `-n` on the cleaned
      value; `→wont-fix` sets `.wont_fix_reason` and deletes
      `deferred_reason`/`defer_reason`; `→deferred` sets `.deferred_reason`
      and deletes `wont_fix_reason`/`defer_reason`; any other target deletes
      all three. When the source is legacy `wont_fix` and no reason is passed,
      keep an existing `.wont_fix_reason` (truncated). Rename the local
      `deferred_reason` to `reason` and fix the wrong `cut -c` comment.

<!-- deepen-plan: codebase -->
> **Codebase:** `cut -c1-200` counts bytes, not characters. On GNU cut 9.4
> under C.UTF-8, 300 × "é" came out as 100 characters, and a cut landing
> mid-character made `yq` write U+FFFD into the todo. The comment at
> `validate.sh:243` claiming character counting is wrong. As planned, the
> `wont_fix→wont-fix` repair would also erase a hand-written
> `wont_fix_reason`, which the seven agent-closed files likely have; hence
> the keep-existing rule above.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** jq string slices count Unicode codepoints whatever the locale
> (jq 1.7/1.8 manual: `.[i:j]` substrings, `length` in codepoints), and
> kislyuk `yq` passes filters to jq, so it is already a dependency.
> Alternatives are worse: bash/zsh `${v:0:N}` counts bytes unless a UTF-8
> `LC_CTYPE` is set and installed, and mawk (Debian/Ubuntu's default `awk`)
> has no multibyte support. Codepoints can still split a grapheme cluster
> (emoji with modifiers), but never produce invalid UTF-8.
<!-- /deepen-plan -->

- [x] 1.5: Add `debt_fingerprint CATEGORY PATH START END` to `validate.sh`.
      It validates `PATH` with `validate_file_path` (relative, inside the
      repo, not a symlink), reads lines `START..END`, removes spaces, tabs
      and CR, and prints `fp/v1:<16 hex>` of
      `sha256("fp/v1\0category\0path\0text")`. Add `debt_anchor_hashes PATH
      START END`, printing one normalized-line hash per non-blank line (the
      first is the todo's `anchor_hash`). A finding with no line range
      fingerprints `(category, path)` only and has no anchor.

### Phase 2: Commands, agent and docs

- [x] 2.1: `commands/debt/status.md`
  - add `wont-fix` to the init loop (line 59) and the valid case arm (line 99)
  - add a hint arm before `*)` for `wont_fix|wontfix|"wont fix"`: print
    (via `printf '%s'`) that the status should be `wont-fix` and the recipe
    `transition_todo_state "$(debt_resolve_todo '<id>' <filename-status>)" wont-fix`,
    noting a filename containing `wont_fix` needs a manual rename first;
    still increment `ERROR_COUNT`
  - add `"wont_fix": ${by_status[wont-fix]}` to the JSON (fix the comma)
  - add `Won't fix:   N findings (closed)` to the dashboard heredoc
  - update the dashboard and JSON samples (also add the missing `deleted`)

<!-- deepen-plan: codebase -->
> **Codebase:** Line numbers confirmed: init loop 59, valid arm 99, `*)` 103,
> JSON heredoc 166-193 (`"deleted"` at 176 is last, so the comma goes after
> it), dashboard heredoc 196-227. Both inner heredocs are unquoted, so the
> apostrophe in "Won't fix" is safe. `--json` is not a separate path: it sets
> `JSON_OUTPUT` (line 42) and branches at 164 after one shared scan; warnings
> go to stderr. Files with an unknown status still increment `TODO_COUNT`, so
> `total_findings` will not equal the sum of `by_status` while legacy files
> exist; mention that in the hint text rather than "skipped".
<!-- /deepen-plan -->

- [x] 2.2: `commands/debt/triage.md`
  - single-line `description:` and intro mention won't-fix
  - option 3 label: "Defer or won't fix — valid, not fixing now"
  - follow-up question: Defer / Won't fix / Cancel (Cancel returns to the
    finding's main options, uncounted)
  - Won't-fix reason prompt mirroring Defer (text reason and blank "Other")
  - two new `bash /dev/fd/3 … 3<<'__YELLOW_DEBT_BASH__'` blocks (with
    reason, without), placed **after** the existing four blocks so
    `extract_wrapper` indexes 1-4 in `security.bats` stay valid; they use
    `debt_resolve_todo "$1" pending` and
    `transition_todo_state "$todo_file" wont-fix "$REASON"`; reuse the
    `mktemp -d` + Write template, renamed to a neutral `debt-reason.XXXXXX`
  - update the `allowed-tools` Write comment, Step 6 counts, the summary
    line ("R won't fix"), and add a "Won't fix" entry to Triage Decisions
    that says the file is kept in `todos/debt/` and gives the helper recipe
    for findings in `ready`, `in-progress` or `deferred`

<!-- deepen-plan: codebase -->
> **Codebase:** The existing Defer reason prompt has two options, "Other"
> (free text) and "Cancel" (`triage.md:167-171`), so the new three-option
> Defer / Won't fix / Cancel step fits the cap and adds one prompt level. The
> accept/reject/defer counters and the Step 7 summary are prose held in
> conversation context (`:105-107`, `:233-236`), not shell, so adding a
> won't-fix count is a wording change. The `debt-defer.XXXXXX` temp name is
> referenced by no test or validator, so renaming it is safe.
> `tests/shell-compat/wrappers.bats:110-111` matches only the single-operand
> accept block, so appended blocks do not disturb it.
<!-- /deepen-plan -->

- [x] 2.3: `agents/synthesis/audit-synthesizer.md`
  - Step 5: anchor the pending wipe to
    `todos/debt/[0-9]*-pending-{critical,high,medium,low}-*.md` (planner
    call: fixes the existing bug that also deletes kept todos whose slug
    contains `-pending-`); preserve list becomes `ready, in-progress,
    complete, deferred, deleted, wont-fix`
  - new shell block right after Step 5, before the Step 6 report: for every
    kept todo (anchored globs, `debt_todo_name_ok`), read `category`,
    `affected_files`, `fingerprint`, `anchor_hash` from frontmatter; if
    missing, compute them with 1.5 from the current tree. For each surviving
    finding compute its fingerprint and line hashes, skip it on a unique
    exact or anchor match, and record it in `skipped_kept[]` (id, status,
    match type). Ties resurface.
  - Step 6 report: add `stats.skipped_kept` and a bullet listing them
  - new shell block before Step 7: next id = 1 + the highest leading
    number across **all** `todos/debt/*.md` (not only regex-valid names),
    parsed with `10#`; Step 7 numbers from there
  - Step 7 and the mapping table: write `fingerprint` and `anchor_hash` to
    frontmatter, and add `content_hash` handling or drop it from the README
    template so docs and code agree

<!-- deepen-plan: codebase -->
> **Codebase:** Collection must happen before Step 6, which writes the
> report (`audit-synthesizer.md:153-163`); the report has no schema, only the
> `stats` JSON at `:130-137`, so a `stats.skipped_kept` key fits. Unanchored
> globs like `*-deleted-*.md` match slug words, and the existing
> `rm -f todos/debt/*-pending-*.md` (`:144-147`) can delete a `ready` todo
> named `…-ready-high-fix-pending-queue.md`; see
> `docs/solutions/logic-errors/structured-filename-glob-counting-bugs.md`.
> `$((052))` style arithmetic fails on ids with 8 or 9 after a leading zero
> (`value too great for base`), so use `10#`. Step 7's `NNN` is prose only;
> `$id` is exported by the agent (`:209-217`), so the max-id computation
> needs its own shell block.
<!-- /deepen-plan -->

- [x] 2.4: `commands/debt/fix.md` State Transitions: one line on what happens
      to a running fix when its todo is closed as `wont-fix` (see the
      decision 9 annotation; verify the worktree behaviour first).
- [x] 2.5: `skills/debt-conventions/SKILL.md` "Invalid Status Values": add the
      `wont-fix` bullet (valid finding deliberately not fixed, optional
      `wont_fix_reason`, reopenable to `pending`, distinct from `deleted`
      = false positive); list `wont_fix` as invalid. Document the
      `fingerprint` and `anchor_hash` fields.
- [x] 2.6: `README.md`: triage Actions line, Workflow step 3, frontmatter
      example (`wont_fix_reason`, `fingerprint`, `anchor_hash`), State
      Machine block, the closing recipe, re-audit dedup behaviour, and a note
      that Linear issues are not closed automatically.
- [x] 2.7: `hooks/scripts/session-start.sh`: comment only, stating terminal
      statuses (including `wont-fix`) are excluded. No logic change.

### Phase 3: Tests

- [ ] 3.1: `tests/validate.bats`: one test per new edge (including
      `wont_fix→wont-fix`); rejects for `wont-fix→{ready,in-progress,
      deferred,complete,deleted,wont-fix}`, `{complete,deleted}→wont-fix`,
      and `pending→wont_fix`.
- [ ] 3.2: `tests/security.bats` (`require_kislyuk_yq`):
  - `→wont-fix` with reason: filename `001-wont-fix-high-…`, frontmatter
    `status`, `wont_fix_reason` round-trips via `yq -r`
  - reopen `wont-fix→pending` with a hyphenated slug and hash: name
    restored exactly and passes `debt_todo_name_ok`; no reason field left
  - `deferred→wont-fix` drops `deferred_reason`; `wont-fix→pending` drops
    `wont_fix_reason`
  - 300-char reason truncated to 200 codepoints, including a multibyte
    character at position 200 under `LC_ALL=C`; reason with newlines; reason
    made only of newlines writes no field
  - hostile reasons (`$(touch pwned)`, backticks, `a: b # c`, `---`) with
    `no_pwned`
  - legacy file `052-pending-…` with frontmatter `wont_fix` →
    `052-wont-fix-…`, status `wont-fix`, existing `wont_fix_reason` kept
  - collision: existing `001-pending-…` blocks `001-wont-fix→pending`,
    non-zero exit, source intact, no lock left
  - after closing an in-progress todo, `debt_resolve_todo <id> in-progress`
    exits 1
  - zsh noclobber end-to-end runs of triage blocks 5 and 6 via
    `extract_wrapper`, modelled on lines 316-329
  - `debt_fingerprint`: unchanged after inserting lines above the range and
    after re-indenting; changed after editing the flagged code; refuses
    `../` and symlinked paths; anchor fallback matches a range shifted by a
    few lines; two equal-anchor candidates count as a tie

<!-- deepen-plan: codebase -->
> **Codebase:** `make_todo ID STATUS FILENAME` (`tests/security.bats:41-44`)
> writes `status` verbatim, so `wont_fix` works, but it cannot add
> `wont_fix_reason`, `deferred_reason`, `linear_issue_id`, `fingerprint` or
> `affected_files`. Give it an optional extra-frontmatter argument or write
> those fixtures with `printf`. Only one fixture uses a real 8-hex hash
> (`0a1b2c3d`, line 139).
<!-- /deepen-plan -->

- [ ] 3.3: new `tests/status-parity.bats`:
  - extract the canonical list from `DEBT_TODO_NAME_RE` via `BASH_REMATCH`;
    assert ≥7 entries including `pending` and `wont-fix`
  - set equality with the `status.md` init loop and valid case arm
  - each status present as a JSON key (`-` → `_`) in `status.md`
  - each status as a backticked bullet in SKILL.md, a token in the README
    State Machine block, and in the synthesizer preserve list (`pending`
    excepted)
  - each status appears in at least one `validate_transition` pair
  - `session-start.sh`'s group is exactly `pending|ready`
  - collect every miss before failing; use `run grep -F --` and assert
    `$status`, never a mid-test `! grep`; no Bats variable named `status`
  - one control test: a copy of `status.md` with `wont-fix` stripped is
    reported as a miss

<!-- deepen-plan: codebase -->
> **Codebase:** `status.md` has four `case` statements, so anchor extraction
> on the `pending|ready|…)` arm (line 99), not on "the first case". The
> session-start group is the anchored `(pending|ready)` regex near line 41.
> README State Machine is `README.md:194-199`, SKILL.md "Invalid Status
> Values" is `:286-299`. The README and `status.md` samples list statuses in
> different orders and some omit `deleted`, so compare set membership, never
> order.
<!-- /deepen-plan -->

- [ ] 3.4: Run `bats tests/` from `plugins/yellow-debt` (or
      `pnpm dlx bats@1.11.0 tests/`).

### Phase 4: Release hygiene

- [ ] 4.1: `plugins/yellow-debt/CLAUDE.md`: Testing section names the new
      parity test; note the fingerprint dedup.
- [ ] 4.2: `pnpm changeset` → `'yellow-debt': minor`.
- [ ] 4.3: Run `pnpm validate:agents`, `pnpm lint:plugins`,
      `pnpm validate:shell-compat`, `pnpm check:shell-parse`,
      `pnpm validate:schemas`, `pnpm test:shell-compat`.
- [ ] 4.4: `.github/workflows/validate-schemas.yml`: add a required step or
      job that installs kislyuk `yq` 3.4.3 (as the shell-compat job does)
      and runs `bats tests/` in `plugins/yellow-debt`; add yellow-debt to
      the advisory loop's skip list; if it is a new job, add it to
      `ci-status` needs. Fix any existing yellow-debt test that fails once
      the `yq`-gated tests stop skipping.

<!-- deepen-plan: codebase -->
> **Codebase:** Today nothing in CI enforces these tests. `plugin-shell-tests`
> (`validate-schemas.yml:1449-1466`) installs bats, gawk and zsh but no
> kislyuk `yq`, so the runner's mikefarah `yq` makes `require_kislyuk_yq`
> (`security.bats:26-29`) skip every transition test, and the loop at
> `:1507-1532` is `continue-on-error: true` (its skip list at `:1520`
> excludes core, council, review, codex and ruvector, not debt). The job
> that does install `yq` 3.4.3 (`:1580-1590`) only runs
> `tests/shell-compat/`. Locally `yq` is kislyuk 3.1.0 and the suite passed
> through at least test 74.
<!-- /deepen-plan -->

## Technical Details

Files to modify, all under `plugins/yellow-debt/` unless noted:
`lib/validate.sh`, `commands/debt/status.md`, `commands/debt/triage.md`,
`commands/debt/fix.md`, `agents/synthesis/audit-synthesizer.md`,
`skills/debt-conventions/SKILL.md`, `README.md`, `CLAUDE.md`,
`hooks/scripts/session-start.sh` (comment), `tests/validate.bats`,
`tests/security.bats`, and the repo-level
`.github/workflows/validate-schemas.yml`.

New files: `plugins/yellow-debt/tests/status-parity.bats`, `.changeset/*.md`.

No manifest or catalog changes: yellow-debt has no Codex/Cursor skill copies,
and component counts are unchanged.

## Acceptance Criteria

1. `validate_transition` accepts exactly the six new edges and rejects the
   cases in 3.1.
2. After every transition, filename status equals frontmatter status and the
   name passes `debt_todo_name_ok`; `pending→wont-fix→pending` restores the
   original name.
3. `wont_fix_reason` is ≤200 codepoints, valid UTF-8, newline-free, and
   present only on `wont-fix` todos.
4. `/debt:status` and `/debt:status --json` succeed with zero and with some
   `wont-fix` todos; JSON has `by_status.wont_fix`.
5. A todo with frontmatter `wont_fix`/`wontfix`/`wont fix` yields a warning
   naming `wont-fix` and the repair recipe; running the recipe on a
   `-pending-` legacy file repairs both name and frontmatter.
6. Triage won't-fix works with a reason, a blank reason, and Cancel, under
   zsh with `noclobber`.
7. A re-audit does not recreate a todo for a finding that matches any kept
   todo by fingerprint or unique anchor, including after lines are inserted
   above it; ties resurface; new ids never collide with existing files.
8. `status-parity.bats` fails when `wont-fix` is removed from any site.
9. All Phase 4 validators and `bats tests/` pass.
10. A failing yellow-debt Bats test blocks the PR in CI.

## Edge Cases

- Legacy file whose **filename** contains `wont_fix`: regex-invisible; the
  hint says to rename it to the `-pending-` form first.
- Flagged code edited, or the file renamed: the fingerprint changes and the
  finding resurfaces. By design: resurfacing is the safe failure.
- Kept todos created before this change have no `fingerprint`; the
  synthesizer computes one from their `affected_files` on the current tree.
  If their lines already moved, they resurface once and get stamped then.
- Short anchors (`}`, `fi`, `return nil`) can match several kept todos; a
  tie never suppresses.
- `affected_files` paths come from scanner output and are untrusted:
  `debt_fingerprint` refuses anything `validate_file_path` rejects.
- Reopened `wont-fix → pending` todos are deleted by the next audit's pending
  wipe, the same as other pending todos.
- Wrongly rejected (`deleted`) findings cannot become `wont-fix`; out of
  scope.
- Status value from frontmatter is untrusted: print it only via
  `printf '%s'`, never in an unquoted heredoc.

## Out of Scope

- `/debt:close` command, helper alias for `wont_fix` as a target,
  centralizing the status list.
- triage.md's "will be removed" wording for `deleted` (only the new won't-fix
  text must say "kept"), and its "deferred re-evaluated in next audit" line.
- Auto-closing Linear issues; a repair helper for files with `wont_fix` in
  the filename; rename-aware fingerprint matching (`git diff -M`).

## References

- `plugins/yellow-debt/lib/validate.sh:27`, `:202-302`
- `plugins/yellow-debt/commands/debt/triage.md:113-253`
- `plugins/yellow-debt/commands/debt/status.md:59-227`
- `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md:130-225`
- `plugins/yellow-debt/tests/security.bats:26-44`, `:124-209`, `:301-329`
- `.github/workflows/validate-schemas.yml:1449-1590`
- `docs/solutions/code-quality/validator-invariant-parity-check.md`
- `docs/solutions/logic-errors/classification-tier-mutual-exclusivity.md`
- `docs/solutions/logic-errors/structured-filename-glob-counting-bugs.md`

<!-- deepen-plan: external -->
> **Research:** Fingerprinting and truncation sources:
> - Semgrep `rule_match.py` (`syntactic_id`, `match_based_id`, index
>   counter): https://raw.githubusercontent.com/semgrep/semgrep/develop/cli/src/semgrep/rule_match.py
> - GitHub codeql-action `fingerprints.ts` (`primaryLocationLineHash`):
>   https://raw.githubusercontent.com/github/codeql-action/main/src/fingerprints.ts
> - GitHub SARIF support for code scanning:
>   https://docs.github.com/en/enterprise-cloud@latest/code-security/reference/code-scanning/sarif-files/sarif-support
> - SonarQube issue matching order:
>   https://docs.sonarsource.com/sonarqube-server/2025.4/user-guide/issues/solution-overview
> - GNU coreutils `cut` (`-c` same as `-b`):
>   https://www.gnu.org/software/coreutils/manual/html_node/cut-invocation.html
> - jq manual (string slices and `length` in codepoints):
>   https://jqlang.org/manual
<!-- /deepen-plan -->
