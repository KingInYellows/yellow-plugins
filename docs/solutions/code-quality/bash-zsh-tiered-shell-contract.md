---
title: 'Bash/zsh tiered shell contract for plugin markdown and libraries'
date: 2026-09-28
category: code-quality
track: knowledge
problem: 'Fenced shell blocks run under the user login shell (often zsh with noclobber), so bash-only code in 19 plugins failed silently or aborted under zsh'
tags: [zsh, bash, noclobber, shell-portability, skill-authoring, command-authoring, validator, bats]
components: [yellow-core, yellow-debt, yellow-council, yellow-ci, yellow-ruvector, yellow-codex, yellow-semgrep, gt-workflow, github-workflow, yellow-linear, yellow-devin, yellow-composio]
---

# Bash/zsh tiered shell contract for plugin markdown and libraries

## Problem

Claude Code's Bash tool runs every fenced shell block in command, skill and
agent markdown under the user's login shell (`CLAUDE_CODE_SHELL` or `$SHELL`)
and replays a snapshot of the user's options and aliases. On a zsh machine
that is zsh with whatever the user set — `noclobber`, `extendedglob` and
`rcquotes` are common. `.sh` files with a bash shebang still run under bash,
so plugins were written and tested as if everything were bash.

Measured across all 19 plugins (784 fenced shell blocks), the zsh breakage
was not only the known `noclobber` class:

- `/council` and `/council:setup` refused to run: they checked
  `${BASH_VERSINFO[0]}`, which is empty in zsh ("bash 4.3+ required, found
  0.0").
- `/debt:triage` and `/debt:fix` sourced `lib/validate.sh`, whose lock used
  `exec 200>"$lock"` (zsh runs a command named `200`) and `trap … RETURN`
  (undefined signal): exit 127, todo untransitioned, stale `.lock`.
- The codex and semgrep setup version checks used `read -a`; under zsh the
  function errored and returned "new enough" for every version.
- `path=`/`for path in` rewrote `$PATH` (`/linear:delegate`, `/setup:all`,
  `gt-setup`, `compound-staging.sh`), and `local status` hit zsh's read-only
  `status`.
- 0-based array indexing read an empty first element (`/worktree:cleanup`
  and `gt-cleanup` ignored `--dry-run`).
- `: > "$fenced_path"` — the wipe of raw reviewer output after a council
  redaction failure — was refused by `noclobber`, leaving raw output on disk.

## Solution

A four-tier contract — inline blocks portable, bash-only code in a
`bash /dev/fd/3 3<<'TAG'` wrapper, bash-only libraries sourced only inside
it, dual-shell libraries sourced directly — enforced by
`scripts/validate-shell-compat.js` (SHC-001..009), `scripts/check-shell-parse.js`
and the `tests/shell-compat/` bats suite. CONTRIBUTING.md "Shell Scripts →
Bash and zsh" is the authoritative statement of the tiers and authoring
rules; the tier lists live in `scripts/shell-compat-config.json`. SHC-001
replaces the two manual greps in `zsh-noclobber-mktemp-stderr-redirect.md`.

## Key Insights

- **The wrapper form is constrained twice.** `bash <<'EOF'` feeds the script
  on stdin, so any command in the body that reads stdin (`gt`, a `node` CLI,
  `claude -p`, a bare `cat`) silently swallows the rest of the script.
  `bash -c "$(cat <<'EOF' …)"` fixes that but is refused as unverifiable by
  the stacked-PR providers' git-push PreToolUse hook, which cannot see into a
  command substitution. `bash /dev/fd/3 3<<'EOF'` satisfies both: bash reads
  the script from fd 3 and the hook inspects the heredoc body (it still
  catches a `git push` inside). SHC-009 flags the other two forms, and
  `tests/integration/shell-compat-hook-parity.test.ts` runs every wrapped
  block through the hook's classifier.
- **A clean lint is not proof.** yellow-debt's `validate.sh` linted almost
  clean until it was run under zsh; the multi-digit fd and RETURN-trap rules
  came from that run. Classify a library only after running it in both
  shells.
- **Dual-shell testing finds bash bugs too.** yellow-ci's
  `fence_log_content` ran `printf '--- begin …'`, which bash's `printf` reads
  as an invalid option — the begin fence around CI logs was never printed.
- **Read the markdown the way Claude does.** A CommonMark renderer ends a
  list-item fence whose body sits at column 0; Claude still runs it as one
  block. The shell checks use `extractRawFencedBlocks`
  (`scripts/lib/markdown-fences.js`), which follows the raw reading.
- **A required check must be able to fail.** Review of the first cut found
  checks that were required but passed while verifying nothing, all now
  fixed: a missing zsh skipped locally and in any CI whose `CI` was not the
  literal `true` (now `SHELL_COMPAT_REQUIRE_ZSH=1` or any `CI` value but
  empty/`false`/`0` fails); zero shell blocks, an unreadable plugin
  directory, or a killed or hung parse driver passed (each now errors);
  wrapper bodies are heredoc data to `zsh -n`, so nothing parsed them (now
  `bash -n` on each); a rollout `--report` flag that forced exit 0 stayed
  available (removed); and the hook-parity test used floors that let new
  unverifiable blocks in (now an exact per-file ratchet).
- **Expanded text counts.** `${reviewer^}` inside a multi-line double-quoted
  string, or in an unquoted-tag heredoc, is a zsh `bad substitution` even
  though it is not a command.

## Prevention

- Run `pnpm validate:shell-compat` after any shell edit in plugin markdown;
  CI requires it and the `shell-compat-tests` job.
- A newly sourced plugin library fails SHC-008 until it is classified; a new
  Tier 4 library fails `tests/shell-compat` until it has a driver.


---

## Update — 2026-10-14

### Promoting a marker-delimited command block to a Tier 4 library (plan-time, yellow-council synthesis)

Planned in `plans/complete/yellow-council-v2-four-cli-05-evidence-verification-and-finalization.md`
(Phase A) and shipped in #1198; this section predates it, so re-check the
file names before citing them.

**Why the inline layout was safe.** The `council-synthesis-lib` helpers sat
between `# >>> ... / # <<< ...` markers in `council.md`. `tests/lib/extract-synthesis-lib.bash`
cut that block out and `synthesis.bats` ran it, so the tests ran the same
bytes the Step 5 fences ran. Drift was impossible by construction.

**What moving it removes.** Once the helpers live in `lib/council-synthesis.sh`
and the fences `. "${CLAUDE_PLUGIN_ROOT}/lib/..."` them, the tests source the
file directly and nothing proves a fence still sources it or still calls a
name the library defines. Both sides can be renamed apart and stay green.

**Do these in the same PR as the move:**

1. Register the file under `tier4Libraries` in `scripts/shell-compat-config.json`
   (SHC-008) and add `tests/shell-compat/drivers/<plugin>--<basename>.sh`
   (`tier4-libraries.bats` fails without it).
2. Add a pinned-text test: the old markers are gone, and every fence that calls
   a library helper also sources the library.
3. Retarget the old extractor and its callers. Keep any generic marker helper
   another suite still uses.
4. Source through an existence check that names the missing file and routes
   through the command's existing abort path, so an unresolved
   `CLAUDE_PLUGIN_ROOT` fails loudly instead of leaving helpers undefined.
5. Keep cleanup-only blocks (cancel, final removal) inline. They must run when
   the library cannot be loaded.
