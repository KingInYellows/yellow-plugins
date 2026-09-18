# Feature: Opt-In Context Observer

## Overview

The statusline payload is the only documented surface on Claude Code 2.1.27x
that carries context-window numbers, and the generated statusline renders and
discards it. This work adds a pass-through observer that records a
session-bound observation to an untracked per-project file, a reader that
treats missing, stale, malformed, or cross-session data as `unknown`, a
provisional 50 % advisory watermark that produces one advisory marker per
crossing and nothing else, and an explicit opt-in step in `/statusline:setup`
that composes the observer ahead of the user's statusline without rewriting
their script. Installing the plugin changes nothing; headless sessions are
reported unsupported.

## Origin
- Spec: `plans/specs/session-continuity-foundation.md`
- Covers: R2 (partial: observer-and-setup-scripts), R18, R19, R20, R21, R22,
  R23 (partial: observer-files), R25 (partial: context-observer-suite), R26
  (partial: shell-two-gates)
- Shell: session-continuity-foundation-02-context-observer

## Pattern Survey

- **Shell 01 delivered the seams this shell consumes.**
  `plugins/yellow-core/skills/session-handoff/scripts/handoff.sh` `ho_measure()`
  emits `context_at_capture: "unknown"` as a hard-coded literal (line 236); the
  front-matter writer (line 362, `tojson`) and the note parser (line 532,
  `if type == "object" then . else "unknown"`) already accept an object, and
  `cmd_preflight` copies `$live.context_at_capture` into the `context` field
  (line 663). `ho_measure` already holds the canonical `$toplevel` and
  `$source_session`, so the reader can be handed both and run no git.
  `ho_git` allowlists only read subcommands; nothing new may call git directly.
- **Slug derivation.** `lib/compound-staging.sh:38-46` `cs_derive_project_slug`
  = `git rev-parse --show-toplevel` (fallback: the raw cwd) then `tr '/' '-'`;
  `cs_staging_dir_for_slug` (52-58) joins `$HOME/.claude/projects/<slug>/…`.
  No Python reproduction exists (there are zero `.py` files in any plugin), so
  the observer is the first standalone Python in yellow-core. R22 forbids git
  in the observer, so it derives the slug from the payload's
  `workspace.project_dir` (fallback `cwd`) with the same `/`→`-` mapping; the
  bats suite proves equality with `cs_derive_project_slug` on a temp repo.
- **Atomic write.** Bash: `cs_atomic_jsonl_write` (`compound-staging.sh:92-106`,
  sibling `${path}.tmp.$$`, `umask 077`, `chmod 700` dir, `mv`). Python has no
  helper; the existing setup merge (`commands/statusline/setup.md` ≈470-505)
  uses `tmp -> json.load validate -> os.replace`. Kill-injection precedent:
  `HANDOFF_TEST_SLEEP_BEFORE_MV` read at `handoff.sh:367`, driven by
  `tests/handoff.bats:226-235` with `timeout -s KILL` (skips when `timeout`
  and `gtimeout` are both absent).
- **Lib sourcing.** Scripts source libs relative to `SCRIPT_DIR`
  (`handoff.sh:29-37`), never via `CLAUDE_PLUGIN_ROOT`; `ho_require_libs`
  (112-116) probes function symbols with `command -v` and exits 2 when one is
  missing. Libs carry a load guard (`_PLUGIN_IDENTITY_LOADED`), set no shell
  options, and use a per-file prefix (`cs_`, `pi_`); use `co_` here.
  `cs_iso_to_epoch` exists for staleness math.
