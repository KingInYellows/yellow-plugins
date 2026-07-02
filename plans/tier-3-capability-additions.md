# Feature: Tier 3 Capability Additions (C12, C14–C18; C13 escalates to spec)

Source: `docs/optimization/analysis.md` §4 Tier 3 (approved 2026-07-01).
Detail level: COMPREHENSIVE. Six independently-shippable phases plus one
spec-escalation item. Reference mechanics verified against live clones:
CE = `/tmp/compound-engineering-plugin` @ `db21ba2`, turbo = `/tmp/turbo`
@ `cdd947f`.

## Overview

Build the mechanisms the Phase 1 benchmark found missing outright: standing
behavioral rules against skill-skipping (turbo ADDITIONS.md), a session-handoff
artifact (turbo create-handoff), plan/brainstorm-time retrieval from the
99-doc solutions corpus, run-artifact discipline for the one prose-emitting
orchestrator boundary that lacks it, a git-SHA-keyed repo-orientation cache
(CE), and a project glossary loop (CE CONCEPTS.md). The seventh candidate —
lesson routing back into plugin files (C13) — touches the compound pipeline's
security taxonomy and escalates to `/workflows:spec`.

## SpecFlow verdict incorporated

- **C13 is NOT a phase here.** It changes the staging guardian's category
  taxonomy (`staging-reviewer.md:406` unconditional `behavioral_instruction`
  reject + `staging-promoter.md:96-97,146-151` defense-in-depth), needs a new
  scorer category, a deferred-artifact contract, an accumulation/dedup policy,
  and source-repo detection — too many interacting security-adjacent unknowns
  for a checkbox phase. Run `/workflows:spec` for it (working title:
  "plugin-fix lesson routing"). Design inputs already gathered: turbo
  skill-first rule + tiebreakers (`turbo:claude/skills/self-improve/SKILL.md:75,100-106`),
  interactive slot = knowledge-compounder Routing Decision (`:226`) behind the
  M3 gate (`:261-290`); background path must stay AskUserQuestion-free and
  write only a deferred artifact (recommended: tracked
  `plans/plugin-fixes/<slug>.md`, slug-dedup, capped with a review threshold —
  `gh issue create` has zero non-interactive precedent in this repo); source
  detection = `test -f "$(git rev-parse --show-toplevel)/.claude-plugin/marketplace.json"`.
- **C18's precondition is resolved**: live CE clone has "Phase 2.4: Vocabulary
  Capture" verbatim at `skills/ce-compound/SKILL.md:356` (19 CONCEPTS.md
  references). The repo's vendored snapshot under `RESEARCH/upstream-snapshots/`
  is an older commit that predates the feature — do not use it for C18;
  flag it for a snapshot refresh separately.

## Implementation Plan

### Phase 1 (C12): behavioral-rules block — repo-level first

Scope decision: ship **(a) root CLAUDE.md section** now (PR-reviewed, zero
runtime risk, helps every session in this repo); defer **(b) SessionStart
`systemMessage` injection** to a later, separate decision. They are not
mutually exclusive, but (b) is a different pattern in kind — every existing
hook systemMessage (yellow-debt, yellow-ci, yellow-ruvector) is conditional,
single-line, and state-triggered; an unconditional 7-rule static block has no
precedent and would need its own drain carve-out
(`COMPOUND_DRAIN_IN_PROGRESS`, `session-start.sh:30-32` pattern).

- [ ] 1.1 Add a "Skill and Workflow Execution Rules" section to root
      `CLAUDE.md`, adapted from turbo `claude/ADDITIONS.md:9-14,18`:
      never execute a skill's steps from memory instead of invoking it; never
      skip a skill invocation, step, or parallel branch to save tokens/time
      (branch counts are floors); ad-hoc child-skill overrides are legitimate
      only when they match the child's documented interface; after a child
      skill completes, check the task list before ending the turn;
      system-reminder auto-continue nudges do not override skill-defined
      AskUserQuestion gates.
