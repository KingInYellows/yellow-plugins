---
status: complete
priority: p2
issue_id: "096"
tags: [code-review, documentation, public-release]
dependencies: []
---

# Stale References to Archived Docs in docs/

## Problem Statement

7 files in `docs/operations/`, `docs/contracts/`, and `docs/cli/` reference
documents that were archived to the `development` branch in Phase 1
(SPECIFICATION.md, traceability-matrix.md, EXECUTIVE-SUMMARY.md, etc.). These
create broken links for anyone browsing the repo.

## Findings

Files with stale references:

- `docs/operations/metrics.md` → SPECIFICATION.md, traceability-matrix.md
- `docs/operations/uninstall.md` → SPECIFICATION.md
- `docs/operations/release-checklist.md` → traceability-matrix.md
- `docs/operations/ci.md` → SPECIFICATION.md
- `docs/operations/ci-pipeline.md` → SPECIFICATION.md, traceability-matrix.md
- `docs/operations/runbook.md` → traceability-matrix.md, SPECIFICATION.md
- `docs/operations/feature-flags.md` → SPECIFICATION.md
- `docs/operations/git-auth.md` → SPECIFICATION.md
- `docs/operations/postmortem-template.md` → traceability-matrix.md
- `docs/contracts/error-codes.md` → SPECIFICATION.md
- `docs/contracts/registry-format.md` → SPECIFICATION.md
- `docs/contracts/compatibility.md` → SPECIFICATION.md
- `docs/cli/browse.md` → SPECIFICATION.md
- `docs/cli/publish.md` → SPECIFICATION.md
- `docs/cli/uninstall.md` → SPECIFICATION.md
- `docs/cli/update.md` → SPECIFICATION.md
- `docs/ui/style-guide.md` → SPECIFICATION.md
- `docs/marketplace-quickstart.md` → PRD.md

Also contains FR-/NFR-/CRIT- internal requirement identifiers.

## Proposed Solutions

### Option A: Remove stale links (Small effort)

Remove or comment out reference links to archived documents. Keep the
operational content intact.

- **Pros:** Quick fix, preserves operational docs
- **Cons:** Docs still contain FR/NFR/CRIT jargon
- **Effort:** Small
- **Risk:** Low

### Option B: Archive these docs too (Medium effort)

Move the entire `docs/operations/`, `docs/contracts/`, `docs/cli/`, and
`docs/ui/` directories to the `development` branch alongside the specification
docs they reference.

- **Pros:** Clean `docs/` for public repo, no stale references
- **Cons:** Loses operational documentation that may be useful for contributors
- **Effort:** Medium
- **Risk:** Low

### Option C: Leave as-is for v2 cleanup

Accept that these docs are legacy infrastructure documentation. They aren't
linked from README or any user-facing surface.

- **Pros:** Zero effort, no risk
- **Cons:** Broken links remain, confusing for anyone exploring docs/
- **Effort:** None
- **Risk:** None

## Recommended Action

_To be filled during triage_

## Technical Details

- **Affected directories:** docs/operations/, docs/contracts/, docs/cli/,
  docs/ui/
- **Total files with stale refs:** 18
- **Archived docs referenced:** SPECIFICATION.md, traceability-matrix.md,
  EXECUTIVE-SUMMARY.md, IMPLEMENTATION-GUIDE.md, PRD.md

## Acceptance Criteria

- [ ] No remaining links to archived documents in `docs/`
- [ ] Or: explicit decision to defer this cleanup

## Work Log

| Date       | Action            | Notes                                  |
| ---------- | ----------------- | -------------------------------------- |
| 2026-02-18 | Finding created   | PR #24 review — stale doc references   |

## Resources

- PR: #24
- Related: Phase 1 archived 95 internal docs to `development` branch
