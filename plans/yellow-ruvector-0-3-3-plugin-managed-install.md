# Feature: yellow-ruvector 0.3.3 — plugin-managed install, root launcher, co-edit

## Overview

Move `plugins/yellow-ruvector` from ruvector 0.2.34 (a global npm binary for
hooks plus a separate `npx` copy for the MCP server) to a single plugin-managed
`ruvector@0.3.3` install. The MCP server and every hook use that one copy, and
the server always starts from the project root. The same work fixes three
failures in today's hooks:

- Hook recall is near-random: the query is hash-embedded and compared against
  384d vectors.
- `post-edit` and `post-command` write noise memories. On a fresh store, those
  writes stamp it `hash`/64d, and the MCP server then refuses every real memory
  write.
- Co-edit data has never been recorded.

The last item gets working co-edit suggestions.

Delivered as three stacked PRs. Source brainstorm:
`docs/brainstorms/2026-09-26-yellow-ruvector-0-3-3-upgrade-and-co-edi-brainstorm.md`.

## Problem Statement

### Current Pain Points

1. **Version skew is structural.** Hooks need a global `ruvector` on PATH
   (`command -v` in all five hook scripts), while the MCP server runs
   `npx ruvector@0.2.34`. An `npm update -g` or nvm switch silently splits them.
   That split caused the store pollution the pin was added to fix.
