# Feature: Bash and zsh compatibility for plugin shell code

## Overview

Claude Code's Bash tool runs every fenced bash block in command, skill and
agent markdown under the user's login shell, and it replays a login-shell
snapshot that carries the user's options and aliases. On the primary dev
machine that is zsh with `noclobber`, `extendedglob`, `rcquotes` and
`nocaseglob`. `.sh` scripts with a bash shebang still run under bash. This plan
fixes the zsh surface across all 19 plugins with a tiered contract, and adds
three guard layers so the fixes stay fixed:

1. A static lint.
2. A differential parse check.
3. A zsh runtime bats suite.

Source brainstorm:
`docs/brainstorms/2026-09-28-make-yellow-plugins-shell-scripts-and-co-brainstorm.md`
(Approach C, tiered by surface).

## Problem Statement

### Current Pain Points

- **zsh `noclobber` skips commands.** Writing with `>` or `2>` onto an existing
  file (usually one created by `mktemp`) fails, and zsh skips the command. The
  failure is usually hidden by `2>/dev/null` or `|| true`. An earlier sweep
  (`docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md`)
  fixed 16+ instances. Measurement shows about 29 markdown hits remain, and
  nothing prevents new ones.
- **Bash-only libraries are sourced into zsh.** Ten libraries with a bash
  shebang are sourced directly from markdown blocks, so they run under zsh.
  For example, sourcing yellow-ruvector `install-ruvector.sh` in zsh fails with
  `bad substitution` and leaves a stale install lock.
- **Bash-only constructs in inline blocks.** About 25 lines use `mapfile`,
  `${!arr[@]}`, `read -ra` and similar. A few assign `path=`, which replaces
  `PATH` in zsh, or `status=`, which is read-only in zsh.
- **One block fails to parse only in zsh.**
  `plugins/yellow-composio/skills/composio-patterns/SKILL.md:192` uses
  `( flock -x 200; … ) 200>"$LOCK_FILE"`.
- **No layer catches regressions.** ShellCheck cannot lint zsh (SC1071), CI
  has no zsh installed, and no test runs code from a zsh parent.

### User Impact

