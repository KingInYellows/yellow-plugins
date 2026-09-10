# Feature: Multi-Body Redaction-Awk Extractor and council.md Sync

Source brainstorm: `docs/brainstorms/2026-09-09-council-multi-body-redaction-awk-extract-brainstorm.md`
Detail level: COMPREHENSIVE (security-relevant content change plus a test-harness contract rewrite)
Base branch: `agent/feat/council-roster-drift-gate` (carries `13c99c56`, the roster drift gate). Both PRs below stack on it via Graphite.

## Overview

`plugins/yellow-council/commands/council/council.md` ships two copies of the
credential-redaction awk program that strips keys from reviewer output before
`/council` commits `docs/council/<report>.md`. Both copies are 189 lines and
roughly 101 lines behind the 290-line canonical in
`plugins/yellow-council/skills/council-patterns/SKILL.md`: they run the
single-pass `strip_deco()` that commit `766268d1` (#703) already showed leaks,
and they lack the `pem_release` / `pem_was_in` stray-window fix. The fix never
reached council.md because `tests/lib/extract-redaction-awk.bash` cannot see
it: its `case` returns one body per file and only matches a bare `^awk '$`
opener, so council.md sits in `redaction_known_untested` in
`scripts/council-roster.json`.

Two stacked PRs close this:

1. **PR 1, content sync.** Replace both council.md bodies with the canonical
   program, re-indented. Independent, reviewable as a security fix.
2. **PR 2, extractor + identity gate.** Rewrite the extractor to return every
   body a file carries by content anchoring, add a fatal `setup_file()`
   identity gate to `redaction.bats`, list council.md in `REDACTION_SOURCES`,
   and delete the `redaction_known_untested` entry. Lands green only because
   PR 1 landed first. No interim CI allowance.

## Problem Statement

### Current pain points

- A hardening fix applied to the three tested carriers silently skipped the
  fourth. The extractor's `REDACTION_SOURCES` list is the universe every fix
  pass sees, and council.md is not in it.
- The extractor's one-string-per-file contract cannot represent council.md's
  two bodies, so adding it to the list is impossible without a rewrite.
- The behavioral suite tests `REDACTION_SOURCES[0]` (gemini-reviewer.md), not
  SKILL.md, and only matches SKILL.md by coincidence today.

### User impact

`/council` users on the shipped plugin get weaker redaction on the claude leg
(Step 4) and on the report-build pass (Step 7) than on the gemini and
opencode legs. Leaked material lands in a committed file.

## Verified facts (checked during planning, 2026-09-09)

| Fact | Evidence |
| --- | --- |
| council.md bodies (pre-sync locations; PR 1 moves them to 379-668 and 1313-1602): Step 4 lines 377-565 at 4-space indent, closer `  '` at 566; Step 7 lines 1208-1396 at 6-space indent, closer `      ' "$fenced_path")` at 1397 | prototype walker, all three awks |
| Both council.md bodies are identical to each other after dedent | `cmp` |
| Canonical body: SKILL.md lines 150-439, 290 lines, no single quotes, no backslash-newline, no blank lines | grep |
| gemini/opencode bodies equal SKILL.md after extraction | existing drift test |
| A content-anchored walker over the three delimiter shapes finds 1/1/1/2 bodies under mawk, gawk, and awk with identical ranges | scratchpad prototype |
| After simulating the sync, all 8 bash fenced blocks in council.md pass `bash -n`, both bodies equal canonical after dedent | scratchpad simulation |
| Longest canonical line becomes 122 chars at 6-space indent; `.markdownlint.json` sets MD013 `code_blocks: false`, so no lint hit | config |
| `$redact_awk` is consumed as program text via `awk "$redact_awk"` at lines 568, 569, 632, 760, 761, 824 | grep |
| Rule R parses `REDACTION_SOURCES` with `/REDACTION_SOURCES=\(([\s\S]*?)\)/` then `"([^"]+)"` | `scripts/validate-council-roster.js:482,490` |
| The Rule S epoch hashes reviewer fields only, so roster edits here trigger no prose re-stamp | `validate-council-roster.js:394-406` |
| `tests/integration/validate-council-roster.test.ts` is fixture-only; PR 1 needs no change there, PR 2 task 2.11 extends its fixture writer | research |
| No bats suite in the repo uses `setup_file()` yet; a failing `setup_file` aborts the file's tests as a single `not ok` (bats-core test suite) | research |
| CI pins `bats@1.11.0`; sibling suites call `bats_require_minimum_version 1.5.0`; `redaction.bats` does not | `validate-schemas.yml:1385` |
| No anchor-string false positives outside real bodies in any carrier | grep |

## Design decisions (final)

1. **Sequencing.** PR 1 lands before PR 2. PR 2's identity gate is red until
   PR 1 is in; that is the intended fail-closed outcome and PR 2's description
   says so. No skip flag, no allowlist.
2. **Canonical by name.** `CANONICAL_SOURCE="plugins/yellow-council/skills/council-patterns/SKILL.md"`
   is a named constant in the extractor. Both `setup()` and `setup_file()`
   use it. Nothing references `REDACTION_SOURCES[0]` anymore.
3. **Anchor on both validator markers, from one source.** The walker treats
   a line containing `strip_deco(` (with its `function` keyword) as an
   anchor and requires `cred_hit(` (with its `function` keyword) to appear
   inside the walked body. The two literal strings live only in the bash
   library as `REDACTION_ANCHOR_MARKERS=(...)`; `validate-council-roster.js`
   parses that array out of the lib the same way Rule R already parses
   `REDACTION_SOURCES`, so there is no second copy and no parity test.
4. **Return contract: files in a caller-supplied directory.**
   `extract_redaction_bodies <file> <outdir>` writes `<outdir>/<basename>.<n>.body`
   and prints nothing on success. Callers glob with `nullglob`. Chosen
   because it preserves the awk exit status (no process substitution) and
   the per-body files feed `cmp` and `diff -u` directly for the identity
   gate's failure output. Bash 3.2 compatibility is a side benefit, not
   the reason.

<!-- deepen-plan: codebase -->
> **Codebase:** No bash-version floor is documented in `AGENTS.md` or
> `CONTRIBUTING.md`; the bash 3.2 (macOS) constraint is this plan's own
> judgment call, not a repo rule. Keep the file-based contract anyway, for
> the exit-status and diff-output reasons decision 4 gives, independent of
> the bash version point: the
> only in-repo precedent for multi-value returns is the globals-array
> pattern in `plugins/yellow-ci/tests/lib/redaction-fuzz.bash:63`, and no
> file under `plugins/` uses `mapfile`.
<!-- /deepen-plan -->
5. **Derived count.** The walker exits 2 with a stderr message naming the
   file, anchor line, and condition (`no opener`, `no closer`,
   `missing cred_hit marker`, `count mismatch`) whenever bodies found differ
   from anchors found. No count is stored anywhere.
6. **One extractor.** The old `case`-based `extract_redaction_awk` is
   deleted; the singular consumer (behavioral `setup()`) takes body 1 of
   `CANONICAL_SOURCE` and asserts exactly one body exists.
7. **Identity gate in `setup_file()`.** Dedent every body, `cmp -s` against
   the canonical, collect every mismatch across all sources, then fail once
   with all of them listed and the fix direction stated. `bats_require_minimum_version 1.7.0`
   is added so an old local bats cannot silently skip the hook.

<!-- deepen-plan: external -->
> **Research:** In bats-core 1.11.0 a failing `setup_file()` prints exactly
> one TAP line, `not ok N setup_file failed`, followed by `#`-prefixed stack
> and stderr lines; the file's tests emit no rows at all, `teardown_file`
> still runs, and the suite exits non-zero. The drifted-copy and canonical
> paths therefore must go to stderr, since the TAP description is fixed.
> `setup_file` exists since v1.2.1, `BATS_FILE_TMPDIR` since v1.4.0, and
> `bats_require_minimum_version` itself since v1.7.0, so 1.7.0 is the real
> floor (sibling suites use 1.5.0; either value hard-fails on a bats too old
> to have the function). Source: `libexec/bats-core/bats-exec-file` at tag
> v1.11.0, https://github.com/bats-core/bats-core/blob/v1.11.0/libexec/bats-core/bats-exec-file
> and https://bats-core.readthedocs.io/en/stable/writing-tests.html
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** No `.bats` file under `plugins/*/tests/` uses `setup_file`
> today, so there is no in-repo pattern to copy. O3 must confirm the
> abort-the-file behaviour empirically with a deliberately failing
> `setup_file` before relying on it.
<!-- /deepen-plan -->
8. **Roster.** Add council.md to `redaction_extra_sources` alongside SKILL.md
   (both are non-reviewer carriers) and remove its `redaction_known_untested`
   entry.

<!-- deepen-plan: codebase -->
> **Codebase:** `scripts/validate-council-roster.js:525-530` errors when any
> `redaction_extra_sources` entry is absent from `REDACTION_SOURCES`, so task
> 2.10 is hard-coupled to task 2.2 and must land in the same commit. Lines
> 332-333 default both arrays to `[]` when missing, so an empty
> `redaction_known_untested` is valid, and no JSON schema for the roster
> exists under `schemas/`.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 0: Preflight (orchestrator)

- [x] 0.1 Run `/stack:status`. Proceed only on `READY_GRAPHITE`; stop with the
      classifier detail otherwise.
- [x] 0.2 Confirm `bats plugins/yellow-council/tests/` is green on the base
      branch under both mawk and gawk (baseline before any edit).
- [x] 0.3 Confirm the brainstorm doc is committed or intentionally left
      untracked (it is untracked today); do not sweep it into either PR.

### Phase 1: PR 1, sync council.md to canonical

Branch: `agent/fix/council-redaction-awk-sync` (Graphite adds the `agent/` prefix) on top of `agent/feat/council-roster-drift-gate`.

- [x] 1.1 Extract canonical: run the current extractor against SKILL.md into
      a scratch file (290 lines). Never hand-copy.
- [x] 1.2 Replace council.md lines 377-565 with canonical indented by 4
      spaces. Keep line 376 (`  local redact_awk='`) and line 566 (`  '`).
- [x] 1.3 Replace council.md lines 1208-1396 (post-1.2 offsets shift by
      +101) with canonical indented by 6 spaces. Keep the opener
      `      section_body=$(awk '` and closer `      ' "$fenced_path")`.
- [x] 1.4 Update the two sync comments (lines 371-372 and 1205-1206) to say
      the copy is byte-identical to SKILL.md after dedent and is gated by
      `tests/redaction.bats` once PR 2 lands.
- [x] 1.5 Verify (orchestrator-owned, see gates below): dedent-and-cmp both
      bodies against canonical; `bash -n` every fenced bash block; no `'` and
      no `\` at end of line inside either body; `pnpm validate:agents`,
      `pnpm lint:plugins`, `pnpm validate:schemas`.
- [x] 1.6 Manual behavioral confirmation: run the four `766268d1` fixture
      shapes (clean multi-line key, deletion-prefixed key, combined-diff key,
      bare PKCS#8 header) through each synced council.md body under mawk and
      gawk. Record the result in the PR test plan. This is a point-in-time
      check; PR 2 makes it automatic. Result 2026-09-09: 20/20 fixture runs
      pass on the synced bodies. Stronger evidence came from running the
      whole behavioral suite against the pre-sync body: 4 over-redaction
      tests failed (prose line ending in a marker, re-arm window retirement,
      base64-shaped line after END, stray-window end line) and 0 leak
      tests; against the synced body all 25 behavioral tests pass.
- [x] 1.7 `pnpm changeset` with `'yellow-council': patch`; body explains it is
      a redaction hardening fix, not a feature.
- [x] 1.8 Submit via `/smart-submit` (gt-workflow). PR description states:
      PR 2 depends on this landing first; the sync is a security fix; the
      `bash -n` check was manual. Submitted 2026-09-09 as #781 (draft) via
      `gt submit --no-interactive` on branch `agent/fix/council-redaction-awk-sync`;
      the branch was already committed, so smart-submit's uncommitted-changes
      path did not apply.

### Phase 2: PR 2, generalized extractor and identity gate

Branch: `agent/feat/council-redaction-multi-body-extractor` stacked on PR 1 (#781).

#### 2A. Extractor library

- [ ] 2.1 Create `plugins/yellow-council/tests/lib/extract-redaction-bodies.awk`
      (passed with `-f`, no shell-quoting layer). Behaviour:
      buffer all lines; for each anchor line matching `function strip_deco\(`,
      walk backward to the nearest opener of three shapes and forward to the
      shape-matched closer; require `cred_hit(` (with its `function` keyword) inside the interior;
      write the interior to `OUT "/" BASE "." n ".body"`; at END exit 2 with a
      stderr diagnostic if any anchor failed or bodies != anchors. Shapes:

      ```awk
      # opener                                   # matching closer
      /^```awk$/                                 /^```$/
      /^awk '$/                                  /^'[ \t]*"\$[A-Za-z_]*FILE"[ \t]*>/
      /^[ \t]*(local[ \t]+)?[A-Za-z_][A-Za-z0-9_]*=(\$\(awk[ \t]+)?'$/
                                                 /^[ \t]*'([ \t]*"\$[A-Za-z_]+"\))?[ \t]*$/
      ```

      No interval expressions, no `gensub`, `[ \t]` rather than `[[:space:]]`
      where older awks might differ. Prototype validated under mawk, gawk, awk.
- [ ] 2.2 Rewrite `extract-redaction-awk.bash`:
      - `CANONICAL_SOURCE` constant; `REDACTION_SOURCES` gains
        `"plugins/yellow-council/commands/council/council.md"`. Keep entries
        as plain double-quoted strings, and keep every explanatory comment
        (including the "two bodies" note) above the array, never inside it,
        because Rule R's regex stops at the first `)`.
      - `REDACTION_ANCHOR_MARKERS` holding the two literal marker strings.
      - `extract_redaction_bodies <file> <outdir>`: runs the awk directly,
        returns its exit status, nothing on stdout.
      - `dedent_file <in> <out>`: awk two-pass min-leading-whitespace strip
        over non-blank lines.
      - `repo_root` unchanged.
      - Header comment rewritten: four carriers, five bodies, contract, and why
        the count is derived.
      - Delete the old `extract_redaction_awk`.

<!-- deepen-plan: codebase -->
> **Codebase:** `repo_root()` in the current lib already resolves paths from
> `${BASH_SOURCE[0]}`; locate the new `.awk` file the same way
> (`"$(dirname "${BASH_SOURCE[0]}")/extract-redaction-bodies.awk"`). The only
> consumer of `extract_redaction_awk` anywhere in the repo is
> `redaction.bats` (lines 37, 164, 184, 197), so deleting it breaks nothing
> else.
<!-- /deepen-plan -->
- [ ] 2.3 Write `plugins/yellow-council/tests/extract.bats` covering the
      walker itself with synthetic fixtures in `BATS_TEST_TMPDIR` (markers
      assembled at runtime, no literal PEM strings): one body per shape; two
      bodies in one file; zero anchors yields zero files and exit 0; anchor
      with no opener exits 2 and names the line; anchor with no closer exits
      2; body missing `cred_hit` exits 2; a `'`-only comment line inside a
      var-shaped body is not treated as a closer only if it is not
      whitespace-then-quote (document this as a known constraint the
      single-quote test already enforces); dedent of mixed 4/6 indent; CRLF
      input is rejected loudly rather than mis-walked.

#### 2B. redaction.bats restructure

- [ ] 2.4 Add `bats_require_minimum_version 1.7.0` at the top (the floor for
      `setup_file` + `BATS_FILE_TMPDIR` + the guard function itself).
- [ ] 2.5 Add `setup_file()`: load the lib; extract every source into
      `BATS_FILE_TMPDIR/bodies/`; assert no `\` at end of line in any raw
      body (dedent precondition); dedent each; extract and dedent the
      canonical from `CANONICAL_SOURCE` and assert exactly one body; `cmp -s`
      every body against it; accumulate failures; on any failure print
      `DRIFT: <file> body <n> — byte N, line M` per body plus a capped
      `diff -u | head -20`, then the fix direction ("SKILL.md is the source of
      truth; apply the change there and to every REDACTION_SOURCES entry"),
      and `return 1`.

<!-- deepen-plan: external -->
> **Research:** The closest formalized prior art for drift messages is
> Bazel's `write_source_files` / `diff_test`, whose failure text carries four
> fields: the out-of-date copy, the source of truth, the exact command to
> fix it, and the diff. Kubernetes' `hack/verify-*.sh` uses the same shape
> ("Generated files need to be updated" plus "Please run
> hack/update-codegen.sh"). Adopt that shape here:
> `<copy path> (body n of N) is out of date. Source of truth: <SKILL.md path>.
> To update: re-extract from SKILL.md and re-indent; never edit this copy alone.`
> followed by the capped diff. See
> https://github.com/bazel-contrib/bazel-lib/blob/main/docs/write_source_files.md
> and https://github.com/kubernetes/kubernetes/blob/master/hack/lib/verify-generated.sh
<!-- /deepen-plan -->
- [ ] 2.6 Rewrite `setup()`: `AWK_PROG` is the dedented canonical body from
      `BATS_FILE_TMPDIR` (no re-extraction), with the existing `[ -s ]` guard.

<!-- deepen-plan: codebase -->
> **Codebase:** `require_awks()` and `available_awks()` are defined inside
> `redaction.bats` itself (lines 74-89), not in the lib. They stay where they
> are and are out of scope for this rewrite; O3's prompt should say so.
<!-- /deepen-plan -->
- [ ] 2.7 Rewrite the three existing loops (byte-identical drift guard,
      single-quote, syntax-valid) to iterate over every `.body` file. The
      drift-guard test becomes a thin assertion that `setup_file` ran (the
      gate itself is fatal) so the suite still lists identity as a named test.
- [ ] 2.8 Update the header comment ("authored in three files" at line 154
      and the top block) to say four files, five bodies.
- [ ] 2.9 Behavioral tests are untouched.

#### 2C. Roster, validator parity, docs

- [ ] 2.10 `scripts/council-roster.json`: add council.md to
      `redaction_extra_sources`; delete its `redaction_known_untested` entry
      (leave the array present and empty so the schema and validator
      default still hold).
- [ ] 2.11 In `scripts/validate-council-roster.js`, replace the hardcoded
      `CANONICAL_AWK_MARKERS` constant with a parse of
      `REDACTION_ANCHOR_MARKERS=(...)` from `extract-redaction-awk.bash`
      (same regex shape as the `REDACTION_SOURCES` parse; error if absent or
      empty). Update the fixture writer in
      `tests/integration/validate-council-roster.test.ts` so its synthetic
      lib carries the array, and add one test that a missing array is an
      error. No separate parity vitest.

<!-- deepen-plan: codebase -->
> **Codebase:** Follow `tests/integration/codex-reviewer-step6-extraction.test.ts:25`
> (`const REPO_ROOT = resolve(__dirname, '..', '..')` plus `readFileSync` and
> a regex over a committed file). `pnpm test:integration` is
> `vitest run --dir tests/integration --passWithNoTests`, so the new file is
> auto-discovered with no config change.
<!-- /deepen-plan -->
- [ ] 2.12 `plugins/yellow-council/CLAUDE.md`: extend the "Output redaction is
      mandatory" bullet with one sentence naming the identity gate and the
      rule that SKILL.md is the source of truth for all five bodies.
- [ ] 2.12b Flip the two "Not yet covered by tests/redaction.bats" comments in
      council.md (Step 4 site near line 371, Step 7 site near line 1308) to
      state the identity gate now covers this file; carry the SKILL.md and
      plugin CLAUDE.md context findings from the PR 1 review (a carrier list
      after the SKILL.md fence, outside the ```awk block; the CLAUDE.md
      redaction bullet naming both council.md sites).
- [ ] 2.13 `pnpm changeset` with `'yellow-council': patch`.
- [ ] 2.14 Submit via `/smart-submit`; PR description states the dependency on
      PR 1 and that landing out of order fails the gate by design.
- [ ] 2.15 Add `sudo apt-get install -y gawk` to the `plugin-shell-tests` job
      in `.github/workflows/validate-schemas.yml` (next to the bats install at
      line 1385) so the gawk path is CI-verified, not local-only. No changeset
      needed for `.github/` changes.

<!-- deepen-plan: codebase -->
> **Codebase:** The `changeset-check` job matches changed files against
> `^plugins/[^/]+/` (`validate-schemas.yml:1213`), which includes
> `plugins/yellow-council/tests/**`, and any `.changeset/*.md` in the diff
> satisfies it. `plugins/yellow-council/package.json` names the package
> exactly `yellow-council`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `ubuntu-latest` (22.04 and 24.04) ships mawk only: the
> runner-images toolsets and build scripts install no gawk, and the request
> to add it (actions/runner-images#1297) closed unaddressed. Installing gawk
> auto-flips the `awk` alternative (gawk priority 10 over mawk priority 5),
> so the suite must call `mawk` and `gawk` by explicit binary name, which
> `available_awks()` already does. The package is about 450 kB. Sources:
> https://github.com/actions/runner-images/tree/main/images/ubuntu/toolsets,
> https://github.com/actions/runner-images/issues/1297,
> https://sources.debian.org/src/gawk/1%3A5.2.1-2/debian/postinst/
<!-- /deepen-plan -->

### Phase 3: Quality gates (orchestrator-owned, every one run locally before submit)

- [ ] 3.1 `bats plugins/yellow-council/tests/` green under mawk and gawk.

<!-- deepen-plan: codebase -->
> **Codebase:** The `plugin-shell-tests` job runs on `ubuntu-latest` only
> (`validate-schemas.yml:1372`) with no gawk install step and no macOS job,
> so until task 2.15 lands this gawk check exists only on the orchestrator's
> machine. Keep it as a recurring local step, not a one-time check.
<!-- /deepen-plan -->
- [ ] 3.2 `pnpm validate:schemas` (includes validate-council-roster.js against
      the real tree), `pnpm validate:agents`, `pnpm lint:plugins`,
      `pnpm test:integration`, `pnpm lint`, `pnpm typecheck`.
- [ ] 3.3 Negative test of the gate: temporarily corrupt one byte in
      council.md body 2, confirm `setup_file` fails with the right file, body
      index, and line; revert.
- [ ] 3.4 Negative test of Rule R: temporarily delete council.md from
      `REDACTION_SOURCES`, confirm the validator errors; revert.
- [ ] 3.5 `git diff --check` and LF-only line endings on every new file
      (`.awk`, `.bash`, `.bats`).

<!-- deepen-plan: codebase -->
> **Codebase:** `.gitattributes:1` sets `* text=auto eol=lf`, so the new
> `.awk` and `.bats` files are LF-normalized on commit without a new rule.
> Neither `scripts/lint-plugins.sh` (walks `agents/*.md`, `commands/*.md`,
> `SKILL.md`) nor `scripts/validate-agent-authoring.js` (filters `.md`)
> touches `plugins/*/tests/**`, and `pnpm lint` is eslint on `.js`/`.ts`
> only, so the new test files trip no lint.
<!-- /deepen-plan -->
- [ ] 3.6 `/review:pr` on each PR; resolve findings before requesting merge.

## Agent Orchestration

The orchestrator (this session, Fable) owns every byte that ships: it
dispatches, reads every diff a subagent produces, runs the Phase 3 gates
itself, and writes the commits and PR descriptions. Subagents never commit,
never run `gt`, and never edit files outside their assignment. Dispatch with
the `Agent` tool using `subagent_type: "general-purpose"` and an explicit
`model` override (`fork` ignores the override). One assignment per agent,
with the exact file list and acceptance checks pasted into the prompt.

### Sonnet assignments (mechanical, fully specified)

| ID | Task | Inputs handed over | Acceptance check the agent must run |
| --- | --- | --- | --- |
| S1 | Phase 1 tasks 1.1-1.4: replace both council.md bodies, update the two comments | canonical scratch file path, exact line ranges, indent widths | dedent-and-cmp both bodies equals canonical; `bash -n` on every fenced block |
| S2 | Phase 2 task 2.7-2.8: rewrite the three existing bats loops over `.body` files and fix the header comments | the new lib's function signatures from O1 | `bats plugins/yellow-council/tests/` green |
| S3 | Phase 2 tasks 2.10, 2.12, 2.13: roster edit, CLAUDE.md sentence, changeset | wording from this plan | `pnpm validate:schemas` green; `node -e` round-trip of the roster JSON |
| S4 | Phase 2 task 2.11: Rule R parses `REDACTION_ANCHOR_MARKERS` from the bash lib; extend the fixture writer in `validate-council-roster.test.ts` | the `REDACTION_SOURCES` parse at `validate-council-roster.js:482,490` as the pattern to copy | `pnpm vitest run tests/integration/validate-council-roster.test.ts` green, plus `pnpm validate:schemas` against the real tree |

### Opus assignments (design judgment inside a fixed contract)

| ID | Task | Inputs handed over | Acceptance check the agent must run |
| --- | --- | --- | --- |
| O1 | Phase 2 tasks 2.1-2.2: the awk walker and the bash library | the three shape regexes above, the prototype from planning, the return contract, the diagnostic format | walker finds 1/1/1/2 bodies with the ranges in the Verified facts table under mawk, gawk, and awk; every error path exits 2 with file and line |
| O2 | Phase 2 task 2.3: `extract.bats` fixture suite for the walker | O1's finished library | suite green under both awks; each error condition has a failing fixture |
| O3 | Phase 2 tasks 2.4-2.6: `setup_file()` identity gate and `setup()` rewrite | O1's library; the failure-message wording from decision 7 | gate passes on the synced tree; corrupting one byte in any body fails with file, body index, byte, line |

S2 depends on O1. O2 and O3 depend on O1 and run in parallel. S3 and S4 are
independent of O1 and run alongside it.

### Orchestrator-only steps (never delegated)

- Phase 0 preflight, including `/stack:status`.
- Task 1.6, the manual four-fixture verification, because it is the only
  behavioral evidence for PR 1 before the automated gate exists.
- Reading every subagent diff in full before staging it.
- All of Phase 3, including both negative tests.
- Branch creation, commits, changeset review, `/smart-submit`, PR
  descriptions, and `/review:pr` triage.
- The final decision that PR 1 is merged before PR 2 is submitted for merge.

## Technical Specifications

### Files to modify

- `plugins/yellow-council/commands/council/council.md` (PR 1): two body
  replacements, two comment edits. Grows from 1731 to 1937 lines; RULE 21 is
  a warning and already fires.
- `plugins/yellow-council/tests/lib/extract-redaction-awk.bash` (PR 2):
  rewritten contract.
- `plugins/yellow-council/tests/redaction.bats` (PR 2): `setup_file`,
  `setup`, three loops, header.
- `scripts/council-roster.json` (PR 2): `redaction_extra_sources` +1,
  `redaction_known_untested` -1.
- `plugins/yellow-council/CLAUDE.md` (PR 2): one sentence.

### Files to create

- `plugins/yellow-council/tests/lib/extract-redaction-bodies.awk` (PR 2)
- `plugins/yellow-council/tests/extract.bats` (PR 2)
- `.changeset/council-redaction-awk-sync.md` (PR 1),
  `.changeset/council-redaction-multi-body-extractor.md` (PR 2)

### Dependencies

None added. bats 1.11.0 (CI pin), mawk/gawk, POSIX `cmp` and `diff`.

## Acceptance Criteria

1. After PR 1: dedenting either council.md body yields bytes equal to the
   SKILL.md fenced body (`cmp` exit 0); `grep -c 'pem_release\|pem_was_in'`
   on council.md returns 12 (6 per copy, two copies); every fenced bash
   block passes `bash -n`. File length is 1937 lines (two 101-line body
   deltas plus two extra comment lines at each site).
2. After PR 2: `bats plugins/yellow-council/tests/` is green under mawk and
   gawk, and lists the identity gate, the extractor suite, and all existing
   behavioral tests.
3. After PR 2: `pnpm validate:schemas` passes with council.md absent from
   `redaction_known_untested` and present in `REDACTION_SOURCES`.
4. Corrupting one byte in any of the five bodies makes `setup_file` fail
   naming the file, body index, byte, and line, and no behavioral test runs.
5. Removing any carrier from `REDACTION_SOURCES` makes Rule R fail.
6. `extract.bats` proves each of the three delimiter shapes extracts from a
   synthetic fixture, so a future carrier in any known shape needs no
   extractor change.
7. Neither PR introduces a skip flag, allowlist, or stored body count.

## Edge Cases and Error Handling

- **Anchor without a recognizable opener or closer.** Walker exits 2 naming
  the file and anchor line. The gate treats this as failure, never as zero
  bodies.
- **Body found but `cred_hit` missing.** Exit 2, `missing cred_hit marker`.
  Prevents a partial paste from counting as a carrier for the extractor while
  the validator (which requires both markers) disagrees.
- **Two anchors sharing an opener.** Second anchor's backward walk hits the
  first anchor's closer region before an opener; treat "nearest opener is
  above another anchor's closer" as `no opener` and exit 2.
- **`'` on a line by itself inside a body.** Would be mistaken for a
  var-shape closer. The existing single-quote test forbids any `'` in the
  program, so this cannot occur in a valid carrier; document it.
- **CRLF input.** Detect `\r` in any buffered line and exit 2 with
  `CRLF line endings`; the repo's `.gitattributes` forces LF, so this only
  guards local WSL edits.
- **Blank or whitespace-only lines.** Dedent ignores them when computing the
  minimum and emits them as empty; canonical has none today.
- **Tabs vs spaces.** Dedent strips only the common prefix; mixed
  indentation fails the byte compare, which is the correct outcome.
- **Multiple drifted files in one run.** `setup_file` reports all of them
  before returning.
- **Old local bats (<1.7.0).** `bats_require_minimum_version` aborts the
  run instead of silently skipping `setup_file`.
- **PR 2 lands before PR 1.** Identity gate red on main; the message points
  at council.md and SKILL.md. Fix is to land PR 1, not to add an allowance.

## Security Considerations

- The synced program is extracted from SKILL.md, never re-typed, so PR 1
  cannot introduce a variant.
- Test fixtures assemble PEM markers at runtime; no literal key headers are
  added to the tree beyond those already in the shipped program.
- Failure output never prints secrets or whole program text: byte and line
  positions plus a capped diff.
- The gate closes the class of bug where a fix pass cannot see a copy. A
  future sixth copy either extracts and is gated, or fails Rule R.

## Migration and Rollback

- PR 1 alone is safe to ship and safe to revert (restores the weaker program,
  nothing else depends on it).
- PR 2 reverted alone restores the old extractor and re-adds council.md to
  `redaction_known_untested`; the validator would then require that entry to
  be re-added, so the revert must include the roster file.
- No runtime reads any test file or the roster, so neither PR changes
  `/council` behavior except through the program text itself.

## Follow-ups surfaced during PR 1 review (out of scope here)

These target the canonical program in SKILL.md, so they cannot be applied
in PR 1 (bodies must stay byte-identical) and are not part of PR 2 either.

- **Leak on a prose-prefixed BEGIN with a narrow-wrapped body (highest
  priority, canonical-wide).** Measured 2026-09-09 with mawk: input
  `leaked key: <BEGIN marker>` followed by four body lines under the
  20-character base64 floor and an END marker. The pre-sync council.md body
  (tail-anchored classifier) leaked 0 lines; the canonical (fully anchored
  after `strip_deco`) leaked 2 lines, because the block runs on the bounded
  path and the stray cutoff releases. Wide-wrapped bodies and bare BEGIN
  lines are safe in both. The anchor exists to stop prose that merely ends
  with a marker from swallowing the report (pinned by the "prose line
  ending with a key marker" test), so the fix must keep that: for example,
  treat a prose-prefixed BEGIN as real when the following line is
  base64-shaped at any width, or lower the width floor inside a bounded
  window that opened on a marker. Ship it as its own PR against SKILL.md
  plus every carrier, with a leak fixture for this shape in
  `redaction.bats`; PR 2's identity gate then keeps all five bodies in step.
- **Step 7 discards the redaction pass's exit status.** `section_body=$(awk
  '...' "$fenced_path")` swallows a non-zero exit and appends an empty
  claude section while the headline still counts the vote. Step 4's file
  pass at the `awk "$redact_awk" "$fenced_path"` site already fails
  closed; mirror it and route to `omit_reason`. Also correct the Step 4
  comment near the persisted-file redaction that presents the Step 7 pass
  as defence in depth: Step 4 has already replaced the BEGIN delimiter, so
  the second pass cannot re-enter PEM mode over the same content.
- **Quadratic decoration stripping is a five-shape class, not just `-`
  floods.** `strip_deco`'s cost comment (SKILL.md ~174-182) scopes the
  quadratic to dash runs; space-separated `+ + +`, `- `, `* `, `1. `, and
  `12| ` floods are consumed one marker per fixpoint pass and cost the
  same. Reachable only on the PEM bounded path. Fix by bulking the
  list-marker and numbered-pipe rules with repeated groups and replacing
  the per-character dash guard with one run-measure that preserves the
  delimiter's five dashes. Gate on `redaction.bats`, not reasoning.
- **Do not replace the `prev`/`s != prev` compare with summed `sub()`
  returns.** The all-`*` blockquote rule matches the empty string at
  position 0 on every line and returns 1 forever; that change would drive
  the loop to `limit`, set `deco_exhausted`, and fail every BEGIN closed.
- **No time bound on the redaction pass** (the shared mitigation for the
  quadratic-stripping and `cred_hit` items above and below). council.md's
  awk invocations run unwrapped; a hostile blowup hangs `/council`. Three
  reviewers flagged this independently. Wrap the sites in GNU `timeout`
  with a fail-closed branch (truncate, never emit unredacted).
- **`cred_hit` is O(M*L) on lines with many sub-minlen prefix matches.**
  Fine for reviewer prose today; if long-line input becomes reachable,
  bound the walk with a fail-closed cap.
- **Validator noise:** Rule R in `validate-council-roster.js` scans
  gitignored `.claude/agent-memory/` and prose files under `plans/` and
  `docs/brainstorms/` for the two marker strings. Consider adding
  `.claude` to `LEDGER_EXCLUDED_DIRS` or restricting Rule R to
  `plugins/`; until then, never quote both marker strings verbatim in
  prose.

## References

- Brainstorm: `docs/brainstorms/2026-09-09-council-multi-body-redaction-awk-extract-brainstorm.md`
- Extractor: `plugins/yellow-council/tests/lib/extract-redaction-awk.bash`
- Suite: `plugins/yellow-council/tests/redaction.bats`
- Canonical: `plugins/yellow-council/skills/council-patterns/SKILL.md:149-440`
- Roster and validator: `scripts/council-roster.json`, `scripts/validate-council-roster.js:234,471-542`
- Prior fix that missed council.md: commit `766268d1` (#703)
- Multi-value precedent in repo: `plugins/yellow-ci/tests/lib/redaction-fuzz.bash`
- Learnings: `docs/solutions/security-issues/awk-pem-state-machine-variable-mutation.md`,
  `docs/solutions/code-quality/frontmatter-sweep-and-canonical-skill-drift.md`,
  `docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md`,
  `docs/solutions/security-issues/sandwich-fence-delimiter-forgery.md`
- CI: `.github/workflows/validate-schemas.yml:1366-1426` (yellow-council bats is a required step)

<!-- deepen-plan: external -->
> **Research:** External references used during enrichment:
> bats-core `setup_file` semantics, https://github.com/bats-core/bats-core/blob/v1.11.0/libexec/bats-core/bats-exec-file;
> bats writing-tests docs, https://bats-core.readthedocs.io/en/stable/writing-tests.html;
> runner-images ubuntu toolsets, https://github.com/actions/runner-images/tree/main/images/ubuntu/toolsets;
> gawk alternative priority, https://sources.debian.org/src/gawk/1%3A5.2.1-2/debian/postinst/;
> drift-message prior art, https://github.com/bazel-contrib/bazel-lib/blob/main/docs/write_source_files.md
> and https://github.com/kubernetes/kubernetes/blob/master/hack/lib/verify-generated.sh;
> GNU awk interval expressions, https://www.gnu.org/software/gawk/manual/html_node/Interval-Expressions.html
<!-- /deepen-plan -->