- **Tests.** `tests/handoff.bats` `setup()` (19-33): skip without `jq`,
  prepend `tests/mocks` (`claude`, `curl`, `gh`, `gt` exit 97 and log to
  `MOCK_FORBIDDEN_LOG`), `teardown()` asserts the log is empty (R2),
  `bats_require_minimum_version 1.5.0`, `run --separate-stderr` everywhere,
  `FIX="$BATS_TEST_DIRNAME/fixtures/<feature>"`. HOME isolation template:
  `tests/compound-stop-hook.bats:8-9` (`export HOME="$(mktemp -d)"`). Real
  `python3` is available in CI and is used unmocked by `setup.md`; no python
  mock exists or is needed. CI job `plugin-shell-tests`
  (`.github/workflows/validate-schemas.yml:1404-1440`) runs
  `bats plugins/yellow-core/tests/` as a required step and installs bats
  1.11.0 via npm; a zero-`@test` file fails under bats-core itself, no repo
  lint involved. Real-host fixture precedent:
  `plugins/gt-workflow/tests/fixtures/hooks/check-git-push/real-host-envelope.stdin`
  + `.golden.txt`; fixture README precedent
  `plugins/yellow-review/tests/fixtures/thermonuclear/README.md`.
- **Setup command.** `commands/statusline/setup.md` (538 lines, Steps 1-6,
  `allowed-tools: [Bash, Read, Write, AskUserQuestion]`). All logic is inline
  prose plus embedded `python3 -c` blocks; nothing is extracted to a script and
  `plugins/yellow-core/scripts/` does not exist. Step 1 detects an existing
  `statusLine` and JSONC; Step 5 gates with AskUserQuestion (Replace / Back up
  existing and replace / Cancel), backs up the script as `<script>.backup`, and
  merges `statusLine` atomically. The generated script's `segment_context`
  (setup.md ≈208; identical in the installed `~/.claude/yellow-statusline.py`
  line 69) renders `ctx:--` when `used_percentage` is null: the T09 baseline.
- **Host facts.** The installed client is Claude Code 2.1.276 (spec text says
  2.1.274); fixtures are versioned by the client they are captured from. The
  user's `statusLine.command` is `python3 /home/<user>/.claude/yellow-statusline.py`.
- **Changeset and gates.** `.changeset/yellow-core-session-handoff-preflight.md`
  is the `'yellow-core': minor` template. Gates: `validate:schemas` (includes
  `sync-shell-snippets.js --check` and `validate-agent-authoring.js`),
  `validate:agents`, `lint:plugins`, `validate:plans`, `validate:generated`,
  `typecheck`, `lint`, `test:integration`, and the two bats trees. `pnpm
  test:unit` exercises none of this. No `docs/solutions/` entry covers
  statusline, Python hooks, or bats timing; the CRLF and `2>|` pitfalls from
  shell 01 still apply.

## Implementation

- [x] Step 1: Create `plugins/yellow-core/lib/context-observer.py`
  (`#!/usr/bin/env python3`, executable, LF, stdlib only, Python 3.7+
  compatible, no imports beyond `sys os json time datetime re tempfile`).
  `main()` reads all of stdin as bytes, writes the identical bytes to
  `sys.stdout.buffer` and flushes BEFORE any other work, then records inside a
  `try/except BaseException` that swallows everything; `sys.exit(0)` on every
  path including SIGPIPE-style `BrokenPipeError`. Header comment: exit 0
  always, no git, no network, no subprocess; a stderr line only when
  `CONTEXT_OBSERVER_DEBUG=1`.