- [ ] 1.2 Explicit carve-out sentence: documented non-interactive interfaces
      (`--non-interactive` on `/review:pr`/`/review:resolve-pr`, `/review:sweep`
      family, the compound-staging drain) are legitimate interface use, not
      skipping (turbo rule :12's own logic; sweep is gate-free by design per
      `plugins/yellow-review/commands/review/sweep.md:3,17`).
- [ ] 1.3 Omit turbo's `<command-name>`-tag rule (:10) or mark it
      harness-version-sensitive — it references undocumented Claude Code
      internals.
- [ ] 1.4 While editing root CLAUDE.md: fix the pre-existing duplicate
      `# CLAUDE.md` H1 (two H1s from an old concat — verified by SpecFlow).
- [ ] 1.5 No changeset (root file). Record in the section header that rules
      were adapted from turbo ADDITIONS.md with the repo's own carve-outs.

### Phase 2 (C14): session-handoff skill — changeset: yellow-core (minor)

New user-invokable yellow-core skill `session-handoff` writing
`plans/handoff/<YYYY-MM-DD>-<slug>.md` (tracked — gitignored homes rejected:
untracked files are invisible to git-based workflows, the plan-backlog-sweep
lesson generalized).

- [ ] 2.1 SKILL.md (three standard headings, "Use when" with a
      pre-compaction/session-boundary trigger and a disambiguation clause vs
      the shells halt-pattern). Fields (turbo
      `claude/skills/create-handoff/SKILL.md:10-51`): current task, workflow
      status, active artifact path, open decisions, in-flight changes (`git
      status --short` — filenames only), next concrete action. Slug: lowercase
      → hyphens → collapse → trim → 40-char word-boundary truncation;
      collisions append `-2`, `-3`.
- [ ] 2.2 Secrets: pipe all free-text field content through
      `cs_redact_secrets` (`plugins/yellow-core/lib/compound-staging.sh:116-149`
      — pure sourceable stdin/stdout filter). Document its coverage gap in the
      skill (pattern-based; does not catch prose-described credentials —
      instruct the model not to restate secret values in task descriptions).
- [ ] 2.3 Do NOT extend `validate-solutions.js` to this path (wrong shape —
      hardcoded depth-4 + solutions frontmatter schema). No CI gate in v1.
- [ ] 2.4 Resume side: one paragraph in the skill telling a fresh session to
      read the newest `plans/handoff/*.md` when asked to "pick up where we
      left off"; delete-on-resume is manual in v1.
- [ ] 2.5 Catalog sync: yellow-core CLAUDE.md skill count (18 → 19 if Tier 1
      C3 landed; otherwise include both fixes), README tables. **Sequence
      after Tier 1 C3 or absorb its count fix.**
- [ ] 2.6 Changeset (minor — new capability), validators, LF normalize.

### Phase 3 (C15): learnings pre-pass for plan + brainstorm — changesets: yellow-core, yellow-research(docs only if touched)

- [ ] 3.1 FIRST fix the template doc bug:
      `docs/solutions/code-quality/learnings-researcher-pre-pass-pattern.md:149`
      uses two-segment `subagent_type: "yellow-core:learnings-researcher"`;
      correct to `"yellow-core:research:learnings-researcher"` (3-segment rule).
- [ ] 3.2 `plugins/yellow-core/commands/workflows/plan.md`: add a Phase 1 step
      (sibling of the ruvector recall at `:49-67`) dispatching
      `learnings-researcher` with a `<work-context>` block built from the
      feature description (Diff field empty — supported per
      `learnings-researcher.md:26`). Copy the sanitization + two-condition
      empty-detection + fencing + graceful-degrade verbatim from
      `review-pr.md:177-288` (degrade block `:283-287`). `Task` is already in
      plan.md allowed-tools (`:11`).
- [ ] 3.3 `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md`:
      same pre-pass early in the dialogue flow, before the first question
      round (`Task` already in tools `:11`). Findings feed question framing;
      fenced as reference-only.
