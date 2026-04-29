---
title: Stale Env Var Docs and Prose Count Drift in Top-Level README
date: 2026-03-01
category: code-quality
track: knowledge
problem: 'Stale Env Var Docs and Prose Count Drift in Top-Level README'
tags: [pr-review, documentation, env-vars, devin, readme, resolve-pr-parallel, file-ownership]
severity: minor
component: README.md
symptoms:
  - Top-level README shows deprecated DEVIN_API_TOKEN (apk_ prefix) while plugin uses DEVIN_SERVICE_USER_TOKEN (cog_ prefix)
  - README omits required DEVIN_ORG_ID export
  - README states "Eight plugins" when only six unique plugins have MCP servers
  - Four automated reviewers (Devin, Copilot, Qodo, CodeRabbit) all flagged the same issues
root_cause: Plugin V3 migration updated plugin-level docs but not the top-level README; MCP count was hand-written and not verified against the table
resolution: Single-pass fix to README.md correcting env vars, adding DEVIN_ORG_ID, updating token URL, and fixing plugin count
---

# Stale Env Var Docs and Prose Count Drift in Top-Level README

## Problem

PR #98 (`docs/readme-yellow-research-and-counts`) accumulated 7 unresolved
review threads from 4 automated reviewers, all targeting `README.md`. The issues
reduced to two distinct problems:

### 1. Deprecated Devin Environment Variables

The README's Devin setup section showed V1 API credentials:

```bash
export DEVIN_API_TOKEN="apk_your_token_here"
# Get your token: https://devin.ai/settings/api
```