- [x] Step 2: In `context-observer.py` implement `parse_payload(raw)` →
  `None` for malformed JSON or non-object; `sanitize_session_id(s)` accepting
  only `^[A-Za-z0-9_-]{1,128}$` (else `None` → write nothing);
  `project_slug(payload)` = `workspace.project_dir` else `cwd` else `None`,
  mapped with `.replace('/', '-')` (documented as equal to
  `cs_derive_project_slug` for a git toplevel); `record_path(slug, sid)` =
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<slug>/context-observations/<sid>.json`
  (return `None` when neither env var resolves). Build the record exactly as
  the spec's `observer_format: 1` object: `session_id`, `observed_at`
  (`datetime.now(timezone.utc)` as `YYYY-MM-DDTHH:MM:SSZ`), `cwd` (payload
  `cwd`, private state, never printed), `transcript_present`
  (`bool(payload.get("transcript_path"))`), `context_window` with
  `used_percentage`, `remaining_percentage`, `context_window_size` (each `None`
  when absent or not int/float), and `current_usage_null`
  (`payload.get("context_window", {}).get("current_usage") is None`).
- [x] Step 3: In `context-observer.py` implement the advisory state per R21:
  `watermark_remaining` from `YELLOW_CONTEXT_WATERMARK` (int 1-99, default 50,
  invalid → 50). Load the previous record for the same `session_id` (ignore
  unreadable or malformed); `prev_state = advisory.last_state` else `"unknown"`.
  Compute `state` = `"below"` when `remaining_percentage` is a number in 0-100
  and `< watermark`, `"above"` when a number in 0-100 and `>= watermark`, else
  `"unknown"`. `crossings` = previous `crossings` (default 0) + 1 only when
  `prev_state == "above"` and `state == "below"`; carry `crossings` unchanged
  otherwise, so ten identical below samples add one, and above → below adds a
  second. Persist `advisory: {watermark_remaining, crossings, last_state}`
  where `last_state` is `state` except that `"unknown"` leaves the previous
  non-unknown `last_state` in place (a null sample must not manufacture a
  crossing). No stdout, no stderr, no other side effect on a crossing.
- [x] Step 4: In `context-observer.py` implement `write_record(path, obj)`:
  `os.makedirs(dir, mode=0o700, exist_ok=True)` then `os.chmod(dir, 0o700)`
  best-effort; `tempfile.NamedTemporaryFile(dir=dir, prefix=".<sid>.", suffix=".tmp", delete=False)`
  with `os.fchmod(fd, 0o600)`; `json.dump` + `\n`, `flush`, `os.fsync`; honor
  `CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME` (float seconds, test only) right
  before `os.replace(tmp, path)`; on any exception unlink the temp file. Write
  nothing when `session_id`, slug, or `record_path` is `None`, or when the
  payload is malformed (R19).
- [ ] Step 5: Create `plugins/yellow-core/lib/context-observer.sh` (sourced
  lib, guard `_CONTEXT_OBSERVER_LOADED`, no shell options, prefix `co_`,
  `co_warn` → `[context-observer] Warning: …`). `co_observation_path <session_id> <toplevel_or_cwd>`
  prints `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(printf '%s' "$2" | tr '/' '-')/context-observations/$1.json`
  after validating the id against `^[A-Za-z0-9_-]{1,128}$`. `co_read_observation <session_id> <toplevel_or_cwd>`
  prints the literal `unknown` when: the id is `unknown` or invalid; the file
  is missing, unreadable, or not a JSON object (`jq -e 'type=="object"'`);
  `observer_format` is not 1; `session_id` differs from the argument;
  `observed_at` fails `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$`
  or `now - cs_iso_to_epoch(observed_at) > ${CO_STALENESS_SECONDS:-300}` (or
  is in the future by more than the window); `remaining_percentage` is null,
  non-numeric, or outside 0-100. Otherwise print one compact JSON object
  `{remaining_percentage, used_percentage, observed_at, advisory_crossings}`
  with `used_percentage` null-safe. Never emits 0 for an unknown value and
  runs no git. Reuse `cs_iso_to_epoch` from `compound-staging.sh` (callers
  source that first; `co_read_observation` checks `command -v cs_iso_to_epoch`
  and returns `unknown` with a warning otherwise).
- [ ] Step 6: Wire the reader into `handoff.sh`: source
  `${SCRIPT_DIR}/../../../lib/context-observer.sh` next to the other libs
  (line ≈37), add `co_read_observation` to the `ho_require_libs` symbol list,
  and in `ho_measure()` replace the literal `context_at_capture: "unknown"`
  with a `--argjson context_at_capture "$ctx"` value where
  `ctx=$(co_read_observation "$source_session" "$toplevel")`, coerced to the
  JSON string `"unknown"` when the reader printed `unknown` or anything that
  fails `jq -e 'type=="object"'`. Leave `cmd_preflight` untouched (it already
  forwards `$live.context_at_capture` as `context`) and keep the preflight
  status independent of context (R20: never compared, never a reason code).
  Add one sentence to `skills/session-handoff/SKILL.md` "What It Does" stating
  that `context_at_capture` comes from the opt-in observer and is `unknown`
  for headless (`claude -p`) sessions and whenever the observer is not
  enabled; keep the frontmatter single-line and the three headings (RULE 15,
  20).
- [ ] Step 7: Create `plugins/yellow-core/lib/context-observer-setup.py`
  (stdlib only, `argparse`, the T11 "setup logic extracted to a script").
  Subcommands: `plan --settings <path> --observer-dest <path> --statusline <path>`
  prints a JSON description `{existing_command, proposed_command, action}` and
  writes nothing; `install --settings <path> --observer-src <path> --observer-dest <path> --statusline <path>`
  copies the observer with `shutil.copy2` (mode 0o755), backs up an existing
  settings file to `<settings>.pre-observer.backup` (only when it exists and
  no backup already exists with identical content), and rewrites ONLY
  `statusLine.command` via the same tmp → validate → `os.replace` merge the
  setup command already uses. Composition rule: existing command absent or
  equal to `python3 <statusline>` (shlex-parsed, path-normalized) →
  `python3 <observer-dest> | python3 <statusline>`; any other non-empty
  command → `python3 <observer-dest> | <existing command>`; a command already
  containing `<observer-dest>` → no change, exit 0 with `action: "already-installed"`.
  Refuse JSONC (same regex as setup.md Step 1) and invalid JSON with exit 1 and
  no write. Never touch `autoCompactEnabled`, `autoCompactWindow`, `hooks`, or
  any other key (R2).
- [ ] Step 8: Edit `plugins/yellow-core/commands/statusline/setup.md`: after
  Step 5's install (and also reachable when the user kept a custom statusline
  or cancelled the replacement), add `### Step 5b: Context Observer (opt-in)`
  with an AskUserQuestion "Record context observations for session handoffs?
  (opt-in, off by default)" → options "No, leave my statusline alone"
  (default, first) / "Yes, compose the observer". On No: print nothing
  changed and continue to Step 6. On Yes: run
  `python3 "${CLAUDE_PLUGIN_ROOT}/lib/context-observer-setup.py" plan …`,
  show the proposed command, confirm once more, then run `install …` with
  `--observer-src "${CLAUDE_PLUGIN_ROOT}/lib/context-observer.py"`,
  `--observer-dest ~/.claude/yellow-context-observer.py`,
  `--statusline ~/.claude/yellow-statusline.py`. Add a short "Manual merge"
  subsection: copy `lib/context-observer.py` to
  `~/.claude/yellow-context-observer.py` and prefix the existing
  `statusLine.command` with `python3 ~/.claude/yellow-context-observer.py | `;
  state that headless `claude -p` sessions produce no payload and are
  `unsupported`; state that installing or updating yellow-core never changes
  `statusLine`. Extend Step 6's report with the observer state
  (`enabled` / `not enabled`). Keep `description:` single-line; keep
  `allowed-tools` unchanged.
