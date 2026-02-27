# Common Workflows

Workflow chains across the yellow-plugins ecosystem. Each chain lists the
commands in order, which plugins are required, and what to do when plugins are
missing.

## Prerequisites

### Minimum Viable Install

Only **yellow-core** is required. It provides the foundational workflow commands:
`/workflows:brainstorm`, `/workflows:plan`, `/workflows:work`,
`/workflows:review`, `/workflows:compound`.

### Full Install

```bash
/plugin marketplace add KingInYellows/yellow-plugins
```

Installs all 11 plugins. Each plugin degrades gracefully when dependencies are
missing — commands report what's unavailable rather than failing silently.

### Plugin Dependencies

| Plugin | Depends On | Without It |
|---|---|---|
| yellow-core | None | `/workflows:*` commands unavailable; yellow-review cross-plugin agents don't load |
| yellow-review | yellow-core (cross-plugin agents) | Only yellow-review's own agents run |
| yellow-debt | yellow-linear (for `/debt:sync`) | Cannot push findings to Linear |
| yellow-ci | gh CLI | All commands fail with auth error |
| yellow-devin | `DEVIN_SERVICE_USER_TOKEN` + `DEVIN_ORG_ID` | Delegation commands fail |
| yellow-chatprd | ChatPRD OAuth | Document commands fail |
| yellow-linear | Linear OAuth | Issue commands fail |
| gt-workflow | Graphite CLI | All commands fail |
| yellow-ruvector | None | — |
| yellow-research | None | — |
| yellow-browser-test | None | — |

## New User Onboarding

First time setup:

1. Install the marketplace:
   ```bash
   /plugin marketplace add KingInYellows/yellow-plugins
   ```
2. Verify hooks are firing: start a new Claude Code session and check for
   `[yellow-ci]` messages (if you have GitHub Actions workflows)
3. Configure credentials for optional plugins:
   - Linear: OAuth on first use — no env var needed (MCP handles it)
   - Devin: `export DEVIN_SERVICE_USER_TOKEN=cog_...` and `export DEVIN_ORG_ID=...`
   - ChatPRD: run `/chatprd:setup`
4. Try the daily development chain (below) on a small feature

---

## Daily Development

**Plugins required:** yellow-core, gt-workflow
**Optional:** yellow-review, yellow-linear

The most common workflow chain. Use for any feature implementation.

### Full Chain

```
/workflows:brainstorm → /workflows:plan → /gt-stack-plan → /workflows:work → /smart-submit → /review:pr → /review:resolve → /linear:sync
```

### Step by Step

1. **`/workflows:brainstorm`** — Explore the problem space through dialogue.
   Captures decisions in `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md`.
   Skip if requirements are already clear.

2. **`/workflows:plan`** — Transform the brainstorm into an actionable plan at
   `docs/plans/YYYY-MM-DD-<topic>-plan.md`. Creates task breakdown, identifies
   files to modify, and sets acceptance criteria.

3. **`/gt-stack-plan`** — Plan how to split the implementation into stacked PRs.
   Skip for single-PR features.

4. **`/workflows:work docs/plans/YYYY-MM-DD-<topic>-plan.md`** — Execute the
   plan. **Important:** pass the plan file path explicitly. Creates commits via
   Graphite.

5. **`/smart-submit`** — Audit changes, commit, and push via
   `gt submit --no-interactive`. Runs parallel code quality agents before
   pushing.

6. **`/review:pr`** — Multi-agent review of the submitted PR. Applies P1/P2
   fixes; confirms with user before pushing. Requires yellow-review.

7. **`/review:resolve`** — Address pending review comments in parallel. Run after
   receiving feedback from human reviewers.

8. **`/linear:sync`** — Link PR to Linear issue and update status. Requires
   yellow-linear.

### Minimum Viable Chain (yellow-core + gt-workflow)

```
/workflows:plan → /workflows:work <plan-path> → /smart-submit
```

### Without Linear

Skip step 8. The rest of the chain works identically.

---

## CI Response

**Plugins required:** yellow-ci
**Optional:** yellow-linear (for `/ci:report-linear` and `/linear:delegate`), yellow-devin (for `/devin:status` monitoring after delegation)

Triggered automatically when a session starts and CI failures are detected.

### Chain

```
SessionStart auto-detect → /ci:diagnose → /ci:report-linear → /linear:delegate
```

1. **SessionStart hook** — Automatically checks for recent CI failures and shows
   a reminder: `[yellow-ci] CI: N recent failure(s)...`

2. **`/ci:diagnose`** — Fetch logs, identify failure pattern (F01-F12), suggest
   fix. Can accept a run ID or auto-detect from current branch.

3. **`/ci:report-linear`** — Create a Linear issue from the diagnosis. Requires
   yellow-linear.

4. **`/linear:delegate`** — Optionally delegate the fix to Devin using the
   Linear issue created in step 3. Requires yellow-linear + Devin env vars
   (`DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID`).

### Without Linear

Use `/ci:diagnose` alone — it produces the diagnosis and fix suggestion without
needing Linear.

---

## Code Review

**Plugins required:** yellow-review
**Optional:** yellow-core (cross-plugin agents)

### Single PR

```
/review:pr [PR# | URL | branch] → /review:resolve
```

1. **`/review:pr`** — Adaptive multi-agent review. Selects agents based on PR
   size and content. Applies P1/P2 fixes; confirms with user before pushing.

2. **`/review:resolve`** — Resolve pending review comments from human reviewers.
   Spawns parallel agents for each comment thread.

### Full Stack

```
/review:all stack
```

Reviews all PRs in your Graphite stack in dependency order (base → tip). Each PR
goes through: review (compounding runs inside review:pr) → resolve → restack.

### Batch Review

```
/review:all all
```

Reviews all your open non-draft PRs.

---

## Knowledge Capture

**Plugins required:** yellow-core

### Manual Capture

```
/workflows:compound [brief context]
```

Run after solving a significant problem. Captures the solution in
`docs/solutions/<category>/<slug>.md` and/or `MEMORY.md`. Uses 5 parallel
subagents to extract problem, solution, related docs, prevention steps, and
category.

### Automatic Capture

After each PR in `/review:all`, the `knowledge-compounder` agent automatically
compounds review findings as part of the inline `review:pr` flow. P1 findings
are always compounded; P2 findings only if the same pattern recurs across 2+
files in the review. The step is skipped if no P1 or P2 findings were reported.

---

## Stack Maintenance

**Plugins required:** gt-workflow

### Daily Sync

```
/gt-sync → /gt-nav → /gt-amend or /smart-submit
```

1. **`/gt-sync`** — Pull latest from trunk, restack branches, clean up merged
   PRs.

2. **`/gt-nav`** — Visualize your stack and navigate between branches.

3. **`/gt-amend`** — Quick-fix the current branch: audit + amend + re-submit.
   Use for small fixes. For larger changes, use `/smart-submit`.
