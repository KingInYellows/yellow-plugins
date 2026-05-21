# Feature: compound-staging stack — review follow-on hardening

## Problem Statement

The PR #540-544 stack review (this session, 2026-05-19) surfaced 4 design-decision
findings that were intentionally not auto-applied because each requires either a
careful refactor (concurrency-sensitive code) or coordinated changes across
multiple sections (cross-doc supersession callouts, test infrastructure).

This plan tracks the follow-on hardening work as a single stacked PR after the
parent stack lands on `main`. Each item is independently mergeable but
collectively closes the remaining review feedback for the background-compounding
pipeline.

## Current State

The parent stack (PRs #540, #542, #543, #544) is MERGEABLE with all auto-applicable
fixes committed:

- PR #540: cosine threshold semantics clarified; `drain-budget.json` naming fixed
- PR #542: `umask 077` + `chmod 700` on JSONL writes; ISO-to-epoch helper extracted;
  `--bare` flag added; timeout validation
- PR #543: pre-write injection filter; `candidate_text` length/`session_id` pattern
  guards; idempotent two-phase commit with `.promote-done` sentinel; bypassPermissions
  paranoia preamble
- PR #544: drain prompt fencing; BATS_VERSION gate; symlink-safe `find -type f`;
  `--bare` flag; CLAUDE.md command count + changeset corrections

Remaining items require:

1. **Concurrency refactor** (PR #542): the drain-lock `mkdir` is in the parent shell
   but the `EXIT` trap is in the subshell. If the parent is killed between `mkdir`
   and subshell start, the lock orphans for 30 min. Separately, the `processing/`
   requeue loop runs *before* lock acquisition, allowing concurrent SessionStart
   invocations to double-requeue the same file.
2. **Brainstorm supersession callouts** (PR #540): the brainstorm doc has a single
   prose SUPERSEDED header at the top, but readers who scan to a specific section
   (Decision 3, Decision 4, JSONL schema, architecture diagram) miss the supersession.
3. **RULE 14/14b lint coverage** (PR #544): RULE 14b's `neverPattern` is a global
   boolean — "Never modify X" anywhere + "CORE_RULES" anywhere both true passes the
   check, even if the two are unrelated. Plus zero integration test coverage for
   either rule.
4. **Phase 5.1 preview UX clarity** (PR #540): the plan's Phase 5.1 description
   says the manual-drain command previews entries by reading `transcript_tail` via
   `jq`, but the JSONL schema at Phase 1.3 omits `candidate_text` (which would have
   been the human-readable form). Users may expect titles but get raw transcript
   bytes — this is a UX gap, not a bug.

## Proposed Solution

Single follow-on PR stacked on `main` *after* the parent stack merges. Each phase
is independent — can be merged separately if any blocks.

The PR is branch `agent/fix/compound-staging-review-followups`, expected size
~250-400 lines (mostly test code + brainstorm callouts).

## Implementation Plan

### Phase 1: Concurrency refactor (PR #542 follow-on)

**Goal**: close the lock-orphan window and the processing/ requeue race.

- [ ] 1.1: Move `mkdir "${STAGING_DIR}/.drain-lock"` into the subshell as the
  FIRST statement, before the `trap` registration. The same shell that creates
  the lock now owns the cleanup; no orphan window exists. Update the lock
  contention check to be "if mkdir fails inside subshell, exit cleanly without
  attempting drain" rather than testing for lock existence in the parent.
- [ ] 1.2: Move the `processing/` requeue loop (currently lines 125-140 in
  `session-start.sh`) to *inside* the disowned subshell, AFTER the lock is
  acquired. This makes requeue serialized with respect to other drains.
- [ ] 1.3: Update `cs_update_drain_budget` call site to remain inside the
  subshell at the end (already correct — verify no regression).
- [ ] 1.4: Add bats test: "lock orphan window closed — parent killed before
  subshell starts cannot leave a stranded lock" (use a stub that mimics the
  race).
- [ ] 1.5: Add bats test: "concurrent SessionStart cannot double-requeue
  processing/ entries — second invocation finds lock and exits".
- [ ] 1.6: Update inline comments referencing the old ordering.

**Files**: `plugins/yellow-core/hooks/scripts/session-start.sh`,
`plugins/yellow-core/tests/compound-session-start-hook.bats`.

### Phase 2: Brainstorm supersession callouts (PR #540 follow-on)

**Goal**: per-section SUPERSEDED markers so partial readers can't act on stale
designs.

- [ ] 2.1: Add `> **SUPERSEDED by plan D1**: bash subshells cannot invoke
  Agent/Task; see plan §Architecture (Option C, pure-shell capture).`
  callout immediately above the ASCII architecture diagram (around line 108
  of the brainstorm).
- [ ] 2.2: Add `> **SUPERSEDED by plan D8**: knowledge-compounder is NOT
  modified; staging-promoter agent is used instead.` callout under the
  "Decision 3" heading (around line 233-237).
- [ ] 2.3: Add `> **SUPERSEDED by plan D context**: 48h base threshold (was
  24h in this brainstorm).` inline note next to the `age > 24h` reference
  on line 245.
- [ ] 2.4: Add `> **SUPERSEDED by plan §JSONL Schema**: transcript_tail-only
  schema; no candidate_text/priority/tags in the Stop-hook write — those are
  generated at drain time by staging-scorer.` callout above the JSONL Schema
  heading (around line 168).
- [ ] 2.5: Resolve the "Open Questions" entries that the plan has answered:
  add `**Resolved: see plan D5**` (etc.) inline notes for Q2, Q3, Q6, Q7.
- [ ] 2.6: Update the brainstorm's deepen-validation doc (Q1/Q5 "BLOCKER"
  status) to "RESOLVED by Option C — pure-shell Stop hook + disowned drain
  subshell".

**Files**: `docs/brainstorms/2026-05-18-background-compounding-triggers-brainstorm.md`,
`docs/research/repo/background-compounding-triggers-deepen-validation.md`.

### Phase 3: RULE 14/14b hardening + integration tests (PR #544 follow-on)

**Goal**: close the regex false-negative window and add CI coverage so
regressions are detectable.

- [ ] 3.1: Replace RULE 14b's disjoint-boolean checks with proximity regex:
  ```javascript
  const namesCoreRules =
    /[Nn]ever (?:modif|write|touch)[^.\n]{0,80}CORE_RULES/.test(body) ||
    /CORE_RULES[^.\n]{0,80}[Nn]ever (?:modif|write|touch)/.test(body);
  ```
  Apply same pattern to `USER_PREFERENCES` and `KNOWN_PROJECTS`. The 80-char
  proximity window catches the protective "Never modify ... CORE_RULES" prose
  but rejects unrelated mentions.
- [ ] 3.2: Make RULE 14b's frontmatter strip CRLF-tolerant (match the
  `extractFrontmatter()` regex). Currently `/^---\n/` misses WSL2-created files.
- [ ] 3.3: Extend RULE 14 to also enforce `disallowedTools: [AskUserQuestion]`
  on `staging-reviewer.md` (currently only `staging-promoter.md`). Both agents
  run non-interactively.
- [ ] 3.4: Create `tests/integration/validate-agent-authoring-rule14.test.ts`
  (mirrors existing pattern in `validate-agent-authoring-review-rule.test.ts`):
  - Fixture: staging-promoter without `disallowedTools` → expect exit 1
  - Fixture: staging-promoter with proper frontmatter → expect exit 0
  - Fixture: missing staging-promoter.md entirely → expect exit 0 (graceful skip)
  - Fixture: body missing "Never modify" → expect exit 1
  - Fixture: body with "Never modify" elsewhere but missing CORE_RULES proximity
    → expect exit 1 (catches the false-negative)
  - Fixture: body satisfying all checks → expect exit 0
- [ ] 3.5: Document RULE 14b's heuristic-vs-AST nature in
  `scripts/validate-agent-authoring.js` header comment — explicitly call out
  the V2-AST upgrade as a tracked TODO with reference to this plan.
- [ ] 3.6: Update CLAUDE.md (root) to note RULE 14/14b exist and what they
  enforce.

**Files**: `scripts/validate-agent-authoring.js`,
`tests/integration/validate-agent-authoring-rule14.test.ts` (new),
`CLAUDE.md` (root).

### Phase 4: Phase 5.1 preview UX clarification (PR #540 follow-on)

**Goal**: align plan documentation with implemented behavior; surface the
"raw transcript bytes" preview as an intentional design choice.

- [ ] 4.1: Rewrite plan Phase 5.1 step 3 to explicitly state: "Preview shows
  the first 80 chars of `transcript_tail` (raw, post-redaction). The
  human-readable `candidate_text` is not yet computed at this point — it is
  generated by `staging-scorer` during the drain itself. If the preview is
  unintelligible, the user can either (a) approve and let the drain run to
  see the scored output in `drain-logs/`, or (b) cancel and let the auto-drain
  fire on next SessionStart."
- [ ] 4.2: Add a UX-mitigation note: optionally show the entry's metadata
  (`session_id`, `cwd`, file modification time) alongside the
  transcript_tail snippet so a user with no readable preview content can
  still identify *which* session is being drained.
- [ ] 4.3: Update the `/compound:review-staged` command's Step 3 preview block
  to render the metadata line (in addition to the existing
  `basename: title` line).

**Files**: `plans/background-compounding-triggers.md`,
`plugins/yellow-core/commands/compound/review-staged.md`.

## Technical Details

### Files to Modify

- `plugins/yellow-core/hooks/scripts/session-start.sh` — lock ordering refactor
- `plugins/yellow-core/tests/compound-session-start-hook.bats` — 2 new tests
- `docs/brainstorms/2026-05-18-background-compounding-triggers-brainstorm.md` — supersession callouts
- `docs/research/repo/background-compounding-triggers-deepen-validation.md` — BLOCKER→RESOLVED
- `scripts/validate-agent-authoring.js` — RULE 14 staging-reviewer coverage + RULE 14b proximity regex + CRLF
- `CLAUDE.md` — document RULE 14/14b
- `plans/background-compounding-triggers.md` — Phase 5.1 rewrite
- `plugins/yellow-core/commands/compound/review-staged.md` — metadata in preview

### Files to Create

- `tests/integration/validate-agent-authoring-rule14.test.ts` — RULE 14/14b integration tests
- `.changeset/yellow-core-compound-staging-followups.md` — patch bump (security hardening, no public-surface change)

### Dependencies

None. All changes use existing tooling.

## Testing Strategy

- **Phase 1**: 2 new bats tests in `compound-session-start-hook.bats`. Run via
  `pnpm test:integration` (configured to pick up bats via the
  `plugin-shell-tests` job).
- **Phase 2**: No automated tests — content review only. Verify via
  `pnpm validate:schemas` (catches any frontmatter regression).
- **Phase 3**: New integration test file gives ~6 test cases. Run via
  `pnpm test:integration -- validate-agent-authoring-rule14`.
- **Phase 4**: Manual smoke test of `/compound:review-staged` to confirm
  metadata renders.

CI baseline gate must pass: `pnpm validate:schemas && pnpm test:unit && pnpm lint
&& pnpm typecheck`.

## Acceptance Criteria

1. **Phase 1**: Bats tests demonstrate the lock-orphan window is closed and the
   processing/ requeue race is gated by the drain lock. `bats
   compound-session-start-hook.bats` shows 15/15 PASS (was 13/13 + 2 new).
2. **Phase 2**: Brainstorm doc has visible per-section SUPERSEDED callouts; no
   stale architectural claim is reachable without the supersession marker.
3. **Phase 3**: `pnpm test:integration` includes the new rule14 test file and
   it passes. RULE 14b's regex demonstrably rejects the "Never modify X /
   CORE_RULES anywhere" decoy fixture.
4. **Phase 4**: Plan Phase 5.1 description matches implementation behavior;
   `/compound:review-staged` preview renders metadata alongside transcript
   tail.

## Edge Cases

- **Phase 1**: a kill -9 between `mkdir` (now inside subshell) and the trap
  registration is still theoretically possible — but the subshell's lifetime
  is so short here that the 30-min stale-lock reaper remains the documented
  worst-case recovery. Note this explicitly in the comment.
- **Phase 3**: RULE 14b proximity window of 80 chars might be too tight for
  multi-sentence security blocks. If the rule rejects legitimate phrasings
  during this work, widen to 120 chars rather than going back to the global
  boolean.
- **Phase 4**: if `transcript_tail` is itself empty (capture edge case), the
  preview shows `(empty)` rather than blanks — explicit fallback string.

## References

- Prior review session findings (this session, 2026-05-19) — surfaced in
  `/yellow-review:review:review-all` aggregate summary
- Parent plan: `plans/background-compounding-triggers.md`
- Parent brainstorm: `docs/brainstorms/2026-05-18-background-compounding-triggers-brainstorm.md`
- Docs research: `docs/solutions/code-quality/claude-code-bare-flag-and-hook-recursion-guard.md`
- Related solutions:
  - `docs/solutions/code-quality/hook-set-e-and-json-exit-pattern.md`
  - `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
  - `docs/solutions/security-issues/prompt-injection-defense-layering-2026.md`
- Stack PRs (all MERGEABLE):
  - #540 `agent/docs/compound-staging-plan`
  - #542 `agent/feat/compound-staging-hooks`
  - #543 `agent/feat/compound-staging-agents`
  - #544 `agent/feat/compound-staging-surface`
