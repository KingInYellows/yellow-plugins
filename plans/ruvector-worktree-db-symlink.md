# Feature: ruvector Worktree DB Symlink

## Problem Statement

When a Claude Code session runs inside a git worktree (e.g.
`.worktrees/pr-review-123/`), the ruvector MCP server and all four hook
scripts resolve `${PWD}/.ruvector/` against the worktree path. Because
`.ruvector/` is gitignored (`**/.ruvector/` in `.gitignore` line 95), it
never carries into a new worktree. Every hook hits its
`if [ ! -d "$RUVECTOR_DIR" ]; then json_exit; fi` guard and silently
no-ops — no recall, no session-start context, no post-edit indexing.
Institutional memory is silently disabled in every worktree session.

Goal: when a worktree is created via `worktree-manager.sh create`, inject a
symlink `.ruvector -> <main-repo>/.ruvector` so the MCP server and hooks
reach the main repo's DB. Cleanup must remove the symlink without following
it into the main repo.

## Current State

- `plugins/yellow-core/skills/git-worktree/scripts/worktree-manager.sh`
  (POSIX `#!/bin/sh`, `set -e`) is the single canonical entrypoint for
  worktree creation. SKILL.md line 25 forbids raw `git worktree add`.
- `cmd_create` (line 109–143) calls `copy_env_files` at line 139 and stops.
  No `.ruvector` handling exists.
- `cmd_cleanup` (line 221–263) iterates `git worktree list --porcelain` and
  calls `git worktree remove "$path"` (line 251). No `rm -rf`. No symlink
  awareness.
- `cmd_copy_env` (line 200–218) is the documented retroactive-fix path for
  existing worktrees; it currently re-syncs `.env*` only.
- `commands/worktree/cleanup.md` is a separate 508-line LLM command that
  also calls `git worktree remove` across 7 worktree categories with no
  symlink awareness.
- `plugins/yellow-ruvector/CLAUDE.md` line 134 contains the aspirational
  note "`.ruvector/` is shared across git worktrees — concurrent indexing
  may race." This is currently inaccurate and becomes accurate after the
  fix (with a different limitation: races, not absence).

## Proposed Solution

Two new POSIX-shell helpers in `worktree-manager.sh`, called from `create`,
`copy-env`, and `cleanup`:

- `get_main_repo_root()` — returns the **main** repo root by stripping the
  trailing `/.git` from `git rev-parse --git-common-dir`. Required because
  `git rev-parse --show-toplevel` returns the **worktree** root when called
  from inside a worktree, which would point the symlink at itself.
- `link_ruvector_db()` — conditionally creates absolute symlink
  `${worktree_path}/.ruvector -> ${main_repo}/.ruvector`. Skips with
  `info` if the symlink already exists. Skips with `warning` if a real
  `.ruvector/` directory already exists. Skips with `warning` if the main
  repo has no `.ruvector/` (no dangling links).
- `cleanup_ruvector_link()` — removes the symlink at
  `${worktree_path}/.ruvector` only if `[ -L ]` is true, using `rm --` (no
  `-r`, no `-f`, no trailing slash). Failure does not abort the cleanup
  loop.

`commands/worktree/cleanup.md` gains the same symlink-removal step before
each of its 5 `git worktree remove` call sites (categories 3, 4, 5, 6, 7).

## Implementation Plan

### Phase 1: Shell helpers and cmd_create wire-up

