# Feature: `library-context` Follow-ups (RULE 13 lint + cache hook)

## Problem Statement

PR #536 shipped the canonical `library-context` skill at
`plugins/yellow-research/skills/library-context/` plus refactors for two
consumer agents. Three follow-ups were deferred and tracked in
`reference.md`:

1. **RULE 13** — a `validate-agent-authoring.js` lint to prevent drift
   between consumer agents and the canonical fallback chain.
2. **SessionStart cache hook** — pre-warm a context7 cache to amortize the
   60 req/hr anonymous global pool across an editor session.
3. **Opt-in adoption to 8 other plugins** — inline the safe-chain block
   into existing consumer agents in yellow-debt, yellow-semgrep,
   yellow-codex, yellow-docs, yellow-review, yellow-council, yellow-devin,
   yellow-browser-test.

Codebase research (this planning session) found that **none of the 8
candidate plugins have an existing library-doc-lookup step** to inline the
safe-chain into. The "Opt-in candidates" list in `reference.md` was
aspirational; the agents in those plugins do code analysis, debt scanning,
CLI delegation, doc generation, or workflow orchestration — not library
documentation lookup. Adopting `library-context` to any of them would
require adding a new feature (a library-lookup step) first, then inlining
the safe-chain. That is a per-plugin feature decision, not a follow-up
refactor.

Follow-up #3 is therefore **dropped from this plan**. If a future PR adds
a library-lookup feature to a candidate plugin, the security-fencing-style
inline pattern is documented in `reference.md` and that PR adopts the
safe-chain as a natural side effect. The `reference.md` "Opt-in
candidates" section is removed in PR-A below to keep the spec honest.

This plan covers the two remaining follow-ups: RULE 13 and the cache hook.

## Current State