2. **Store corruption (RuVector#995).** 0.2.34's MCP server saves
   `intelligence.json` non-atomically, which is the documented cause of the
   store flipping to hash/64d after parallel hook bursts. This is fixed upstream
   in 0.3.3 (commit 33cad21). It is recorded as `UPGRADE_BLOCKED_UPSTREAM` in
   `plans/yellow-ruvector-hook-contract-a.md`, and that block is now cleared.
3. **Wrong store on subdirectory launch.** `getIntelPath()` (0.3.3
   `bin/mcp-server.js:268`, `bin/cli.js:3232`) checks only `process.cwd()` and
   then `~/.ruvector`. `RUVECTOR_STORAGE_PATH` has no effect.
4. **Hook recall is meaningless on healthy stores.** In 0.2.34 it hash-embeds
   the query against 384d vectors ("recall quality degraded"). 0.3.3 fixes the
   embedding, but recall then takes 1.2–2.1 s warm (6.4 s on the first model
   download). That exceeds the 0.9 s UserPromptSubmit and 0.65 s SessionStart
   budgets, so it would silently inject nothing.
5. **Hooks damage the store.** Each `post-edit` and `post-command` call writes a
   near-empty memory (`"successful edit of ts in project"`). On a fresh store
   that write stamps provenance `hash`/64d, and the MCP server then refuses
   every `hooks_remember` (ADR-210).
6. **Co-edit data is never recorded.** `Intelligence.lastEditedFile` lives only
   in memory (`cli.js:3131`, `:3797`), and each hook is a new process, so
   `file_sequences` stays empty. The `pre-edit` output is thrown away
   (`pre-tool-use.sh:53`). The MCP server keeps its startup copy of
   `intelligence.json` and writes all of it back on every save
   (`mcp-server.js:223`, `:418-430`). Anything a hook adds to that file between
   saves is erased.
7. **MultiEdit is read from the wrong field.** The hooks read
   `tool_input.edits[].file_path`. Claude Code's MultiEdit carries a single
   top-level `tool_input.file_path`.

<!-- deepen-plan: codebase -->

> **Codebase:** (Pain point 3) Correction: `getIntelPath` is at
> `mcp-server.js:269`. Before falling back to `~/.ruvector` it also returns the
> project path when `cwd/.claude` exists, and it returns the project path again
> when there is no home store.

<!-- /deepen-plan -->

### User Impact

Memory injection returns noise. Real learnings can be silently refused. Worktree
and subdirectory sessions can write to `~/.ruvector`. Users must manage a global
npm install by hand.

### Value

- One pinned install with no skew.
- Real semantic recall at session start.
- Hooks that no longer damage the store.
- A working co-edit signal ("files usually edited with this one").

## Proposed Solution

### High-Level Architecture

```text
${CLAUDE_PLUGIN_DATA:-${XDG_DATA_HOME:-~/.local/share}/yellow-ruvector}/
  install-<lockhash12>/node_modules/ruvector/bin/cli.js   # one dir per lockfile
  current -> install-<lockhash12>                         # atomic symlink swap
  .install.lock/                                          # mkdir lock + pid

bin/start-ruvector.sh (MCP command)
  ensure install (lock, wait while owner alive) -> resolve root -> heal
  .ruvector symlink -> cd root -> exec node current/.../cli.js mcp start

hooks/scripts/lib/resolve.sh (sourced by every hook and the launcher)
  ruvector_resolve_root   git toplevel(.cwd) -> CLAUDE_PROJECT_DIR -> PWD
  ruvector_heal_store     (moved out of session-start.sh)
  ruvector_resolve_bin    RUVECTOR_BIN (test seam) -> DATA/current/... -> fail
  ruvector_node_ok        node major >= 20
  timeout probe + run_budgeted (moved out of session-start.sh)

<root>/.ruvector/coedit.json          plugin-owned co-edit pairs (jq only)
<root>/.ruvector/coedit-sessions/<sid> last edit + surfaced set per session
```

### Key Design Decisions

1. **Plugin-managed install (morph pattern), keyed by lockfile hash.**
   - `npm ci --ignore-scripts` into `install-<hash>`, then swap `current`
     atomically with `ln -sfn` on a temp link followed by `mv -T`.
   - Keying by hash means a version bump never deletes `node_modules` from under
     a running MCP server, whose ONNX imports load lazily.
   - Prune install dirs other than `current` and the previous one.
   - Pass through `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` (and lowercase),
     `NODE_EXTRA_CA_CERTS` and `npm_config_*`/`NPM_CONFIG_*` into the `env -i`
     install.
2. **Root resolution checks git first:**
   `git -C "$cwd" rev-parse --show-toplevel`, then `CLAUDE_PROJECT_DIR`, then
   `PWD`. The launcher uses `$PWD`; hooks use the stdin `.cwd`. Linked worktrees
   keep the existing symlink-to-main model, now healed synchronously in the
   launcher before `exec`, which removes the "only helps the next session" race.
3. **DATA fallback.** When `CLAUDE_PLUGIN_DATA` is unset (older Claude Code,
   Cursor bridge), use `${XDG_DATA_HOME:-$HOME/.local/share}/yellow-ruvector`,
   with the same HOME or /tmp prefix validation as morph.
4. **Install waiting.**
   - The launcher waits while a live lock owner is installing, for up to
     `RUVECTOR_INSTALL_WAIT` seconds (default 25, under Claude Code's MCP
     startup timeout). If it gives up, it prints one stderr hint naming
     `/ruvector:setup` and `MCP_TIMEOUT`.
   - Hooks never wait. If `current` is missing, or the lock exists with a live
     owner, they exit with the silent allow JSON.
5. **Recall timing.**
   - SessionStart runs one semantic `hooks recall` with a 4.5 s internal budget;
     the catalog timeout goes from 3 to 6.
   - `hooks session-start --resume` is dropped: it only bumps stats and costs a
     second node start.
   - The UserPromptSubmit hook and its tests are deleted.
   - The prewarm downloads the ONNX model once, detached, under the install
     lock, so SessionStart does not pay the 6.4 s cold download.
6. **An offline first session can't stamp the store `hash`.** This decision was
   revised after deepen-plan (user decision): `RUVECTOR_EMBEDDER=minilm` does
   not help, because the MCP server swallows the engine error and falls back to
   hash (see the note below).
   - When the store has no `embeddingProvenance` stamp, the launcher first warms
     the model with `node cli.js embed text "warmup"`, bounded at about 15 s and
     judged by its output rather than its rc.
   - If the model is still not cached (offline), the launcher starts MCP with
     `hooks_remember` removed from `RUVECTOR_MCP_ALLOW` for that session, so the
     server is read-only and cannot stamp the store.
   - A stamped store, or a warm model, keeps the normal five-tool allowlist.
   - `/ruvector:status` reports the read-only mode and how to leave it (the next
     session with network).
7. **Co-edit is plugin-owned, not ruvector-owned.**
   - Pairs live in `.ruvector/coedit.json`, which only the plugin writes, using
     jq plus a temp file and `mv`, under a non-blocking mkdir lock (skip if
     busy).
   - The MCP server's save would erase anything the hooks add to
     `intelligence.json` (`mcp-server.js:223`, `:418-430`), which rules that
     file out.
   - Paths are stored root-relative and `realpath`-normalized.
   - Last-edit state is per session (`coedit-sessions/<session_id>`), so
     worktrees and concurrent sessions sharing the symlinked store never produce
     false pairs.
   - `hooks_coedit_suggest` stays out of the MCP allowlist. The on-demand path
     is a new `/ruvector:related` command.
8. **Removed hooks.**
   - `post-edit` and `post-command` go (noise and stamp poisoning).
   - The `Stop` hook goes: `session-end` only exports metrics, yet it rewrites
     the whole store every turn and races the MCP server's saves.
   - The `PostToolUseFailure` registration goes: co-edit only needs successes.

<!-- deepen-plan: codebase -->

> **Codebase:** (Decision 3) Morph can't be copied as is:
>
> - `yellow_morph_validate_paths` hard-fails when `CLAUDE_PLUGIN_DATA` is unset
>   (`install-morphmcp.sh:23-26`), so the XDG fallback is new code.
> - `needs_install` diffs the lockfile at the DATA root (`:80-85`). The
>   hash-directory scheme needs its own sync check: the lockfile hash vs the
>   target of `current`.
> - Morph passes no proxy or CA variables and doesn't use `--ignore-scripts`
>   (`:172-182`).
> - BSD `realpath` lacks `-m`. Reuse morph's capability probe (`:38-72`).

<!-- /deepen-plan -->

<!-- deepen-plan: external -->

> **Research:** (Decision 4) `MCP_TIMEOUT` is in milliseconds, but its default
> and the on-timeout behavior (retry vs failed for the session) are not
> documented (https://code.claude.com/docs/en/mcp.md). Measure it on the current
> Claude Code during task 1.1 before fixing the 25 s wait.

<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->

> **Codebase:** (Decision 6) **This decision does not work for the MCP server.**
>
> - `bin/mcp-server.js:490-496` wraps `engine.remember()` in `try {} catch {}`
>   and then falls back to hash at `:511-518`.
> - On a store with no stamp yet, `checkVectorWrite` (`:369-371`) stamps it
>   `hash`.
> - Under minilm the engine throws (`dist/core/intelligence-engine.js:111`,
>   `:269`), and a constructor throw sets `engine = null` (`mcp-server.js:239`).
> - The MCP server never reads `RUVECTOR_EMBEDDER`. Only the CLI does
>   (`cli.js:3495`).
>
> Proposed replacement:
>
> 1. When the store has no stamp, the launcher first warms the model with
>    `embed text` (bounded).
> 2. If the model still isn't cached (offline), the launcher starts MCP with
>    `hooks_remember` removed from `RUVECTOR_MCP_ALLOW` for that session, so the
>    server is read-only and cannot stamp the store.
> 3. `/ruvector:status` explains the read-only mode.
>
> This needs a user decision.

<!-- /deepen-plan -->

<!-- deepen-plan: external -->

> **Research:** (Decision 7) `session_id` is a documented common field in
> PreToolUse, PostToolUse and SessionStart input
> (https://code.claude.com/docs/en/hooks-guide.md). Its stability across
> `--resume` is not documented.
>
> - No yellow-ruvector hook or fixture reads `session_id` today. Add it to every
>   fixture, and skip pairing when it is missing.
> - Reuse `yellow-core/hooks/scripts/_stop-capture-subshell.sh:31-36` (sanitize
>   with `tr -c 'A-Za-z0-9._-' '_'`, reject `.` and `..`) and the per-session
>   temp+rename writes in `yellow-core/lib/compound-staging.sh:12-22`.

<!-- /deepen-plan -->

### Trade-offs Considered

- **Keep global + `npx`, and warn on skew.** Rejected by the user: the warning
  detects skew but does not prevent it.
- **ruvector's `coedit-record` into `intelligence.json`.** Rejected: the MCP
  server erases it on its next save. File the upstream issue instead.
- **Per-prompt semantic recall with a 3 s budget.** Rejected by the user: it
  adds 1.5–2 s to every prompt.
- **One combined PR.** Rejected by the user in favor of three stacked PRs.

## Implementation Plan

Each PR branches from the previous one and goes through the enabled stacked-PR
provider (`/stack:status`). Each PR gets its own changeset.

### PR 1 — Foundation: plugin-managed 0.3.3, root launcher, recall rework (minor)

**Phase 1.1: Discovery (before writing code)**

- [ ] 1.1a: In a scratch dir with 0.3.3, check each of these:
  - Offline `hooks_recall` behavior on 0.3.3 (read-only mode must still answer
    recall).
  - Whether `ruvector embed "warmup"` (`cli.js:2231`) loads ONNX without
    creating or touching a `.ruvector/` store.
  - The model cache path `${RUVECTOR_CACHE_DIR:-$HOME}/.ruvector/models/`
    (`dist/core/onnx/loader.js:178-184`) is shared by hooks and MCP.
- [ ] 1.1b: Confirm 0.2.34 can still load a store written by 0.3.3 (rollback
      path). Record the result in Migration & Rollback.
- [ ] 1.1c: Confirm `hooks reembed --dry-run` output in 0.3.3 still has the
      `targetProvenance` object that `status-provenance.bats` expects.

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.1a) The warm-up command is `embed text "warmup"`
> (`cli.js:2234`); `embed` alone is a parent command (`:2231`).
>
> - It loads ONNX and never constructs `Intelligence`, so it only writes
>   `~/.ruvector/models`.
> - Its catch at `:2288` logs without setting an exit code, so check stdout for
>   an embedding, not rc.
> - `hooks recall` does not save the store (`:4888-4898`), and
>   `targetProvenance` is still emitted (`:4985`). That confirms 1.1c.

<!-- /deepen-plan -->

**Phase 1.2: Packaging**

- [ ] 1.2a: Add `"dependencies": {"ruvector": "0.3.3"}` to
      `plugins/yellow-ruvector/package.json`, generate
      `plugins/yellow-ruvector/package-lock.json`
      (`npm install --package-lock-only --ignore-scripts`), and add
      `!plugins/yellow-ruvector/package-lock.json` to `.gitignore` (lines 45-52
      ignore lockfiles by default).
- [ ] 1.2b: Run `pnpm install` and commit the regenerated `pnpm-lock.yaml` (the
      workspace includes `plugins/*` and CI uses `--frozen-lockfile`). Confirm
      `pnpm audit` / the `security-audit` job passes with ruvector's tree. The
      tree has no install scripts: verified, with no preinstall, install or
      postinstall entries.
- [ ] 1.2c: Create `plugins/yellow-ruvector/lib/install-ruvector.sh` from
      `plugins/yellow-morph/lib/install-morphmcp.sh`:
  - Use the `yellow_ruvector_` prefix, starting with `#!/bin/false`.
  - Keep the functions `validate_paths`, `needs_install`,
    `acquire_install_lock`, `release_install_lock` and `cleanup_failed_install`.
  - Add the DATA fallback, the `install-<hash>` directory plus the `current`
    symlink swap, `npm ci --ignore-scripts`, the proxy and CA passthrough,
    pruning, and a post-install smoke test (`node …/cli.js mcp start --help`,
    using the `if ! out=$(…)` form).
- [ ] 1.2d: Mirror `tests/integration/install-morphmcp.test.ts` as
      `tests/integration/install-ruvector.test.ts`, covering path validation,
      `needs_install`, the DATA fallback and the hash directory swap.

**Phase 1.3: Shared resolver and launcher**

- [ ] 1.3a: Create `hooks/scripts/lib/resolve.sh` with:
  - `ruvector_resolve_root`;
  - `ruvector_heal_store`, moved verbatim from `session-start.sh:47-89`;
  - `ruvector_resolve_bin`, which honors `RUVECTOR_BIN`, fails when the lock is
    held by a live pid, and requires `current`;
  - `ruvector_node_ok`, which requires Node 20 or later;
  - the `TIMEOUT_CMD` probe and `run_budgeted`, moved from
    `session-start.sh:112-138`.
- [ ] 1.3b: Create `bin/start-ruvector.sh` (mode 100755, LF), following
      `plugins/yellow-morph/bin/start-morph.sh`. Keep `set -euo pipefail`. It:
  1. validates paths;
  2. checks Node;
  3. installs under the lock, with the live-owner wait from decision 4;
  4. releases the lock explicitly before `exec`;
  5. resolves the root, heals the store and `cd`s there;
  6. exports `RUVECTOR_MCP_ALLOW`: the same five tools, or four
     (`hooks_remember` removed) in decision 6's read-only case, after the
     bounded model warm-up for an unstamped store;
  7. runs
     `exec node "$DATA/current/node_modules/ruvector/bin/cli.js" mcp start`.
- [ ] 1.3c: Create `hooks/scripts/prewarm.sh` (SessionStart, catalog timeout 5),
      modeled on `prewarm-morph.sh`. It uses `hook-json.sh` `json_exit`, so the
      output carries `permission` for Cursor. It runs a detached install, then
      the one-time model warm-up from 1.1a, and writes the subshell pid to the
      lock.

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.3a) The heal block (`session-start.sh:47-89`) works on
> the globals `PROJECT_DIR`/`RUVECTOR_DIR` at top level. Moving it into a
> function means passing those in as arguments, not copying it verbatim.
> `worktree-manager.sh` handles only the `.ruvector` symlink (`:169-244`,
> `:401-411`). `coedit.json` and `coedit-sessions/` live inside the shared
> target, so worktree removal needs no change.

<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.3b) Keep `npx` out of `bin/start-ruvector.sh`:
> `scripts/check-upstream-pins.js:239-260` scans `bin/*.sh` for `npx pkg@ver`.
> Morph's catalog shape (`command: "${CLAUDE_PLUGIN_ROOT}/bin/start-morph.sh"`,
> `args: []`) already passes the validators.

