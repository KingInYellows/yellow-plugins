# Feature: Harden plugin fenced shell blocks against user shell aliases

## Problem Statement

Claude Code's Bash tool runs fenced shell blocks under the user's login shell
and replays a snapshot of their options and aliases. A user who aliases
`ls`→eza, `ps`→procs, `du`→dust or `df`→duf silently breaks any block that
parses those commands' output. The worst case is `ls -t plans/*.md 2>/dev/null`:
eza reads `-t` as `--time <field>`, the error goes to `/dev/null`, and
`/flow:work` reports that no plans exist.

CONTRIBUTING.md "Bash and zsh" already says "where flags matter, call
`command ls` / `command cat`" (line 619), but nothing enforces it, so the
rule has already been broken in eight places.

## Current State

Swept every fenced shell block in `plugins/**/*.md` (CHANGELOGs, `tests/`
and generated `codex/skills/` copies excluded, as `validate-shell-compat.js`
does), using the validator's own `classifyLines` so lines inside a
`bash /dev/fd/3` wrapper (`pinned`) and quoted heredoc bodies (`data`) are
told apart from code that runs in the user's shell.

### Must fix: runs in the user's shell, result consumed

| Site | Code | Effect under the alias |
|---|---|---|
| `yellow-core/commands/flow/work.md:47` | `ls -t plans/*.md 2>/dev/null \| head -5` | eza: "no plans exist" |
| `yellow-core/commands/flow/review.md:79` | `ls -t plans/*.md 2>/dev/null \| head -3` | same |
| `yellow-core/commands/flow/review.md:51` | same, in prose (inline code) | same; the lint cannot see prose |
| `yellow-core/commands/flow/decompose.md:48` | `SPEC_LIST=$(ls -t plans/specs/*.md 2>/dev/null)` | "No specs found. Run /flow:spec first" |
| `yellow-core/commands/flow/pick-next-shell.md:33` | `if ! ls plans/shells/*.md >/dev/null 2>&1` | `alias ls=false`-style breakage reports "all shells expanded" |
| `yellow-core/skills/plan-status/SKILL.md:27` (+ codex copy) | `if ! ls plans/*.md >/dev/null 2>&1` | reports "plans/ is empty" |
| `yellow-codex/commands/codex/status.md:74` | `ls -lt "$CODEX_SESSIONS" \| head -5` | eza: empty "Recent:" list |
| `yellow-browser-test/commands/browser-test/explore.md:169`, `test.md:171` | `PROC_CMD=$(ps -p "$PID" -o comm=)` | procs: no match, server left running (fails safe) |

### No change needed: not in the user's shell

- `yellow-ruvector/commands/ruvector/status.md:81` (`du -sh … | cut -f1`)
  sits inside the `bash /dev/fd/3 3<<'__YELLOW_RUVECTOR_BASH__'` wrapper
  opened at line 64. A non-interactive bash child neither inherits zsh
  aliases nor expands aliases, so it is already safe.
- `yellow-ci` `df`/`top` (`commands/ci/runner-cleanup.md:77,135`,
  `commands/ci/setup-self-hosted.md:188,190`,
  `skills/ci-runner-health/SKILL.md:608` and its codex copy) are quoted
  heredoc bodies sent to `ssh "$user@$host"`. They run on the runner, not under
  the user's local shell, so Claude Code's alias replay never reaches them.
  **Decision:** prefix them with `command` anyway. It is POSIX, costs four
  edits, and covers a runner admin who defines aliases in `.zshenv`. They
  stay outside the lint's scope (they are `data` lines).
- Tier 4 libraries (`scripts/shell-compat-config.json`) have no `ls`, `ps`,
  `du`, `df` or `top` calls.

### Lower risk: `cat`, `grep`, `find`

Inline blocks pipe or capture `grep` 135 times, `cat` 40 and `find` 18. The
common replacements are built to stay compatible when stdout is not a
terminal: `bat` drops decorations and acts as `cat`, `ugrep` is a drop-in
`grep`, and `grep --color=auto` colors only a TTY. `alias grep=rg` and
`alias find=fd` do break these blocks, but they are rare, and guarding 190
call sites would add churn to every plugin.
**Decision:** do not sweep `cat`/`grep`/`find` now. The lint reads its
command list from `shell-compat-config.json`, so adding one later is a config
change. New code that uses `find` for listing (below) still writes
`command find`.

### Second hazard found: zsh `nomatch`

Verified with zsh 5.9: `ls -t plans/*.md 2>/dev/null` with no match prints
`no matches found: plans/*.md` (the glob fails before `2>/dev/null` applies)
and the command never runs. Inside `$(…)` only the subshell aborts, so the
current blocks still get an empty result, but they leak an error line, and
`command ls` alone would not fix that. Listing through `find` fixes both.

## Proposed Solution

### Pattern

