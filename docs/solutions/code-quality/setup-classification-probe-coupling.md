---
title: Setup-All Classification Block and Probe List Must Stay in Sync
date: 2026-04-26
category: code-quality
tags: [agent-authoring, setup, classification, probe, coupling, plugin-authoring]
components: [yellow-core]
pr: '#265'
---

# Setup-All Classification Block and Probe List Must Stay in Sync

## Problem

`plugins/yellow-core/commands/setup/all.md` contains two co-dependent sections:

- **Step 1.5 — Probe list** (lines 197–209 in PR #265): enumerates the tools
  the LLM must probe via ToolSearch before reaching the classification step.
  Results are stored for use in Step 2.
- **Step 2 — Classification block** (line 266): references ToolSearch
  visibility criteria to route the session to the correct plugin tier.

In PR #265, a `"Ceramic ToolSearch visible"` criterion was added to the Step 2
classification block for `yellow-research`. The Step 1.5 probe list was not
updated to include `ceramic_search`. At runtime the LLM reaches the
classification criterion with no probe result for `ceramic_search` in memory —
the criterion evaluates against a missing value and the classification
silently misfires, routing to the wrong tier on every affected session.

The fix required adding `ceramic_search` to both the keyword list and the
resolved-name list in Step 1.5, and bumping the "four probes" count to "five".

## Root Cause

The probe list and classification block are in the same file but in different
numbered steps separated by approximately 60 lines. They are logically coupled
— every tool that the classification block references by ToolSearch visibility
must have been probed in Step 1.5 — but this coupling is invisible without
reading the full command body. There is no structural enforcement; nothing
prevents one section from drifting when the other is edited.

The drift happens because PRs that add a new backend tool naturally focus on
the classification criteria (Step 2: "what tier does this tool unlock?") and
miss the prerequisite probe step (Step 1.5: "can this tool be found?").

## Fix

Whenever a tool name is added to or removed from the Step 2 classification
block in `plugins/yellow-core/commands/setup/all.md`, apply the following
three-point update atomically in the same commit:

1. Add / remove the tool name from the Step 1.5 keyword list.
2. Add / remove the tool name from the Step 1.5 resolved-name list.
3. Update the Step 1.5 probe count ("N probes") to match the new total.

Verify by searching the file for every tool name appearing in a classification
criterion and confirming each also appears in Step 1.5.

```bash
GIT_ROOT="$(git rev-parse --show-toplevel)"
FILE="$GIT_ROOT/plugins/yellow-core/commands/setup/all.md"

# Extract tool names referenced in classification criteria (Step 2)
grep -n 'ToolSearch visible\|ToolSearch.*resolved\|probe.*visible' "$FILE"

# Confirm each appears in the Step 1.5 probe list
grep -n 'ceramic_search\|exa_search\|context7\|perplexity' "$FILE" | head -30
```

Any tool name found in the classification section but absent from Step 1.5 is
a coupling gap that will cause silent misfire at runtime.

## Prevention

### Rule: Classification Criteria Must Reference Only Probed Tools

The probe list (Step 1.5) is the contract between the preparation phase and the
classification phase. No tool may appear as a ToolSearch visibility criterion in
Step 2 unless it is explicitly probed in Step 1.5.

This rule applies to:
- `plugins/yellow-core/commands/setup/all.md` (the canonical setup command)
- Any other setup or triage command that follows the probe-then-classify
  pattern

### Review Checklist Item for Backend-Add PRs

Add this item to the PR checklist for any PR adding or removing an MCP server
in `yellow-research` or any plugin whose tier is determined by
`plugins/yellow-core/commands/setup/all.md`:

> [ ] `plugins/yellow-core/commands/setup/all.md` Step 1.5 probe list updated
> to include / remove `<tool_name>` (keyword list, resolved-name list, and
> count)

### Authoring Tip: Co-Locate a Reference Comment

Consider adding a comment near the Step 2 classification block that names the
dependency explicitly:

```
<!-- Classification criteria below must mirror the Step 1.5 probe list.
     Add any new tool to Step 1.5 (keyword + resolved name + count) first. -->
```

This makes the coupling visible to future authors editing the classification
block in isolation.

## Generalisation

The same coupling failure can occur in any multi-section command file where:

- Section A populates a result set (probe, fetch, list, resolve)
- Section B makes a decision based on that result set

Any time Section B gains a new criterion referencing a named entity, Section A
must be updated to include that entity in its collection pass. The sections are
never independent, even when they appear far apart in the file.

## Related Documentation

- [stale-env-var-docs-and-prose-count-drift.md](./stale-env-var-docs-and-prose-count-drift.md) — Co-occurring MCP count drift from PR #265; extended with the probe-count sub-case
- [agent-prose-fallback-threshold-anti-pattern.md](./agent-prose-fallback-threshold-anti-pattern.md) — Co-occurring subjective-threshold anti-pattern from PR #265
- [claude-code-command-authoring-anti-patterns.md](./claude-code-command-authoring-anti-patterns.md) — Broader anti-pattern catalog; includes `AskUserQuestion` and step-guard patterns