<!-- /deepen-plan -->

**Phase 1.4: Hooks**

- [ ] 1.4a: In all hooks, replace the `command -v ruvector` blocks
      (`session-start.sh:217-221`, `pre-tool-use.sh:31-35`,
      `post-tool-use.sh:44-48`, `stop.sh:30-34`) with sourcing `resolve.sh` and
      calling `ruvector_resolve_bin || json_exit`. Derive PROJECT_DIR from
      `ruvector_resolve_root "$CWD"`.
- [ ] 1.4b: In `session-start.sh`:
  - drop `--resume`;
  - make the two 0.65 s recalls a single
    `run_budgeted 4.5 … hooks recall -k 5 "<query>"`;
  - keep the provenance check (0.2 s) and `emit_recall_json`;
  - update the header budget comment.
- [ ] 1.4c: Delete `hooks/scripts/user-prompt-submit.sh` and
      `tests/user-prompt-submit.bats`.
- [ ] 1.4d: In `catalog/plugins/yellow-ruvector.json`:
  - set mcpServers to `command: "${CLAUDE_PLUGIN_ROOT}/bin/start-ruvector.sh"`,
    `args: []`;
  - in env, drop `RUVECTOR_STORAGE_PATH` and keep `RUVECTOR_MCP_ALLOW`;
  - remove UserPromptSubmit;
  - set the session-start timeout to 6;
  - add the prewarm SessionStart entry;
  - quote every command as `bash "${CLAUDE_PLUGIN_ROOT}/…"`.

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.4d) The hook commands are already quoted this way, so
> that sub-step is a no-op. The `plugin.json` snapshot (`...snap:993-1024`)
> includes `RUVECTOR_STORAGE_PATH`, so expect it in the snapshot diff.
> `scripts/lib/plugin-paths.js:28` only lists valid event names, so dropping
> `PostToolUseFailure` (PR 2) is harmless.

