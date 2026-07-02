# C6 progressive-disclosure — manual e2e stub-firing checklist

CI COULD verify that every load stub names an existing file and that
every `references/` file is named by at least one stub (the Tier 2
plan's acceptance criteria assume such a check), but no automated
stub↔reference validator exists yet — for now that property is verified
by one-time manual grep. CI also CANNOT observe the core C6 mechanism:
an agent actually Reading a reference file at runtime. This checklist is
the manual verification gate for both, following the same method
accepted for yellow-council (PR #3,
`docs/testing/yellow-council-manual-tests.md`).

## What to watch for — two distinct failure modes

- **Skip:** the agent reaches the stub, does NOT Read the reference, and
  improvises the detail from prior knowledge. Detect by checking the
  session transcript for a `Read` of the exact reference path at the
  reach point, and by comparing the produced output (prompt text, report
  shape, reviewer set) against the reference's canonical content.
- **Stop:** the agent halts its turn at the load boundary instead of
  continuing after the Read (turbo documents this citing
  anthropics/claude-code#17351). Detect by the workflow ending
  mid-phase right after the reference load with no follow-on action.

Record PASS/FAIL per row. Any FAIL means the stub wording needs
strengthening (unconditional imperative, exact path, failure mode named)
— not that the split should be reverted.

Later tiers append companion rows (suffixed "(C9 companion)" etc.) for
other agent behaviors CI likewise cannot observe. Those rows verify
their own mechanism, not stub-firing — the Skip/Stop taxonomy and the
"strengthen the stub wording" remedy above apply only to the
stub-firing rows.

## Checklist

### yellow-core / optimize

- [ ] Run `/yellow-core:optimize` with a minimal 2-candidate spec through
      Phase 3. Verify a Read of
      `plugins/yellow-core/skills/optimize/references/judge-protocol.md`
      occurs BEFORE the first judge dispatch, and the judge prompt matches
      the template verbatim (untrusted-data preamble, per-criterion 1-5,
      style_bias_check field). Skip-detection: an improvised judge prompt
      missing `style_bias_check` proves the skip.
- [ ] In Phase 4, reply `show 3` on a `parallel_count >= 3` run. Verify
      `references/pagination-layouts.md` is Read and the follow-up
      AskUserQuestion matches the per-count layout (≤ 4 options).
- [ ] Force a spec-validation failure (missing `optimization_target`).
      Verify `references/failure-modes.md` is Read and the run aborts
      with a field-level error WITHOUT inferring the missing field.

### yellow-core / compound-lifecycle

- [ ] Run `/yellow-core:compound-lifecycle <narrow-scope-hint>`. Verify a
      Read of
      `plugins/yellow-core/skills/compound-lifecycle/references/scoring-and-clustering.md`
      occurs before any staleness classification, and that an entry with
      `inbound_refs >= 5` is classified Keep WITHOUT a computed score
      (citation gate applied as pre-check).
- [ ] At Step 9, verify `references/report-template.md` is Read and the
      report contains exactly the Scope / Staleness / Overlap / Applied /
      Recommended / Archive moves / Coverage sections.

### yellow-review / review-pr command

- [ ] Set `review_pipeline: legacy` in `yellow-plugins.local.md`, run
      `/review:pr <PR#>`. Verify a Read of
      `plugins/yellow-review/references/review-pr/legacy-fallback.md`
      and that the dispatched reviewer set matches the legacy list (incl.
      `security-sentinel`/`performance-oracle`, NOT the Wave-2 calibrated
      variants). Remove the config key afterwards; re-run and verify the
      reference is NOT loaded on the default persona path.
- [ ] Run `/review:pr` on a PR that yields at least one P2 finding, in a
      repo with `.ruvector/`. Verify a Read of
      `plugins/yellow-review/references/review-pr/knowledge-compounding.md`
      before Step 9a/9b execution, and that the findings table is fenced
      with `--- begin review-findings ---` / `--- end review-findings ---`.

### yellow-core / workflows-work + setup-all commands

- [ ] Run `/workflows:work` on a small plan to completion. If the agent
      needs a gt form not spelled out in the phases, verify it Reads
      `plugins/yellow-core/references/workflows-work/graphite-command-reference.md`
      rather than guessing syntax. (This stub is consulted-on-need; a run
      where every gt command was already inline is a vacuous PASS.)
- [ ] Run `/setup:all`. Verify a Read of
      `plugins/yellow-core/references/setup-all/credential-status-and-version-drift.md`
      and that BOTH probe blocks execute (a `=== Credential Status Files ===`
      section AND a `=== Plugin Version Drift ===` section appear in the
      dashboard). Skip-detection: a dashboard missing the version-drift
      line proves Step 1.7 was improvised away.

### yellow-core / workflows-work non-stack resume (C9 companion)

- [ ] Start `/workflows:work` on a plan with per-step `- [ ]` checkboxes,
      let it complete 2+ steps, and confirm each completed step's box is
      flipped to `- [x]` in the plan file in the same loop iteration as
      its TaskUpdate (Phase 2 step 1k writeback). Then kill the session,
      start a FRESH session, re-run `/workflows:work` on the same plan,
      and verify it announces resume mode, marks the already-done steps'
      tasks completed in TaskList, and starts from the first unchecked
      box without re-executing completed steps (Phase 2 step 0).
- [ ] Re-run `/workflows:work` on a plan whose every task checkbox is
      already `- [x]`. Verify it announces the plan is already complete
      and proceeds directly to Phase 3 without re-executing any step.
- [ ] Run `/workflows:work` on a plan whose implementation section is
      fully ticked but which carries a separate unchecked checklist
      section (e.g. `### Manual Testing Checklist`). Verify step 0 does
      NOT treat those checklist items as the resume target.
- [ ] Run `/workflows:work` on a prose-only plan (no task checkboxes) and
      verify the resume check announces "resume unavailable — running
      all steps" and the writeback is a silent no-op.

### yellow-council / council-patterns (no stub-firing test)

- [ ] No runtime verification needed: only the non-executed
      "Cross-References" provenance bullets moved
      (`references/cross-references.md`); every runtime-load-bearing
      section (output schema, redaction block, fence format, atomic
      write, Synthesis Format V1, CLI flag patterns, awk block) remains
      inline in the preloaded SKILL.md. Verify by grep, not execution.

## Results log

| Date | Runner | Rows run | Failures | Notes |
|------|--------|----------|----------|-------|
|      |        |          |          |       |
