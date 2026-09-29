# Feature: Shell-compat follow-ups

## Overview

Issues found while landing the bash/zsh compatibility stack
(`plans/bash-zsh-shell-compatibility.md`, PRs #913–#921) that are outside its
scope. The two yellow-debt security items came from the stack's security
review; the user chose to track them here rather than widen the stack.

## Implementation

- [ ] 1: yellow-debt — symlinked write targets (security review SS-2, P2).
      A cloned repo can ship `.debt/file-list.txt`, `.debt/scanners-to-run.txt`,
      `.debt/severity-filter.txt`, or `todos/debt/*.md.tmp` / `*.md.lock` as
      symlinks; bash writes through them (e.g. `.debt/file-list.txt ->
      ../.git/config` with filename-injected `core.fsmonitor` lines). Bash
      users were always exposed; zsh users lost the incidental noclobber
      refusal when the blocks moved into a bash child. Fix: refuse to run when
      `.debt`, `todos/debt` or the todo file is a symlink; write through
      `mktemp` in the same directory then `mv`; take the transition lock via
      `mkdir` or a mktemp'd fd instead of `exec 200>"$todo.lock"`.
- [ ] 2: yellow-debt — pasted todo paths inside double quotes (SS-3, P2).
      `triage.md` and `debt-fixer.md` have the model paste a repo-controlled
      path into `"…"` inside the bash body; a filename containing `$(…)` or
      backticks executes. Fix: the model supplies only the numeric id
      (`^[0-9]{1,6}$`); the block globs `todos/debt/${id}-*.md`, requires one
      match whose basename fits the todo pattern, and filters nonconforming
      names in triage Step 2 and the SessionStart counter.
- [ ] 3: yellow-debt — positional arguments inside wrapped blocks (SS-5).
      `fix.md`, `audit.md` and `status.md` parse `$1`/`$#`, which are empty
      both in the Bash tool and in the wrapper, so `/debt:fix` prints its
      usage error. Document one hand-off — e.g.
      `bash /dev/fd/3 '<arg1>' 3<<'TAG'`, values single-quoted and any value
      containing `'` rejected — teach SHC-009's wrapper pattern to accept
      trailing arguments, and keep the in-block validators as the gate.
- [ ] 4: git-push hook friction on six blocks (pre-existing on main). The
      detector already classified these as `unverifiable` before the stack;
      wrapping did not change that (asserted by
      `tests/integration/shell-compat-hook-parity.test.ts`):
      `yellow-debt/agents/remediation/debt-fixer.md` (two blocks),
      `yellow-debt/commands/debt/{audit,fix,status}.md`,
      `yellow-ruvector/commands/ruvector/status.md` (provenance block).
      Find which construct the detector cannot verify and rewrite it, or
      extend the detector.
- [ ] 5: `yellow-debt/commands/debt/sync.md` step 8a calls
      `extract_frontmatter` without sourcing `lib/validate.sh` (fails in
      every shell).
- [ ] 6: `yellow-research/tests/context7-cache.bats` test 6 ("cache age <
      24h → skips") fails on code the stack did not touch; investigate.
- [ ] 7: Alias leakage: users' shell snapshots apply aliases (`cat=bat`,
      `ls=eza`, `ps=procs`) to markdown blocks. Consider a lint rule for
      flag-sensitive aliased commands at command position.
- [ ] 8: git-push detector gaps around the fd-3 wrapper (second-pass
      security review, P3): `exec 3<<'X' … X` followed by `bash /dev/fd/3`
      is allowed because a bare `exec` heredoc is never scanned; and
      `git -c alias.x='!bash /dev/fd/3' x 3<<'T'` (also `GIT_SSH_COMMAND=`,
      `PAGER=`) loses the heredoc context — the latter predates the stack.
      Fix in both detector copies (keep them byte-identical): deny as
      unverifiable a shell whose script operand is `/dev/fd/N`,
      `/dev/stdin` or `/proc/self/fd/N` with no readable source of its own,
      and thread `stdinCtx` into `commandValueInvokesGitPush` /
      `gitConfigInvokesGitPush`.
- [ ] 9: Run `tests/integration/check-shell-parse.test.ts` somewhere zsh is
      installed (the vitest integration job has none, so its parse cases
      skip in CI; the real-repo parse check does run in the zsh job).

## Acceptance Criteria

- Items 1–2 have regression tests (symlinked target refused; a `$(…)`
  filename never executes).
- `pnpm validate:shell-compat`, `pnpm check:shell-parse` and
  `pnpm test:shell-compat` stay green.

## References

- Security review findings SS-2, SS-3, SS-5 in the stack's quality pass
  (`plans/bash-zsh-shell-compatibility.md`, "Quality Review").
- `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`