- [ ] Step 9: Capture real-host statusline fixtures under
  `plugins/yellow-core/tests/fixtures/statusline/<client-version>/`
  (`startup-null.json`, `mid-session.json`, `post-compact-null.json`, plus
  `missing-session.json` and `malformed.json` derived from `mid-session.json`
  by deleting `session_id` and truncating the text) and a `README.md`
  recording client version (`claude --version`), capture date, capture
  method, and every sanitization applied (session id, transcript path, cwd,
  project dir, user name replaced with synthetic values; numbers kept). The
  capture must be run by the user, not the agent: ask them to temporarily
  set `statusLine.command` to
  `tee -a ~/.claude/statusline-capture.jsonl | python3 ~/.claude/yellow-statusline.py`
  in a session, trigger a compaction, restore the command, and hand over the
  file; never edit `~/.claude/settings.json` or run `claude` from this plan.
  If the user cannot capture, stop and report; do not fabricate payloads.
- [ ] Step 10: Create `plugins/yellow-core/tests/context-observer.bats`
  (`bats_require_minimum_version 1.5.0`; header explains it unit-tests
  `lib/context-observer.py`, `lib/context-observer.sh`, and
  `lib/context-observer-setup.py`). `setup()`: skip without `python3` or `jq`;
  prepend `tests/mocks` to `PATH`, export `MOCK_FORBIDDEN_LOG`; export
  `HOME="$(mktemp -d)"` and unset `CLAUDE_CONFIG_DIR`, `YELLOW_CONTEXT_WATERMARK`,
  `CO_STALENESS_SECONDS`, `CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME`; source
  `$BATS_TEST_DIRNAME/../lib/compound-staging.sh` and `context-observer.sh`;
  `FIX="$BATS_TEST_DIRNAME/fixtures/statusline/<client-version>"`;
  `OBS="$BATS_TEST_DIRNAME/../lib/context-observer.py"`. `teardown()` asserts
  the forbidden log is empty and removes the temp HOME. T09 tests: every
  fixture round-trips byte-for-byte (`cmp` stdout against the file) with exit
  0; `startup-null` and `post-compact-null` write a record with
  `current_usage_null: true` and the reader returns `unknown`; `mid-session`
  writes a record whose `context_window` numbers equal the payload's and the
  reader returns an object with the same `remaining_percentage`; a record
  with `observed_at` 600 s old → `unknown`, 60 s old → object,
  `CO_STALENESS_SECONDS=30` → `unknown`; `session_id` mismatch → `unknown`;
  `missing-session` and `malformed` write no file and still echo stdin;
  `remaining_percentage` 101, -1, `"61"`, null → `unknown`; the reader never
  prints `0` for any unknown case; a session id containing `../` writes
  nothing; slug from a temp git repo's `workspace.project_dir` equals
  `cs_derive_project_slug "$repo"`. T10 tests: ten identical below-watermark
  samples → `crossings == 1`; above, below, above, below → `2`; a null sample
  between two below samples keeps `crossings` at 1;
  `YELLOW_CONTEXT_WATERMARK=80` flips a 61 % sample to below; kill-injection
  (`CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME=5`, `timeout -s KILL 1`, skip
  without `timeout`/`gtimeout`) leaves the previous record byte-identical and
  no `*.tmp` sibling counted as a record; two concurrent invocations (`&` +
  `wait`) leave one valid JSON record; stdout is complete even when
  `CLAUDE_CONFIG_DIR` points at a read-only directory. Timing (R22): run the
  largest fixture five times measured with `python3 -c 'import time…'` or
  `date +%s%N`, assert the best run is under 100 ms and print the value. T11
  tests via `context-observer-setup.py`: `plan` writes nothing (settings and
  statusline byte-identical); `install` with no `statusLine` sets the composed
  command; with the yellow command → composed pipeline; with a custom command
  → `python3 <observer> | <custom>`, every other key byte-identical (compare
  `jq 'del(.statusLine)'`), backup file present and equal to the original,
  observer copied executable; second `install` → `already-installed` and no
  further change; JSONC settings → exit 1, untouched; `hooks`,
  `autoCompactEnabled` keys survive unchanged (R2). R2 for the whole file:
  the mocks log stays empty.