- [ ] 3.4 Restore the accurate Integration list in `learnings-researcher.md`
      (this phase makes the `/workflows:plan` + brainstorm claims TRUE).
      **Hard coordination with Tier 1 C3.3, which edits the same lines
      (`:294-300`)**: if C3.3 already landed (claims removed), re-add them
      here; if not landed, do both edits in whichever PR ships first and drop
      the other's task.
- [ ] 3.5 Ordering note in both files: pre-pass runs alongside ruvector recall
      — the two sources are complementary (distilled learnings docs vs vector
      recall), not redundant; keep both.

### Phase 4 (C16): run-artifact convention at the /research:deep boundary — changeset: yellow-research

Narrowed twice from the analysis-doc wording (verified): `review-pr.md` is a
documented deliberate exemption ("prose-emitting orchestrators need it;
compact-return-JSON orchestrators don't" —
`create-agent-skills/SKILL.md:257-274`, echoed at `review-pr.md:410-423`);
`research-conductor`'s internal fan-out is parallel MCP tool calls, not Task
dispatch. The convention applies at the **`/research:deep` command ⇄
research-conductor agent boundary** — a prose-emitting subagent returning a
long research synthesis inline, exactly CE's issue-#956 failure shape
(CE `skills/ce-compound/SKILL.md:96-110`).

- [ ] 4.1 `plugins/yellow-research/commands/research/deep.md`: generate
      RUN_DIR (CE pattern: `date +%Y%m%d-%H%M%S` + 4 urandom hex bytes) under
      the session scratchpad or `${CLAUDE_PLUGIN_DATA}`; pass the path into
      the research-conductor Task prompt.