<!-- /deepen-plan -->

Then run `pnpm generate:manifests` and refresh the snapshot with
`pnpm vitest run tests/integration/generate-manifests-characterization.test.ts -u`.

**Phase 1.5: Commands, docs and cross-plugin**

- [ ] 1.5a: Rewrite `commands/ruvector/setup.md`:
  - CLI reference (16-33);
  - Step 1 probe and decision tree (40-80), which becomes "DATA install missing
    or out of sync";
  - Step 2a (82-97): source the lib, take the lock, install;
  - remove the `~/.local/bin` PATH steps (102, 120);
  - Step 3 (145-170): verify `current` and a smoke recall through the resolved
    binary;
  - remove `user-prompt-submit.sh` from the list at 127;
  - add a note that any global `ruvector` is no longer used;
  - add detection of leftover `ruvector hooks init` entries in
    `~/.claude/settings.json` or `.claude/settings.json`, with a warning and the
    `scripts/repair-cursor-pretooluse.sh` pointer.
- [ ] 1.5b: Update `commands/ruvector/status.md`:
  - Step 1: install dir, version, lockfile sync, Node version;
  - Step 6 (line 155): the dry-run uses the resolved binary instead of `npx`.
    Keep the `INTEL=.ruvector/intelligence.json` first line and the closing
    fence so the `status-provenance.bats` extractor still works;
  - add checks for a nested `.ruvector/` below the root and for leftover global
    hook entries;
  - add "hooks inactive: CLAUDE_PLUGIN_DATA unset, using fallback" when
    applicable.