1. **Listing files by mtime (`ls -t <dir>/*.md`):** use `find` and hand the
   matches to the `ls` binary through `-exec`, which never sees aliases or
   functions:

   ```bash
   command find plans -maxdepth 1 -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -5
   ```

   Output is byte-identical to today's (`plans/<name>.md`, newest first). No
   matches means no output and exit 0, with no `nomatch` error. Verified under
   `zsh -f -o noclobber -o extendedglob -o rcquotes -o nocaseglob` with
   `alias ls=false find=false`. `-exec … {} +` can split into several `ls`
   runs past ARG_MAX, which is not a concern for `plans/`.
2. **Existence checks (`if ! ls dir/*.md >/dev/null 2>&1`):** test for the
   first match with the same `find`:

   ```bash
   if [ -z "$(command find plans/shells -maxdepth 1 -type f -name '*.md' 2>/dev/null | head -1)" ]; then
   ```

3. **Every other parsed call (`ps -p`, `ls -lt <dir>`, remote `df`/`top`):**
   prefix with `command` (`command ps -p "$PID" -o comm=`). Prefer it over
   `\ls`, because `command` also bypasses shell functions, works the same in
   bash and zsh, and is POSIX on the remote runners.

### Lint rule: SHC-010 in `validate:shell-compat`

**Decision:** enforce it in `scripts/validate-shell-compat.js` and document
it in CONTRIBUTING.md, rather than adding an AGENTS.md authoring RULE. The
shell-compat validator already separates user-shell code from `pinned` and
`data` lines, already has an allowlist with reasons and hints, and already
runs in CI. An AGENTS.md rule would need a second parser to get that right.