- [ ] Step 11: Extend `plugins/yellow-core/tests/handoff.bats` with two tests:
  `measure` after the observer wrote a fresh record for
  `CLAUDE_CODE_SESSION_ID` under the test HOME → `context_at_capture` is an
  object with `remaining_percentage`; with a stale or cross-session record →
  `"unknown"`; and `preflight` on a happy-path note reports `context` equal to
  the live reader result while `status` stays `ready` (never a reason code).
- [ ] Step 12: Add `.changeset/yellow-core-context-observer.md`
  (`'yellow-core': minor`): opt-in context observer, observation reader,
  `context_at_capture` wiring, `/statusline:setup` opt-in step and manual
  merge, statusline fixtures and `context-observer.bats`; note that README and
  CLAUDE.md inventories follow after PR #750 (R23).
- [ ] Step 13: Normalize line endings (`sed -i 's/\r$//'`) and `chmod +x`
  on the two `.py` files, run every command in Verification, and record the
  actual test counts, the measured observer time, the fixture client version,
  and `not-run` for the installed-host interruption smoke in the commit body
  and PR body result table (R25, R26).

## Verification

- `cd plugins/yellow-core && bats tests/context-observer.bats` -> expected:
  all pass, count printed (target ≥ 30), skips only for missing `timeout`.
