# Feature: Error→Fix Institutional Memory via ruvector recall (I1 MVP, Path B)

## Problem Statement

The `debugging` skill re-derives every root cause from scratch — it has no
pre-fix query against the institutional knowledge already captured in
`docs/solutions/` (105 docs) and the ruvector memory store. Agents only
benefit from past fixes if they think to Grep. I1's goal: surface relevant
past error→fix knowledge automatically, before hypothesis-forming.

**Path decision (2026-07-17, supersedes brainstorm KD1):** the brainstormed
`hooks_error_record`/`hooks_error_suggest` family was source-verified unfit
on ruvector 0.2.34 — no score/confidence field ever reaches the caller
(mcp-server.js:2310-2338), the embedding matcher never persists across
sessions (rehydration skips `data.errors`), and `RUVECTOR_STORAGE_PATH` is
**confirmed ignored** by that subsystem (writes go to the machine-global
`~/.ruvector/intelligence.json`). Instead, **Path B**: reuse the existing
`hooks_remember`/`hooks_recall` subsystem, which has real similarity scores,
established thresholds (discard < 0.5, top 3), and a hardened guard pattern
already replicated across consumers.

<!-- deepen-plan: codebase -->
> **Codebase:** Stronger than stated: `RUVECTOR_STORAGE_PATH` appears
> **nowhere in the installed 0.2.34 package** (full-source grep) — it is dead
> config in `plugin.json:29`, ignored by every subsystem, not just errors.
> Store resolution is `getIntelPath()` (`bin/mcp-server.js:220`): project
> `.ruvector/intelligence.json` whenever `./.ruvector/` or `./.claude` exists
> in cwd, else `~/.ruvector/intelligence.json`. Minor ref correction:
> `hooks_error_suggest`'s scoreless return is at mcp-server.js:2353;
> `hooks_recall`'s real score field is at ~:1813.
<!-- /deepen-plan -->

**Value over plain Grep** (must survive review): semantic recall matches a
live error message against differently-worded fix docs (paraphrase
matching); Grep/`learnings-researcher` is keyword-bound and re-reads the
corpus each time. The trade-off (seeded store goes stale as new solution
docs land) is accepted as a documented limitation with a manual re-seed
path.

## Current State

- `hooks_remember(content, type)` / `hooks_recall(query, top_k)` are wired
  and score-returning; protocol constants live in
  `plugins/yellow-ruvector/skills/memory-query/SKILL.md` (RULE 16 sentinel).
- `plugins/yellow-core/skills/debugging/SKILL.md` (274 lines, no
  `allowed-tools:` — skills run in main-session tool scope): Phase 1
  Investigate ends at 1.3 "Trace the code path"; nothing queries
  institutional memory before Phase 2 hypothesis-forming.
- `plugins/yellow-review/commands/review/resolve-pr.md` Step 3b (lines
  173-203) already queries `hooks_recall` generically — seeded entries
  surface there **for free** (piggyback decision; zero changes to
  yellow-review).
- Live probe anomalies to resolve in Phase 0: `hooks_recall` returned 0
  results despite `hooks_stats` reporting 910 memories; yellow-ruvector
  CLAUDE.md documents `.ruvector/intelligence/memory.rvdb`, which does not
  exist on disk (doc drift, 4th instance); this worktree's `.ruvector` is a
  plain directory, not the symlink the worktree tooling documents.

<!-- deepen-plan: codebase -->
> **Codebase:** The 910/0 anomaly is most likely **path identity, not a
> scoring bug**: `hooks_stats` and `hooks_recall` in one session always read
> the same file (same `getIntelPath()`), so the split readings almost
> certainly came from different session/cwd contexts (HOME store has 910
> memories; this worktree's own store has 104 — same JSON shape, same code
> path). `hooks_stats` echoes `intel_path` in its response — Phase 0's canary
> should assert on that field for path identity before/after writes.
<!-- /deepen-plan -->

## Proposed Solution

Seed eligible `docs/solutions/` content into the recall store under an
`ERROR-FIX:` content convention, then add one query step to the debugging
skill. Decisions locked with the user (2026-07-17):

- **Path B** (recall pivot), gated on a storage-scoping canary test.
- **Empty-store behavior: silent-normal** (existing Step 3b convention).
  KD4's "distinguish absent vs silently-empty" is satisfied by the
  one-time Phase 0 canary, not by runtime signaling.
- **`/review:resolve`: piggyback** existing Step 3b — no new step, no
  frontmatter change, no second MCP round-trip.

