---
'yellow-core': patch
---

Compound-staging review follow-ups: concurrency hardening + lint hardening + doc clarity.

**Phase 1 — Concurrency hardening (PR #542 follow-on):**
- `session-start.sh`: processing/ requeue loop now gated on the absence of an
  active `.drain-lock`. Closes the race where two concurrent SessionStarts
  could both requeue the same crashed entry.
- `session-start.sh`: parent-side EXIT trap with `LOCK_OWNED_BY_PARENT` flag
  releases `.drain-lock` if the parent exits between `mkdir` and successful
  subshell dispatch. Closes the lock-orphan window (was previously recoverable
  only via the 30-min stale-lock reaper).
- Two new bats tests: `does not requeue processing/ entries when drain lock
  is held`, `parent-side trap releases drain-lock on early-exit before dispatch`.

**Phase 2 — Brainstorm supersession callouts (PR #540 follow-on):**
- Per-section SUPERSEDED markers added to `docs/brainstorms/2026-05-18-*.md`
  Architecture block, JSONL Schema section, Decision 3, and Decision 4 so
  readers who scan to a specific section can't act on stale designs.

**Phase 3 — RULE 14/14b hardening + tests (PR #544 follow-on):**
- `scripts/validate-agent-authoring.js`: RULE 14 now also enforces
  `disallowedTools: [AskUserQuestion]` on `staging-reviewer.md` (was only
  checking `staging-promoter.md`). Both run non-interactively.
- RULE 14b: replaced the global-boolean co-location check with paragraph-based
  co-location. Catches the decoy where "Never modify staging entries" appears
  in one paragraph and the protected section names appear in unrelated
  paragraphs elsewhere.
- RULE 14b: CRLF-tolerant frontmatter strip (matches `extractFrontmatter()`),
  so WSL2-authored files aren't false-negative.
- RULE 14 character class widened from `[\w:-]+` to `[\w.:-]+` to admit tool
  names with dots.
- New `tests/integration/validate-agent-authoring-rule14.test.ts` (8 cases):
  pass/fail fixtures for both rules including the decoy false-negative.

**Phase 4 — Phase 5.1 preview UX clarification (PR #540 + PR #544 follow-on):**
- Plan Phase 5.1 description rewritten to explicitly state that the preview
  shows raw `transcript_tail` bytes (not `candidate_text`, which doesn't
  exist until drain time).
- `/compound:review-staged` Step 3 preview now renders metadata
  (`session_id`, `cwd`, file mtime) alongside the transcript snippet so users
  can identify which session each entry came from even when the transcript
  preview is unintelligible.

No public-surface changes; all updates are internal hardening, doc clarity,
and test coverage. Patch bump.
