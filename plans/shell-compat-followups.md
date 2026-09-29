# Feature: Shell-compat follow-ups

## Overview

Issues found while landing the bash/zsh compatibility stack
(`plans/bash-zsh-shell-compatibility.md`, PRs #913–#921) that are outside its
scope. The two yellow-debt security items came from the stack's security
review; the user chose to track them here rather than widen the stack.

## Implementation

- [x] 1: yellow-debt — symlinked write targets (security review SS-2, P2).
      A cloned repo can ship `.debt/file-list.txt`, `.debt/scanners-to-run.txt`,
      `.debt/severity-filter.txt`, or `todos/debt/*.md.tmp` / `*.md.lock` as
      symlinks; bash writes through them (e.g. `.debt/file-list.txt ->
      ../.git/config` with filename-injected `core.fsmonitor` lines). Bash
      users were always exposed; zsh users lost the incidental noclobber
      refusal when the blocks moved into a bash child. Fix: refuse to run when
      `.debt`, `todos/debt` or the todo file is a symlink; write through
      `mktemp` in the same directory then `mv`; take the transition lock via
      `mkdir` or a mktemp'd fd instead of `exec 200>"$todo.lock"`.
- [x] 2: yellow-debt — pasted todo paths inside double quotes (SS-3, P2).
      `triage.md` and `debt-fixer.md` have the model paste a repo-controlled
      path into `"…"` inside the bash body; a filename containing `$(…)` or
      backticks executes. Fix: the model supplies only the numeric id
      (`^[0-9]{1,6}$`); the block globs `todos/debt/${id}-*.md`, requires one
      match whose basename fits the todo pattern, and filters nonconforming
      names in triage Step 2 and the SessionStart counter.
- [x] 3: yellow-debt — positional arguments inside wrapped blocks (SS-5).
      Done in the PR #917 review round: `fix.md`, `audit.md` and
      `status.md` pass their arguments as single-quoted operands
      (`bash /dev/fd/3 '<todo-path>' 3<<'TAG'`, values containing `'`
      rejected), and SHC-009 accepts quoted operands.
- [x] 4: git-push hook friction on six blocks (pre-existing on main). The
      detector already classified these as `unverifiable` before the stack;
      wrapping did not change that (asserted by
      `tests/integration/shell-compat-hook-parity.test.ts`):
      `yellow-debt/agents/remediation/debt-fixer.md` (two blocks),
      `yellow-debt/commands/debt/{audit,fix,status}.md`,
      `yellow-ruvector/commands/ruvector/status.md` (provenance block).
      Find which construct the detector cannot verify and rewrite it, or
      extend the detector.
- [x] 5: `yellow-debt/commands/debt/sync.md` step 8a calls
      `extract_frontmatter` without sourcing `lib/validate.sh` (fails in
      every shell).
- [x] 6: `yellow-research/tests/context7-cache.bats` test 6 ("cache age <
      24h → skips") fails on code the stack did not touch; investigate.
- [ ] 7 (optional, deferred): Alias leakage: users' shell snapshots apply aliases (`cat=bat`,
      `ls=eza`, `ps=procs`) to markdown blocks. Consider a lint rule for
      flag-sensitive aliased commands at command position.
- [x] 8: git-push detector gaps around the fd-3 wrapper (second-pass
      security review, P3): `exec 3<<'X' … X` followed by `bash /dev/fd/3`
      is allowed because a bare `exec` heredoc is never scanned; and
      `git -c alias.x='!bash /dev/fd/3' x 3<<'T'` (also `GIT_SSH_COMMAND=`,
      `PAGER=`) loses the heredoc context — the latter predates the stack.
      Fix in both detector copies (keep them byte-identical): deny as
      unverifiable a shell whose script operand is `/dev/fd/N`,
      `/dev/stdin` or `/proc/self/fd/N` with no readable source of its own,
      and thread `stdinCtx` into `commandValueInvokesGitPush` /
      `gitConfigInvokesGitPush`.
- [x] 9: Run `tests/integration/check-shell-parse.test.ts` somewhere zsh is
      installed (the vitest integration job has none, so its parse cases
      skip in CI; the real-repo parse check does run in the zsh job).

Review-bot findings from the second `/review:resolve-stack` pass (P2,
recorded instead of fixed so the stack can merge; each thread links here):

- [x] 10: `scripts/lib/markdown-fences.js` `scanFences` — an unterminated
      fence inside a block quote (`> ```text`, quoted content, a blank line)
      stays open past the end of the quote and swallows a following
      top-level ```` ```bash ```` fence, so the lint and parse check never
      see that block. End `current` when its block-quote depth is lost
      (blank line or a line with a shallower depth), matching the list-exit
      rules. Keep `stripFencedContent` byte-identical on the repo's markdown.
      (PR #913 thread PRRT_kwDOQ3SUys6nJZD8.)
- [x] 11: `scripts/validate-shell-compat.js` `classifyLines` — heredoc
      detection runs on the raw line, so a quoted example such as
      `printf '%s\n' "use cat <<'EOF'"` opens a heredoc and hides every
      following line until `EOF` from the rules. Detect `<<` only outside
      quotes (reuse `scanQuotes`). (PR #914 thread PRRT_kwDOQ3SUys6nJXzg.)
- [x] 12: SHC-001 second-write tracking covers only bare-variable targets
      (`> "$f"`); two `>` onto the same literal path (`cmd > result`,
      `cmd2 > result`) are not flagged although noclobber refuses the
      second. Track literal targets in the per-block `written` set, minding
      `/dev/null`, `/dev/std*` and paths built from expansions.
      (PR #914 thread PRRT_kwDOQ3SUys6nJXzp.)
- [x] 13: SHC-002 misses a special-parameter assignment used as a
      condition (`if status=0; then`, `while path=x; do`): `CMD_START` omits
      the control keywords that the source and truncation scanners already
      accept. Add `if|while|until|then|do|else|elif|!` there.
      (PR #914 thread PRRT_kwDOQ3SUys6nJXz2.)

Review-bot findings from the third round (P2; no plugin file hits either
pattern today, so both are lint hardening):

- [x] 14: `classifyLines` compares a heredoc terminator after `trimEnd()`,
      so an fd-wrapper tag line with trailing spaces or tabs counts as
      closed although the shell does not recognise it; execution then feeds
      the would-be tag to bash as a command. Compare the raw line (after the
      `<<-` tab strip only) for fd wrappers, and report the trailing-blank
      tag as unclosed. (PR #921 thread PRRT_kwDOQ3SUys6nJqQp.)
- [x] 15: `existingFileVars` collects `f=$(mktemp)` from comment text and
      quoted examples (`rm -f "$f" # f=$(mktemp)`), so a later `> "$f"` is
      a false SHC-001. Scan only code outside comments and quotes (reuse
      `scanQuotes` and the comment cut). (PR #921 thread
      PRRT_kwDOQ3SUys6nJqQx.)
- [x] 16: `tests/shell-compat/controls.bats` has positive controls for
      `noclobber`, `extendedglob` and `rcquotes` but not `nocaseglob`, so
      dropping it from `profile_cmd`'s zsh-snapshot profile would go
      unnoticed. Add `[[ -o nocaseglob ]]` (or a mixed-case glob assertion)
      to the snapshot control. (PR #920 thread PRRT_kwDOQ3SUys6nJ-yR.)
- [x] 17: `commandSubstitutions` (used when blanking `[[ ]]` / `(( ))`
      spans for SHC-001) balances parentheses without regard to quoting, so
      a quoted `)` ends the substitution early and a later redirect in it
      (`[[ -n $(printf ')'; printf x > "$f") ]]`) is erased. Make the
      balancer skip quoted text and backslash escapes (reuse `scanQuotes`).
      (PR #921 thread PRRT_kwDOQ3SUys6nJ-1z.)

Review-bot findings from the fourth round (promised in PR #921 replies):

- [x] 18: `classifyLines` reads heredoc text inside a trailing comment as a
      real opener: `true # example: cat <<'EOF'` hides the following lines
      from the rules until `EOF`. Cut the comment (`scanQuotes` already
      finds it) before `HEREDOC_RE` runs. (PR #921 thread
      PRRT_kwDOQ3SUys6nKQUY.)
- [x] 19: `stripComparisons` ends a `[[ … ]]` span at a quoted `"]]"`, so
      `f=$(mktemp); [[ "]]" > "$f" ]]` gives a false SHC-001. Make the span
      matcher quote-aware. (PR #921 thread PRRT_kwDOQ3SUys6nKQUg.)
- [x] 20 (P1, CI coverage): the fork workflow
      (`.github/workflows/validate-schemas-fork.yml`, `shell-compat` target)
      runs the lint and the zsh parse check but not the `tests/shell-compat`
      bats runtime suite, and the main workflow's `shell-compat-tests` job
      skips fork PRs. Add the suite to the fork target with the same zsh,
      `bats@1.11.0` and kislyuk `yq==3.4.3` (pipx) installs as the main job;
      no secrets and no new actions. Update task 4.2's decision text in
      `plans/bash-zsh-shell-compatibility.md`. (PR #921 thread
      PRRT_kwDOQ3SUys6nKi8Q.)
- [x] 21: an fd wrapper split with a line continuation (`bash /dev/fd/3 \`
      then `3<<'TAG'`) is not recognised, so its body is treated as data and
      skipped by both checks. Join `\`-continued lines before wrapper
      detection, or reject the form with SHC-009 and a specific detail.
      (PR #921 thread PRRT_kwDOQ3SUys6nKi8Z.)

Found while landing items 1–21:

- [x] 22: `pnpm check:shell-parse` ignores the 36 blocks that fail to parse in
      both shells as templates or pseudo-code. One of them was a real bug
      (an apostrophe closing the `awk '…'` program in
      `yellow-council/skills/council-patterns/SKILL.md`, fixed here). Triage
      the rest and allowlist the genuine templates, so a new both-shell
      failure is reported. Done without an allowlist: a block both shells
      reject is parsed again with its `<placeholder>` tokens replaced, and
      fails unless both shells then accept it. All 36 are templates.
- [x] 23: `docs/operations/ci.md` omits the `shell-compat-tests` job and the
      `shell-compat` matrix target.

## Acceptance Criteria

- Items 1–2 have regression tests (symlinked target refused; a `$(…)`
  filename never executes).
- `pnpm validate:shell-compat`, `pnpm check:shell-parse` and
  `pnpm test:shell-compat` stay green.

## References

- Security review findings SS-2, SS-3, SS-5 in the stack's quality pass
  (`plans/bash-zsh-shell-compatibility.md`, "Quality Review").
- `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`