<!-- deepen-plan: external -->
> **Research:** all-MiniLM-L6-v2 (ruvector's embedder) is documented as a
> **symmetric**-search model; short-error-query → longer-stored-entry is the
> asymmetric case sbert.net explicitly warns about, where cosine scores
> compress toward the middle. A fixed 0.5 floor therefore **risks false
> negatives** for this context; community guidance favors a lower floor
> (~0.35-0.4) or top-1/top-2 margin gating (TARG, arXiv:2511.09803). The
> error-fix protocol block should define its OWN threshold constant
> (separate from the RULE-16 0.5 recall constant) and Phase 4.1 must
> calibrate it empirically. Sources: sbert.net semantic-search docs;
> UKPLab/sentence-transformers#2267; huggingface.co model card.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 0: Verification gate (prerequisite — do not skip)

- [x] 0.1: **Storage-scoping canary test.** In this project: call
      `hooks_remember` with a marked disposable canary
      (`ERROR-FIX-CANARY: <date>`); confirm which physical file changes
      (project `.ruvector/intelligence.json` vs `~/.ruvector/...`) via
      size/mtime; confirm `hooks_recall` retrieves it with a score. Repeat
      in a second project directory to confirm isolation. **If recall
      writes/reads the HOME-global store, STOP — Path B inherits Path A's
      pollution problem; re-open the path decision with the user.**
- [x] 0.2: Resolve the 910-memories/0-results anomaly (was Phase 0.1's
      recall probing the wrong store, or is the project store genuinely
      cold?). Document the answer in the PR description.

<!-- deepen-plan: codebase -->
> **Codebase:** Design 0.1/0.2 around **path identity first**: assert the
> `intel_path` field echoed by `hooks_stats` before and after the canary
> write, and run all calls from the same cwd. Given `getIntelPath()`'s
> cwd-based resolution, a same-session mismatch should be impossible — if
> the canary still shows one, only then investigate engine-level causes.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The "legacy vectors read-only until `ruvector hooks
> reembed`" theory is **unverified with conflicting evidence**: no ADR-210,
> `isLegacyVectorStore`, or `reembed` subcommand exists anywhere in the
> ruvector GitHub repo (ADRs stop at ADR-102), though bundle identifiers
> were sighted in the installed minified source. Do not build around those
> names. What IS documented (ADR-074): tiered embeddings — deterministic
> HashEmbedder upgrades to semantic RlmEmbedder **automatically at a 50+
> doc corpus threshold**, re-embedding stored memories. Our ~44 seeded
> entries sit at that boundary → 0.1 must include a **cross-restart recall
> check with score-sanity inspection** (restart MCP, re-query, verify
> scores look semantic, not hash-degenerate).
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase (RESOLUTION, 2026-07-17 execution):** the annotation above is
> superseded — the conflict resolved POSITIVE during implementation. The
> shipped 0.2.34 package (not its GitHub docs) contains `hooks reembed`
> whose `--help` cites ADR-210 verbatim, and `ERR_LEGACY_STORE_READONLY`
> fired live 32 times during seeding (legacy stores are write-locked until
> reembed). Observed timings: reembed of ~170 entries took 12-17s. The
> seed-solutions command's Step 6 documents the verified behavior; shipped
> package source outranks repo docs for this vendor (5th doc-drift
> instance).
<!-- /deepen-plan -->

- [x] 0.3: Check worktree behavior: confirm whether `.ruvector` should be a
      symlink here (worktree-manager.sh) and whether seeding from a
      worktree lands in the shared store. Note findings; do not fix
      yellow-core's worktree-manager.sh in this PR.
- [x] 0.4: Fix the `memory.rvdb` doc drift in
      `plugins/yellow-ruvector/CLAUDE.md` to match observed reality.

<!-- deepen-plan: codebase -->
> **Codebase:** 0.3 should START from
> `docs/solutions/integration-issues/ruvector-worktree-db-symlink.md` — it
> already root-causes this exact symptom (gitignored `.ruvector/` never
> materializes in worktrees; `worktree-manager.sh` is supposed to inject a
> symlink). In THIS worktree `.ruvector` is a plain directory with its own
> 104-memory store — the injection didn't fire, which is itself new data to
> feed back. 0.4 must fix **two** docs, not one: that solution doc's
> "Concurrent-write caveat" carries the same stale `memory.rvdb` path as
> yellow-ruvector CLAUDE.md:9 (actual: flat `.ruvector/intelligence.json`).
<!-- /deepen-plan -->

### Phase 0b: Foundation fixes (added 2026-07-17 after canary STOP; user-approved)

**Phase 0 canary verdict:** the MCP write path hit the machine-global
`~/.ruvector/` store (STOP condition). Root causes, all live-confirmed:
(1) `npx ruvector mcp start` resolves the stale **global 0.2.25**, not
0.2.34 — the version-qualified spec was never pinned; (2) 0.2.25's
`getIntelPath()` caches its store choice at first use — a worktree session
whose `.ruvector/` doesn't exist yet at server start silently selects HOME
for the process lifetime; (3) `RUVECTOR_STORAGE_PATH` is dead config in
every present version. The 910/0 anomaly was path identity (HOME store
stats vs cold project store recall), not a scoring bug. This also means the
EXISTING integration (resolve-pr Step 3b, workflow recalls/remembers) has
been polluting the global store from worktree sessions. User decision:
fix foundation first, then continue I1 on the corrected base (same branch).
Canary entry left in HOME store (self-describing, inert).

- [x] 0b.1: Pin the MCP server: catalog `mcpServers.ruvector.args` →
      `ruvector@0.2.34` + `pnpm generate:manifests` (plugin.json is
      generated — never hand-edit). Default `install.sh` to the same
      pinned version so the CLI-hook path (global binary) matches. Keep
      `RUVECTOR_STORAGE_PATH` env (documents intent) but document it as
      inert at 0.2.34.
- [x] 0b.2: `session-start.sh` worktree store-heal: before the existing
      `.ruvector`-missing early-exit, if inside a git worktree whose main
      checkout has `.ruvector/` and the local dir is absent, create the
      symlink (restores the documented shared-store contract at the hook
      level; yellow-core's worktree-manager.sh untouched). Bats coverage.
- [x] 0b.3: Post-fix verification: pinned spec resolves 0.2.34
      (`npx -y ruvector@0.2.34 --version`); process-level canary — from a
      dir WITH `.ruvector/` present, a fresh 0.2.34 process selects the
      project store (`hooks_stats` intel_path echo); worktree heal links
      to main store. (Full MCP-session canary re-run needs a fresh
      session — note as PR follow-up verification.)

### Phase 1: Seeding

- [x] 1.1: New command `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md`
      — seeds recall memory from a repo's `docs/solutions/` (generic: the
      compound workflow creates that directory in any repo). Rationale for
      a command over a documented procedure: idempotent re-seeding is an
      acceptance criterion; MCP tools are callable only from a session.

<!-- deepen-plan: codebase -->
> **Codebase:** No existing command loops MCP calls over a file corpus —
> `index.md` uses one bulk `hooks_pretrain` call, not per-file writes — so
> build the loop by adapting `learn.md`'s single-entry store logic
> (frontmatter shape, ToolSearch→capabilities gate, retry-once) rather than
> hunting for a corpus-loop precedent. **Naming-collision risk:** learn.md's
> description claims "record a decision" / "save a memory" / "add a fact"
> (the memory-router phrases); seed-solutions.md's description must not
> overlap them or routing between two yellow-ruvector commands becomes
> ambiguous.
<!-- /deepen-plan -->

- [x] 1.2: Eligibility filter: `track: bug` docs only (43 of 105), exclude
      `docs/solutions/archived/`. Report explicit counts:
      eligible / seeded / flagged-for-manual-review.

<!-- deepen-plan: codebase -->
> **Codebase:** Counts have already drifted (now 106 non-archived docs, 44
> `track: bug`) — consistent with the plan's own corpus-drift edge case.
> Do NOT hardcode either number in seed-solutions.md; enumerate and count
> at run time, and treat the numbers here as a snapshot for scoping only.
<!-- /deepen-plan -->

- [x] 1.3: Extraction: content = `ERROR-FIX: <error signature> | FIX:
      <fix text> | SOURCE: <doc path> — <one-line problem summary>`.
      Fix-text fallback chain: `## Fix` → `## Solution` → flag for manual
      review (46% of corpus lacks both — flagged docs are skipped and
      listed, never guessed). Error signature: prefer literal error
      strings/codes from the doc body over the prose `problem:` field.
      `type=context` (CLAUDE.md forbids inventing params; no new types).

<!-- deepen-plan: external -->
> **Research:** The convention's ordering is load-bearing: bi-encoder
> embeddings pool over tokens, so the literal error signature must be the
> FIRST element of the stored text (it is), and one-entry-per-error-signature
> beats one-entry-per-doc for short-query matching precision — if a doc
> documents multiple distinct error signatures, emit multiple entries.
<!-- /deepen-plan -->

- [x] 1.4: Idempotency: before each `hooks_remember`, dedup-check via
      `hooks_recall(top_k=1)`, skip if score > 0.82 (existing protocol
      constant). Require no concurrent active sessions before seeding
      (cross-process write safety is undocumented — known limitation).

### Phase 2: Debugging-skill wiring

- [x] 2.1: Add step **1.4 "Query institutional memory (optional)"** to
      `plugins/yellow-core/skills/debugging/SKILL.md` — after 1.3 (trace),
      before 2.2 (hypotheses). Inline-replicate the FULL guard pattern
      (fast-path `test -d .ruvector` → ToolSearch → `hooks_capabilities`
      warmup → query → retry-once on execution error → score-filter
      < 0.5 / top 3 / truncate 800 → XML entity-escape → fenced
      `<reflexion_context>` advisory block). Cross-plugin `skills:` fails
      silently — never reference, always inline.

<!-- deepen-plan: codebase -->
> **Codebase:** Insertion point verified exact against the live file:
> Phase 1 sub-steps are 1.1 Reproduce (83) → 1.2 Env sanity (92) → 1.3
> Trace (103-116); Phase 2 opens at 118 with the "do not propose a fix
> until the causal chain is explained" reminder — the new 1.4 lands
> between them. Step 3b template confirmed at resolve-pr.md:173-203
> (3c starts at 204). Note the score-filter constant in this step is
> subject to the Phase 4.1 calibration annotation above — carry whatever
> constant the error-fix protocol block defines, not automatically 0.5.
<!-- /deepen-plan -->

- [x] 2.2: Query construction rule for the debugging context: query = the
      parsed error message/signature from Phase 0 Triage (not raw
      `$ARGUMENTS`, which may be a full stack trace), capped at 300 chars.
- [x] 2.3: **Causal-chain guard sentence:** recalled fixes are input to
      hypothesis-forming (2.2), never a bypass of the causal-chain gate
      (2.3). A past fix does not exempt the skill from explaining the
      causal chain (Core Principle #1).

### Phase 3: Canonical documentation

- [x] 3.1: New section `## Error→Fix Seeding Pattern` in
      `plugins/yellow-ruvector/skills/memory-query/SKILL.md`: the content
      convention, eligibility rules, dedup constants, and a new
      query-construction table row for the debugging context. Must NOT
      touch the existing RULE 16 sentinel line or its 4-file list; the 3
      yellow-core replicas mirror the recall/remember protocol only and
      are not updated.
- [x] 3.2: Update `plugins/yellow-ruvector/CLAUDE.md` + `README.md`
      (new command, ERROR-FIX convention, re-seed limitation).

### Phase 4: Quality

- [x] 4.1: Retrieval spot checks with REAL error strings (not doc titles),
      5-10 known repeats: `"Unable to create '.git/index.lock': File
      exists"` → gt-sync-exit-128 doc; CRLF merge-block; npm-view stderr;
      etc. Record scores; adjust nothing blindly — if < 0.5 across the
      board, surface to user before shipping (threshold calibration
      precedent: docs/research/2026-05-21-solution-doc-jaccard-calibration.md).
      Per the asymmetric-matching research above, expect compressed scores;
      calibrate the error-fix floor (candidate range 0.35-0.5, or top-1/
      top-2 margin) from these observations and record the chosen constant
      in the Phase 3 protocol block.
- [x] 4.2: Non-interference check: run representative existing recall
      queries (brainstorm/plan/work Phase 1, resolve-pr Step 3b) before/
      after seeding; confirm seeded entries don't displace previously
      useful top-3 results.
- [x] 4.3: Degradation matrix verified: plugin absent → silent skip; MCP
      down → retry-once → silent skip; healthy-but-cold → silent-normal.
- [x] 4.4: Validators + changeset: `pnpm validate:schemas`,
      `validate:agents`, `pnpm validate:generated` (new gate from PR #644 —
      should be a no-op since this plan touches no generated manifests);
      LF normalize; changeset = **yellow-ruvector minor** (new command +
      skill section), **yellow-core patch** (debugging skill wiring). No
      yellow-review change (piggyback).

## Technical Details

- Modify: `plugins/yellow-core/skills/debugging/SKILL.md`,
  `plugins/yellow-ruvector/skills/memory-query/SKILL.md`,
  `plugins/yellow-ruvector/CLAUDE.md`, `plugins/yellow-ruvector/README.md`
- Create: `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md`
- No new deps; no scripts/ changes (MCP tools are session-only — verified
  reason the seeder is a command, not a Node script)
- **Catalog-generation note (PR #644, merged mid-planning):**
  `marketplace.json` and `plugin.json` are now GENERATED from
  `catalog/plugins/<name>.json` — never hand-edit them. This plan requires
  no manifest changes (commands are auto-discovered from `commands/*.md`),
  so no catalog edit is expected; if scope grows to touch `plugin.json`
  (e.g. new hooks), edit `catalog/plugins/yellow-ruvector.json` and run
  `pnpm generate:manifests` instead.

## Acceptance Criteria

1. Phase 0 canary passes: project-scoped write+read isolation confirmed.
2. Seed run reports eligible/seeded/flagged counts (expect ~44 eligible at
   run time).
3. Smoke: a seeded doc's error text recalls that entry in top 3, with a
   score above the calibrated floor.
4. ≥ 3 of the 5-10 real-error spot checks retrieve the right doc in top 3.
5. Re-running seed-solutions converges (no duplicate entries; dedup skips
   logged).
6. Degradation matrix behaviors observed as specified.
7. CI baseline green (`validate:schemas`, `test:unit`, `lint`, `typecheck`).

## Edge Cases

- Security-issues docs contain literal injection payloads by design — they
  are `track: bug` eligible; entity-escaping at injection time (existing
  Step 3b pattern, replicated in 2.1) is the defense; seeded content is
  stored raw. The advisory-fence framing must be preserved verbatim.

<!-- deepen-plan: codebase -->
> **Codebase:** Sharpen this: entity-escaping is sufficient **only for the
> XML-tag wrapper** (`<reflexion_context>` — it neutralizes `</content>`
> breakout). It does NOT neutralize dash-style `--- begin/end ---` fence
> delimiters, which contain no XML metacharacters
> (docs/solutions/security-issues/sandwich-fence-delimiter-forgery.md,
> prompt-injection-fence-breakout-literal-delimiter.md — and the seeded
> corpus includes those very payload docs). Therefore 2.1 MUST reuse
> resolve-pr.md's XML-tag wrapper verbatim and MUST NOT render recalled
> content inside any dash-style fence.
<!-- /deepen-plan -->

- Ambiguous multi-match (generic `EACCES`-class errors): SOURCE path +
  problem summary in the content string lets the agent/human disambiguate;
  never act on a bare fix line.
- Memory-browse pollution: `ERROR-FIX:` prefix makes entries filterable in
  `/ruvector:memory` and by `ruvector-memory-manager`.
- Corpus drift: one-time seed; new solution docs invisible until manual
  `/ruvector:seed-solutions` re-run — documented limitation, stated
  plainly in README.
- Worktree sessions: pending 0.3 findings; do not assume shared store.

## References

- Brainstorm: `docs/brainstorms/2026-07-17-which-untapped-ruvector-mcp-tool-familie-brainstorm.md`
- Research: `docs/research/ruvector-latest-featureset-and-plugin-ideation.md`
- Guard-pattern precedent: `plugins/yellow-review/commands/review/resolve-pr.md:173-203`
- Protocol constants + RULE 16: `plugins/yellow-ruvector/skills/memory-query/SKILL.md`,
  `scripts/validate-agent-authoring.js` (RULE 16: 129-191, 919-991)
- Seeder shape precedent: `scripts/backfill-solution-frontmatter.js`
- Changeset precedent: `.changeset/ruvector-warmup-retry.md`
- Prior incidents: `docs/solutions/integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md`,
  `ruvector-mcp-tool-parameter-schema-mismatch.md`, `ruvector-worktree-db-symlink.md`

<!-- deepen-plan: external -->
> **Research:** External sources backing the annotations above:
> ruvector ADR-074 (tiered embeddings):
> https://github.com/ruvnet/ruvector/blob/main/docs/adr/ADR-074-ruvllm-neural-embeddings.md ·
> sbert.net semantic-search docs (symmetric vs asymmetric models):
> https://sbert.net/examples/sentence_transformer/applications/semantic-search/README.html ·
> UKPLab/sentence-transformers#2267 ·
> all-MiniLM-L6-v2 model card: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 ·
> TARG adaptive retrieval gating: https://arxiv.org/abs/2511.09803
<!-- /deepen-plan -->
