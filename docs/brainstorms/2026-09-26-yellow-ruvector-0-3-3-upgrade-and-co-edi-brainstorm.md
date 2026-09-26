# yellow-ruvector 0.3.3 Upgrade, Root Launcher, and Co-edit — Brainstorm

**Date:** 2026-09-26
**Status:** Brainstorm — ready for `/flow:plan`
**Approach chosen:** A — three stacked PRs (foundation → hook hygiene → co-edit surfacing)
**Grounding:** unpacked `ruvector@0.2.34` and `ruvector@0.3.3` npm tarballs,
local CLI runs against scratch stores, upstream `ruvnet/RuVector` commit log
and issues, and a repo-wide codebase pass.

## What We're Building

Three changes to `plugins/yellow-ruvector` (v1.3.3, pinned to ruvector
0.2.34), shipped as three stacked PRs:

1. **Foundation: plugin-managed ruvector 0.3.3, a root launcher, and new recall timing.**
   - Install the pinned `ruvector@0.3.3` into `${CLAUDE_PLUGIN_DATA}`,
     following yellow-morph's pattern: `package.json` plus a committed
     lockfile, `npm ci --ignore-scripts`, an atomic mkdir install lock, and
     a SessionStart prewarm.
   - Start the MCP server from a new `bin/start-ruvector.sh`. It resolves the
     git/worktree root, heals the `.ruvector` symlink synchronously, `cd`s to
     the root, then `exec`s the installed CLI's `mcp start`. The
     `RUVECTOR_MCP_ALLOW` list is unchanged.
   - Every hook resolves that same installed binary, so a global `ruvector`
     on PATH is no longer required or used.
   - Automatic recall runs once, semantically, at SessionStart (budget raised
     to about 5 s). Per-prompt recall in UserPromptSubmit is dropped.
     Agents and commands keep querying the warm MCP server on demand.
2. **Hook hygiene.**
   - PostToolUse stops calling `hooks post-edit` and `hooks post-command`.
   - It records co-edits instead: it keeps the last edited file and a
     timestamp in a small sidecar file under `.ruvector/`, and calls
     `hooks coedit-record` (fast mode) when two different files are edited
     within a window.
   - Measure the noise being removed, and report the before/after in the PR.
3. **Co-edit surfacing.**
   - Automatic: PreToolUse on Edit/Write/MultiEdit adds a short, fenced
     "files often edited with X" `additionalContext` note when a pair's
     count clears a threshold. It uses `hooks coedit-suggest`, about 75 ms.
   - On demand: allowlist `hooks_coedit_suggest` and/or add a command or
     agent path.
   - File the upstream `lastEditedFile` issue.

## Why This Approach

### Evidence gathered

**The upgrade is safe for our interfaces and fixes the worst failure.**
- The schemas for the five allowlisted MCP tools (`hooks_recall`,
  `hooks_remember`, `hooks_stats`, `hooks_pretrain`, `hooks_capabilities`)
  are identical in 0.2.34 and 0.3.3.
- `compareProvenance` is byte-identical, so `/ruvector:status` provenance
  logic holds.
- The CLI subcommands the hooks use are all present.
- New tools (`metaharness_*`, `rvf_branch`, `rvf_freeze`) stay hidden behind
  `RUVECTOR_MCP_ALLOW`.

**RuVector#995 is fixed in 0.3.3.**
- Upstream commit 33cad21: `bin/mcp-server.js:430` now saves with
  `atomicWriteFileSync`, and `:286-296` quarantines a corrupt store as
  `.corrupt-<epoch>` instead of silently starting empty.
- This clears the `UPGRADE_BLOCKED_UPSTREAM` note in
  `plans/yellow-ruvector-hook-contract-a.md` and the open half of the
  "Non-atomic store write race" section in
  `docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`.

**First-start cost is unchanged.**

| | 0.2.34 | 0.3.3 |
|---|---|---|
| Cold `npx` start | 8.5 s | 8.2 s |
| Warm start | 0.76 s | 0.82 s |
| npm cache size | 117 MB | 119 MB |

The new optional dependencies (`@metaharness/*`, `mincut-wasm`) cost almost
nothing.

**Upstream changes to plan around:**
- `engines.node` is now `>=20`. `install.sh` already requires 22.22.0.
- 0.3.x releases are frequent (12 from July to September; 0.2.40 was
  published from an unmerged branch). This argues for an exact pin plus a
  committed lockfile.