But the `yellow-devin` plugin migrated to the V3 API (PR #18+), which requires
`DEVIN_SERVICE_USER_TOKEN` (with `cog_` prefix) and `DEVIN_ORG_ID`. The plugin's
own README (`plugins/yellow-devin/README.md:34-35`) and CLAUDE.md both use the
correct names. Users following the top-level README would set the wrong variable.

### 2. Wrong MCP Plugin Count

The README stated "Eight plugins connect to external MCP servers" but the table
below it lists only 6 unique plugins: `yellow-core`, `yellow-chatprd`,
`yellow-devin`, `yellow-linear`, `yellow-research`, `yellow-ruvector`. The count
was hand-written and never re-verified against the table after edits.

## Root Cause

**Stale env vars:** The V3 migration updated all plugin-level files but the
top-level README setup section was not updated in the same PR. The descriptive
text at line 71 was partially updated (mentioning `DEVIN_SERVICE_USER_TOKEN`) but
the bash code block at line 75 still showed the old variable.

**Wrong count:** The count "Eight" was authored manually and not derived from the
table. After adding/removing MCP rows across multiple PRs, the prose drifted from
the table it described.

## Solution

All 7 threads targeted the same file (`README.md`), so a single-pass fix was
applied instead of spawning parallel agents:

```diff
-Eight plugins connect to external MCP servers. Authentication requirements vary
-by server.
+Six plugins connect to MCP servers. Authentication requirements vary by
+server.
```

```diff
-export DEVIN_API_TOKEN="apk_your_token_here"
-
-# Get your token: https://devin.ai/settings/api
+export DEVIN_SERVICE_USER_TOKEN="cog_your_token_here"
+export DEVIN_ORG_ID="your-org-id"
+
+# Create a service user at: Enterprise Settings > Service Users
+# Find your org ID at: Enterprise Settings > Organizations
```

After committing and pushing, all 7 threads were resolved via the GitHub GraphQL
`resolveReviewThread` mutation, then verified with an empty re-query.

## Workflow Learning: File-Ownership Grouping for PR Comments

The `resolve-pr-parallel` skill instructs spawning one `pr-comment-resolver`
agent per unresolved thread in parallel. **This is wrong when all comments target
the same file** — it causes last-writer-wins conflicts where the last agent to
write overwrites earlier agents' changes.

The correct approach follows the established file-ownership grouping pattern:

1. Fetch all unresolved threads
2. Build a map: `file -> [threads]`
3. For each unique file, handle ALL threads for that file in a single agent/pass
4. Only parallelize across files that do not overlap

**Decision heuristic:** If the union of all target files is a set of size 1,
spawn one agent for the entire batch. Parallel agents = parallel files.

## Prevention

### Stale Env Var References

**On-touch rule:** Whenever an env var name is modified in any plugin file, run
`rg '<OLD_VAR_NAME>' --glob '*.md'` across the full repo and update every hit in
the same commit. This includes the top-level README, plugin README, SKILL.md
files, and command `.md` files.

**Single source of truth:** The canonical env var name lives in each plugin's
`CLAUDE.md` "Required Environment Variables" section. All other files are derived
copies.

### Prose Count Drift

**Never write counts as prose literals without verification.** Before finalizing
any sentence containing a count ("N plugins", "Eight servers"), literally count
the table rows. Do not trust a count written in a previous version of the file.

### resolve-pr-parallel File Grouping

Before spawning agents, always run file-ownership analysis:
- Map each comment to its target file(s)
- Group comments sharing any file into the same agent
- Only parallelize across non-overlapping file sets
- For small PRs with all comments in one file, skip parallel machinery entirely

## Related Documentation

- [parallel-todo-resolution-file-based-grouping.md](./parallel-todo-resolution-file-based-grouping.md) — Original file-ownership grouping pattern (PR #37)
- [parallel-multi-agent-review-orchestration.md](./parallel-multi-agent-review-orchestration.md) — File-ownership applied to review findings (PRs #11, #15)
- [cross-plugin-documentation-correctness.md](./cross-plugin-documentation-correctness.md) — Env var naming errors across plugin docs (PRs #75, #76)
- `plugins/yellow-devin/README.md:42-50` — V1-to-V3 migration instructions
- `plugins/yellow-review/commands/review/resolve-pr.md` — The resolve-pr command that spawns parallel agents

---

## Update — 2026-04-26

### Multi-File MCP Count Drift on Backend Add/Remove (PR #265)

PR #265 (`feat: Ceramic.ai as default research backend`) added one MCP server
(`ceramic_search`) to `yellow-research`. The review found stale MCP counts in
four separate files that had not been updated together:

| File | Stale value |
|---|---|
| `README.md:29` | "1 MCP" for yellow-core |
| `README.md:265` | "5 MCPs" for yellow-research |
| `README.md:271` | MCP server enumeration missing `ceramic_search` |
| `plugins/yellow-research/package.json:5` | Pre-Ceramic MCP count in description field |

All four were prose literals written by hand when the previous backend was the
canonical one. None were derived from a single source of truth.

#### Why This Keeps Recurring

MCP server counts and enumerations appear in at least four locations per plugin:

1. The top-level `README.md` summary table (plugin row count)
2. The top-level `README.md` narrative paragraph
3. The plugin's own `package.json` description field
4. The plugin's CLAUDE.md or setup command enumeration block (e.g.,
   `plugins/yellow-core/commands/setup/all.md` Step 1.5 probe list)

When a backend is added, the author updates the agent files (allowed-tools,
SKILL.md, command bodies) and the plugin-level docs — but the top-level README
and `package.json` are outside the immediate edit surface and silently lag.

#### Rule: Treat Every MCP Add/Remove as a Cross-File Operation

Any PR that adds or removes an MCP server must run the following grep before
opening for review:

```bash
GIT_ROOT="$(git rev-parse --show-toplevel)"
PLUGIN="yellow-research"   # substitute affected plugin name
NEW_SERVER="ceramic_search" # substitute new or removed server name

# Find prose count references that may need updating
rg --glob '*.md' --glob '*.json' -n "$PLUGIN" "$GIT_ROOT" \
  | grep -E '[0-9]+ MCP|MCP[s]? [0-9]+|[0-9]+ server'

# Find server name enumerations that may be missing the new server
rg --glob '*.md' -n \
  'exa_search|context7|perplexity|ceramic_search|github_search' \
  "$GIT_ROOT/plugins/$PLUGIN" "$GIT_ROOT/README.md"
```

Every hit that does not already include the new server name is a stale
reference that must be updated in the same commit.

#### Classification Probe Counts Are Also Affected

`plugins/yellow-core/commands/setup/all.md` contains a Step 1.5 enumerated
probe list AND a Step 2 classification block that references ToolSearch
visibility. Both sections must be updated together: adding a criterion to the
classification block without adding the corresponding tool to the probe list
means the LLM has no probe result to evaluate at classification time — the
criterion silently misfires on every run. See
[setup-classification-probe-coupling.md](./setup-classification-probe-coupling.md)
for the full pattern.