zsh users (the macOS default, and the maintainer's WSL2 setup) get commands
that silently skip writes, lose error capture, or abort partway. Bash users are
unaffected today and must stay unaffected.

## Proposed Solution

### Tiered contract (by surface)

| Tier | Surface | Rule | Guard |
|---|---|---|---|
| 1 | Inline fenced `bash`/`sh`/`shell` blocks in plugin markdown | Must run as written in bash and zsh. Use constructs both shells accept. Write `>\|` where an overwrite is intended. | Lint, differential parse check |
| 2 | Blocks that need bash-only constructs | Wrap the whole block in `bash <<'EOF' … EOF`. The block is then exempt from the bash-only rules. | Lint (wrapper detection) |
| 3 | `.sh` files with a bash shebang, hooks, `bin/` launchers | Bash-by-contract: never sourced into zsh or run as `zsh x.sh`. Hooks are invoked directly, so the user's shell does not matter. | Lint (contract rule), existing bats |
| 4 | Libraries sourced from markdown that contain no bash-only constructs | Dual-shell. Tested under bash and zsh (default and snapshot profile). | zsh runtime bats suite |

### Key Design Decisions

- **Sourced libraries, handled one library at a time (user decision).**
  - Wrap call sites for libraries that contain bash-only constructs. Each
    markdown block that sources one of these gets a `bash <<'EOF'` wrapper, so
    the `source` and the function calls run in one bash process. Return values
    and variables therefore stay in scope. The libraries are:
    - yellow-ci `hooks/scripts/lib/validate.sh`, `resolve-runner-targets.sh`
      and `redact.sh`
    - yellow-debt `lib/validate.sh`
    - yellow-core `lib/compound-staging.sh`
    - yellow-ruvector `lib/install-ruvector.sh` and `hooks/scripts/lib/resolve.sh`
  - Libraries with zero bash-only constructs move to Tier 4 and keep their
    direct `source` call sites:
    - yellow-core `lib/repo-profile.sh`
    - yellow-morph `lib/install-morphmcp.sh`
    - yellow-ruvector `hooks/scripts/lib/validate.sh`
  - The Phase 1 measurement re-confirms which bucket each library is in.
- **The parse check flags zsh-only failures (user decision).** A block fails
  only when `bash -n` accepts it and `zsh -n` rejects it. Template blocks with
  `<PLACEHOLDER>` tokens fail both shells and are skipped automatically, so
  there are no allowlist entries and no markdown edits for them.
- **No runtime execution of inline blocks (user decision).** Inline blocks get
  the lint and the parse check only. Runtime zsh coverage goes to Tier 4
  libraries and to Tier 2/3 invocation paths started from a zsh parent. Most
  blocks call `gh`, `gt` or MCP tools and cannot run in CI anyway.
- **Advisory first, then required (user decision).** The lint and the zsh job
  land in report-only mode. Per-plugin fixes follow. The last PR makes both
  blocking, including `ci-status` and the fork workflow. There is no permanent
  baseline allowlist.
- **One mechanism for bash-only code.** Use `bash <<'EOF'` for inline blocks
  and `bash script.sh` for files. `emulate -L sh` is allowed only as the first
  line of functions in Tier 4 libraries, and it must be guarded with
  `if [ -n "${ZSH_VERSION:-}" ]; then emulate -L sh; fi`. The `&&` form of that
  guard trips `set -e` under bash. Never use `emulate` in inline blocks,
  because it turns `noclobber` off and so hides the failure this plan exists to
  catch.
- **Stay on bats.** bats-core needs bash, so the zsh layer is a bats suite
  whose tests launch `zsh -f -o …`. ShellSpec is not adopted.
- **The allowlist caps counts per file and rule, and a reason is required.**
  Entries are keyed by file and rule ID, not by line, because line numbers
  drift. Stale entries (cap above the actual count) fail the lint.

### Trade-offs Considered

- **Rewriting every library for both shells:** rejected. yellow-ci
  `validate.sh` alone has 62 bash-only constructs, so the rewrite would put
  bash users and hooks at risk.
- **Wrapping every block (Approach B):** rejected. It would touch most of the
  876 blocks, hurt readability, and still leave one-liners exposed.
- **A blanket `bash -n` gate:** rejected. It fails on the 37 template blocks,
  which are not bugs.

## Implementation Plan

Stack order follows the phases. Run `/stack:status` before any branch or PR
mutation, and use only the enabled provider.

### Phase 1: Measurement and shared tooling (PR 1, no plugin changes)

- [x] 1.1: Add `scripts/lib/markdown-fences.js`, a CommonMark-aware fence
      extractor.
  - **Output:** one record per block,
    `{ file, startLine, lang, indent, body }`.
  - **Fences to handle:** backtick and tilde fences, closing fences that are
    the same character and at least as long, info strings (`bash title=x`),
    and four-backtick outer fences around nested fences.
  - **Dedent:** strip the opener's indent from the body. Blocks inside list
    items fail `zsh -n` otherwise.
  - **Shared logic:** move `fenceOpenerRe`/`fenceOpenerAt` and the state
    machine out of `scripts/validate-agent-authoring.js` (around lines
    547/594/610), and have that validator import them so there is one
    implementation.
  - **Prototype:**
    `/tmp/claude-1000/-home-kinginyellow--herdr-worktrees-yellow-plugins-zsh-compatibility/2c9a3151-c782-4681-a8fa-8f3faec1c7ed/scratchpad/extract.js`
    (876 blocks found).
- [ ] 1.2: Add `scripts/validate-shell-compat.js`, the static lint.
  - Copy the skeleton from `scripts/validate-provider-neutral-commands.js`
    (constants, walker, `main()`, `require.main` guard, exported helpers).
  - Support a `VALIDATE_SHELL_COMPAT_ROOT` env override, as
    `validate-doc-counts.js:33` does.
  - Support `--report` mode: print findings and exit 0.
  - **Scan scope:**
    - Include `plugins/*/{commands,skills,agents,references}/**/*.md` and
      plugin `CLAUDE.md`/`README.md`, fences tagged `bash`, `sh` or `shell`.
    - Exclude generated `plugins/*/codex/**` (fix the source and regenerate),
      `CHANGELOG.md`, and `docs/`.
  - **Rules for inline blocks.** SHC-001 to SHC-007 are skipped inside a Tier 2
    wrapper body, except SHC-001 and SHC-002, which apply inside
    `bash <<'EOF'` too. Every finding prints file, line, rule ID and a
    one-line fix hint.
    - SHC-001 (noclobber): `>`, `2>` or `&>` onto a variable assigned from
      `mktemp` in the same block, or onto a file created with `touch` in the
      same block. A `${var:-/dev/null}` target is exempt.
    - SHC-002 (special parameter): assigning `status`, `path`, `argv`,
      `pipestatus`, `match` or `MATCH`, with or without `local`, `export` or
      `declare`.
    - SHC-003 (bash-only builtin or expansion outside a wrapper):
      `mapfile`, `readarray`, `read` with `-a`, `-p`, `-n`, `-s` or `-d`,
      `${!…}`, `${v,,}`, `${v^^}`, `local -n`, `declare -n`, `BASH_REMATCH`,
      `BASH_SOURCE`, `PIPESTATUS`, `FUNCNAME`, `shopt`, `export -f`,
      `type -t`, `type -P`, `;;&`. `declare -A` alone is not flagged, because
      it works in zsh.
    - SHC-004 (echo escapes): `echo -e`, or `echo` with a backslash in its
      argument. Fix: use `printf`.
    - SHC-005 (array indexing): a literal numeric index `${a[N]}`. Fix: iterate
      over `"${a[@]}"`.
    - SHC-006 (test syntax): `==` inside single-bracket `[ … ]`.
    - SHC-007 (rcquotes): adjacent single-quoted segments `'…''…'`.
    - SHC-008 (unwrapped source): `source` or `.` of a Tier 3 library outside
      a `bash <<'EOF'` wrapper. The Tier 3 list lives in the config file
      (1.3).
  - **Wrapper detection (SHC-W).** A block counts as pinned when its first
    non-blank, non-comment line is `bash <<'TAG'` or `bash <<-'TAG'`, and the
    matching terminator closes it. The body of a `bash -c '…'` counts as
    pinned only for a single-line `-c` argument. A block whose only command is
    `bash path/to/script.sh …` has no inline body to check.
  - **Rules for `.sh` files:**
    - SHC-101: a `.sh` file under `plugins/` has no shebang and no
      `# shell-compat: library` marker.
    - SHC-102: a library listed as Tier 4 in the config contains a bash-only
      construct (the SHC-003 list). This keeps dual-shell libraries dual-shell.
- [ ] 1.3: Add `scripts/shell-compat-config.json`, holding the tier 3 and
      tier 4 library lists and the allowlist:

      ```json
      {
        "tier3Libraries": ["plugins/yellow-ci/hooks/scripts/lib/validate.sh"],
        "tier4Libraries": ["plugins/yellow-core/lib/repo-profile.sh"],
        "allowlist": {
          "plugins/x/skills/y/SKILL.md": {
            "SHC-005": { "max": 1, "reason": "..." }
          }
        }
      }
      ```

  - An empty `reason`, or a `max` above the actual count (a stale entry), is a
    lint error.
- [ ] 1.4: Add `scripts/check-shell-parse.js`, the differential parse check.
  - Batch the extracted blocks into one temp dir and spawn one loop per shell,
    not about 1,750 separate processes.
  - Fail only when bash accepts a block and zsh rejects it.
  - If zsh is missing, print a skip warning and exit 0 locally. Exit 1 when
    `CI=true`.
  - Honor `--report`.
- [ ] 1.5: Run the measurement.
  - Run `node scripts/validate-shell-compat.js --report` and
    `node scripts/check-shell-parse.js --report`.
  - Also run every extracted block through
    `zsh -f -o noclobber -o extendedglob -o rcquotes -n`.
  - Commit the per-plugin inventory as the checklist in Phase 2.
  - Classify each finding as real breakage (fix), style-level or false
    positive (allowlist with a reason), or a lint bug (fix the rule).
- [ ] 1.6: Wire the scripts into the build.
  - `package.json`: add `validate:shell-compat` and `check:shell-parse`
    aliases. Append `node scripts/validate-shell-compat.js --report` to the
    `validate:schemas` chain (line 20).
  - `.github/workflows/validate-schemas.yml`: add a `shell-compat` matrix
    target and `case` arm in the `validate-schemas` job (matrix around lines
    138-149, `case` around line 198). It runs the lint and, after
    `sudo apt-get install -y zsh`, the parse check, both in `--report` mode for
    now.
  - `.github/workflows/validate-schemas-fork.yml`: mirror the target.
- [ ] 1.7: Add integration tests.
  - `tests/integration/validate-shell-compat.test.ts`: follow the fixture and
    env-root pattern in `tests/integration/validate-doc-counts.test.ts`, with
    a positive and a negative fixture per rule. Also cover wrapper exemption,
    a codex-path exclusion, a stale allowlist entry, an empty reason, and
    `--report` exit 0.
  - `tests/integration/markdown-fences.test.ts`: cover the extractor edge
    cases (indented list-item fences, tilde fences, nested four-backtick
    fences, info strings, unterminated fences).
  - `tests/integration/check-shell-parse.test.ts`: skip when zsh is missing
    locally. Cover a bash-and-zsh failure (template, not flagged), a zsh-only
    failure (flagged), and the missing-zsh path under `CI=true`.

### Phase 2: Fix real breakage (one PR per plugin or small group)

Each PR fixes the source files, regenerates the Codex copies
(`pnpm generate:manifests`), runs `pnpm validate:agents`, `pnpm lint:plugins`,
`pnpm validate:shell-compat` and `pnpm check:shell-parse`, and adds a patch
changeset per touched plugin. The inventory from 1.5 is authoritative. The
items below come from research and must be confirmed against it.

- [ ] 2.1: yellow-composio `skills/composio-patterns/SKILL.md:192,210`. Fix the
      zsh parse failure in `( flock -x 200; … ) 200>"$LOCK_FILE"` and the
      noclobber hit after `touch "$LOCK_FILE"`. Use `exec 200>>"$LOCK_FILE"`
      or a `bash <<'EOF'` wrapper.
- [ ] 2.2: yellow-council. Fix the noclobber hits in
      `skills/council-patterns/SKILL.md` (for example `:602`, `:977`) and the
      `path=` assignments (`:674`, `:677`). Wrap the `declare -A` /
      `${!REVIEWER_*[@]}` blocks in `commands/council/council.md` (`:350`,
      `:1326`, `:1901`, `:1917`, `:2016`), or rewrite them without `${!`.
- [ ] 2.3: yellow-core.
  - Wrap `agents/workflow/staging-reviewer.md:235-251` (`declare -A`, `${!`,
    `read -ra`).
  - Rewrite the `${!BRANCHES[@]}` loop at `commands/flow/review.md:209` to
    iterate values.
  - Wrap the `compound-staging.sh` call sites in
    `commands/compound/review-staged.md:33,161`.
- [ ] 2.4: yellow-debt.
  - Wrap every markdown block that sources `lib/validate.sh`: `commands/debt/`
    `fix.md`, `audit.md`, `triage.md`, `status.md` and `sync.md`,
    `agents/remediation/debt-fixer.md`, `skills/debt-conventions`, and the
    plugin `CLAUDE.md` examples.
  - Fix the noclobber hits in `debt-fixer.md:159,208`.
  - The `mapfile` calls at `debt-fixer.md:81,192` end up inside the wrapper
    or get rewritten to `while IFS= read -r`.
- [ ] 2.5: yellow-ci.
  - Rename `local status` in `skills/ci-runner-health/SKILL.md:455`.
  - Wrap the call sites that source `validate.sh`, `resolve-runner-targets.sh`
    and `redact.sh` (`commands/ci/setup-runner-targets.md:33-34`,
    `agents/ci/failure-analyst.md:87`).
- [ ] 2.6: yellow-ruvector. Wrap the `install-ruvector.sh` and `resolve.sh`
      call sites in `commands/ruvector/setup.md` (`:56`, `:94`, `:106`,
      `:140`, `:178`) and `status.md` (`:23`, `:59`, `:78`, `:189`, `:264`).
- [ ] 2.7: github-workflow and yellow-devin. Rewrite the `mapfile -d '' -t`
      calls in `skills/github-stack-amend/SKILL.md:51` and
      `skills/github-stack-submit/SKILL.md:63` (NUL-delimited, so a
      `while IFS= read -r -d ''` loop inside a bash wrapper), plus the
      yellow-devin `mapfile`.
- [ ] 2.8: gt-workflow.
  - Check `skills/gt-cleanup/SKILL.md:55`: `${args_copy[$i]}` indexed from a
    0-based counter is off by one in zsh. Rewrite it to iterate values or
    shift positional parameters.
  - Confirm that the `gt-setup` `mq_err_log` hits are false positives
    (`${mq_err_log:-/dev/null}`).
- [ ] 2.9: yellow-linear `commands/linear/delegate.md:523` (`path=`), and the
      noclobber hits in yellow-browser-test, yellow-review, yellow-semgrep
      (`skills/semgrep-conventions/SKILL.md:246`) and yellow-research.
- [ ] 2.10: Allowlist every remaining style-level or false-positive finding
      with a reason. Target: the lint is clean in non-report mode, with fewer
      than 10 allowlist entries. Explain any larger number in the PR body.

### Phase 3: zsh runtime suite (PR after Phase 2)

- [ ] 3.1: Add the `tests/shell-compat/` bats suite, with a
      `helpers/zsh.bash` that provides `run_in_zsh <profile> <script>`.
  - It runs `zsh -f` so a contributor's `~/.zshrc` cannot change the result.
  - Profiles:
    - `default`
    - `snapshot`: `-o noclobber -o extendedglob -o rcquotes -o nocaseglob`
- [ ] 3.2: Add positive controls, so a silently dropped option cannot give a
      false green:
  - Under `snapshot`, `echo x > existing` fails.
  - Under `default`, it succeeds.
- [ ] 3.3: Test the Tier 4 libraries (`repo-profile.sh`, `install-morphmcp.sh`,
      ruvector `hooks/scripts/lib/validate.sh`). Source each one under bash,
      zsh `default` and zsh `snapshot`, and exercise its public functions with
      `run --separate-stderr`. Assert on stdout, stderr and the exit code
      separately. Reuse existing plugin mocks where relevant
      (`plugins/yellow-core/tests/mocks/`).
- [ ] 3.4: Test Tier 2/3 invocation from a zsh parent. For each Tier 3
      library, run the documented wrapper form
      (`bash <<'EOF' … source lib; fn … EOF`) from `zsh -f -o noclobber`, and
      assert that it succeeds and can overwrite an existing temp file.
- [ ] 3.5: Add the CI job `shell-compat-tests` to `validate-schemas.yml`.
  - Settings: `ubuntu-latest`, `timeout-minutes: 10`,
    `needs: [validate-schemas]`, SHA-pinned actions, and the same fork `if:`
    guard as the other jobs.
  - It installs `zsh` via apt and `bats@1.11.0` via npm, logs
    `zsh --version`, and runs `bats tests/shell-compat/`.
  - It starts as `continue-on-error: true` and is not in `ci-status`.
  - Add a local alias `test:shell-compat` in `package.json`.

### Phase 4: Flip to required, then docs (final PR)

- [ ] 4.1: Remove `--report` from the `validate:schemas` chain and from the
      `shell-compat` matrix arm in both workflows.
- [ ] 4.2: Make `shell-compat-tests` required. Drop `continue-on-error` and
      edit `ci-status` in four places (lines around 1642-1706): `needs:`, the
      `env:` result variable (`SHELL_COMPAT_RESULT`), the `if` chain, and the
      echo summary. Decide whether the fork workflow needs the job. It has no
      shell-test jobs today, so the lint and parse target cover forks.
- [ ] 4.3: Update the docs.
  - `CLAUDE.md`:
    - `validate:schemas` comment list (line 32)
    - Common Commands (the new aliases)
    - bats paragraph (the new top-level suite)
    - `ci-status` job list
  - `AGENTS.md`:
    - Targeted Validation Matrix (around line 133): add a bullet for fenced
      bash edits, and refresh the stale bats list at line 139.
    - Command aliases.
  - `CONTRIBUTING.md` `### Shell Scripts` (around line 578):
    - The tier contract.
    - The rules: `>|`, `printf`, no `status`/`path` names, `bash <<'EOF'` for
      bash-only code, the guarded `emulate -L sh` for Tier 4 only, and
      `command <tool>` where user aliases (`cat=bat`, `ls=eza`) could change
      flags.
    - How to run the checks locally without zsh.
- [ ] 4.4: Add a solution doc,
      `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`, with
      `validate-solutions.js` frontmatter. Update
      `zsh-noclobber-mktemp-stderr-redirect.md` so its done-criteria points to
      lint rule SHC-001 instead of the two manual greps.
- [ ] 4.5: Update the per-plugin `CLAUDE.md` where a plugin documents library
      sourcing (yellow-debt, yellow-ci, yellow-ruvector) to show the wrapper
      form.

## Technical Specifications

### Files to Create

- `scripts/lib/markdown-fences.js`: shared fence extractor.
- `scripts/validate-shell-compat.js`: static lint (SHC-001 to SHC-008,
  SHC-101, SHC-102).
- `scripts/shell-compat-config.json`: tier library lists and allowlist.
- `scripts/check-shell-parse.js`: differential `bash -n` / `zsh -n` check.
- `tests/integration/validate-shell-compat.test.ts`,
  `tests/integration/markdown-fences.test.ts` and
  `tests/integration/check-shell-parse.test.ts`.
- `tests/shell-compat/*.bats` and `tests/shell-compat/helpers/zsh.bash`.
- `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`.
- `.changeset/*.md`: one patch entry per touched plugin.

### Files to Modify

- `scripts/validate-agent-authoring.js`: import the shared fence helpers.
- `package.json`: the aliases and the `validate:schemas` chain.
- `.github/workflows/validate-schemas.yml` and `validate-schemas-fork.yml`: the
  matrix target, the new job, and `ci-status`.
- Plugin markdown listed in Phase 2, then the regenerated Codex copies.
- `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, and the per-plugin `CLAUDE.md`
  files.

### Dependencies

No new npm packages. CI adds `zsh` via apt. Bats stays at `bats@1.11.0` via
npm.

## Testing Strategy

- **Unit and integration (Vitest):**
  - one positive and one negative fixture per rule
  - extractor edge cases
  - allowlist governance: a stale entry and an empty reason both fail
  - report mode
  - parse check differential logic, and the missing-zsh behavior locally and
    in CI
- **Runtime (bats, `tests/shell-compat/`):**
  - Tier 4 libraries under bash, zsh `default` and zsh `snapshot`
  - Tier 2/3 wrapper invocation from a zsh `noclobber` parent
  - positive controls proving the options are in effect
- **Regression for bash users:** every fixed block still passes `bash -n` (the
  parse check runs both shells). The existing plugin bats suites stay green,
  since they run the libraries under bash.
- **Manual smoke test, in a zsh Claude Code session with the user's snapshot:**
  - `/ruvector:status`
  - `/debt:status`
  - `/ci:setup-runner-targets` (dry path)
  - `/flow:plan` (which sources `repo-profile.sh`)
  - one yellow-council `council-patterns` flow

## Acceptance Criteria

1. The lint is clean in blocking mode: `node scripts/validate-shell-compat.js`
   exits 0 and every allowlist entry has a reason.
2. `node scripts/check-shell-parse.js` reports no block that bash accepts and
   zsh rejects. It runs in CI with zsh installed.
3. SHC-001 finds no noclobber-class hits in plugin markdown sources. This
   replaces the two manual greps in the noclobber solution doc.
4. No markdown block sources a Tier 3 library outside a `bash <<'EOF'` wrapper
   (SHC-008 clean).
5. `bats tests/shell-compat/` passes locally and in CI, including the positive
   controls.
6. `shell-compat-tests` and the `shell-compat` matrix target are required in
   `ci-status`, and the matrix target is mirrored in the fork workflow.
7. `pnpm validate:schemas`, `pnpm validate:generated`, `pnpm validate:agents`,
   `pnpm lint:plugins`, `pnpm test:integration`, `pnpm lint` and
   `pnpm typecheck` pass. The existing plugin bats suites pass.
8. Every touched plugin has a patch changeset, and its Codex copies are
   regenerated.

## Edge Cases & Error Handling

- **Template blocks:** blocks with `<PLACEHOLDER>` tokens that fail both
  shells are ignored by the differential check. The lint still scans their
  lines, and placeholders do not trip any rule.
- **Cross-block state:** each block is a fresh process (see the
  `bash-block-subshell-isolation-in-command-files.md` solution doc). A wrapper
  must cover every line that uses the library's functions or variables. When a
  later block needs a value, pass it explicitly (printed and re-read), never
  through an implicit environment.
- **Path substitution inside wrappers:** `${CLAUDE_PLUGIN_ROOT}` is substituted
  as text in command markdown, and a quoted `'EOF'` heredoc keeps the
  substituted text literal. For each wrapped call site in skills and agents,
  keep the existing path-resolution method unchanged inside the wrapper, and
  confirm it during the manual smoke test.
- **Untrusted input:** never interpolate untrusted values (PR text, issue
  titles) into a heredoc body. Pass them as arguments
  (`bash -s -- "$arg" <<'EOF'`) or through the environment.
- **Exit codes through wrappers:** `bash <<'EOF'` returns the exit status of
  the last command in the body. Call sites that branched on a library
  function's status must keep that branch inside the wrapper, or end the
  wrapper with an explicit `exit`.
- **Users with other zsh options (`nomatch`, `extendedglob`):**
  - The lint's fix hints call for quoting `? [ * ^ ~ #` in arguments.
  - Unquoted-glob detection is style-level and advisory. Add it as a warning
    rule only if the Phase 1 measurement shows real hits.
- **Alias leakage (`cat=bat`, `ps=procs`):** not linted. `CONTRIBUTING.md`
  guidance recommends `command <tool>` where flags matter. Tracked as a
  follow-up.
- **Contributors without zsh:** the lint needs only Node. The parse check
  skips with a warning locally and fails when `CI=true`.
- **macOS bash 3.2 and `/bin/sh`:** out of scope. The fixes must not introduce
  new bash 4+ syntax outside Tier 2 wrappers, which already require the bash
  on PATH.
- **Command length:** wrappers make some commands and agents longer. Watch the
  RULE 21 ceilings (500 lines for commands, 300 for agents), which only warn.
  Move prose to `references/` rather than trimming behavior.

## Performance Considerations

The lint is a single Node pass over about 900 markdown files, taking seconds.
The parse check batches blocks into one shell loop per shell, instead of about
1,750 spawns. The new CI job runs separately from `plugin-shell-tests`, so the
10-minute budget there is unaffected.

## Security Considerations

- Keep the `'EOF'` delimiter quoted in every wrapper so the body is never
  expanded twice. Pass untrusted values as arguments.
- New CI steps pin actions by SHA and keep the fork-PR `if:` guard.
- New prose that quotes untrusted content follows the `security-fencing`
  skill.

## Migration & Rollback

- The stack lands in phase order. Phases 1 and 3 are report-only or advisory,
  so they cannot block unrelated PRs.
- Rollback for the gate: revert the Phase 4 PR, which puts `--report` and
  `continue-on-error` back. The fixes in Phase 2 stay, since they are valid in
  bash.
- Follow-ups not done here:
  - an alias-leakage lint
  - an unquoted-glob rule, if the measurement shows hits
  - a `dash` run for any library that claims POSIX compatibility

## References

- Brainstorm:
  `docs/brainstorms/2026-09-28-make-yellow-plugins-shell-scripts-and-co-brainstorm.md`
- Past learnings:
  - `docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md`
  - `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`
  - `docs/solutions/code-quality/agent-cli-bash-hardening-patterns.md`
- Validator patterns:
  - `scripts/validate-provider-neutral-commands.js`
  - `scripts/provider-neutral-commands-allowlist.json`
  - `scripts/validate-doc-counts.js`
  - `tests/integration/validate-doc-counts.test.ts`
- Fence logic to extract: `scripts/validate-agent-authoring.js` (around lines
  547, 594 and 610).
- CI: `.github/workflows/validate-schemas.yml`:
  - `plugin-shell-tests`: line 1404
  - `ruvector-shell-tests`: line 1508
  - `ci-status`: line 1642
- Claude Code shell behavior:
  - https://code.claude.com/docs/en/env-vars (`CLAUDE_CODE_SHELL`)
  - https://code.claude.com/docs/en/tools-reference (separate process per
    call)
  - shell snapshot issues anthropics/claude-code#96194 and #24564
- Tooling limits:
  - ShellCheck zsh support: koalaman/shellcheck#809
  - nvm multi-shell CI:
    https://github.com/nvm-sh/nvm/blob/master/AGENTS.md

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/refactor/shared-markdown-fences
- **Type:** refactor
- **Description:** Extract a shared CommonMark fence extractor into scripts/lib
- **Scope:** scripts/lib/markdown-fences.js, scripts/validate-agent-authoring.js, tests/integration/markdown-fences.test.ts
- **Tasks:** 1.1
- **Depends on:** (none)

### 2. agent/feat/shell-compat-lint
- **Type:** feat
- **Description:** Add the shell-compat lint and zsh-only parse check in report-only mode
- **Scope:** scripts/validate-shell-compat.js, scripts/shell-compat-config.json, scripts/check-shell-parse.js, package.json, .github/workflows/validate-schemas.yml, .github/workflows/validate-schemas-fork.yml, tests/integration/validate-shell-compat.test.ts, tests/integration/check-shell-parse.test.ts, plans/bash-zsh-shell-compatibility.md
- **Tasks:** 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
- **Depends on:** #1

### 3. agent/fix/zsh-composio-council
- **Type:** fix
- **Description:** Fix zsh parse, noclobber and path= breakage in yellow-composio and yellow-council
- **Scope:** plugins/yellow-composio/skills/composio-patterns/SKILL.md, plugins/yellow-council/skills/council-patterns/SKILL.md, plugins/yellow-council/commands/council/council.md, .changeset/
- **Tasks:** 2.1, 2.2
- **Depends on:** #2

### 4. agent/fix/zsh-core-debt-wrappers
- **Type:** fix
- **Description:** Wrap bash-only library calls and blocks in yellow-core and yellow-debt
- **Scope:** plugins/yellow-core/agents/workflow/staging-reviewer.md, plugins/yellow-core/commands/flow/review.md, plugins/yellow-core/commands/compound/review-staged.md, plugins/yellow-debt/commands/debt/, plugins/yellow-debt/agents/remediation/debt-fixer.md, plugins/yellow-debt/skills/debt-conventions/, plugins/yellow-debt/CLAUDE.md, .changeset/
- **Tasks:** 2.3, 2.4
- **Depends on:** #3

### 5. agent/fix/zsh-ci-ruvector-wrappers
- **Type:** fix
- **Description:** Wrap bash-only library calls in yellow-ci and yellow-ruvector
- **Scope:** plugins/yellow-ci/skills/ci-runner-health/SKILL.md, plugins/yellow-ci/commands/ci/setup-runner-targets.md, plugins/yellow-ci/agents/ci/failure-analyst.md, plugins/yellow-ruvector/commands/ruvector/setup.md, plugins/yellow-ruvector/commands/ruvector/status.md, .changeset/
- **Tasks:** 2.5, 2.6
- **Depends on:** #4

### 6. agent/fix/zsh-remaining-plugins
- **Type:** fix
- **Description:** Fix remaining zsh breakage across plugins and record the allowlist
- **Scope:** plugins/github-workflow/skills/, plugins/yellow-devin/, plugins/gt-workflow/skills/gt-cleanup/SKILL.md, plugins/yellow-linear/commands/linear/delegate.md, plugins/yellow-browser-test/, plugins/yellow-review/, plugins/yellow-semgrep/skills/semgrep-conventions/SKILL.md, plugins/yellow-research/, scripts/shell-compat-config.json, .changeset/
- **Tasks:** 2.7, 2.8, 2.9, 2.10
- **Depends on:** #5

### 7. agent/test/zsh-runtime-suite
- **Type:** test
- **Description:** Add the zsh runtime bats suite and an advisory CI job
- **Scope:** tests/shell-compat/, .github/workflows/validate-schemas.yml, package.json
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5
- **Depends on:** #6

### 8. agent/chore/shell-compat-required
- **Type:** chore
- **Description:** Make shell-compat checks required and document the tier contract
- **Scope:** package.json, .github/workflows/validate-schemas.yml, .github/workflows/validate-schemas-fork.yml, CLAUDE.md, AGENTS.md, CONTRIBUTING.md, docs/solutions/, plugins/yellow-debt/CLAUDE.md, plugins/yellow-ci/CLAUDE.md, plugins/yellow-ruvector/CLAUDE.md
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 4.5
- **Depends on:** #7