- [ ] 1.1: Add `get_main_repo_root()` helper to `worktree-manager.sh`.
  `git rev-parse --git-common-dir` output is asymmetric (confirmed via
  git's t1500-rev-parse.sh test suite): returns `.git` (literal, relative)
  from main repo root, `../../.git` (relative) from a subdir of main, an
  absolute `/abs/.git` from a linked worktree, and echoes `--git-common-dir`
  literally on git < 2.5. Required minimum: git 2.5 (July 2015), introduced
  alongside the worktree feature.

  Implementation (POSIX `sh`, no bashisms):
  ```sh
  get_main_repo_root() {
      common=$(git rev-parse --git-common-dir 2>/dev/null) || {
          error "git rev-parse --git-common-dir failed"
      }
      case "$common" in
          --*) error "git >= 2.5 required for --git-common-dir" ;;
          .git) printf '%s' "$PWD" ;;
          */.git) printf '%s' "${common%/.git}" ;;     # absolute (worktree) or relative subdir
          *)
              resolved=$(cd "${common%/.git}" 2>/dev/null && pwd) \
                  || error "could not resolve git common dir: $common"
              printf '%s' "$resolved" ;;
      esac
  }
  ```
  The `*/.git)` branch handles both absolute (`/repo/.git`) and relative
  (`../../.git`) cases via the same `${var%/.git}` strip; the fallback
  branch resolves any unusual shape (bare repo, nested setups) by `cd`-ing
  to it. Sources: git-rev-parse docs + `t/t1500-rev-parse.sh` + pre-commit
  PR #2252 (the git<2.5 fallback precedent).
- [ ] 1.2: Add `link_ruvector_db(main_root, worktree_path)` helper. Order:
  (1) if `[ -L "$worktree_path/.ruvector" ]` → `info` already linked, return 0;
  (2) if `[ -e "$worktree_path/.ruvector" ] && [ ! -L ... ]` → real
  directory present, `warning` and return 0 (do NOT overwrite);
  (3) if `[ ! -d "$main_root/.ruvector" ]` → `warning "Main .ruvector/ not
  found at $main_root; skipping symlink"` and return 0;
  (4) `ln -s -- "$main_root/.ruvector" "$worktree_path/.ruvector"` or
  `error` on failure.
- [ ] 1.3: Add `cleanup_ruvector_link(worktree_path)` helper. Body:
  `link="${worktree_path}/.ruvector"`; if `[ -L "$link" ]` then
  `rm -- "$link" || warning "Failed to remove .ruvector symlink at $link"`.
  Never aborts cleanup loop.
- [ ] 1.4: Wire `link_ruvector_db` into `cmd_create` immediately after
  `copy_env_files` (line 139). Use `get_main_repo_root` (not `repo_root`
  from line 120) to derive the target.
- [ ] 1.5: Wire `link_ruvector_db` into `cmd_copy_env` after the existing
  `copy_env_files` call. Same `get_main_repo_root` usage.
- [ ] 1.6: Wire `cleanup_ruvector_link` into `cmd_cleanup` immediately
  before `git worktree remove "$path"` (line 251).
- [ ] 1.7: Normalize line endings: `sed -i 's/\r$//' worktree-manager.sh`
  after editing on WSL2.

### Phase 2: cleanup.md command parity

- [ ] 2.1: Locate the 5 `git worktree remove` call sites in
  `commands/worktree/cleanup.md` (lines ~343, 353, 387 + the two `--force`
  paths inside categories 6 and 7). Insert
  `[ -L "$WT_PATH/.ruvector" ] && rm -- "$WT_PATH/.ruvector"` before each.
- [ ] 2.2: Add an 8th success criterion to the success block (line ~492):
  "`.ruvector` symlink removed from each worktree directory before
  `git worktree remove` is called."
- [ ] 2.3: Add a code comment near the symlink removal step pointing at
  `worktree-manager.sh#cleanup_ruvector_link` as the canonical source —
  any logic change there must be mirrored here.

### Phase 3: Tests (bats)

- [ ] 3.1: Create `plugins/yellow-core/skills/git-worktree/tests/`
  directory and `worktree-manager.bats` (yellow-core has no existing bats
  fixture — bootstrap the convention used by `yellow-ruvector/tests/`).
  File header (matching `yellow-ruvector/tests/post-tool-use.bats:1-3`):
  ```bash
  #!/usr/bin/env bats
  bats_require_minimum_version 1.5.0
  ```
  No shared `helper.bash` exists in any other plugin — keep this file
  self-contained.
- [ ] 3.2: `setup()` builds a tmp git repo with `git init`, configures user
  identity, makes an initial commit on `main`, creates `.ruvector/` with a
  fixture `intelligence.json`, and adds `**/.ruvector/` to `.gitignore`.
- [ ] 3.3: Test cases (corresponds to AC-1 … AC-6 below):
  - `create: symlink exists, target is main .ruvector` (AC-1).
  - `create: main .ruvector missing → no symlink, warning to stderr` (AC-2).
  - `create: [ -d worktree/.ruvector ] is true via the symlink` (AC-3).
  - `create: real .ruvector dir already in worktree → skipped, dir intact`
    (P1-A guard).
  - `create: symlink already present → idempotent, no error` (P1-D guard).
  - `create-from-inside-worktree: target is MAIN repo, not nested
    worktree` (P0-A regression for `get_main_repo_root`).
  - `copy-env: retroactive fix on pre-existing worktree → symlink created`
    (AC-5).
  - `cleanup: symlink removed before git worktree remove; main
    .ruvector/intelligence.json intact` (AC-6, the safety-critical case).
  - `cleanup: pre-fix worktree with no .ruvector → no error` (P1-E).
- [ ] 3.4: Verify tests pass: `cd plugins/yellow-core && bats
  skills/git-worktree/tests/worktree-manager.bats`.

### Phase 3.5: Wire bats into CI (closes a pre-existing gap)

**Context:** Audit found four other plugins (yellow-ruvector, yellow-ci,
yellow-debt, yellow-review) already have `tests/*.bats` suites that no CI
job currently runs — they are orphaned. `bats` is not in the workspace
`devDependencies`, not in `.github/workflows/validate-schemas.yml`, and
not in any plugin's `package.json` scripts. Adding the new yellow-core
suite without CI wiring continues the pattern of orphaned tests.

This phase is **optional / scope-decision**: adding it solves a
pre-existing problem (good leverage) but expands the PR scope beyond the
ruvector worktree feature. If we defer it, the new suite still runs
locally via `bats tests/`; just not in CI.

- [ ] 3.5.1: Add `"test": "bats skills/git-worktree/tests/"` to
  `plugins/yellow-core/package.json` `scripts` block (currently `{}`).
- [ ] 3.5.2: Add new `plugin-shell-tests` job in
  `.github/workflows/validate-schemas.yml`. Steps: `apt-get install -y
  bats` (Ubuntu runner), `bats plugins/*/tests/ plugins/*/skills/*/tests/`
  glob to cover yellow-core's nested `tests/` dir AND the four orphaned
  suites in one job.
- [ ] 3.5.3: Add `plugin-shell-tests` to `report-metrics.needs` (line
  ~806) and `ci-status.needs` (line ~900) arrays so the gating logic
  blocks merge on shell-test failure.
- [ ] 3.5.4: Local sanity: confirm the orphaned suites still pass before
  merging — they may have rotted. If any fail, capture the failure as a
  follow-up issue rather than blocking this PR.

### Phase 4: Documentation + changeset

- [ ] 4.1: Update `plugins/yellow-core/skills/git-worktree/SKILL.md`: add
  `### ruvector DB Sharing` subsection under `## Usage`. Cover: symlink
  created at create time; absolute target; conditional skip when main DB
  absent; cleanup safety; **MCP-spawn-time qualifier** (the symlink only
  helps when Claude Code is launched from inside the worktree, since
  `RUVECTOR_STORAGE_PATH` resolves at MCP spawn).
- [ ] 4.2: Update `plugins/yellow-core/CLAUDE.md` git-worktree skill
  description to mention `.ruvector` symlink lifecycle.
- [ ] 4.3: Update `plugins/yellow-ruvector/CLAUDE.md` line 134 from the
  aspirational note to: "`.ruvector/` is shared across worktrees via a
  symlink injected by yellow-core's `worktree-manager.sh` at create time.
  Concurrent worktree sessions writing to the same DB may race; the
  ruvector CLI's internal session queue provides partial serialization
  but is not documented as cross-process-safe."
- [ ] 4.4: Create `docs/solutions/integration-issues/ruvector-worktree-db-symlink.md`
  capturing: confirmed root cause with file/line evidence, the fix, the
  three footguns (trailing-slash `rm -rf`, dangling symlink hook
  semantics, MCP-spawn-time path resolution), the security analysis of
  the symlink target derivation (P2-C: no injection vector), and the
  rollback note (P2-D: leftover symlinks resolve correctly until
  `git worktree remove` cleans them up).
- [ ] 4.5: Add a troubleshooting entry (if `troubleshooting.md` exists in
  the git-worktree skill, or inline in SKILL.md): "`.ruvector/` symlink
  missing in worktree → cause: ruvector not initialized before worktree
  was created → fix: initialize ruvector in main, run
  `worktree-manager.sh copy-env <name>`."
- [ ] 4.6: Run `pnpm changeset` and write a `minor` bump for `yellow-core`
  describing the symlink lifecycle. (Yellow-ruvector CLAUDE.md change is
  doc-only; no functional yellow-ruvector change so no changeset needed
  there per CLAUDE.md bump guide.)

### Phase 5: Validation

- [ ] 5.1: `pnpm validate:schemas`.
- [ ] 5.2: `pnpm typecheck && pnpm lint && pnpm test:unit`.
- [ ] 5.3: Manual end-to-end smoke: create a worktree in this repo via
  `worktree-manager.sh create test-ruvector-link from main`, confirm
  `readlink .worktrees/test-ruvector-link/.ruvector` returns the main
  repo path, run `/ruvector:status` from inside the worktree and confirm
  the same totalMemories count as from main, then `cleanup` and verify
  main `.ruvector/intelligence.json` size is unchanged.
- [ ] 5.4: Conventional-commit message: `feat(git-worktree): symlink
  .ruvector into worktrees for ruvector DB sharing` — passes the
  `gt-workflow:check-commit-message` regex.
- [ ] 5.5: `gt commit create -m "..."` then `gt stack submit`.

## Technical Specifications

### Files to Modify

- `plugins/yellow-core/skills/git-worktree/scripts/worktree-manager.sh` —
  three new helpers; three call sites in create / copy-env / cleanup.
- `plugins/yellow-core/commands/worktree/cleanup.md` — symlink removal
  before each `git worktree remove`; success-criteria addition.
- `plugins/yellow-core/skills/git-worktree/SKILL.md` — `### ruvector DB
  Sharing` subsection; MCP-spawn-time qualifier.
- `plugins/yellow-core/CLAUDE.md` — git-worktree skill description.
- `plugins/yellow-ruvector/CLAUDE.md` line 134 — replace aspirational
  note.

### Files to Create

- `plugins/yellow-core/skills/git-worktree/tests/worktree-manager.bats` —
  9 test cases.
- `docs/solutions/integration-issues/ruvector-worktree-db-symlink.md` —
  design + footguns + security analysis.
- `.changeset/ruvector-worktree-db-symlink.md` — `yellow-core: minor`.

### Dependencies

None. POSIX shell + `git` + `ln` + `bats` (already used elsewhere).

## Acceptance Criteria

Each maps to a bats test in Phase 3.3.

- AC-1: After `create <name>`, `readlink "$worktree/.ruvector"` returns
  the absolute path of `${main_repo_root}/.ruvector`.
- AC-2: After `create <name>` with no main `.ruvector/`, the worktree
  contains no `.ruvector` entry and a warning was printed.
- AC-3: After `create <name>` with `.ruvector/` linked,
  `[ -d "$worktree/.ruvector" ]` returns true (validates the hook guard
  `[ ! -d "$RUVECTOR_DIR" ]` will not trip on a healthy symlink).
- AC-4 (manual, Phase 5.3): `/ruvector:status` from inside the worktree
  reports the same `intelligence.json` stats as from main.
- AC-5: `copy-env <name>` is idempotent — re-running it does not error
  and does not duplicate the symlink.
- AC-6: After `cleanup`, the worktree's `.ruvector` symlink is removed
  AND the main repo's `.ruvector/intelligence.json` is byte-identical to
  before.

## Edge Cases & Error Handling

- **P0-A: `get_main_repo_root` from inside a worktree.** Use
  `git rev-parse --git-common-dir`. `--show-toplevel` returns the
  worktree root, not main. Tested in Phase 3.3.
- **P0-C: rm failure under `set -e`.** `cleanup_ruvector_link` wraps
  `rm` with `|| warning` so cleanup loop continues.
- **P1-A: Real `.ruvector/` directory already in worktree** (user ran
  `git worktree add` directly then `/ruvector:setup`). Detect with
  `[ -e ] && [ ! -L ]` → warn and skip. User keeps their isolated DB.
- **P1-B: MCP server resolves at spawn time.** Documented in SKILL.md:
  the symlink only helps when Claude Code is launched FROM the worktree
  directory. Pre-existing sessions started in main do not benefit.
- **P1-C: Worktree-of-worktree.** Resolved by P0-A — `--git-common-dir`
  always points at main from any worktree depth. Tested.
- **P1-D: copy-env idempotency.** `[ -L ]` check before `ln -s` makes
  re-runs no-ops.
- **P1-E: Pre-fix worktree (no `.ruvector` entry).**
  `cleanup_ruvector_link` short-circuits via `[ -L ]` false. Tested.
- **P2-A: Concurrent writes to shared `intelligence.json`.** Two write
  paths actually exist: (1) direct MCP writes to `intelligence/memory.rvdb`
  via the per-session MCP server process, (2) `pending-updates.jsonl`
  read-then-truncate pattern (memory-manager step 8) that can interleave
  between sessions and silently drop entries. A `flock` wrapper at the
  plugin layer is **not viable** — both write paths run inside the
  ruvector MCP server process, not in shell wrappers we control;
  `flock`-ing the MCP server start would serialize all MCP tool calls and
  break the UX. Posture: document-only (option a). Mitigation is
  behavioral: avoid simultaneous Claude Code sessions with active memory
  writes against the same project. Revisit if/when the ruvector binary's
  source confirms SQLite WAL mode (which would already provide
  cross-process write safety). Reference: `plugins/yellow-ruvector/CLAUDE.md:134`.
- **P2-B: Main `.ruvector/` deleted → dangling symlink.** POSIX `[ -d ]`
  on a dangling symlink is false, so hooks correctly no-op. Documented.

## Security Considerations

- Symlink target is derived from `git rev-parse --git-common-dir`, never
  from user input. Branch name is pre-validated by `validate_name()`
  which rejects `..`, `/`, `~`. No injection vector.
- Cleanup uses `rm --` (no `-r`, no `-f`, no trailing slash) on a
  `[ -L ]`-confirmed symlink only. Cannot follow into the main DB.
- `git worktree remove` does not follow symlinks during its directory
  cleanup. Confirmed from git source: `dir.c::remove_dir_recurse` uses
  `lstat()` (not `stat()`) per directory entry — symlinks are detected
  as `S_ISLNK`, fall through the `S_ISDIR` branch, and are removed via
  `unlink()` not recursion. Behavior has been consistent since git 2.17
  (worktree remove introduction, commit cc73385) across Linux and macOS
  because git uses its own POSIX C `lstat`/`unlink`, not the platform's
  `rm`. Gitignored symlinks also do not block removal (`git status
  --porcelain` excludes ignored entries). Explicit pre-removal of the
  symlink makes us independent of this behavior anyway — auditable,
  handles `git worktree remove` bypasses, and isolates us from any
  future git refactor.

## Migration & Rollback

- **Forward:** existing pre-fix worktrees do nothing until cleaned up;
  next `worktree-manager.sh copy-env <name>` repairs them retroactively.
- **Rollback:** revert the PR. Symlinks remain in any worktrees created
  during the rollout window. They resolve correctly to the main DB
  (still useful) and are removed naturally when `git worktree remove`
  takes the worktree directory. No data migration needed.

## References

- Brainstorm: `docs/brainstorms/2026-05-05-ruvector-worktree-db-sharing-brainstorm.md`
- `worktree-manager.sh:109-143, 200-218, 221-263, 92-106, 19-38, 58-61`
- `plugin.json` `RUVECTOR_STORAGE_PATH`: `plugins/yellow-ruvector/.claude-plugin/plugin.json:28`
- Hook DB-presence guard:
  `plugins/yellow-ruvector/hooks/scripts/session-start.sh:22-30`
- LLM cleanup command: `plugins/yellow-core/commands/worktree/cleanup.md`
  (343, 353, 387, 492-508)
- CLAUDE.md aspirational note: `plugins/yellow-ruvector/CLAUDE.md:134`
- `.gitignore:93-95`
- POSIX symlink rm semantics: `symlink(7)`,
  https://linux.die.net/man/7/symlink
- Trailing-slash rm footgun: nushell #12453,
  https://github.com/nushell/nushell/issues/12453
- bats convention precedent:
  `plugins/yellow-ruvector/tests/validate.bats:1-12`,
  `yellow-ruvector/tests/post-tool-use.bats:1-3` (shebang + min-version)
- git source — symlink-safe directory removal:
  https://github.com/git/git/blob/master/dir.c (`remove_dir_recurse`)
- git source — `git worktree remove` cleanness check:
  https://github.com/git/git/blob/master/builtin/worktree.c
  (`check_clean_worktree`, `delete_git_work_tree`)
- git commit cc73385 — `worktree remove` introduction (git 2.17.0,
  Q1 2018), "ignored files are not precious":
  https://github.com/git/git/commit/cc73385cf6c5c229458775bc92e7dbbe24d11611
- git docs — `git rev-parse --git-common-dir`:
  https://git-scm.com/docs/git-rev-parse
- pre-commit precedent for git<2.5 fallback:
  https://github.com/pre-commit/pre-commit/pull/2252
- Pre-existing CI gap (orphaned bats suites): `yellow-ci/tests/`,
  `yellow-debt/tests/`, `yellow-review/tests/` — no `package.json`
  scripts entry, no CI job in `.github/workflows/validate-schemas.yml`
