---
name: ruvector:seed-solutions
description: "Seed ruvector recall memory with ERROR-FIX entries extracted from a repo's docs/solutions/ corpus. Use when user says \"seed solutions\", \"seed error memory\", \"import solution docs into ruvector\", or after new solution docs land and the seeded error memory needs a manual refresh. Not for recording a single new learning — that is /ruvector:learn."
argument-hint: '[solutions directory, default docs/solutions]'
allowed-tools:
  - ToolSearch
  - AskUserQuestion
  - Glob
  - Grep
  - Read
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
  - mcp__plugin_yellow-ruvector_ruvector__hooks_stats
---

# Seed Error→Fix Memory from Solution Docs

Batch-import eligible `docs/solutions/` entries into ruvector recall memory
under the `ERROR-FIX:` content convention, so the debugging skill and
review commands can surface past fixes semantically. Idempotent — safe to
re-run after new solution docs land.

## Workflow

### Step 1: Availability and store-scoping gate

1. Call ToolSearch("hooks_remember"). If not found, report "ruvector not
   available. Run `/ruvector:setup` to initialize." and stop.
2. Warmup: call `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities()`.
   If it errors, report "ruvector not available right now. Check
   `/ruvector:status` and try again." and stop.
3. **Store-scoping check (do not skip):** call
   `mcp__plugin_yellow-ruvector_ruvector__hooks_stats()` and inspect the
   `intel_path` field. If it is absent, or does not resolve to a path
   inside the current project root, STOP and report:
   "ruvector is using a non-project store (<intel_path>). Seeding would
   pollute a store shared across projects. This happens when the MCP
   server started before `.ruvector/` existed — start a fresh session and
   retry. See docs/solutions/integration-issues/ruvector-worktree-db-symlink.md."
   Never seed a store outside the project root.

### Step 2: Concurrency guard

Cross-process write safety is undocumented for the ruvector store. Use
AskUserQuestion: "Seeding writes many entries. Confirm no other Claude
Code session is actively writing this project's ruvector store right now?"
Options: "Yes, proceed" / "No, stop". Stop on "No".

### Step 3: Enumerate the eligible corpus (count at run time)

1. Directory: `$ARGUMENTS` if provided (validate: relative path, no `..`,
   no leading `/` or `~`; reject otherwise), else `docs/solutions`.
2. Glob `<dir>/*/*.md`. Exclude any path containing `/archived/`.
3. For each file, Read the frontmatter. Keep only docs with `track: bug`.
   Everything else (`track: knowledge`, `track: feature`, missing track)
   is ineligible — patterns and conventions are not error→fix pairs.
4. Report the eligible count before writing anything. Never hardcode
   corpus counts — the corpus grows continuously.

### Step 4: Extract one entry per error signature

For each eligible doc:

1. **Error signature** — prefer a literal error string from the body
   (backticked or quoted error text, exit codes, tool messages, e.g.
   `Unable to create '.git/index.lock': File exists`) over the prose
   `problem:` frontmatter, which is usually a restated title and will not
   substring- or semantically match a live error. If a doc documents
   multiple distinct error signatures, emit one entry per signature.
2. **Fix text** — first paragraph under `## Fix`; else `## Solution`;
   else FLAG the doc for manual review and skip it (never guess a fix).
   Truncate to 400 characters at a word boundary.
3. **Entry content** (signature first — embedding pooling favors
   front-loaded tokens):

   ```
   ERROR-FIX: <error signature> | FIX: <fix text> | SOURCE: <doc path> — <one-line problem summary>
   ```

4. `type` is always `context`. Do not invent new type values or
   parameters — the MCP schema accepts `content` and optional `type`.

### Step 5: Idempotent store loop

For each extracted entry:

1. Dedup check: call
   `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with
   `query` = the entry content, `top_k` = 1. If the top result scores
   > 0.82, count as `skipped-duplicate` and continue. Zero results (cold
   store) means no duplicate.
2. Store: call `mcp__plugin_yellow-ruvector_ruvector__hooks_remember`
   with the entry content and `type=context`. On timeout, connection
   refused, or service unavailable: wait ~500 ms, retry exactly once. If
   the retry fails, count as `failed` and continue with the next entry.
   Do NOT retry on validation or parameter errors.

### Step 6: Embedding provenance (ADR-210) — unlock and re-embed

Three provenance behaviors matter, all observed live on 0.2.34:

1. **Legacy stores are write-locked.** If any store call fails with
   `ERR_LEGACY_STORE_READONLY` ("predates embedding provenance"), the
   store has vectors but no provenance stamp. Unlock it, then retry the
   failed entries:

   ```bash
   npx -y ruvector@0.2.34 hooks reembed --dry-run   # inspect first
   npx -y ruvector@0.2.34 hooks reembed             # re-embed + stamp provenance
   ```

2. **A version-skewed global binary silently clobbers the stamp.** If an
   older global `ruvector` (pre-ADR-210, e.g. 0.2.25) is on PATH, its
   passive-capture hooks rewrite the store after every tool call and
   reset the provenance stamp to null — re-locking the store within
   seconds of the reembed. Verify `ruvector --version` matches the pinned
   version BEFORE seeding; upgrade with
   `npm install -g ruvector@0.2.34 --ignore-scripts` if not.
3. **After a reembed to ONNX, hash-path writes are refused.** Seeding
   after an ONNX reembed requires semantic-mode writes so the active
   embedder matches the stamped provenance. Report any residual
   provenance-mismatch failures in the summary rather than retrying
   blindly.

If `reembed` is unavailable or fails, report it — seeded entries remain
findable but semantic match quality is degraded until a successful
re-embed.

### Step 7: Report

Print a summary table:

- Eligible docs (track: bug, non-archived)
- Entries extracted / seeded / skipped-duplicate / failed
- Flagged for manual review (list each doc path — these have neither
  `## Fix` nor `## Solution` and were not seeded)

Remind: seeding is manual — new solution docs are invisible to recall
until this command is re-run. Re-running is safe (dedup skips existing
entries).

## Error Handling

See `ruvector-conventions` skill for the error catalog.

- **MCP unavailable:** "ruvector not available. Run `/ruvector:setup`."
- **Non-project store:** stop per Step 1.3 — never seed a global store.
- **Storage failure mid-run:** per-entry `failed` count; the run
  continues. Re-running after the cause is fixed converges (dedup).