- No 0.3.4 is in progress.

**Version skew comes from the packaging, not from a missing check.**
- Hooks require a global `ruvector` binary on PATH (six `command -v`
  sites), while the MCP server runs a separate `npx` copy.
- One plugin-managed install used by both removes the skew instead of
  merely detecting it.
- `CLAUDE_PLUGIN_DATA` is available to hook subprocesses
  (`docs/solutions/code-quality/claude-code-bare-flag-and-hook-recursion-guard.md:89-91`),
  and yellow-research and yellow-ci hooks already use it.

**Store selection still depends on the working directory in 0.3.3.**
- `getIntelPath()` (`cli.js:3232`, `mcp-server.js:268`) checks only
  `process.cwd()` and then falls back to `~/.ruvector`.
- `RUVECTOR_STORAGE_PATH` still appears nowhere in the package.
- No upstream issue exists. The plugin controls the launch, so a
  root-`cd` launcher is the only fix available to us.
- yellow-morph, yellow-semgrep and yellow-research already use
  `${CLAUDE_PLUGIN_ROOT}/bin/start-*.sh` launchers, so there is precedent.

**Hook recall is broken today and would silently stop after a plain bump.**
Measured on a store stamped `onnx-minilm`/384d:

| | 0.2.34 (today) | 0.3.3 |
|---|---|---|
| Query embedding | `hash`/64d, compared against 384d vectors | semantic ONNX by default (upstream 31bb944) |
| Warning printed | "recall quality degraded" | none |
| Time | about 85 ms | 1.2–2.1 s warm, 6.4 s on first model download |
| Effect | near-random matches | exceeds the 0.9 s (UserPromptSubmit) and 0.65 s (SessionStart) internal budgets |

So automatic injection is currently noise, and a plain bump would make it
time out and inject nothing. A single SessionStart semantic recall with a
larger budget gives real recall at a one-time cost per session.

**The post-edit and post-command hooks cause harm as well as noise.**
- Each call writes a near-empty memory with no deduplication
  (`"successful edit of ts in project"`, `"npm test succeeded"`). Three
  edits plus three commands produced six such memories.
- On a healthy ONNX store, every one of those writes is refused under
  ADR-210 (wasted work on every tool call).
- On a fresh store, those same writes stamp it `hash`/64d. After that, the
  MCP server refuses every real `hooks_remember`. Our own hooks are
  therefore one way the ADR-210 failure starts.
- `coedit-record` leaves the stamp unset (`embeddingProvenance: null`, zero
  memories).

**Co-edit data has never been recorded.**
- `hooks post-edit` records a file sequence only when
  `Intelligence.lastEditedFile` is set. That field lives only in memory
  (`cli.js:3131`, `:3797`), and each hook runs as a new process.
- `post-edit a.ts` followed by `post-edit b.ts` on 0.3.3 left
  `file_sequences` empty. The same is true on 0.2.34.
- The "likely next files" output of `hooks pre-edit` is thrown away
  (`pre-tool-use.sh:53`), even though the script header and
  `docs/security.md:209` claim co-edit suggestions.
- The MCP server's `convertLegacyData` imports neither `file_sequences` nor
  `coEditPatterns` into its engine. `hooks_coedit_suggest` therefore only
  reads `coEditPatterns` from the file.
- `hooks coedit-record` / `coedit-suggest` in fast mode take about 75 ms,
  persist across processes, and return `{file, count, confidence}`.
- No upstream issue exists. A draft is included under Key Decisions.

### Why three stacked PRs

- The packaging migration is the riskiest change and touches the most
  files, so it lands first on its own, where the tests catch problems.
- Hook hygiene depends on the foundation's binary resolution, and co-edit
  surfacing depends on hygiene having started to collect co-edit pairs.
- Each PR can be reverted on its own. This also fits the repo's
  stacked-PR workflow (`/stack:status`).

## Key Decisions

1. **Packaging: plugin-managed install**, with no global install and no
   `npx` spec. `plugins/yellow-ruvector/package.json` gets
   `"dependencies": {"ruvector": "0.3.3"}` plus a lockfile.
   `scripts/check-upstream-pins.js` already tracks plugin `package.json`
   dependencies. The launcher is the correctness gate for installs, as in
   yellow-morph (a SessionStart prewarm can race MCP startup).
