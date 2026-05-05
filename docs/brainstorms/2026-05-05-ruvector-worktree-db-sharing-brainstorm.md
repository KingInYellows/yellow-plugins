# Brainstorm: ruvector Worktree DB Sharing

**Date:** 2026-05-05
**Topic:** How to keep the ruvector vector DB accessible and functional when working inside git worktrees

---

## What We're Building

A mechanism so that when a Claude Code session runs inside a git worktree
(e.g., `.worktrees/pr-review-123/`), the ruvector MCP server and hook scripts
resolve to the main repository's `.ruvector/` database rather than looking for
a missing DB under the worktree path. The fix must require no changes to
plugin.json, the hook scripts, or `RUVECTOR_STORAGE_PATH` — only the
worktree creation and cleanup lifecycle in `worktree-manager.sh` needs
to change.

---

## Why This Approach

### Confirmed root cause (evidence from codebase)

**1. `.ruvector/` is gitignored — it never transfers to a worktree.**

`.gitignore` line 95: `**/.ruvector/`. Git worktree add creates a clean
working directory from the index; gitignored directories are not present.
The worktree starts with no `.ruvector/` at all.

**2. The MCP server path-resolves to the worktree root, not the main repo.**

`plugin.json` line 28:
```json
"RUVECTOR_STORAGE_PATH": "${PWD}/.ruvector/"
```
`${PWD}` is evaluated when Claude Code spawns the MCP server process for
a session. In a worktree session, `PWD` is the worktree path. So the MCP
server looks for `.worktrees/pr-review-123/.ruvector/` — which does not
exist.

**3. The hook scripts resolve the same way and fail silently.**

All three hook scripts (`session-start.sh:24`, `user-prompt-submit.sh:27`,
`pre-tool-use.sh:24`) use the same pattern:
```bash
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""')
PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit   # silently exits with {"continue": true}
fi
```
In a worktree, `.cwd` from the hook input is the worktree path. The DB
directory check fails, and every hook silently no-ops. No recall, no
session-start context, no post-edit indexing. Ruvector appears to work
but does absolutely nothing.

**4. The MCP server is not global — it is per-session.**

The user's hypothesis was that ruvector runs as a single global process
(one per Claude Code install) and would therefore always hit the same DB.
That is not how it works. Claude Code spawns one MCP server process per
project session. The DB is scoped by `${PWD}` at spawn time, which is
why two sessions — one in main, one in a worktree — see different
(or missing) DBs.

**5. The worktree-manager.sh only copies `.env*` files today.**

`worktree-manager.sh` `create` command calls `copy_env_files()` after
`git worktree add`. There is no equivalent step for `.ruvector/`. The
`copy_env_files` function already has a symlink-safety guard
(`[ ! -L "$f" ]`) — the same guard pattern applies to cleanup.

**6. The DB is a single file.**

Both `.ruvector/` directories in this repo contain only `intelligence.json`.
This is not a multi-file B-tree or WAL-based database. Concurrent write
safety depends on the ruvector CLI's own session queue, not on filesystem
locking across multiple files.

**7. The CLAUDE.md already anticipated this — aspirationally.**

`plugins/yellow-ruvector/CLAUDE.md` line 134: "`.ruvector/` is shared
across git worktrees — concurrent indexing may race." This was written as
a known limitation for a future shared-DB approach, not a description of
current behavior.

### Corrected mental model

```
Main session:     /repo/                      → MCP: /repo/.ruvector/           (works)
Worktree session: /repo/.worktrees/foo/       → MCP: /repo/.worktrees/foo/.ruvector/  (missing, all hooks no-op)

After fix (symlink at creation time):
Worktree session: /repo/.worktrees/foo/       → MCP: /repo/.worktrees/foo/.ruvector/
                                                          ↓ symlink
                                                    /repo/.ruvector/              (same DB)
```

---

## Key Decisions

### Recommended approach: A — Symlink on worktree creation

Extend `worktree-manager.sh create` to create a relative symlink
`.ruvector/ -> ../../.ruvector/` inside the new worktree directory, right
after the `.env` copy step. Extend `cleanup` to detect and remove the
symlink without following it into the main repo.

