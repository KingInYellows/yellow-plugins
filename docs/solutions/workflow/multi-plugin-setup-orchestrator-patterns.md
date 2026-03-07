---
title: "Multi-Plugin Setup Orchestrator: Dashboard, Classification, and Delegation Patterns"
date: "2026-03-04"
category: workflow
tags:
  - setup-orchestration
  - multi-plugin-dashboard
  - status-classification
  - skill-delegation
  - claude-code-commands
  - plugin-ecosystem
  - graceful-degradation
  - review-fix-patterns
components:
  - plugins/yellow-core/commands/setup/all.md
  - plugins/yellow-core/CLAUDE.md
---

# Multi-Plugin Setup Orchestrator: Dashboard, Classification, and Delegation Patterns

Discovered while building `setup:all`, a unified orchestrator command that checks
prerequisites, classifies plugin status, and delegates to per-plugin setup
commands across a 9-plugin ecosystem.

## Context

Users of the yellow-plugins ecosystem had to run 9 separate `/X:setup` commands
across 8 plugins to configure everything after a fresh install. There was no
single entry point to see what was missing, no unified dashboard, and no
before/after verification that setups actually worked. Each plugin's setup
command worked independently, but nothing tied them together.

The `setup:all` command was built in yellow-core using a hybrid approach:
non-interactive dashboard first, then interactive setups only for plugins that
need attention, with a before/after summary at the end.

## Root Cause

No orchestration layer existed above the individual setup commands. The gap
manifested as:

1. **No visibility** -- users could not see which of 9 plugins needed attention
   without running each setup command individually.
2. **No prioritization** -- there was no status classification (READY vs PARTIAL
   vs NEEDS SETUP) to help users focus on what mattered.
3. **No verification** -- after running setups, there was no automated re-check
   to confirm the configuration actually improved.

## Solution

### 1. Single Bash Call Dashboard

Batch all prerequisite, environment variable, config file, and plugin
installation checks into one shell command. This minimizes tool-call budget and
produces a structured output that can be parsed for classification.

```bash
printf '=== Prerequisites ===\n'
command -v node    >/dev/null 2>&1 && printf '%-14s OK (%s)\n' 'node:' "$(node --version 2>/dev/null)" || printf '%-14s NOT FOUND\n' 'node:'
command -v curl    >/dev/null 2>&1 && printf '%-14s OK\n' 'curl:' || printf '%-14s NOT FOUND\n' 'curl:'
# ... all CLI tools checked with command -v

printf '\n=== Environment Variables ===\n'
[ -n "${MORPH_API_KEY:-}" ] && printf '%-30s set\n' 'MORPH_API_KEY:' || printf '%-30s NOT SET\n' 'MORPH_API_KEY:'
# ... all env vars checked with [ -n "${VAR:-}" ]

printf '\n=== Config Files ===\n'
[ -d .ruvector ] && printf '%-48s exists\n' '.ruvector/:' || printf '%-48s missing\n' '.ruvector/:'
# ... all config files/dirs checked with [ -f ] or [ -d ]

printf '\n=== Installed Plugins ===\n'
plugin_cache="$HOME/.claude/plugins/cache"
if [ -d "$plugin_cache" ]; then
  for p in yellow-ruvector yellow-morph ...; do
    # Check each plugin cache directory for plugin.json with matching name
  done
fi
```

Key design choice: dashboard checks are **shallow** -- env var presence and CLI
existence only. No API validation, no format checks. That is each setup
command's job. This avoids duplicating logic and keeps the orchestrator
lightweight.

### 2. Three-Tier Status Classification with Catch-All

Each plugin is classified as READY, PARTIAL, or NEEDS SETUP based on the
dashboard output.

**Critical pattern -- catch-all negative for NEEDS SETUP:**

```text
yellow-morph:
- READY: rg OK AND node OK AND MORPH_API_KEY set
- NEEDS SETUP: any READY condition not met
```