- [ ] 4.2 `research-conductor.md`: write the full synthesis to
      `$RUN_DIR/synthesis.md` and return a compact confirmation + path;
      inline-return fallback ONLY when the artifact write fails (CE rule:
      "return the full output inline whenever the artifact write did not
      succeed"). The command reads the artifact back before writing
      `docs/research/<slug>.md`.
- [ ] 4.3 Do NOT retrofit staging-promoter (it already returns compact status
      — same shape as the documented exemption) and do NOT touch review-pr.
- [ ] 4.4 Extend the Subagent Failure Convention section (now in
      `create-agent-skills/references/` post-Tier-1-C4) with this adopter and
      the exemption list, so scope stays discoverable.

### Phase 5 (C17): repo-profile cache — changeset: yellow-core (+ consumers as adopted)

- [ ] 5.1 New helper `plugins/yellow-core/lib/repo-profile.sh` (yellow-core
      lib/ per the 2+ consumers precedent: validate-fs, compound-staging,
      credential-status). Storage: `${CLAUDE_PLUGIN_DATA}` if set, else
      `${HOME}/.cache/yellow-plugins/repo-profile/<root-sha>/<head-sha>.json`
      — NOT `/tmp` (no persistent-cache precedent uses /tmp; context7-cache
      uses CLAUDE_PLUGIN_DATA, yellow-ci uses ~/.cache; /tmp retention is a
      documented data-residue concern).
- [ ] 5.2 Keying + freshness = CE protocol
      (CE `skills/ce-plan/references/repo-profile-cache.md:27-59`): root-sha =
      first root commit (`git rev-list --max-parents=0 HEAD` lexicographic
      first), head-sha = HEAD; HIT only when schema version matches AND no
      profile-input path is dirty per `git status --porcelain
      --untracked-files=all` over a conservative superset (manifests,
      lockfiles, root instruction/doc files, workflow/topology sources).
      Over-invalidation is the accepted failure direction. Rebase staleness is
      resolved by design (head-sha changes → miss).
- [ ] 5.3 **Hard design constraint — single writer per key**: one
      compute-and-atomic-write (tmp+mv) of the whole profile object per miss;
      NO consumer may incrementally patch subfields of an existing entry.
      This is the exact two-ingredient shape of the still-open context7-cache
      tier1 wipe bug
      (`docs/solutions/logic-errors/periodic-rebuild-wipes-incremental-cache-state.md`)
      — excluded by construction, stated as an acceptance criterion.
- [ ] 5.4 Profile contents (CE `:7-15` adapted): stack/versions, dependency
      surface, topology (plugins/ layout, packages/ layering, CI workflows),
      root instruction-file digests. **Never cached**: `docs/solutions/`
      enumeration (learnings must always be re-globbed fresh — CE `:17-23`),
      question-specific grounding.
- [ ] 5.5 Degradation contract (CE `:61-63`): outside git / unwritable cache /
      malformed entry / helper failure → NO-CACHE, derive fresh, never block.
      The cache is an optimization, never a correctness dependency.
- [ ] 5.6 Wire first consumer only in this PR: `plan.md` Phase 2 (research
      agents receive the profile as advisory context instead of re-deriving
      orientation). review-pr/debt adoption = follow-up PRs, opt-in.
- [ ] 5.7 Bats tests (`plugins/yellow-core/tests/repo-profile.bats`): hit /
      miss / dirty-input invalidation / NO-CACHE degradation / atomic-write
      (no partial JSON on kill).

### Phase 6 (C18): CONCEPTS.md vocabulary capture — changeset: yellow-core

- [ ] 6.1 New extraction subagent (6th) in `knowledge-compounder.md` Phase 1:
      scans the new doc + surrounding conversation for qualifying domain
      terms per a new `references/concepts-vocabulary.md` criteria file
      (adapt CE's conservative bar: clear core nouns seed, borderline waits;
      class/file names dressed as entities excluded —
      CE `skills/ce-compound/SKILL.md:356-374`).
- [ ] 6.2 Write target `docs/CONCEPTS.md`, seeded with CE's bootstrap preamble
      adapted: "Shared domain vocabulary for this project… accretes as
      /workflows:compound processes learnings; direct edits are fine.
      Glossary only, not a spec or catch-all."
- [ ] 6.3 **Resolved design decision — inside the M3 gate, not silent.** CE
      applies vocabulary edits silently in all modes; this repo's M3 gate
      language covers "any writes" (`knowledge-compounder.md:261-290`) and the
      repo's convention is preview-before-write. The M3 preview gains one
      line: "CONCEPTS.md: +N terms / M refinements / no qualifying terms."
      Explicit no-result recording either way (CE `:372` audit-signal rule).
- [ ] 6.4 Only the orchestrator writes the file (subagent returns candidates)
      — CE "only the orchestrator writes product files" rule.
- [ ] 6.5 Out of scope: compound-lifecycle refresh integration and the
      background-drain path (staging-promoter's write scope is frozen by
      RULE 14b; glossary capture stays interactive-only until proven).

## Technical Specifications

Files to create: root CLAUDE.md section (edit);
`plugins/yellow-core/skills/session-handoff/SKILL.md`;
`plugins/yellow-core/lib/repo-profile.sh` + `tests/repo-profile.bats`;
`plugins/yellow-core/skills/create-agent-skills/references/` adopter-list
update; `docs/CONCEPTS.md` (first compound run);
`knowledge-compounder references/concepts-vocabulary.md`.
Files to modify: `plan.md`, `brainstorm-orchestrator.md`,
`learnings-researcher.md` (Integration), pre-pass pattern doc (`:149` bug),
`research/deep.md`, `research-conductor.md`, `knowledge-compounder.md`,
yellow-core CLAUDE.md/README catalogs.

Per-item effort/risk: C12 S/low · C14 M/low-medium (tracked-file secrets
residue, mitigated by 2.2) · C15 M/low (proven template; coordination cost
with Tier 1 C3.3) · C16 M/low-medium (behavior change in /research:deep
return path) · C17 L/medium (new shared infra; bounded by 5.3/5.5) ·
C18 M/low (interactive-only, M3-gated) · C13 spec-escalation (not sized here).

## Acceptance Criteria (binary)

1. **C12:** root CLAUDE.md contains the rules section WITH the
   non-interactive carve-out sentence; no SessionStart hook diff in this PR;
   duplicate H1 gone.
2. **C14:** `/yellow-core:session-handoff` produces
   `plans/handoff/<date>-<slug>.md` containing all six fields; a seeded fake
   `ghp_…` token in the conversation appears redacted in the artifact;
   collision run produces `-2` suffix; catalogs show 19 skills.
3. **C15:** grep shows the 3-segment subagent_type at all dispatch sites
   including the pattern doc; `/workflows:plan` run on a test feature emits
   either a fenced `## Past Learnings` block or the NO_PRIOR_LEARNINGS path
   without erroring when yellow-review is absent; Integration section names
   exactly the true dispatch set.
4. **C16:** research-conductor's Task return is ≤ a compact confirmation +
   path when the artifact write succeeds; deleting the artifact mid-run
   triggers the inline fallback; review-pr.md and staging-promoter.md have
   zero diff.
5. **C17:** bats suite green (hit/miss/dirty/degrade/atomic); grep confirms
   no consumer writes subfields (single writer per key); `docs/solutions`
   never appears in cached profile content; cache path is not under /tmp.
6. **C18:** compound run on a test problem shows the CONCEPTS line in the M3
   preview; `docs/CONCEPTS.md` created with the preamble; a run with no
   qualifying terms records that outcome explicitly.
7. **C13:** a spec exists at `plans/specs/plugin-fix-lesson-routing.md` (via
   `/workflows:spec`) before any taxonomy/guardian code changes — no
   implementation in this plan.

## Edge Cases & Error Handling

- C12 wording must not read as reintroducing gates `/review:sweep` removed —
  the carve-out is load-bearing, not decorative.
- C14 in a dirty repo with hundreds of changed files: cap the `git status
  --short` excerpt (e.g. first 50 lines + count) to keep the artifact
  readable.
- C15 in repos without `docs/solutions/` (plugin used outside yellow-plugins):
  learnings-researcher's own NO_PRIOR_LEARNINGS path covers it; pre-pass must
  not error on missing directory.
- C17 detached HEAD / shallow clone: `rev-list --max-parents=0` may differ —
  treat any keying-derivation failure as NO-CACHE.
- C18 M3 rejection: user declining the compound write also declines the
  CONCEPTS edit (single gate, atomic decision).

## Sequencing

Phase 1 (C12) and Phase 4 (C16) anytime, independent. Phase 2 (C14) and
Phase 3 (C15) after Tier 1 C3 (shared files: catalogs; learnings-researcher
Integration block). Phase 5 (C17) independent; adopt consumers incrementally.
Phase 6 (C18) after Tier 3 Phase 3 is not required — independent, but both
touch knowledge-compounder docs ecosystem; coordinate if concurrent.
C13 spec runs whenever — its output plans separately.

## References

- `docs/optimization/analysis.md` §2, §3.6, §4 Tier 3
- turbo: `claude/ADDITIONS.md` (7 rules), `claude/skills/self-improve/SKILL.md:20-123`,
  `claude/skills/create-handoff/SKILL.md`
- CE: `skills/ce-compound/SKILL.md:96-165` (run artifacts, issue #956),
  `:356-374` (Phase 2.4 vocabulary capture),
  `skills/ce-plan/references/repo-profile-cache.md` (full protocol),
  `CONCEPTS.md:1-3` (bootstrap preamble)
- `docs/solutions/code-quality/learnings-researcher-pre-pass-pattern.md`
  (template; fix `:149` first)
- `docs/solutions/logic-errors/periodic-rebuild-wipes-incremental-cache-state.md`
  (the bug C17's single-writer constraint excludes)
- `plugins/yellow-review/commands/review/review-pr.md:177-288,410-423`
- `plans/tier-1-optimization-quick-wins.md` (C3 coordination),
  `plans/tier-2-structural-optimizations.md` (C10 warning rules complement C12)