- [ ] 1.5c: Update `commands/ruvector/seed-solutions.md`:
  - allowed-tools lines 11-13;
  - the Step 1.3 version gate (42-67), which checks the DATA install version
    instead;
  - Step 6 (248-266).
- [ ] 1.5d: Update `agents/ruvector/memory-manager.md:95`,
      `skills/memory-query/SKILL.md:114` (no `CLAUDE_PLUGIN_DATA` paths in skill
      prose), `README.md`, `CLAUDE.md` (MCP Server, Hooks, Known Limitations,
      Maintenance, Testing), and `docs/security.md` (15, 22-23, 140-142, 209,
      462).
- [ ] 1.5e: Update `plugins/yellow-core/commands/setup/all.md`:
  - replace the line 63 probe and the READY rule at 435-439 with a DATA
    `current` + lockfile check, modeled on morph's block at 441-461;
  - update the example output at 689.

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.5a) Corrections to `setup.md` line numbers:
>
> - The PATH exports are at 104 and 122.
> - The hook-script list is at 128.
> - The Global Binary block is 144-169.
>
> Also update:
>
> - 192 ("Hook events (6)");
> - 198-225 ("global binary REQUIRED" plus the `npm -g` fix);
> - the Node `< 22.22.0` rows at 59 and 240. These conflict with the plan's Node
>   20; pick one floor (20 is ruvector's `engines`).

<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.5b) `status.md` also pins `npx` at 54, 274 and 281, and
> Step 1 is at line 22. `tests/status-provenance.bats:38-40,57-98` stubs `npx`
> on PATH, so switching Step 6 to the resolved binary needs a new stub seam
> (e.g. `RUVECTOR_BIN`). Add this to 1.6.

<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.5d) The plan misses these:
>
> - `docs/security.md` 159 (hook-event list), 210-213 (UPS, post-tool-use and
>   stop rows), 425 (tool table) and 456-470 (the "Local npm Dependencies"
>   section);
> - `skills/ruvector-conventions/SKILL.md:121-122,128`;
> - `commands/ruvector/seed-solutions.md:180` (user-prompt-submit fence);
> - `docs/architecture-overview.md:495`;
> - plugin `CLAUDE.md:55,110-113,137,141,208,271`;
> - `yellow-core/skills/git-worktree/SKILL.md:147` and `worktree-manager.sh:162`
>   (`RUVECTOR_STORAGE_PATH`).
>
> The last two are in yellow-core, which then needs its changeset.

<!-- /deepen-plan -->

Adding a changeset for yellow-core is part of this task.

- [ ] 1.5f: Delete `scripts/install.sh`, since setup now uses the lib. Remove
      its entry from `scripts/sync-shell-snippets.js:59` and update
      `tests/integration/sync-shell-snippets.test.ts:86` (FOCUS_TARGET).
- [ ] 1.5g: Update
      `docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`
      (the write race is fixed in 0.3.3, and the hook stamp path closes in PR 2)
      and `plans/yellow-ruvector-hook-contract-a.md` (the upgrade block is
      cleared).

<!-- deepen-plan: codebase -->

> **Codebase:** (Task 1.5f) `FOCUS_TARGET` feeds `seedAllTargets`
> (`sync-shell-snippets.test.ts:92-117`), so the whole ruvector-focused drift
> fixture must be retargeted to another plugin's install script. Also update the
> comments at `scripts/sync-shell-snippets.js:42-44`. The three pin tests in
> `session-start.bats` grep `scripts/install.sh` for `RUVECTOR_DEFAULT_VERSION`;
> 1.6b already repoints them.

<!-- /deepen-plan -->

**Phase 1.6: Tests**

- [ ] 1.6a: Bats run helpers set `RUVECTOR_BIN="$MOCK_BIN/ruvector"` and leave
      `CLAUDE_PLUGIN_DATA` unset. Tests for an absent binary unset
      `RUVECTOR_BIN` and point DATA at an empty temp dir.
- [ ] 1.6b: Repoint the pin-sync tests in `session-start.bats:191-241` and
      `memory-manager-flush.bats:3,19` at `package.json`
      `.dependencies.ruvector`, and assert that no `@0.2.34` string remains.