- `cd plugins/yellow-core && bats tests/handoff.bats` -> expected: all pass
  including the two new context tests; existing count + 2.
- `cd plugins/yellow-core && bats tests/ && bats skills/git-worktree/tests/`
  -> expected: green; every other suite unchanged.
- `printf '%s' "$(cat tests/fixtures/statusline/*/mid-session.json)" | python3 lib/context-observer.py | cmp - tests/fixtures/statusline/*/mid-session.json`
  -> expected: no output, exit 0 (byte-for-byte pass-through).
- Timing line printed by the bats timing test -> expected: best of five under
  100 ms; record the number in the PR body.
- `pnpm validate:agents && pnpm lint:plugins` -> expected: no new warnings
  for `commands/statusline/setup.md` or `skills/session-handoff/SKILL.md`.
- `pnpm validate:schemas && pnpm validate:generated && pnpm validate:plans`
  -> expected: pass; `git diff --stat -- catalog plugins/yellow-core/.claude-plugin`
  empty (no catalog or manifest change).
- `pnpm typecheck && pnpm lint && pnpm test:integration` -> expected: pass
  (baseline only; none of it exercises this work).
- `git diff --name-only main` -> expected: only paths under
  `plugins/yellow-core/lib/`, `plugins/yellow-core/skills/session-handoff/`,
  `plugins/yellow-core/tests/`, `plugins/yellow-core/commands/statusline/setup.md`,
  `.changeset/`, and this plan (R23).
- Manual smoke in this worktree with `HOME=$(mktemp -d)`: pipe a fixture
  through the observer, then `handoff.sh measure` with the fixture's
  `session_id` exported as `CLAUDE_CODE_SESSION_ID` -> expected:
  `context_at_capture` object; `git status` unchanged.
- Not run: installed-host smoke of the composed pipeline inside a live
  Claude Code statusline (interruption and debounce behavior is
  undocumented); reported as `not-run`. The user's `~/.claude/settings.json`
  is never modified by this work.

## Context Files
- `plugins/yellow-core/skills/session-handoff/scripts/handoff.sh` — `ho_measure` (context stub at line 236), `ho_require_libs`, lib sourcing, `cmd_preflight` `context` field
- `plugins/yellow-core/lib/compound-staging.sh` — `cs_derive_project_slug`, `cs_staging_dir_for_slug`, `cs_atomic_jsonl_write`, `cs_iso_to_epoch`
- `plugins/yellow-core/lib/plugin-identity.sh` — sourced-lib shape: load guard, prefix, `CLAUDE_CONFIG_DIR` default, test overrides
- `plugins/yellow-core/commands/statusline/setup.md` — Steps 1, 4, 5, 6; JSONC check; settings atomic merge; generated `segment_context` null handling (T09 baseline)
- `plugins/yellow-core/tests/handoff.bats` — `setup()`/`teardown()` mocks contract, `--separate-stderr`, kill-injection test (226-235), timing guard (492-496)
- `plugins/yellow-core/tests/compound-stop-hook.bats` — HOME isolation template
- `plugins/yellow-core/tests/mocks/` — forbidden-command shims (R2)
- `plugins/gt-workflow/tests/fixtures/hooks/check-git-push/real-host-envelope.stdin` — real-host fixture precedent
- `plugins/yellow-review/tests/fixtures/thermonuclear/README.md` — fixture README precedent
- `.changeset/yellow-core-session-handoff-preflight.md` — changeset template
- `.github/workflows/validate-schemas.yml` (1404-1440) — `plugin-shell-tests` job
- `plans/specs/session-continuity-foundation.md` — R18–R22, observation record, statusline composition, test design
- `docs/testing/session-continuity-acceptance.md` — T09–T11 and the gate-report fields
- `docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md`, `docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md` — `2>|` and CRLF pitfalls
