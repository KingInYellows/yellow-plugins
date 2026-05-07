# Post-W3 Functional Smoke Test

This addendum to `release-checklist.md` Section 3 documents the functional
acceptance test for the EveryInc merge effort's Wave 3 deliverables. The
existing Section 3 covers CLI install/update/publish/rollback mechanics —
this checklist exercises the actual plugin behaviors Wave 3 added.

**Status:** Required closure gate. The merge effort is closed when this test
passes on a fresh Claude Code install.

**Sign-off prerequisites:** Merge of PRs:

- #402 — backbone loose threads (BT-1 frontmatter backfill, BT-2
  `code-reviewer` stub removal)
- #403 — agent-native-reviewers + authoring skills
- #406 — yellow-debt scanner v2.0 emission audit
- #410 — yellow-docs `/docs:review` + 7 persona reviewers

---

## Section A: Pre-Test Setup

**Objective**: Establish a clean Claude Code instance with no pre-existing
yellow-plugins marketplace entries.

- [ ] Claude Code latest stable installed
  - macOS: `brew upgrade claude-code` or download latest
  - Linux: per platform installer
  - WSL: per Windows install path
- [ ] Verify clean state (run inside Claude Code, not a shell):
  ```text
  /plugin marketplace list
  # Expected: KingInYellows/yellow-plugins NOT present
  ```
  If present, remove first: `/plugin marketplace remove KingInYellows/yellow-plugins`
- [ ] Open a test repo (any git repo will work; recommend a small TS or
  Python project)

---

## Section B: Marketplace Install

**Objective**: Verify the marketplace installs cleanly via the canonical
short-form command.

- [ ] Install:
  ```text
  /plugin marketplace add KingInYellows/yellow-plugins
  ```
  - Expected: marketplace appears in `/plugin marketplace list`
  - Expected: 17 plugins available for install
- [ ] Install required plugins for the functional checks below:
  ```text
  /plugin install yellow-core@yellow-plugins
  /plugin install yellow-review@yellow-plugins
  /plugin install yellow-docs@yellow-plugins
  /plugin install yellow-debt@yellow-plugins
  ```
  - Expected: each install completes without remote-validator errors

---

## Section C: Wave 3 Functional Acceptance

### C.1 `/review:pr` end-to-end

**Objective**: Confirm the Wave 2 multi-persona review pipeline still works
end-to-end after BT-2 stub removal and the W3 #5 reviewer additions.

- [ ] In the test repo, identify any small PR (or create a trivial test PR
  via `gt create`):
  ```bash
  gh pr list --limit 5
  ```
- [ ] Run review against the PR:
  ```text
  /review:pr <PR#>
  ```
  - Expected: command starts; learnings pre-pass runs (or skips silently
    if yellow-research not installed); persona reviewers dispatch
    in parallel
  - Expected: no errors referencing the deleted `code-reviewer` stub
  - Expected: at least one persona returns findings in the standard
    JSON compact-return schema
  - Expected: command exits cleanly (no stack traces, no orphan
    background processes)

### C.2 `/docs:review` end-to-end (NEW)

**Objective**: Confirm the W3 #2 `/docs:review` orchestrator and 7 persona
reviewers work end-to-end on a real planning document.

- [ ] Pick any planning doc as input (a brainstorm or PRD in the test
  repo, or use this checklist itself):
  ```text
  /docs:review docs/operations/post-w3-functional-smoke-test.md
  ```
  - Expected: command validates the path
  - Expected: 6 always-applicable persona reviewers dispatch in parallel
  - Expected: adversarial-document-reviewer is invoked IF the doc has
    more than 5 requirements OR risk-domain keywords (this checklist
    has both — it should fire)
  - Expected: each invoked persona returns findings in the JSON
    compact-return schema
  - Expected: report rendered to stdout grouped by persona
  - Expected: no errors; graceful degradation if any persona fails

### C.3 `/debt:audit` v2.0 schema confirmation

**Objective**: Confirm the W3 #7 audit-only PR (#406) result holds — all
5 scanners emit v2.0 schema fields.