- [ ] 1.6c: New `tests/start-ruvector.bats`. Stub `node` and use a fake DATA
      install. Cover:
  - it `cd`s to the git toplevel when launched from a subdirectory;
  - it heals a linked-worktree symlink before exec;
  - fallback DATA when `CLAUDE_PLUGIN_DATA` is unset;
  - the wait-then-hint behavior when the lock is held by a live pid;
  - Node below 20 gives a clear error;
  - `RUVECTOR_MCP_ALLOW` holds the five tools for a stamped store. For an
    unstamped store with a failing `embed` stub it holds four (`hooks_remember`
    removed).
- [ ] 1.6d: New `tests/resolve.bats`, covering root order, the `RUVECTOR_BIN`
      seam, the lock-held skip and a missing `current`.
- [ ] 1.6e: `session-start.bats` asserts one recall call, no `--resume`, and a
      budget of 4.5 s or less.

### PR 2 — Hook hygiene and co-edit recording (minor)

- [ ] 2.1: `post-tool-use.sh`:
  - Delete `record_bash` and the `post-edit` call in `record_edit` (104-134).
  - Bash events become a no-op allow.
  - Edit, Write and MultiEdit (fixed to read `tool_input.file_path` instead of
    `edits[]`, lines 141-146) call `coedit_record "$rel"`.
- [ ] 2.2: New `hooks/scripts/lib/coedit.sh`:
  - `coedit_normalize`: realpath, reject paths outside the root, strip control
    characters, cap at 512 characters, skip `.ruvector/` and `docs/solutions/`.
  - `coedit_record`:
    1. Read `coedit-sessions/<session_id>` (last path and epoch).
    2. If the path differs and the edit is within 60 s, increment the symmetric
       pair in `coedit.json` under a non-blocking mkdir lock, using jq with a
       temp file and `mv`. Skip on contention.
    3. Rewrite the session file atomically.
  - Cap `coedit.json` at 5 000 pairs, evicting the lowest counts.
  - Prune session files older than 7 days on SessionStart.
- [ ] 2.3: Catalog: remove the `Stop` hook and the `PostToolUseFailure`
      registration. Delete `hooks/scripts/stop.sh` and `tests/stop.bats`. Narrow
      the PostToolUse matcher to `Edit|Write|MultiEdit`. Regenerate and refresh
      the snapshot.
- [ ] 2.4: Update `commands/ruvector/seed-solutions.md` Step 6: the write-freeze
      invariant now covers only `coedit.json`, which never touches
      `intelligence.json`, so seeding is safe. Update
      `docs/solutions/logic-errors/write-freeze-invariant-omits-passive-hook-path.md`
      and
      `docs/solutions/code-quality/ruvector-hook-rewrite-builtin-cli-delegation.md`,
      since PR 2 deliberately stops delegating to `post-edit`/`post-command`.
- [ ] 2.5: Tests in `post-tool-use.bats`:
  - Rewrite the fixtures with real envelope shapes, including MultiEdit with a
    top-level `file_path`.
  - A pair is recorded within the window. None is recorded across sessions or
    after 60 s.
  - Paths outside the root and `.ruvector/` paths are rejected.
  - Concurrency: 20 parallel invocations never corrupt `coedit.json`.
  - The resolved binary is never invoked.
- [ ] 2.6: Measure noise before and after (memories added per 10 edits plus 10
      commands on a fresh store) and put it in the PR body.
- [ ] 2.7: `CLAUDE.md` / `README.md`: update the hooks section and the component
      counts.

### PR 3 — Co-edit surfacing (minor)

- [ ] 3.1: `pre-tool-use.sh`:
  - On Edit, Write and MultiEdit (with `tool_input.file_path`), look up the
    partners of the normalized path in `coedit.json` with jq (no node start).
  - Keep up to 3 partners with a count of at least 3 that still exist under the
    root and are not yet surfaced for that file this session (tracked in the
    session file).
  - Emit them with `emit_recall_json "PreToolUse" "<fenced block>"`: an advisory
    header, a reference-only fence, and forged-terminator scrubbing.
  - Bash stays a no-op allow. Drop the background `pre-edit` and `pre-command`
    calls, whose output was always discarded.
  - Update the header comment and the `hook-json.sh:27-28` comment.
- [ ] 3.2: New command `commands/ruvector/related.md`
      (`/ruvector:related <file>`):
  - validate the argument through `lib/validate.sh`;
  - normalize it to a root-relative path;
  - print the top 10 partners with counts from `coedit.json`;
  - handle a missing file ("no co-edit history yet").

<!-- deepen-plan: external -->

