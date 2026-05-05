---
title: 'ruvector .ruvector/ DB silently absent inside git worktrees'
category: integration-issues
track: knowledge
problem: 'ruvector MCP server and hook scripts silently no-op inside git worktrees because .ruvector/ is gitignored and ${PWD}/.ruvector/ resolves to the worktree path'
date: 2026-05-05
tags:
  - ruvector
  - git-worktree
  - mcp
  - plugin-authoring
  - yellow-core
  - yellow-ruvector
problem_type: silent-failure
components:
  - plugins/yellow-core/skills/git-worktree/scripts/worktree-manager.sh
  - plugins/yellow-core/commands/worktree/cleanup.md
  - plugins/yellow-ruvector/.claude-plugin/plugin.json
  - plugins/yellow-ruvector/hooks/scripts/session-start.sh
  - plugins/yellow-ruvector/hooks/scripts/user-prompt-submit.sh
  - plugins/yellow-ruvector/hooks/scripts/pre-tool-use.sh
  - plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh
severity: medium
---

# ruvector `.ruvector/` DB silently absent inside git worktrees

## Problem

When a Claude Code session runs inside a git worktree (e.g.
`.worktrees/pr-review-123/`), the ruvector MCP server and all four hook
scripts silently no-op. Recall returns no results, session-start context
is not injected, post-edit indexing never runs. The user sees a working
ruvector that does absolutely nothing.

## Root cause

Three independent facts compound:

1. **`.ruvector/` is gitignored.** `.gitignore` line 95 has
   `**/.ruvector/`. `git worktree add` creates the working directory from
   the index; gitignored entries are never present in a fresh worktree.
2. **MCP path resolves at spawn time against the worktree's PWD.**
   `plugins/yellow-ruvector/.claude-plugin/plugin.json:28` declares
   `"RUVECTOR_STORAGE_PATH": "${PWD}/.ruvector/"`. Claude Code spawns one
   MCP server process per session and expands `${PWD}` to the session's
   working directory — the worktree path.
3. **Hooks fail-closed without error.** Every hook reads the same pattern
   (`session-start.sh:24`, etc.):
   ```sh
   PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
   RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
   if [ ! -d "$RUVECTOR_DIR" ]; then json_exit; fi
   ```
   The directory is missing → silent `{"continue": true}` exit.

The MCP server is per-session (not global), so the brainstorm hypothesis
that "ruvector is global so it should work" was wrong.

## Fix

Inject an absolute symlink `${worktree}/.ruvector -> ${main_repo}/.ruvector`
during worktree creation. Three new helpers in `worktree-manager.sh`:

- `get_main_repo_root()` — uses `git rev-parse --git-common-dir` (NOT
  `--show-toplevel`, which returns the worktree root from inside a
  worktree) and strips the trailing `/.git`. Handles four output shapes:
  literal `.git` (relative, from main repo root), `*/.git` (absolute from
  worktree, or relative `../../.git` from a subdir), the bare-repo
  fallback, and the git<2.5 echo-back guard.
- `link_ruvector_db()` — idempotent: skips on existing symlink (`info`),
  skips on existing real directory (`warning`, preserves user's isolated
  DB), skips when main has no `.ruvector/` (no dangling links).
- `cleanup_ruvector_link()` — `[ -L ] && rm --` (no `-r`, no `-f`, no
  trailing slash) before `git worktree remove`. POSIX-safe; cannot
  follow into the main DB.

`commands/worktree/cleanup.md` (the separate 508-line LLM cleanup command)
gains a `remove_ruvector_link` helper called before every
`git worktree remove` invocation across categories 3, 4, 5, 6, 7.

## Footguns to avoid

- **`rm -rf "$worktree/.ruvector/"` with trailing slash.** POSIX trailing
  slash on a symlink-to-directory dereferences the link — the trailing
  slash recursively deletes the main DB. Always use `rm --` on a
  `[ -L ]`-confirmed entry, no `-r`, no `-f`, no trailing slash. Source:
  https://github.com/nushell/nushell/issues/12453,
  https://tookmund.com/2022/04/importance-of-the-trailing-slash.
- **`git rev-parse --show-toplevel` from inside a worktree.** Returns the
  worktree root, not main. Symlinking to that path produces a
  self-referential dangling link. Use `--git-common-dir` instead.