- [ ] Run a small audit:
  ```text
  /debt:audit
  ```
  - Expected: 5 scanner agents dispatch in parallel
  - Expected: each writes to `.debt/scanner-output/<scanner>.json`
  - Expected: every finding carries the canonical v2.0 schema fields per
    `plugins/yellow-debt/skills/debt-conventions/SKILL.md`:
    `finding`, `file`, `failure_scenario`, `confidence`, `category`,
    `severity`, `effort`, and `fix`.
- [ ] Verify schema in any one output:
  ```bash
  jq '.findings[0] | keys' .debt/scanner-output/ai-pattern-scanner.json
  # Expected: ["category", "confidence", "effort", "failure_scenario", "file",
  #           "finding", "fix", "severity"] — all 8 v2.0 keys present
  ```

### C.4 W3 #5 auto-trigger on plugin-authoring diff

**Objective**: Confirm the 3 new yellow-review reviewers
(`cli-readiness-reviewer`, `agent-cli-readiness-reviewer`,
`agent-native-reviewer`) auto-trigger on PR diffs that touch plugin
authoring surface.

- [ ] Construct a synthetic plugin-authoring diff in the test repo (or use
  any merged yellow-plugins PR that touches `plugins/<x>/agents/`):
  ```bash
  gh pr list --search 'plugins/' --state all --limit 5
  ```
- [ ] Run review:
  ```text
  /review:pr <PR# touching plugins/<x>/agents/>
  ```
  - Expected: dispatch table shows `plugin-contract-reviewer`,
    `cli-readiness-reviewer`, `agent-cli-readiness-reviewer`,
    `agent-native-reviewer` all selected (4 reviewers co-fire on the
    same plugin-authoring globs intentionally; concerns are disjoint)
  - Expected: each returns findings in the JSON compact-return schema
    (or empty findings array if no issues)

---

## Section D: Cleanup

- [ ] Uninstall test plugins (optional):
  ```text
  /plugin uninstall yellow-core@yellow-plugins
  /plugin uninstall yellow-review@yellow-plugins
  /plugin uninstall yellow-docs@yellow-plugins
  /plugin uninstall yellow-debt@yellow-plugins
  ```
- [ ] Remove marketplace (optional):
  ```text
  /plugin marketplace remove KingInYellows/yellow-plugins
  ```

---

## Smoke Test Sign-Off

**Reviewer**: ************\_************ **Date**:
************\_************ **Platforms Tested**: ☐ macOS ☐ Linux ☐ WSL
**Claude Code version**: ********\_********
**yellow-plugins catalog version**: ********\_********
**Test Evidence Path**: `.ci-artifacts/releases/post-w3/smoke-tests/`

| Check | Result | Notes |
|---|---|---|
| C.1 `/review:pr` end-to-end | PASS / FAIL | |
| C.2 `/docs:review` end-to-end | PASS / FAIL | |
| C.3 `/debt:audit` v2.0 schema | PASS / FAIL | |
| C.4 W3 #5 auto-trigger | PASS / FAIL | |

**Overall**: PASS / FAIL

**Notes**: ************\_\_\_\_************

---

## Failure Handling

If any check fails:

1. Do NOT close PR #412 (or whichever PR carries this checklist) until
   resolved.
2. File a follow-up bug. The merge effort remains open.
3. Diagnose: was the failure due to local validator drift vs. remote
   validator (a recurring pattern — see MEMORY.md "Plugin Manifest
   Validation"), or a genuine code issue?
4. Fix forward in a stacked PR rather than reverting the W3 PRs.

## References

- Backbone plan: `plans/everyinc-merge.md`
- Wave 3 plan: `plans/everyinc-merge-wave3.md`
- Closure plan: `plans/everyinc-merge-remaining-work.md` (this stack's source)
- Brainstorm: `docs/brainstorms/2026-05-06-everyinc-merge-remaining-work-brainstorm.md`
- Existing Section 3 (CLI install/update/publish/rollback mechanics):
  `docs/operations/release-checklist.md` Section 3
- Sign-off block format: reused from `release-checklist.md` Section 3
  "Smoke Test Sign-Off" line 644