> **Research:** (Task 3.1) The two docs passes disagree on whether PreToolUse
> `hookSpecificOutput.additionalContext` reaches the model. One read the hooks
> reference as supporting it; the other found it documented only for
> UserPromptSubmit and SessionStart
> (https://code.claude.com/docs/en/hooks-guide.md).
>
> - Add task 3.0: verify on the current Claude Code with a throwaway hook.
> - If it is not shown, emit the note from PostToolUse (after the edit, "files
>   usually edited with X"). The timing is arguably as useful, and the rest of
>   PR 3 is unchanged.

<!-- /deepen-plan -->

Register it in `CLAUDE.md`, `README.md` and the command counts.
`hooks_coedit_suggest` stays out of the allowlist, so `tests/mcp-allowlist.bats`
is unchanged.

- [ ] 3.3: Mention `/ruvector:related` in the `ruvector-semantic-search` agent
      ("files usually edited together").
- [ ] 3.4: Tests in `pre-tool-use.bats`:
  - Every path prints non-empty, valid JSON with `continue:true` and
    `permission:"allow"` (Cursor bridge).
  - Below-threshold pairs are not shown.
  - A suggestion is shown once per file per session.
  - A deleted partner file is filtered out.
  - An injected fence terminator in a path is neutralized.
  - p95 stays under 150 ms against a 5 000-pair file.
- [ ] 3.5: File two upstream RuVector issues, using the draft in the brainstorm
      doc:
  - `lastEditedFile` is not persisted across CLI processes;
  - the MCP server writes back its startup snapshot without reloading first,
    erasing CLI writes.

  Link both from `CLAUDE.md` Known Limitations.

- [ ] 3.6: `/flow:compound` solution doc
      `docs/solutions/integration-issues/ruvector-hook-writes-poison-provenance-and-coedit.md`,
      covering the hook stamp poisoning, the MCP snapshot clobbering, the
      never-populated `file_sequences`, and the MultiEdit field fix.

## Technical Specifications

### Files to Create

- `plugins/yellow-ruvector/package-lock.json`
- `plugins/yellow-ruvector/lib/install-ruvector.sh`
- `plugins/yellow-ruvector/bin/start-ruvector.sh`
- `plugins/yellow-ruvector/hooks/scripts/prewarm.sh`
- `plugins/yellow-ruvector/hooks/scripts/lib/resolve.sh`
- `plugins/yellow-ruvector/hooks/scripts/lib/coedit.sh` (PR 2)
- `plugins/yellow-ruvector/commands/ruvector/related.md` (PR 3)
- Tests: `tests/start-ruvector.bats`, `tests/resolve.bats`,
  `tests/integration/install-ruvector.test.ts`

### Files to Delete

- `plugins/yellow-ruvector/hooks/scripts/user-prompt-submit.sh` and
  `tests/user-prompt-submit.bats` (PR 1)
- `plugins/yellow-ruvector/scripts/install.sh` (PR 1)
- `plugins/yellow-ruvector/hooks/scripts/stop.sh` and `tests/stop.bats` (PR 2)

### Files to Modify

These are listed per task above. The main ones:

- `catalog/plugins/yellow-ruvector.json` and the generated `plugin.json`
- the snapshot
- `.gitignore` and `pnpm-lock.yaml`
- `session-start.sh`, `pre-tool-use.sh`, `post-tool-use.sh`
- `setup.md`, `status.md`, `seed-solutions.md`
- `yellow-core/commands/setup/all.md`
- `CLAUDE.md`, `README.md`, `docs/security.md`
- `scripts/sync-shell-snippets.js` and its test

### Dependencies

- `ruvector@0.3.3` (exact pin, plugin-local). Needs Node 20 or later.
  `scripts/check-upstream-pins.js` picks up the pin automatically.

### Data formats

```json
// .ruvector/coedit.json
{ "version": 1, "pairs": { "src/a.ts": { "src/b.ts": 4 }, "src/b.ts": { "src/a.ts": 4 } } }
// .ruvector/coedit-sessions/<session_id>
{ "last": "src/a.ts", "epoch": 1790000000, "surfaced": ["src/b.ts"] }
```

## Testing Strategy

- **Bats:** every hook suite, plus the new launcher, resolver and co-edit
  suites. Run `bats tests/` from `plugins/yellow-ruvector`.
- **Vitest:** the install-lib integration test, the manifest snapshot and the
  sync-shell-snippets test.
- **Validators:** `pnpm validate:schemas`, `pnpm validate:agents`,
  `pnpm lint:plugins`, `pnpm validate:versions`, `pnpm validate:generated`,
  `pnpm typecheck`, `pnpm lint`.
- **Manual (PR 1):**
  - A clean `CLAUDE_PLUGIN_DATA`: the first session installs, and
    `/ruvector:status` is green.
  - Launch from `src/`: the store is at the root.
  - A linked worktree shares the main store in the same session.
  - An offline first session runs read-only and leaves the store unstamped.
  - Time SessionStart with a cold model and with a warm one.
- **Manual (PR 2/3):** edit two files together three times, then see the
  suggestion on the next edit and in `/ruvector:related`. Call `hooks_remember`
  through MCP and confirm `coedit.json` is unchanged.

## Acceptance Criteria

1. `grep -rn "ruvector@0.2.34\|command -v ruvector\|npm install -g ruvector" plugins/ docs/security.md`
   returns nothing, except in CHANGELOG and history docs.
2. The MCP server and hooks run the same `cli.js` under `DATA/current`, and
   `/ruvector:status` reports its version as 0.3.3.
3. A session launched from a subdirectory reads and writes
   `<git-root>/.ruvector/intelligence.json`, checked with `/ruvector:status`
   `intel_path`.
4. SessionStart injects semantic recall on an `onnx-minilm` store: the JSON
   field `semantic: true` and no "degraded" warning. p95 is under 6 s warm. With
   a cold model or offline, it fails open with the allow JSON.
5. 20 edits plus 20 Bash commands on a fresh store leave `embeddingProvenance`
   null and add no memories.
6. Co-edit pairs in `coedit.json` survive an MCP `hooks_remember` save. 6a. An
   offline first session on a fresh store leaves `embeddingProvenance` null (MCP
   ran read-only).
7. PreToolUse and PostToolUse p95 stay under 1 s. Every PreToolUse path prints
   valid allow JSON.
8. A version bump of the pin installs into a new `install-<hash>` without
   disturbing a running MCP server.
9. CI is green, including `security-audit`, `changeset-check` and
   `plugin-shell-tests`.

<!-- deepen-plan: codebase -->

> **Codebase:** (Acceptance criterion 1) `tests/mcp-allowlist.bats:3` and
> `agents/ruvector/memory-manager.md:95` also match. They describe 0.2.34
> behavior, so reword them rather than delete them.

<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->

> **Codebase:** (Acceptance criterion 9) CI does not enforce these gates:
>
> - The yellow-ruvector bats suite runs in the advisory `continue-on-error` step
>   (`.github/workflows/validate-schemas.yml:1473-1493`).
> - `security-audit` runs `pnpm audit … || echo warning` (`:1029`), so it never
>   fails.
>
> The criterion should require running `bats tests/` and `pnpm audit` locally,
> with the output in the PR body. `pnpm install` also pulls ruvector's 12
> optional deps (`@metaharness/*` and others) into the workspace. Run the audit
> on that tree.

<!-- /deepen-plan -->

## Edge Cases & Error Handling

- **No DATA install and no network:** the launcher's install fails with one
  stderr hint and MCP does not start. Hooks exit silently. Status explains the
  problem and suggests `/ruvector:setup`.
- **An install is in progress:** the launcher waits for up to 25 s while the
  owner is alive. Hooks skip. A stale lock (dead pid) is recovered once, as in
  morph.
- **Offline with a fresh (unstamped) store and no cached model:** MCP starts
  read-only (`hooks_remember` withheld). Recall still answers, and the store
  stays unstamped until a session with network warms the model.
- **`CLAUDE_PLUGIN_DATA` is unset:** use the XDG fallback. Status notes this.
- **Node older than 20:** the launcher prints a clear error. Hooks exit
  silently. Setup blocks with an upgrade hint.
- **Non-git project:** the root falls back to `CLAUDE_PROJECT_DIR`, then `PWD`.
  Worktree healing is skipped.
- **A nested `.ruvector/` left by an earlier subdirectory launch:** status warns
  and offers a merge note. There is no automatic merge.
- **A hash-stamped legacy store:** keep the existing ADR-210 detection and the
  `reembed` remediation unchanged.
- **Leftover global `ruvector hooks init` entries:** setup and status detect and
  warn. They are never edited automatically, except through the existing repair
  script.
- **Concurrent sessions:** `intelligence.json` stays last-writer-wins
  (upstream). `coedit.json` skips writes when its lock is busy, so at worst one
  pair increment is lost.
- **Paths:** reject anything outside the root. Prefix `./` to arguments
  beginning with `-`. Strip control characters from suggestions.

## Performance Considerations

- Hook cost: `node cli.js` cold start is about 75 ms for fast-mode commands.
  Co-edit hooks use only jq, about 10 ms.
- SessionStart: one node start plus the ONNX load, 1.2–2.1 s warm, inside the
  4.5 s budget.
- Disk: about 62 MB per install dir, with at most two kept.

## Security Considerations

- `npm ci --ignore-scripts` under `env -i` with an explicit passthrough list,
  and an exact pin plus a committed lockfile. Upstream has shipped from an
  unmerged branch before (0.2.40), so the lockfile integrity hashes matter.
- DATA and ROOT prefix validation (morph `validate_paths`). The launcher and
  hooks never `eval` input.
- Recall and co-edit output is fenced as reference data. Paths are validated,
  and the MCP allowlist is unchanged.

## Migration & Rollback

- **Existing users:** the first session after the update installs into DATA. The
  global 0.2.34 is ignored, and setup says it can be removed with
  `npm uninstall -g ruvector`. Stores keep working: the stamp format and
  `compareProvenance` are unchanged.
- **Rollback:** revert the PR (the catalog goes back to `npx ruvector@0.2.34`).
  The DATA dir can be deleted. Whether 0.2.34 reads a store written by 0.3.3 is
  verified in 1.1b.

## References

- Brainstorm:
  `docs/brainstorms/2026-09-26-yellow-ruvector-0-3-3-upgrade-and-co-edi-brainstorm.md`
- Prior plan: `plans/yellow-ruvector-hook-contract-a.md`
- Pattern:
  `plugins/yellow-morph/{bin/start-morph.sh,lib/install-morphmcp.sh,hooks/scripts/prewarm-morph.sh}`
- Solution docs:
  - `docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`
  - `ruvector-worktree-db-symlink.md`
  - `ruvector-cursor-pretooluse-empty-stdout.md`
  - `docs/solutions/code-quality/hook-set-e-and-json-exit-pattern.md`
  - `posttooluse-hook-input-schema-field-paths.md`
  - `plugin-install-mcp-subcommand-smoke-test.md`
- Upstream: https://github.com/ruvnet/RuVector/issues/995 (fixed in 0.3.3)
- Claude Code docs: plugin manifest reference (`CLAUDE_PLUGIN_DATA`,
  `CLAUDE_PROJECT_DIR` in MCP env), hooks reference (PreToolUse
  `additionalContext`)