- **MCP-spawn-time vs. process-runtime.** `RUVECTOR_STORAGE_PATH` is
  evaluated at MCP server spawn. The symlink only helps when Claude Code
  is launched from inside the worktree directory. A pre-existing main
  session that `cd`s into a worktree continues writing to main directly —
  that's actually fine, but worth understanding.
- **Dangling symlink semantics in hook guards.** POSIX `[ -d X ]` on a
  dangling symlink returns false. So if the main `.ruvector/` is later
  deleted while a worktree symlink still points at it, hooks correctly
  no-op rather than error. Documented as the safe failure mode.

## Concurrent-write caveat (deferred)

Two simultaneous Claude Code sessions (one in main, one in a worktree, or
two worktrees) both spawn an MCP server process pointing at the same DB.
Two write paths exist:

1. Direct MCP writes to `intelligence/memory.rvdb` from per-session
   `hooks_remember` calls.
2. `pending-updates.jsonl` read-then-truncate from the memory-manager
   agent — interleaving sessions can silently drop entries.

A `flock` wrapper at the plugin layer is **not viable**: both write paths
run inside the ruvector MCP server process, not in shell wrappers we
control. `flock`-ing the MCP server start serializes all MCP tool calls
and breaks UX. Posture: document only. Mitigation is behavioral —
avoid simultaneous Claude Code sessions with active memory writes against
the same project. Revisit if/when ruvector source confirms SQLite WAL
mode (which would already provide cross-process write safety).

## Why explicit pre-removal in cleanup is kept

`git worktree remove` uses `dir.c::remove_dir_recurse` internally, which
calls `lstat()` + `unlink()` per entry — symlinks are never followed
(see https://github.com/git/git/blob/master/dir.c). Behavior has been
consistent since git 2.17 (commit cc73385) across Linux and macOS,
because git uses its own POSIX C `lstat`/`unlink`, not the platform's
`rm`. Gitignored symlinks also do not block removal.

So explicit pre-removal of the symlink in `cleanup_ruvector_link` is
**defensive only, not required for safety.** It is kept anyway because:

1. The `lstat`/`unlink` behavior is not documented in user-facing git
   docs — derivable only from source. A future git refactor could
   theoretically change it.
2. It keeps cleanup auditable independent of git internals.
3. It handles bypass cases — if a user invokes `git worktree remove`
   directly without going through `worktree-manager.sh cleanup` or
   `/yellow-core:worktree:cleanup`, the symlink is still removed by
   git's directory traversal, but having explicit logic in our cleanup
   paths means the failure mode is predictable.

## Security analysis

The symlink target is derived from `git rev-parse --git-common-dir`,
never from user input. The branch name is pre-validated by
`worktree-manager.sh::validate_name` (rejects `..`, leading `/`, `~`,
allows `[a-zA-Z0-9._/-]`). No injection vector. The symlink lives at a
deterministic path inside the validated worktree directory. Cleanup uses
`[ -L ]`+`rm --` only — no recursive deletion can ever traverse into the
main DB.

## Rollback

If this PR is reverted, symlinks remain in any worktrees created during
the rollout window. They resolve correctly to the main DB (still useful)
and are removed naturally when `git worktree remove` deletes the worktree
directory (POSIX `unlink` on the symlink entry). No data migration
required.

## References

- Brainstorm: `docs/brainstorms/2026-05-05-ruvector-worktree-db-sharing-brainstorm.md`
- Plan: `plans/ruvector-worktree-db-symlink.md`
- git source — `dir.c::remove_dir_recurse`:
  https://github.com/git/git/blob/master/dir.c
- git commit cc73385 (`worktree remove` introduction, 2.17.0):
  https://github.com/git/git/commit/cc73385cf6c5c229458775bc92e7dbbe24d11611
- git docs — `git rev-parse --git-common-dir`:
  https://git-scm.com/docs/git-rev-parse
- pre-commit precedent for git<2.5 fallback:
  https://github.com/pre-commit/pre-commit/pull/2252
- POSIX `symlink(7)` — rm-without-r-on-symlink semantics:
  https://linux.die.net/man/7/symlink
- Trailing-slash footgun: https://tookmund.com/2022/04/importance-of-the-trailing-slash
- nushell #12453 — canonical example of the `rm -r link/` footgun:
  https://github.com/nushell/nushell/issues/12453