The initial implementation enumerated specific failure cases (e.g., "MORPH_API_KEY
not set" and "rg missing" separately). This left gaps where a combination of
failures was not covered. The fix was a catch-all: "any READY condition not met"
implies NEEDS SETUP.

**PARTIAL status** covers degraded-but-functional states:

```text
yellow-semgrep:
- READY: SEMGREP_APP_TOKEN set AND semgrep OK
- PARTIAL: SEMGREP_APP_TOKEN set but semgrep NOT FOUND
- NEEDS SETUP: SEMGREP_APP_TOKEN NOT SET

yellow-ci:
- READY: gh OK AND jq OK AND ssh OK AND gh_auth OK
- PARTIAL: tools OK but gh_auth NOT AUTHENTICATED, or ssh NOT FOUND
- NEEDS SETUP: gh NOT FOUND OR jq NOT FOUND
```

### 3. Skill-Based Delegation

The orchestrator invokes existing setup commands via the Skill tool in a fixed
order, without modifying or wrapping them:

```text
1. ruvector:setup    (infrastructure)
2. morph:setup       (infrastructure)
3. devin:setup       (API keys)
4. semgrep:setup     (API keys)
5. research:setup    (API keys)
6. chatprd:setup     (interactive wizard)
7. ci:setup          (interactive wizard)
8. browser-test:setup (interactive wizard)
9. statusline:setup  (always last -- detects all other plugins)
```

**Why fixed order over dependency graph:** the plugin list changes rarely (a few
times per quarter). A hard-coded list is trivial to update. Dynamic
auto-discovery would be over-engineered for 9 plugins maintained by the same
team.

**Graceful degradation:** if a Skill invocation fails (skill not found, plugin
not installed, MCP unavailable), the orchestrator records the failure and
continues to the next plugin. It does not stop.

### 4. Plugin Installation Detection

The dashboard checks `$HOME/.claude/plugins/cache` for installed plugins before
classifying status. Uninstalled plugins are shown as NOT INSTALLED and excluded
from the interactive setup phase.

```bash
plugin_cache="$HOME/.claude/plugins/cache"
if [ -d "$plugin_cache" ]; then
  for d in "$plugin_cache"/*/; do
    if [ -f "${d}.claude-plugin/plugin.json" ]; then
      name=$(python3 -c "import json; print(json.load(open('${d}.claude-plugin/plugin.json')).get('name',''))" 2>/dev/null)
      # match against known plugin names
    fi
  done
fi
```

### 5. Before/After Verification

After all selected setups complete, the same dashboard Bash check from Step 1 is
re-run. A comparison table shows only plugins whose status changed, giving the
user confidence that the setups worked.

## Review Findings and Fixes

The following issues were caught during review and fixed in the same session:

### Classification Gaps (P2)

**Problem:** NEEDS SETUP conditions enumerated specific failure cases rather than
using a catch-all. When multiple prerequisites were missing simultaneously, some
combinations fell through without a classification.

**Fix:** Changed to "any READY condition not met -> NEEDS SETUP" for every plugin.

### Redundant CLI Checks (P2)

**Problem:** The dashboard checked for `npm` and `npx` separately, but both are
bundled with `node`. If node is installed, npm and npx are always present.

**Fix:** Removed npm and npx from the prerequisite checks. Only check for `node`.

### Unused Tool in allowed-tools (P2)

**Problem:** `Read` was listed in the command's `allowed-tools` frontmatter but
never used in the command body.

**Fix:** Removed `Read` from `allowed-tools`.

### Pointless Final Step (P2)

**Problem:** A "Next Steps" step offered to re-run setup:all or exit. This added
no value -- the user can just run the command again.

**Fix:** Removed the step entirely.

### Unnecessary Interaction on All-READY Path (P2)

**Problem:** When all 9 plugins were already READY, the command still presented
an AskUserQuestion with options like "Run statusline refresh" / "Done". This was
unnecessary friction.

**Fix:** Simplified to display "All plugins are configured. Nothing to do." and
stop.

### SSH Gap in CI Classification (P3)

**Problem:** The yellow-ci classification only had READY and NEEDS SETUP states.
When tools were present but `ssh` was missing or `gh auth` failed, there was no
PARTIAL classification.

**Fix:** Added PARTIAL case: "tools OK but gh_auth NOT AUTHENTICATED, or ssh NOT
FOUND."

### Missing Plugin Installation Check (External Review)

**Problem:** The dashboard classified plugin status without first checking
whether the plugin was installed. A plugin that was not installed would show
misleading status based on incidental env var/config state.

**Fix:** Added plugin cache directory detection as a prerequisite for status
classification. Uninstalled plugins show as NOT INSTALLED.

### Brittle Version Parsing (External Review)

**Problem:** Python3 version extraction used `awk` to parse `python3 --version`
output, which is fragile across different python version string formats.

**Fix:** Switched to `python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"` -- using python's own interpreter for reliable version extraction. This matches the pattern used in the statusline setup command.

## Prevention Strategies

### Checklist for Multi-Plugin Orchestrator Commands

**Status Classification**
- [ ] Every plugin's NEEDS SETUP uses a catch-all negative ("any READY condition not met") rather than enumerating each failure case individually
- [ ] PARTIAL status is defined for plugins with degraded-but-functional states
- [ ] Plugin installation is verified before status classification
- [ ] Status table shows specific detail about what is missing, not generic labels

**Prerequisite Checks**
- [ ] CLI tools bundled with other tools are not checked separately (e.g., npm/npx with node)
- [ ] Version extraction uses the tool's own interpreter rather than fragile awk/sed parsing
- [ ] `command -v` is used for CLI existence checks (not `which`)

**Command Hygiene**
- [ ] `allowed-tools` lists only tools actually used in the command body
- [ ] Every step serves a purpose -- no "Next Steps" or "What would you like to do?" at the end
- [ ] All-satisfied paths exit cleanly without unnecessary user interaction
- [ ] Dashboard checks are shallow (presence only) to avoid duplicating per-plugin setup logic

**Delegation**
- [ ] Existing per-plugin commands are reused unchanged via Skill tool
- [ ] Fixed order is documented with rationale (infrastructure first, statusline last)
- [ ] Failed Skill invocations are recorded and do not stop the orchestrator
- [ ] Before/after re-check uses the exact same checks as the initial dashboard

## Related Documentation

- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` -- 16 anti-patterns for command markdown files; prerequisite checks, allowed-tools hygiene, AskUserQuestion patterns
- `docs/solutions/code-quality/brainstorm-orchestrator-agent-authoring-patterns.md` -- Patterns for brainstorm orchestrator agents
- `docs/brainstorms/2026-03-04-setup-all-command-brainstorm.md` -- Original brainstorm exploring approaches (single orchestrator, two-layer, registry)
- `plans/setup-all-command.md` -- Implementation plan with acceptance criteria and edge cases
- `plugins/yellow-core/commands/setup/all.md` -- The setup:all command itself