- Canonical SKILL.md at `plugins/yellow-research/skills/library-context/SKILL.md` (153 lines, in PR #536)
- Sibling `reference.md` at the same path (149 lines, in PR #536) — includes a deferred-RULE-13 spec with preload-exemption clause
- Drift sentinel `context7 unavailable — falling back to` (Unicode em dash U+2014) appears 8 times across 3 files: SKILL.md, reference.md, `best-practices-researcher.md`
- Two existing consumers: `yellow-research/agents/research/code-researcher.md` (preloads via `skills: [library-context]`), `yellow-core/agents/research/best-practices-researcher.md` (inlines the safe-chain block)
- `scripts/validate-agent-authoring.js` is 474 lines; W1.5 rule at line 291; `skills` parsed at line 318
- `plugins/yellow-research/hooks/` has one file: `write-credential-status.sh`; one SessionStart entry in `plugin.json`
- Precedent hook for session-start caching: `plugins/yellow-ci/hooks/scripts/session-start.sh` (atomic-rename pattern at lines 156-158, mtime-based TTL invalidation)
- Cache file location precedent: `${CLAUDE_PLUGIN_DATA}` (per official Claude Code hooks docs + yellow-morph precedent), NOT project `.claude/` (would pollute VCS)

## Proposed Solution

Two independent PRs, both bumping `yellow-research`. **Hard ordering
constraint: PR-A cannot land until PR #536 merges to main** — otherwise
RULE 13 fires on `code-researcher` because the `skills: [library-context]`
preload only exists on the PR #536 branch.

### PR-A: RULE 13 drift-detection lint

Adds a new rule to `scripts/validate-agent-authoring.js` that fails CI
when an agent file has any of `mcp__context7__resolve-library-id`,
`mcp__context7__query-docs`, OR `mcp__context7__get-library-docs` in its
`tools:` list AND does NOT preload via `skills: [library-context]` AND
does NOT contain the drift sentinel `context7 unavailable — falling back
to` (U+2014) in body content.

Test coverage: new file `tests/integration/validate-agent-authoring-context7-rule.test.ts`
with 5 inline-fixture tests covering preload-exempt, inline-sentinel
exempt, ASCII-dash negative (proves the rule rejects `--`), pure
negative, and empty-tools no-op.

Also deletes the "Opt-in candidates" section from `reference.md` in the
same PR (keeps spec aligned with reality).

### PR-B: SessionStart cache hook

Pre-warms a two-tier context7 cache at
`${CLAUDE_PLUGIN_DATA}/context7-cache-<md5_of_project_dir>.json`:

- **Tier 1:** `library-name → library-id` (24h TTL)
- **Tier 2:** `(library-id, topic) → docs-fragment` (4h TTL, max 50 entries)

Implementation extends the existing `plugins/yellow-research/hooks/write-credential-status.sh`
(adding a second logical section after the credential-status scaffold call)
rather than introducing a second SessionStart array entry — multi-hook
SessionStart behavior is unverified in this repo, and merging is
conservative.

Pre-warm strategy: skip if cache age < tier-1 TTL (24h); when stale or
absent, parse the project's lockfile(s), dedup library names across all
found lockfiles, resolve up to 5 library-ids. Caps anonymous quota
consumption at 5 req per 24h window per project.

Direct HTTP to context7 (the MCP server is user-level and not reachable
from a shell hook). Uses `CONTEXT7_API_KEY` as `Authorization: Bearer`
when set; anonymous otherwise.

Atomic-rename writes (tmp + mv) copy yellow-ci's pattern. JSON parse
failures treated as cache miss. Lockfile-mtime invalidation purges tier-2
when any tracked lockfile (`package-lock.json`, `pnpm-lock.yaml`,
`yarn.lock`, `Cargo.lock`, `go.sum`, `requirements.txt`) changes.

## Implementation Plan

### PR-A: RULE 13 lint

- [ ] A.1 Verify PR #536 has merged to main (`gh pr view 536 --json mergedAt -q .mergedAt | grep -v null`); if not merged, stop. RULE 13 will fail CI on main without #536's `skills: [library-context]` frontmatter on `code-researcher`.
- [ ] A.2 Sync main and create branch `agent/feat/rule-13-context7-drift-lint` off the post-#536 tip.
- [ ] A.3 Add module-scope constants to `scripts/validate-agent-authoring.js` near `REVIEW_AGENT_DENIED_TOOLS` (~line 19): `CONTEXT7_TOOLS = new Set(['mcp__context7__resolve-library-id', 'mcp__context7__query-docs', 'mcp__context7__get-library-docs'])` and `LIBRARY_CONTEXT_SENTINEL = 'context7 unavailable — falling back to'` (write the em dash as `—` to be unambiguous in source).
- [ ] A.4 Add RULE 13 logic in `validateAgentFile()` after line 318 (the `const skills = new Set(parseList(frontmatter, 'skills'))` line), still inside the `if (!hasAllowedTools)` gate: check `tools.some(t => CONTEXT7_TOOLS.has(t))`; if true, check `skills.has('library-context')` OR `content.includes(LIBRARY_CONTEXT_SENTINEL)`; if neither, push error with both fix paths named.
- [ ] A.5 Error message format: ``${relative(filePath)}: references context7 tool without `skills: [library-context]` preload or drift sentinel in body (RULE 13). Fix: either add `library-context` to `skills:` frontmatter, OR include `context7 unavailable — falling back to` in the agent body.``
- [ ] A.6 Create `tests/integration/validate-agent-authoring-context7-rule.test.ts` with 5 fixture tests using `writeAgent()` from the existing `tests/integration/helpers/validator-harness.ts`. Each fixture body uses `—` for the em dash, NOT `--`.
- [ ] A.7 Delete the "Opt-in candidates for follow-up adoption" section from `plugins/yellow-research/skills/library-context/reference.md`. Replace with a one-paragraph "Adoption" section explaining the safe-chain pattern is documented for future use but not pre-tracked.
- [ ] A.8 Run gates: `pnpm validate:schemas && pnpm test:integration && pnpm lint && pnpm typecheck`. Confirm `validate:agents` exits 0 against current `plugins/` tree (both existing consumers should pass — preload-exempt for code-researcher, inline-exempt for best-practices-researcher).
- [ ] A.9 Add `.changeset/rule-13-context7-drift-lint.md`: `yellow-research` patch.
- [ ] A.10 LF normalize (`sed -i 's/\r$//' ...`), commit, `gt submit --no-interactive`.

### PR-B: SessionStart cache hook

- [ ] B.1 Branch `agent/feat/library-context-cache-hook` from main (independent of PR-A; no ordering dependency).
- [ ] B.2 Read the existing `plugins/yellow-research/hooks/write-credential-status.sh` end-to-end to confirm the shape: where credential_hook_scaffold is called, where JSON output is emitted, what env vars are guarded. The new cache logic appends AFTER the credential-status scaffold call but BEFORE the JSON-output line.
- [ ] B.3 Add the cache helper functions in the same file (or a sourced `lib/context7-cache.sh` in `plugins/yellow-research/lib/`). Functions: `_lc_cache_path` (md5 hash of CLAUDE_PROJECT_DIR), `_lc_cache_age` (now - file mtime), `_lc_scan_lockfiles` (returns deduped library names), `_lc_resolve_library_id` (HTTP call with optional API key), `_lc_write_cache_atomic` (tmp + mv).
- [ ] B.4 Wire the pre-warm logic: if `CLAUDE_PLUGIN_DATA` is unset → warn to stderr, skip. If lockfiles absent → warn to stderr, skip. If cache age < 86400 (24h) → skip. Else scan lockfiles, take top 5 deduped names, call `_lc_resolve_library_id` for each (anonymous or authenticated based on `CONTEXT7_API_KEY`), write atomically.
- [ ] B.5 Hook output: continue using the existing `write-credential-status.sh` output format (whatever it currently emits) — do not change. If pre-warm succeeds, optionally extend with `hookSpecificOutput.additionalContext` mentioning N libraries warmed. Errors during pre-warm are NEVER fatal — always emit `{"continue": true}`.
- [ ] B.6 Bats tests in `plugins/yellow-research/tests/cache-context7.bats`: 6 cases covering no-lockfile, no-CLAUDE_PLUGIN_DATA, corrupted-cache (re-warms cleanly), fresh-cache (skips), successful warm with anonymous, successful warm with API key (mock the HTTP call).
- [ ] B.7 Run gates: `pnpm validate:schemas && pnpm test:integration && bats plugins/yellow-research/tests/`.
- [ ] B.8 Add `.changeset/library-context-cache-hook.md`: `yellow-research` minor (additive feature).
- [ ] B.9 LF normalize, commit, `gt submit --no-interactive`.

## Technical Details

### Files to modify

**PR-A:**
- `scripts/validate-agent-authoring.js` — add CONTEXT7_TOOLS + LIBRARY_CONTEXT_SENTINEL constants (top of file) + RULE 13 check (~line 320 region, after `skills` parse)
- `plugins/yellow-research/skills/library-context/reference.md` — delete "Opt-in candidates" section; replace with a brief "Adoption" paragraph

**PR-B:**
- `plugins/yellow-research/hooks/write-credential-status.sh` — append cache pre-warm logic (or extract to a sourced helper in `lib/context7-cache.sh` and call from the hook)
- `plugins/yellow-research/.claude-plugin/plugin.json` — NO change (existing SessionStart entry stays; logic extends in the same file)

### Files to create

**PR-A:**
- `tests/integration/validate-agent-authoring-context7-rule.test.ts`
- `.changeset/rule-13-context7-drift-lint.md`

**PR-B:**
- `plugins/yellow-research/hooks/lib/context7-cache.sh` (recommended; keeps the SessionStart hook readable)
- `plugins/yellow-research/tests/cache-context7.bats`
- `.changeset/library-context-cache-hook.md`

### Files NOT to modify

- SKILL.md — current Step 1 wording "from cache (if available) or via resolve-library-id" already accommodates the hook; no edit needed when PR-B lands.
- `.claude-plugin/marketplace.json` — no schema impact.
- `plugins/yellow-core/commands/setup/all.md` — no plugin add/remove.
- Any cross-plugin agent — no adoption work in this plan.

### Cache file shape

```json
{
  "schema": "1",
  "warmed_at": 1779000000,
  "lockfile_fingerprint": {
    "package-lock.json": 1778999000,
    "Cargo.lock": null
  },
  "tier1": {
    "react": { "library_id": "/facebook/react", "fetched_at": 1779000000 },
    "axios":  { "library_id": "/axios/axios",   "fetched_at": 1779000000 }
  },
  "tier2": {
    "/facebook/react|hooks": { "docs": "...", "fetched_at": 1779000000 }
  }
}
```

`schema: "1"` per existing MEMORY.md convention for forward-compat.

### Context7 HTTP endpoints (verify post-merge)

Per best-practices research, context7 publishes an HTTP API at
`https://api.context7.com/` (exact paths to verify when implementing).
The MCP server tools (`mcp__context7__*`) are not reachable from a shell
hook. The hook calls the HTTP API directly; the MCP server still serves
runtime queries from agents.

## Acceptance Criteria

### PR-A (RULE 13)

1. `pnpm validate:agents` exits 1 with a message containing `RULE 13` and the file path when a fixture agent has any of `mcp__context7__resolve-library-id`/`query-docs`/`get-library-docs` in `tools:`, no `skills: [library-context]`, and no sentinel in body.
2. `pnpm validate:agents` exits 0 for `code-researcher.md` (preload-exempt — verified post-PR-#536 only).
3. `pnpm validate:agents` exits 0 for `best-practices-researcher.md` (sentinel-exempt — cross-plugin inline).
4. `pnpm validate:agents` exits 0 for a synthetic fixture with both exemptions present.
5. `pnpm validate:agents` exits 1 for a synthetic fixture whose sentinel uses ASCII `--` instead of em dash U+2014.
6. `pnpm validate:agents` does NOT emit a RULE 13 error when `tools:` is empty (the existing "missing tools" gate handles that case).
7. Five integration tests pass in `tests/integration/validate-agent-authoring-context7-rule.test.ts`; all fixtures inline (no external `.example.md` files); em dash spelled as `—` in JS strings.
8. `reference.md` no longer contains a section titled "Opt-in candidates"; the replacement "Adoption" paragraph explains the inline-copy pattern is documented for future ad-hoc use.
9. `CONTEXT7_TOOLS` Set includes all three tool names (resolve-library-id, query-docs, get-library-docs).
10. Changeset file `.changeset/rule-13-context7-drift-lint.md` exists, bumps `yellow-research` patch.
11. `pnpm release:check` passes.

### PR-B (cache hook)

1. New cache logic lives in `plugins/yellow-research/hooks/write-credential-status.sh` (or in a sourced helper called from there); no second SessionStart array entry added to `plugin.json`.
2. On first run (no cache file), hook creates `${CLAUDE_PLUGIN_DATA}/context7-cache-<md5_of_CLAUDE_PROJECT_DIR>.json`, populates tier-1 with up to 5 library IDs from project lockfile(s), and emits `{"continue": true}` (with optional `hookSpecificOutput.additionalContext` summarizing N libraries warmed).
3. On subsequent runs where cache age < 24h, hook skips pre-warm and completes within 3 seconds.
4. On corrupted JSON in cache file, hook deletes file, re-warms cleanly, does NOT block startup.
5. When no lockfile found, hook emits `{"continue": true}` + stderr warning `[yellow-research] No lockfile found; skipping context7 cache warm`; no `systemMessage`.
6. When `CLAUDE_PLUGIN_DATA` unset, hook emits `{"continue": true}` + stderr warning; skips all cache operations.
7. When `CONTEXT7_API_KEY` env var set, hook uses `Authorization: Bearer ${CONTEXT7_API_KEY}`; otherwise calls anonymously.
8. Cache writes use atomic rename (`mktemp + mv`); confirmed by reading the hook code.
9. `set -e` is NOT used in any new bash; comment explains why (hook must emit `{"continue": true}` on all paths).
10. Bats tests pass: `bats plugins/yellow-research/tests/cache-context7.bats` covers no-lockfile, no-CLAUDE_PLUGIN_DATA, corrupted-cache, fresh-cache-skip, anonymous-warm, authenticated-warm.
11. Changeset file `.changeset/library-context-cache-hook.md` exists, bumps `yellow-research` minor.
12. `pnpm validate:schemas` passes (plugin.json still well-formed).

## Edge Cases (must handle in code)

**PR-A:**
- **Empty `tools:` list** — existing line 287 gate fires "missing or empty tools" error; RULE 13 does not also fire because `CONTEXT7_TOOLS.has(t)` is vacuously false for an empty array. Verified by Test #6 above.
- **Future PR removing `skills: [library-context]` from code-researcher** — RULE 13 catches this as a regression (correct behavior); author must either re-add the preload OR add the sentinel inline.
- **Synthetic test fixtures referencing context7** — the validator scans `VALIDATE_PLUGINS_DIR` (set by tests to a `mkdtempSync` path); production runs use `plugins/` only. No cross-contamination.

**PR-B:**
- **Multi-language project with multiple lockfiles** — scan all known lockfiles, dedup library names across the union, take top 5 from the merged set. Mtime check covers all found lockfiles.
- **Cached library-id valid but library removed from context7 since** — surfaces at skill-invocation time (`query-docs` fails); handled by the skill's existing fallback chain, NOT the cache hook's responsibility.
- **Concurrent SessionStart from two sessions** — atomic rename means last writer wins; both sessions read fresh-or-empty cache, both attempt warm, second write replaces first. No corruption; minor wasted API calls. Acceptable.
- **Lockfile present but unparseable** (e.g., partial-write race condition) — treat as no-lockfile; skip pre-warm; stderr warning. Try again next session.
- **`CLAUDE_PROJECT_DIR` unset, `$PWD` fallback** — per MEMORY.md guidance, warn `[yellow-research] CLAUDE_PROJECT_DIR unset; using $PWD as cache key seed` to stderr; do NOT silently use $PWD.

## Known Limitations / Follow-Ups

- **Adoption to other plugins is NOT in this plan.** When a future PR adds a library-doc-lookup feature to any consumer plugin (yellow-debt, yellow-semgrep, etc.), that PR adopts the inline-copy safe-chain as a natural part of its feature work. Pattern is documented in `reference.md` (post-PR-A); RULE 13 (post-PR-A) catches drift on the new inline copy.
- **PR-B uses HTTP not MCP for cache pre-warm.** The MCP tools are user-level and not reachable from a shell hook. If context7's HTTP API surface changes incompatibly, this hook breaks; the runtime SKILL.md chain (which uses MCP) is unaffected. Document this dependency in the hook's comment block.
- **Pre-warm budget is 5 anonymous req per 24h window per project.** If `CONTEXT7_API_KEY` is set, the per-key 60 req/hr quota applies — pre-warm consumes a small slice of that. For team environments without per-developer keys, the shared anonymous pool is preserved by the 24h skip-if-fresh gate.
- **`/research:setup` does not surface cache health.** PR-B does not extend the setup command. A follow-up could add a `Cache: HEALTHY/STALE/EMPTY` line. Out of scope here.
- **SessionStart multi-hook entry is still unverified.** If the merge-into-existing-hook approach later proves limiting (e.g., the credential-status scaffold and cache pre-warm need different timeouts), a follow-up PR could split them — but only after empirically verifying that two array entries in `plugin.json` SessionStart both fire.

## References

- PR #536: `feat(library-context): canonical skill + refactor 2 research agents` — https://github.com/KingInYellows/yellow-plugins/pull/536
- Canonical SKILL.md: `plugins/yellow-research/skills/library-context/SKILL.md`
- Reference: `plugins/yellow-research/skills/library-context/reference.md`
- Parent brainstorm: `docs/brainstorms/2026-05-17-library-context-skill-brainstorm.md`
- Validator template: `scripts/validate-agent-authoring.js` (W1.5 at line 291; `skills` parse at line 318; `REVIEW_AGENT_DENIED_TOOLS` placement at top)
- Test harness: `tests/integration/helpers/validator-harness.ts` (`writeAgent`, `runValidator`)
- Cache precedent: `plugins/yellow-ci/hooks/scripts/session-start.sh` (atomic-rename lines 156-158, mtime TTL pattern)
- Pre-warm precedent: `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` (CLAUDE_PLUGIN_DATA + background subshell pattern)
- Multi-plugin changeset precedent: `.changeset/security-debt-quick-fixes.md` (6 plugins, one entry — kept as reference; not used in this plan since both PRs touch only yellow-research)
- Closed cross-plugin skills issue: https://github.com/anthropics/claude-code/issues/15944
- Context7 platform: https://glama.ai/mcp/servers/upstash/context7-mcp; https://github.com/upstash/context7
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