- **Summary:** alias-prone command whose result is consumed.
- **Flags:** a `code` line (not `pinned`, `data`, `comment` or `expand`)
  where `ls`, `ps`, `du`, `df` or `top` (`aliasGuardedCommands` in
  `shell-compat-config.json`) is in command position, not preceded by
  `command ` or `\`, and its result is consumed. Consumed means its stdout is
  piped (`| …`), captured (`$(…)` or backticks), redirected to a file, or its
  exit status is tested (`if`, `!`, `&&`, `||`).
- **Ignores:** a bare display call (`ls -d .ruvector/`), because Claude reads
  that output and eza's is still readable. Also arguments to `find -exec`,
  `xargs` or `ssh`, which are not command position.
- **Hint:** "write `command <cmd>` (or list files with `command find … -exec
  ls -t {} +`): users' aliases (ls=eza, ps=procs, du=dust, df=duf) apply to
  these blocks."
- **Scope:** inline blocks and Tier 4 libraries (the shared `lintShellText`
  path). `.sh` files with a shebang are not linted, as with SHC-001..009.

## Implementation Plan

### Phase 1: Lint rule (lands first, fails on the current tree)

- [ ] 1.1: Add `aliasGuardedCommands: ["ls","ps","du","df","top"]` to
      `scripts/shell-compat-config.json`, and validate it in
      `validateConfig` (a non-empty array of command names, else SHC-900).
- [ ] 1.2: Add `SHC-010` to `RULES` and a `ruleAliasGuarded(code)` line rule
      to `LINE_RULES` in `scripts/validate-shell-compat.js`. Reuse
      `COMMAND_POSITION_RE` and `maskShell` so quoted text and
      `$((…))` are not matched.
- [ ] 1.3: Add cases to `tests/integration/validate-shell-compat.test.ts`.
      Flag: `ls -t plans/*.md | head`, `x=$(ps -p 1 -o comm=)`,
      `if ! ls a/*.md >/dev/null 2>&1`, a backtick capture, `du -sh x | cut -f1`.
      Pass: `command ls -t x | head`, `\ls x | head`, bare `ls -d .ruvector/`,
      `find … -exec ls -t {} +`, the same `ls` inside a `bash /dev/fd/3` wrapper
      or a quoted `ssh` heredoc, `ls` inside a string (`printf 'ls -t'`).
- [ ] 1.4: Update the rule range in AGENTS.md line 100 (`SHC-001..010`) and
      the header comment of `validate-shell-compat.js`.

### Phase 2: Harden the call sites

- [ ] 2.1: `flow/work.md:47`, `flow/review.md:79` and the prose at
      `flow/review.md:51`: use pattern 1.
- [ ] 2.2: `flow/decompose.md:48`: `SPEC_LIST=$(command find plans/specs
      -maxdepth 1 -type f -name '*.md' -exec ls -t {} + 2>/dev/null)`.
- [ ] 2.3: `flow/pick-next-shell.md:33` and `skills/plan-status/SKILL.md:27`:
      use pattern 2. Update `plugins/yellow-core/tests/plan-status-parity.bats`
      `run_phase1` in the same commit, because it copies the block verbatim.
      Check that the golden fixtures still match.
- [ ] 2.4: `codex/status.md:74`: `command ls -lt "$CODEX_SESSIONS" 2>/dev/null | head -5`.
- [ ] 2.5: `browser-test/{explore,test}.md`: `command ps -p "$PID" -o comm=`.
- [ ] 2.6: `yellow-ci` remote heredocs: `command df` (×4) and `command top`
      (×1). Leave the prose mentions (`df -h /` in ci-runner-health:745 and
      runner-diagnostics:102) as they are, since they describe metrics.
      `ssh-safety.bats` and `validate.bats` call `validate_ssh_command "df -h"`.
      Confirm that the validator's allowlist accepts a leading `command`, or
      keep the remote string unchanged if it does not.
- [ ] 2.7: `pnpm generate:manifests` to refresh
      `plugins/yellow-core/codex/skills/plan-status/SKILL.md` and
      `plugins/yellow-ci/codex/skills/ci-runner-health/SKILL.md`.
- [ ] 2.8: `pnpm validate:shell-compat` reports zero SHC-010 findings, with no
      allowlist entries.

### Phase 3: Regression test under hostile aliases

- [ ] 3.1: New `tests/shell-compat/aliases.bats`. Its setup makes a fixture
      dir with `plans/new.md`, `plans/old.md` aged by
      `touch -d '-1 hour' plans/old.md`, `plans/shells/`, and a prelude defining
      `alias ls=false ps=false du=false df=false find=false`. Run each case
      under the `zsh` and `zsh-snapshot` profiles, and under bash with
      `shopt -s expand_aliases`.
- [ ] 3.2: Extract the hardened lines from the markdown at run time, by a
      fixed grep on the line (the way `status-provenance.bats` extracts its
      block), so the test exercises the shipped text rather than a copy.
      Assert:
      - the work/review listing prints `plans/new.md` then `plans/old.md`;
      - with `plans/` empty it prints nothing, exits 0, and stderr has no
        `no matches found`;
      - the plan-status and pick-next-shell existence checks take the right
        branch in both the empty and non-empty cases;
      - `PROC_CMD=$(command ps -p "$$" -o comm=)` is non-empty.
- [ ] 3.3: Control test: the old `ls -t plans/*.md 2>/dev/null | head -5`
      prints nothing under the alias prelude. This proves the profile really
      applies aliases, so the suite can fail.
- [ ] 3.4: Add `aliases.bats` to the shell-compat CI job if the job lists
      files rather than the directory.

### Phase 4: Docs and release

- [ ] 4.1: CONTRIBUTING.md "Bash and zsh": replace the line-619 bullet with
      the three patterns above and name SHC-010.
- [ ] 4.2: Add a "Key Insights" entry (aliases plus `nomatch`) to
      `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`.
- [ ] 4.3: Patch changesets for `yellow-core`, `yellow-codex`,
      `yellow-browser-test` and `yellow-ci`. `yellow-ruvector` is unchanged.

## Validation

Run all of these before submitting:

- `pnpm validate:agents`
- `pnpm lint:plugins`
- `pnpm validate:shell-compat` (zero findings, SHC-010 included)
- `pnpm check:shell-parse` (needs zsh)
- `pnpm test:shell-compat` (needs zsh; includes the new `aliases.bats`)
- `pnpm vitest run tests/integration/validate-shell-compat.test.ts`
- `pnpm generate:manifests` then `pnpm validate:generated` (codex copies)
- `bats tests/` in `plugins/yellow-core` (`plan-status-parity`,
  `plan-commands`) and `plugins/yellow-ci` (`ssh-safety`, `validate`)
- `pnpm changeset` once per touched plugin, with the files committed

## Acceptance Criteria

- `pnpm validate:shell-compat` fails on a fixture that pipes a bare `ls`,
  `ps`, `du`, `df` or `top` from user-shell code, and passes on the tree.
- With `alias ls=eza`-style aliases (stood in for by `false`) under zsh,
  `/flow:work`, `/flow:review`, `/flow:decompose`, `/flow:pick-next-shell`
  and `/plan:status` list or detect plans correctly, and an empty `plans/`
  produces no `no matches found` noise.
- `plan-status-parity.bats` still matches its golden fixtures.
- Generated codex skill copies are in sync (`validate:generated`).

## Edge Cases

- A `plans/*.md` that is a symlink is dropped by `-type f`. Use
  `\( -type f -o -type l \)` if any workflow relies on symlinked plans
  (none found).
- `head` and `cut` could be aliased too. They are out of scope, since no
  common replacement changes their output.
- Global zsh aliases (`alias -g`) and suffix aliases are out of scope.
- A user function named `ls` is bypassed by `command`, but not by `\ls`,
  which is why pattern 3 uses `command`.

## Execution note

Phase 1 alone turns CI red until Phase 2 lands, so ship Phases 1 to 3 as one
PR, or as a two-PR stack with call sites first and the lint plus test on top.

## References

- CONTRIBUTING.md "Bash and zsh" (lines 586-660)
- `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`
- `scripts/validate-shell-compat.js` (`classifyLines`, `LINE_RULES`, `RULES`)
- `tests/shell-compat/helpers/shells.bash` (profiles), `wrappers.bats`
- `plugins/yellow-core/tests/plan-status-parity.bats`
