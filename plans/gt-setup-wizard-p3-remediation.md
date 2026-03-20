# P3 Remediation: gt-setup AI Agent Wizard

## Overview

Address P3 review suggestions from the gt-setup wizard PR and add the required
changeset for CI. These are minor refinements — no new functionality.

## Implementation

### Accept (4 items)

- [ ] **P3-1: yq parse failures indistinguishable from absent fields.** In the
  yq parsing blocks across `gt-setup.md`, `smart-submit.md`, `gt-amend.md`, and
  `gt-stack-plan.md`, the `2>/dev/null || true` pattern silently swallows yq
  errors. Add a single-line stderr warning when yq returns non-zero (distinct
  from the field being absent). Pattern: check yq exit code, warn if non-zero,
  then fall through to defaults. Keep `|| true` to avoid breaking the flow.

- [ ] **P3-2: gt --version masks a broken binary.** In `gt-setup.md` Step 1,
  `gt --version 2>/dev/null` hides crash output. Capture the exit code: if
  non-zero AND output is empty, show `gt: BROKEN (exited with code N)` instead
  of `gt: ok (version unknown)`.

- [ ] **P3-4: Remove retry-on-failure AskUserQuestion in Phase 2 Step 7.** The
  retry loop after `gt user` failures is over-engineered — users can re-run
  `/gt-setup`. Remove the AskUserQuestion with "Retry failed settings" option.
  Keep the per-command status summary (Applied/Failed/Skipped).

- [ ] **P3-5: Remove "Show diff" branch in Phase 3 Step 9.** Simplify the
  existing-file flow from 3 options (Update/Show diff/Skip) to 2 options
  (Update/Skip). The user can read the file separately.

### Reject (3 items)

- **P3-3: pr_template.create is YAGNI.** Already implemented and documented in
  schema. Removing it creates churn for no runtime benefit. Keep.

- **P3-6: Debug printf 'GW_*=...' could recur.** Not actionable — the debug
  lines were already removed. No code change needed.

- **P3-7: Plan line-count estimate stale.** The plan doc is historical context,
  not live code. The actual command file speaks for itself.

### Required (1 item)

- [ ] **Changeset: create `.changeset/gt-setup-ai-agent-wizard.md`.** CI blocks
  merge without it. Select `minor` for `gt-workflow` (new feature: wizard) and
  `patch` for `yellow-core` (setup:all classification tweak).

## Files to Modify

| File | Change |
|---|---|
| `plugins/gt-workflow/commands/gt-setup.md` | P3-2 (gt --version exit code), P3-4 (remove retry), P3-5 (remove "Show diff") |
| `plugins/gt-workflow/commands/smart-submit.md` | P3-1 (yq error warning) |
| `plugins/gt-workflow/commands/gt-amend.md` | P3-1 (yq error warning) |
| `plugins/gt-workflow/commands/gt-stack-plan.md` | P3-1 (yq error warning) |
| `.changeset/gt-setup-ai-agent-wizard.md` | New file — changeset for CI |

## Acceptance Criteria

- yq parse failures produce a distinct stderr warning vs absent fields
- Broken `gt` binary is not reported as "ok (version unknown)"
- No retry loop in gt-setup Phase 2
- No "Show diff" option in gt-setup Phase 3
- Changeset file exists and CI passes
