# Feature: Context observer review follow-ups

## Problem Statement

PR #912 (yellow-core opt-in context observer, merged as `611671fb`) left 52
review findings in its ledger. Each was re-verified against `611671fb`: 15
are still real, the rest are fixed or not worth changing (see "Out of
scope"). They are one small code bug, missing tests for documented error
paths and invariants, and documentation that misstates what the code does.
Stale docs here are costly: the solution doc and `security.md` are what the
next author and reviewer trust.

## Current State

- `lib/statusline-settings.py:193` (`load_settings`) backs up a corrupt
  `settings.json` with `numbered_backup(os.path.realpath(path), ...)`, while
  `backup_settings` (392-396) uses the link path. For a symlinked
  `settings.json` the two kinds of backup land in different directories.
  `shutil.copy2` follows the link either way, so content is unaffected.
- `settings_unreadable` (raised at 184) and `io_error` (emitted at 660) are in
  `ERROR_CODES` and the setup.md error table but no test triggers them.
- `unchanged()` (`context-observer.py:256-264`) rewrites a future-dated
  record (`0 <= age`), untested. `REWRITE_AFTER_SECONDS = 60`
  (`context-observer.py:69`) must stay below `CO_STALE_AFTER=300`
  (`context-observer.sh:48`) or unchanged sessions read as stale; nothing
  asserts it.
- `tests/context-observer.bats` 102-131 passes a dead second `"$top"`
  argument to `co_read_observation`, which takes only the session id.
- Docs that disagree with the code are listed per task below. The pending,
  unreleased `.changeset/yellow-core-context-observer.md` (minor) repeats two
  of the errors.

## Proposed Solution

One PR on `agent/fix/context-observer-review-followups` (worktree
`worktrees/yellow-plugins/agent-fix-context-observer-review-followups`, off
`origin/main`). One code line, new bats cases that reuse the existing helpers
(`seed_settings`, `setup_py`, `observe`, `record_for`, `set_observed_at`,
`iso_ago`) and naming (`T09`/`T10`/`T11`/`R19`/`R20`/`R22`, `parity:`), and doc
corrections. Each wording fix is applied everywhere the claim is restated,
found by grep, not only at the cited line. Correct the pending #912 changeset
in place and add a patch changeset for the new behaviour change only.
<!-- deepen-plan: codebase -->
> **Codebase:** Cited locations are confirmed: `statusline-settings.py:193` (corrupt backup), `:184`
> (`settings_unreadable`), `:392-396` (`backup_settings`), `:660` (`io_error`); `context-observer.py:69`,
> `:256-264`; `context-observer.sh:48`; `CLAUDE.md:295`; bats R22 title at `:329`. The `statusline`
> subcommand (not `install`) recovers invalid JSON (`run_statusline` `:455-468`, action `recovered`,
> `.backup` = corrupt-backup path); the existing test at bats `:686` already asserts
> `.backup == "$SETTINGS.corrupt.backup"` for a non-symlink.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Code

- [x] 1.1: `lib/statusline-settings.py` `load_settings`: back up the corrupt
  file with `numbered_backup(path, CORRUPT_SUFFIX, raw)` (the link path),
  matching `backup_settings`.

### Phase 2: Tests (`plugins/yellow-core/tests/context-observer.bats`)

- [x] 2.1: `T11:` a symlinked invalid `settings.json` recovered by
  `statusline` reports `.backup == "$SETTINGS.corrupt.backup"`; that file
  exists next to the link, holds the raw invalid content, and no
  `*.corrupt.backup` appears in the link target's directory. Model on the
  symlink tests near 446 and 1190 and the recovery test near 686.
- [x] 2.2: `T11:` `status` on a `chmod 000` settings file exits 1 with
  `error_code == "settings_unreadable"`. Skip as root with the file's idiom
  (`[ "$(id -u)" -ne 0 ] || skip "root ignores file modes"`); restore the mode
  before asserting.
- [x] 2.3: `T11:` `install` whose `--observer-dest` directory is `chmod 500`
  (separate from the settings directory) exits 1 with `error_code ==
  "io_error"`; the settings backup exists, `statusLine.command` is unchanged,
  and neither the observer copy nor an `.observer.*` temp file exists. Skip as
  root ("root ignores directory modes"); restore the mode before asserting.
<!-- deepen-plan: codebase -->
> **Codebase:** `run_install` (`statusline-settings.py:497-513`) runs `backup_settings` (`:510`), then
> `install_observer` (`:511`, `publish_atomically(..., prefix=".observer.")`), then the settings write.
> `makedirs(exist_ok=True)` passes on the existing chmod-500 dir and `tempfile.mkstemp` raises
> `PermissionError`, which `main()` turns into `io_error` (`:659-661`). No temp file is created
> (`mkstemp` itself failed); assert on `"$dir"/.observer.*` anyway. `setup_py install` forwards `"$@"`
> and argparse keeps the last value, so appending `--observer-dest "$dir/yellow-context-observer.py"`
> overrides the helper's default. Action on a fresh seed is `installed`, not `already-installed`.
<!-- /deepen-plan -->
- [x] 2.4: `T09:` an unchanged sample over a future-dated record is rewritten:
  `observe steady 61`, `set_observed_at "$(record_for steady)" "$(iso_ago
  -600)"`, `observe steady 61`, then assert `observed_at` is no longer the
  future value and is within a few seconds of now.
- [x] 2.5: `parity:` `REWRITE_AFTER_SECONDS` is below `CO_STALE_AFTER`. Read
  the Python value with `sed -nE 's/^REWRITE_AFTER_SECONDS *= *([0-9]+).*/\1/p'`
  and use the sourced `$CO_STALE_AFTER`; fail if either is empty.
<!-- deepen-plan: codebase -->
> **Codebase:** `setup()` sources `context-observer.sh` (bats ~29), so `$CO_STALE_AFTER` (300, not
> `readonly`) is in scope. The sed pattern matches `REWRITE_AFTER_SECONDS = 60` at column 0. The
> existing `parity:` test (~937) reads Python constants via `importlib`; either approach works.
<!-- /deepen-plan -->
- [x] 2.6: Drop the dead `"$top"` argument at ~116 and ~129 and the now-unused
  `top` locals and `top=$(jq …)` assignments (~103/105, ~122/125).
<!-- deepen-plan: codebase -->
> **Codebase:** Dead args at bats `:116` and `:129`; `top=` at `:105` and `:125`; the `local ... top ...`
> declarations sit on the lines just above (~103, ~122).
<!-- /deepen-plan -->

### Phase 3: Documentation

Before each edit, grep the repo for the claim so every restatement changes
together (`rg -n '<phrase>' plugins/yellow-core docs .changeset`).

- [x] 3.1: `status --yes`. `--yes` applies only to `enable|disable`
  (`setup.md:37`). Fix `references/statusline-setup/context-observer.md`
  (~84: `observer enable|disable --yes` or `observer status`), `setup.md`
  frontmatter `description` (3) and `argument-hint` (4), the usage line (~38),
  the fail-open doc (~62) and the pending changeset.
<!-- deepen-plan: codebase -->
> **Codebase:** Literal `status --yes` appears only in `.changeset/yellow-core-context-observer.md:9` and
> `references/statusline-setup/context-observer.md:84`. `setup.md:3`, `:4` and `:38` use the bracket
> form `enable|disable|status [--yes]`, which reads as allowing `status --yes`; rewrite those to
> separate `observer [enable|disable] [--yes]` and `observer status` forms. Drop the "fail-open doc
> (~62)" item: that doc never mentions `--yes`.
<!-- /deepen-plan -->
- [x] 3.2: Render vs complete. `exec` lets the next stage see EOF and render
  while the observer records, but the statusLine command completes only when
  the observer exits (≤ 2 s deadline). Reword wherever the doc says the
  statusline renders "without waiting": `docs/security.md` (~348-350), the
  reference (~45-49), `context-observer.py` docstring (~17), the
  `observer_stage` comment in `statusline-settings.py` (~130-134), the
  fail-open doc (~20-27) and the pending changeset.
<!-- deepen-plan: external -->
> **Research:** The proposed wording is still wrong. Claude Code shows the statusline only when the
> whole `statusLine` command completes (blank on non-zero exit; "slow scripts block the status line from
> updating until they complete"; 300 ms debounce; a new update cancels an in-flight run), and bash waits
> for every pipeline member before exiting. So `exec` lets the next stage read EOF and compute its
> output early, but nothing is displayed until the observer exits (≤ 2 s). Use: "the observer hands the
> payload on and releases stdout, so the statusline script computes its output immediately; Claude Code
> shows it once the whole command exits, which waits for the observer's record write (capped at 2 s); a
> new statusline update in that window cancels the run." Re-check the quoted doc text against the live
> page before citing it.
> See: https://code.claude.com/docs/en/statusline ; https://www.gnu.org/software/bash/manual/html_node/Pipelines.html ;
> POSIX XCU 2.9.2 https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html
<!-- /deepen-plan -->
<!-- deepen-plan: codebase -->
> **Codebase:** Corrected site list. Phrase `without waiting`: `context-observer.py:17` (its docstring at
> 17-21 already notes the shell waits for the observer to exit) and `docs/security.md:349`. Differently
> worded: `statusline-settings.py:226-234` (the `observer_stage` comment; not ~130-134, which is the
> `OBSERVER_FORMS` regex), `references/statusline-setup/context-observer.md:47-48`,
> `docs/solutions/code-quality/fail-open-observer-stage-patterns.md:28` and `:109`, and
> `.changeset/yellow-core-context-observer.md:21` ("instead of waiting for the record write").
<!-- /deepen-plan -->
- [x] 3.3: `docs/security.md` "No side channels" (~345-347): the observer
  prints nothing to stdout beyond the pass-through; it writes one stderr line
  only when `CONTEXT_OBSERVER_DEBUG=1`, and usage text on `--help` or a
  terminal stdin.
<!-- deepen-plan: codebase -->
> **Codebase:** `main()` handles `--help`/TTY via `wants_help` (`context-observer.py:414`); `DeadlineReached`
> is at `:405`. The `CONTEXT_OBSERVER_DEBUG` stderr line is covered by the R19 bats test (~1159).
<!-- /deepen-plan -->
- [x] 3.4: Budget framing: a 2 s hard recording deadline
  (`DEADLINE_SECONDS`) and a 100 ms latency target checked by R22 (250 ms
  limit, 1000 ms on CI). Apply to `plugins/yellow-core/CLAUDE.md:295`, and keep
  `security.md` and the R22 test title consistent with it.
- [x] 3.5: `docs/solutions/code-quality/fail-open-observer-stage-patterns.md`:
  `Deadline` → `DeadlineReached` in guidance item 2 and the example (~40-43,
  ~85-89); replace the `UNREADABLE` sentinel (~44-47) with the actual
  mechanism (`load_previous` raises `OSError` for an unreadable record so the
  caller keeps the old one, and returns `None` only for absent or malformed);
  delete the primary-slug bullet (~57-58) and fix the ~135 restatement to "the
  reader takes the newest record across all projects".
- [x] 3.6: `setup.md`: delete the tool-call count (~47-48) and keep the
  batching guidance; at ~355 say `installed` changed only `statusLine.command`
  in settings.json and also wrote the observer copy to
  `$CONFIG/yellow-context-observer.py`; at ~366-367 say a non-interactive
  caller stops and reports `statusline_missing` because the base install is
  interactive. Mirror the last point in the reference's error table (~28-30).

### Phase 4: Release and verification

- [x] 4.1: Add `.changeset/yellow-core-context-observer-followups.md`
  (`"yellow-core": patch`) covering only the corrupt-backup location change
  (it now sits next to a symlinked `settings.json`, like the pre-observer
  backup) and the doc corrections. The pending #912 changeset is corrected in
  3.1 and 3.2, not duplicated.
- [x] 4.2: `cd plugins/yellow-core && bats tests/ && bats
  skills/git-worktree/tests/`; remove `lib/__pycache__` afterwards.
- [x] 4.3: `pnpm validate:schemas && pnpm validate:agents && pnpm lint:plugins`.
- [x] 4.4: Run `rg` for `status --yes`, `without waiting`, `class Deadline(`,
  `UNREADABLE`, `primary-slug`, `100 ms budget` and `five tool calls` to
  confirm no stale restatement remains outside `plans/complete/` and
  `CHANGELOG.md`.
<!-- deepen-plan: codebase -->
> **Codebase:** Widen the grep: `status --yes` misses the bracket form (add `rg -n 'status\]? ?\[?--yes'`),
> and `without waiting` misses the other phrasings (add
> `rg -n 'instead of waiting|wait for the record|waits for recording|renders as soon'`). `UNREADABLE`
> also matches unrelated identifiers in `lib/stack-provider-state.js:131` and `knowledge-compounder.md`;
> only the fail-open doc hit matters. "100 ms budget" also matches the R22 test title, which 3.4 updates.
<!-- /deepen-plan -->

## Technical Details

- Files to modify: `plugins/yellow-core/lib/statusline-settings.py`,
  `plugins/yellow-core/lib/context-observer.py` (docstring only),
  `plugins/yellow-core/tests/context-observer.bats`,
  `plugins/yellow-core/commands/statusline/setup.md`,
  `plugins/yellow-core/references/statusline-setup/context-observer.md`,
  `plugins/yellow-core/CLAUDE.md`, `docs/security.md`,
  `docs/solutions/code-quality/fail-open-observer-stage-patterns.md`,
  `.changeset/yellow-core-context-observer.md`.
- New file: `.changeset/yellow-core-context-observer-followups.md`.
- No dependencies, manifests or catalog changes.

## Acceptance Criteria

- The corrupt backup of a symlinked `settings.json` lands next to the link
  (test 2.1), and existing recovery tests (~686-714, ~844) still pass.
- `settings_unreadable` and `io_error` are each produced by a test, with the
  io_error test proving install leaves settings unchanged and no observer
  copy.
- The future-dated rewrite and the cross-language constant invariant are
  asserted; the invariant test fails if either constant is renamed.
- The 4.4 grep finds no stale restatement; yellow-core bats, the nested
  git-worktree suite and the three validators pass.

## Edge Cases

- Tests that chmod run as root in CI containers: they skip, as the existing
  mode tests do.
- A symlinked `settings.json` whose link directory is unwritable now fails the
  corrupt backup there instead of in the target directory, the same as the
  pre-observer backup; noted in the changeset.
- Known limitation, not tested: when `settings.json` is a symlink into a
  read-only directory, `install` writes the `.pre-observer.backup` next to the
  link and copies the observer, then the settings write fails with `io_error`,
  leaving the copy without a composed stage. `status` reports it as not
  enabled and a later `install` completes it once the target is writable. (A
  missing `settings.json` cannot reach this state: `install` refuses it with
  `statusline_missing` before copying anything.)
<!-- deepen-plan: external -->
> **Research:** A 2 s observer run holds the whole statusline update, and Claude Code cancels an in-flight
> run when the next update fires, discarding output already computed. Normal observer runs are ~20 ms,
> so this only matters when recording stalls; worth one sentence in `docs/security.md` next to the
> deadline.
<!-- /deepen-plan -->

## Out of scope (verified against 611671fb)

37 findings were re-checked and dropped: already fixed on main (literal `$`
paths, `!` negation, `observer_src_missing` test, relative paths), conflicting
with documented design (the fail-open observer, the eight-key result contract,
the plain manual-merge stage form, script backups done by setup.md), or style
and defence-in-depth points not worth churn. The `statusline` subcommand's
missing script-exists check and the `handoff.sh context` Usage step were
reported as P2 but are not real: setup always writes the script first, and
SKILL.md already documents the call.

## References

<!-- deepen-plan: external -->
> **Research:** Claude Code statusline docs (completion-gated rendering, 300 ms debounce, in-flight
> cancellation): https://code.claude.com/docs/en/statusline . Bash pipelines wait for all members:
> https://www.gnu.org/software/bash/manual/html_node/Pipelines.html . `shutil.copy2`/`copyfile` follow
> symlinks by default, so a backup next to the link holds the target's real content.
<!-- /deepen-plan -->

- PR #912 and its fix commits on main (`611671fb`).
- `docs/solutions/code-quality/doc-fix-mechanical-verification-gap.md` (grep
  every restatement when fixing a doc claim).
- `docs/solutions/code-quality/agent-cli-bash-hardening-patterns.md` (use
  `run --separate-stderr` for the new CLI tests).
- Existing root-skip idiom: `tests/context-observer.bats` ~747 and ~1101.