2. **Launcher root:**
   - Resolve the root with `git rev-parse --show-toplevel`, falling back to
     `$CLAUDE_PROJECT_DIR` and then `$PWD`.
   - Inside a linked worktree, keep the `.ruvector` symlink model and heal
     it synchronously before `exec`. This removes the "heal only helps the
     next session" race.
   - Hooks resolve the same root, which fixes nested launches on the hook
     side too.
   - Keep the `/ruvector:seed-solutions` Step 1.4 guard as defense in depth.
3. **Recall timing:**
   - SessionStart: one semantic recall, hook timeout raised to about 5 s,
     with first-download handling (6.4 s cold). Skip or degrade with a
     one-line note rather than block.
   - UserPromptSubmit: no per-prompt recall. The hook either goes away or
     keeps only a cheap job, to be decided in planning.
4. **Hook hygiene:**
   - Drop `post-edit` and `post-command` from PostToolUse.
   - Track the last edited file in a sidecar (for example
     `.ruvector/.last-edit`, holding path, epoch and session id, written
     atomically) and call `hooks coedit-record -p <prev> -r <cur>` when both
     are within the window (upstream uses 60 s).
   - Skip `docs/solutions/` paths as today.
5. **Co-edit surfacing:** both automatic (threshold-gated PreToolUse
   `additionalContext` via `emit_recall_json`-style JSON, fenced as reference
   data) and on demand (allowlist `hooks_coedit_suggest`; update
   `tests/mcp-allowlist.bats` `EXPECTED` and `CLAUDE.md`).
6. **Upgrade path for existing users:**
   - `/ruvector:setup` installs into DATA and says that any global
     `ruvector` is no longer used (it does not uninstall it).
   - `/setup:all` probes the ruvector DATA directory instead of
     `command -v ruvector`.
   - `CLAUDE.md` Maintenance and `docs/security.md` are updated to match.
7. **Draft upstream issue (PR 3):**
   > *hooks post-edit never records file_sequences: lastEditedFile is not
   > persisted across CLI processes.* `Intelligence.lastEditedFile` lives only
   > in memory (`cli.js` ~3131/3797). Claude Code runs each PostToolUse hook
   > as a separate process, so every `post-edit` starts with
   > `lastEditedFile = null` and never records a sequence. Reproduced on
   > 0.2.34 and 0.3.3. Suggested fix: persist `lastEditedFile` and a
   > timestamp in the store or a sidecar, with a staleness window.

## Open Questions

- **Protected-directory prompt:** does upstream Claude Code bug #41156
  (a prompt on writes to `CLAUDE_PLUGIN_DATA`) or #51398 (DATA is
  session-scoped in Cowork Desktop) affect a large (about 119 MB) ruvector
  install? See `plans/complete/plugin-install-resilience.md:106-116`.
- **SessionStart budget:** is about 5 s acceptable, and should the first
  model download (about 23 MB from huggingface.co) be moved into the prewarm
  or setup step so SessionStart never pays it?
- **UserPromptSubmit:** remove the hook entirely, or keep a
  hash-stamped-store-only path for legacy stores?
- **Hook binary cost:** hooks now run `node <DATA>/node_modules/ruvector/bin/cli.js`
  instead of a global shim. Confirm this stays within the 1 s PreToolUse and
  PostToolUse budgets (fast-mode commands measured at about 75 ms).
- **Test migration:** every bats suite stubs `ruvector` on `PATH`. Decide on
  a resolver seam (for example a `RUVECTOR_BIN` override) so the stubs keep
  working. The suites run in CI's advisory bats step, so failures there do
  not block merges.
- **Co-edit threshold and window:** the minimum count before automatic
  injection (3?), the co-edit window (60 s?), and whether paths are stored
  relative to the root, so worktrees share patterns through the shared
  store.
- **Concurrent writers:** saves are atomic in 0.3.3 but still
  last-writer-wins. Does moving hooks to fast-mode `coedit-record` (smaller,
  faster writes) reduce lost updates enough, or is a `flock` around hook
  writes worth adding?
- **Hash-stamped stores:** keep the existing ADR-210 detection and the
  `reembed` remediation unchanged. Confirm that `hooks reembed` in 0.3.3
  keeps the same `targetProvenance` shape that `status-provenance.bats`
  relies on.