**Why this is the right approach:**

- Zero changes to `plugin.json`, hook scripts, or `RUVECTOR_STORAGE_PATH`.
  The `${PWD}/.ruvector/` path in plugin.json resolves correctly once the
  symlink exists.
- The gitignore pattern `**/.ruvector/` ignores the symlink entry itself
  (matched by path, not by target), so no tracking risk.
- All learnings recorded in any worktree session land in the main repo's
  `intelligence.json` — exactly the "project-scoped, not worktree-scoped"
  goal.
- The worktree-manager.sh is already the enforced single creation path
  (the SKILL.md says "NEVER use raw `git worktree add` directly"), so
  the symlink logic lives in exactly one place.

**Failure modes and mitigations:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Concurrent write races (two sessions writing simultaneously) | Low | ruvector CLI has internal session queue; single-file DB; concurrent worktree sessions are rare in this workflow |
| Cleanup `rm -rf` follows symlink and deletes main DB | High | Cleanup must check `[ -L "$RUVECTOR_LINK" ]` and use `rm` (not `rm -rf`) on the symlink entry only |
| Worktree created inside a path where `../../.ruvector/` is wrong | Low | Use `ln -s "$(realpath --relative-to="$worktree_path" "$repo_root/.ruvector")" "$worktree_path/.ruvector"` for a path-independent relative link |
| Main `.ruvector/` does not exist yet when worktree is created | Medium | Symlink creation should be conditional: skip with a warning if `"$repo_root/.ruvector"` does not exist, rather than creating a dangling link |

### Alternatives considered

**Approach B — Copy DB into each worktree (like `.env` files)**

Each `worktree create` copies `.ruvector/` as a real directory. The
worktree gets its own isolated DB snapshot. Learnings recorded in the
worktree are lost when the worktree is cleaned up.

- Pros: complete isolation, no write races
- Cons: learnings from PR reviews never make it back to main; requires
  explicit merge or export step; defeats the purpose of institutional memory
- Best when: you want branch-specific experimental learnings you intend to
  discard

**Approach C — Override storage path via env var per worktree**

Add a `.env.ruvector` file to each worktree (or a `.claude`-level env
override) that sets `RUVECTOR_STORAGE_PATH` to the absolute path of the
main repo's `.ruvector/`. Plugin.json or a wrapper script reads this
and passes it to the MCP server.

- Pros: no symlink on the filesystem, explicit path configuration
- Cons: requires changes to plugin.json MCP server config (env var
  indirection), adds a new per-worktree file to manage, more moving parts
  than a symlink
- Best when: the project uses a dotenv-based config system that already
  handles per-worktree overrides

The symlink approach (A) is strictly simpler: one `ln -s` command at
creation, one `rm` at cleanup, zero other changes.

---

## Open Questions

1. **Relative vs. absolute symlink target.** A relative symlink
   (`../../.ruvector`) works as long as the worktree stays at
   `.worktrees/<name>/`. If the worktree path depth ever changes (e.g., a
   nested subdirectory), the link breaks. Using `realpath --relative-to`
   at creation time makes it robust. Should the implementation default to
   relative (simpler, more portable) or absolute (more explicit)?

2. **What happens to learnings recorded before this fix?** Sessions that
   ran in worktrees before the symlink mechanism existed silently no-op'd.
   No DB was written. There is no data loss — there was simply no data
   recorded. No migration step needed.

3. **Should the `copy-env` subcommand also link `.ruvector/`?** The
   `worktree-manager.sh copy-env <name>` command re-syncs `.env` files
   to an existing worktree. It would be consistent to also repair a
   missing `.ruvector` symlink in that command, but it is not strictly
   needed for the create path to work correctly.

4. **Concurrent session safety ceiling.** The ruvector CLI's queue system
   provides some write serialization, but it is not documented whether
   it is safe across two simultaneous processes pointing at the same
   `intelligence.json`. If concurrent worktree sessions become a regular
   pattern, a file lock or `flock`-based wrapper around ruvector CLI
   writes may be needed. Defer until the pattern is observed in practice.
