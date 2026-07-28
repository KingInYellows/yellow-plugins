# gt-cleanup — Worktree Cleanup Offer (Phase 6)

Moved verbatim from SKILL.md Phase 6. Read when the branch cleanup summary
(or a dry-run/nothing-to-clean exit) reaches Phase 6.

The host note in SKILL.md Phase 4 (Codex AskUserQuestion fallback) applies
to the prompt below — and on Codex, the `worktree:cleanup` skill is not
Codex-exposed: skip the Skill invocation and go directly to the
graceful-degradation message instead of attempting it.

After the branch cleanup summary, check if any git worktrees exist beyond the
main worktree:

```bash
WT_COUNT=$(git worktree list --porcelain | grep -c '^worktree ')
```

If `WT_COUNT` > 1:

If `$DRY_RUN` is true, skip AskUserQuestion and instead print:

```text
Note: $((WT_COUNT - 1)) git worktree(s) found. Run the worktree:cleanup skill with --dry-run to preview.
```

Then exit.

Otherwise, proceed with AskUserQuestion:

```text
You have $((WT_COUNT - 1)) git worktree(s). Would you like to scan and
clean them up too?

1. Yes — run worktree:cleanup
2. No — done
```

If the user chooses "Yes", invoke the Skill tool with
`skill: "worktree:cleanup"` (no args).

**Graceful degradation:** If the Skill call fails (yellow-core not installed or
command not found), report:

On Claude Code:

```text
worktree:cleanup skill not available. Install yellow-core via your host's
plugin manager.
```

On Codex: `worktree:cleanup` is not part of yellow-core's Codex-exposed skill
set, so installing yellow-core would not resolve this. Report:

```text
worktree:cleanup skill not available on this platform.
```

If `WT_COUNT` is 1 (only the main worktree), skip this phase silently.
