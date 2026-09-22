# Common Workflows

Workflow chains across the yellow-plugins ecosystem. Each chain lists the
commands in order, which plugins are required, and what to do when plugins are
missing.

## Prerequisites

### Minimum Viable Install

Only **yellow-core** is required. It provides the foundational workflow commands:
`/flow:brainstorm`, `/flow:plan`, `/flow:work`,
`/flow:review`, `/flow:compound`.

### Full Install

```bash
/plugin marketplace add KingInYellows/yellow-plugins
```

Installs all 19 plugins. Each plugin degrades gracefully when dependencies are
missing — commands report what's unavailable rather than failing silently.

### Plugin Dependencies

| Plugin | Depends On | Without It |
|---|---|---|
| yellow-core | None | `/flow:*` commands unavailable; yellow-review cross-plugin agents don't load |
| yellow-review | yellow-core (cross-plugin agents) | Only yellow-review's own agents run |
| yellow-debt | yellow-linear (for `/debt:sync`) | Cannot push findings to Linear |
| yellow-ci | gh CLI | All commands fail with auth error |
| yellow-devin | `DEVIN_SERVICE_USER_TOKEN` + `DEVIN_ORG_ID` | Delegation commands fail |
| yellow-linear | Linear OAuth | Issue commands fail |
| gt-workflow | Graphite CLI | All commands fail |
| github-workflow | `gh` stack CLI, and `/stack:status` `READY_GITHUB` | `/github-stack:*` commands are unavailable |
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
4. Try the daily development chain (below) on a small feature

---

## Daily Development

**Plugins required:** yellow-core, and exactly one stacked-PR provider
(`gt-workflow` or `github-workflow`)
**Optional:** yellow-review, yellow-linear

The most common workflow chain. Use for any feature implementation. Run
`/stack:status` before any branch or PR step. Only `READY_GRAPHITE` and
`READY_GITHUB` continue; every other state stops. Do not hardcode Graphite.

### Full Chain

`READY_GRAPHITE`:

```
/flow:brainstorm → /flow:plan → /gt-stack-plan → /flow:work → /smart-submit → /review:pr → /review:resolve → /linear:sync
```

`READY_GITHUB`:

```
/flow:brainstorm → /flow:plan → /flow:work → /github-stack:submit → /review:pr → /review:resolve → /linear:sync
```

`/github-stack:plan` only reports the current stack. It does not decompose a
feature the way `/gt-stack-plan` does, and there is no GitHub equivalent of
`/smart-submit`.

### Step by Step

1. **`/flow:brainstorm`** — Explore the problem space through dialogue.
   Captures decisions in `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md`.
   Skip if requirements are already clear.

2. **`/flow:plan`** — Transform the brainstorm into an actionable plan at
   `plans/YYYY-MM-DD-<topic>-plan.md`. Creates task breakdown, identifies
   files to modify, and sets acceptance criteria.

3. **`/gt-stack-plan`** — Graphite only. Plan how to split the implementation
   into stacked PRs. Skip for single-PR features. On `READY_GITHUB`, skip this
   step; `/github-stack:plan` is a read-only stack view, not a decomposition.

4. **`/flow:work plans/YYYY-MM-DD-<topic>-plan.md`** — Execute the
   plan. **Important:** pass the plan file path explicitly. `/flow:work`
   uses whichever stacked-PR provider is ready (Graphite or GitHub).

5. **Submit.** On `READY_GRAPHITE`, **`/smart-submit`** audits changes, commits,
   and pushes via `gt submit --no-interactive`, running parallel code quality
   agents before pushing. On `READY_GITHUB`, **`/github-stack:submit`** stages
   specific files, commits, and submits with `gh stack submit` (draft by
   default). It does not run those audit agents.

6. **`/review:pr`** — Multi-agent review of the submitted PR. Applies P1/P2
   fixes; confirms with user before pushing. Requires yellow-review.

7. **`/review:resolve`** — Address pending review comments in parallel. Run after
   receiving feedback from human reviewers.

8. **`/linear:sync`** — Link PR to Linear issue and update status. Requires
   yellow-linear.

### Minimum Viable Chain

`READY_GRAPHITE` (yellow-core + gt-workflow):

```
/flow:plan → /flow:work <plan-path> → /smart-submit
```

`READY_GITHUB` (yellow-core + github-workflow):

```
/flow:plan → /flow:work <plan-path> → /github-stack:submit
```

### Without Linear

Skip step 8. The rest of the chain works identically.

---

## CI Response

**Plugins required:** yellow-ci
**Optional:** yellow-linear (for `/ci:report-linear` and `/linear:delegate`); the enabled `remote-agent` provider (yellow-cursor preferred, yellow-devin legacy) for delegation

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

4. **`/linear:delegate`** — Optionally hand the Linear issue from step 3 to the
   enabled `remote-agent` provider. yellow-cursor is preferred; yellow-devin is
   the legacy path and is used only when it is the provider that resolves.
   `--provider` breaks a tie only when both are enabled. Requires yellow-linear.
   The Devin path also needs `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID`.

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
/flow:compound [brief context]
```

Run after solving a significant problem. Captures the solution in
`docs/solutions/<category>/<slug>.md` and/or `MEMORY.md`. Uses 6 parallel
subagents to extract problem, solution, related docs, prevention steps,
category, and vocabulary candidates (for `docs/CONCEPTS.md`).

### Automatic Capture

After each PR in `/review:all`, the `knowledge-compounder` agent automatically
compounds review findings as part of the inline `review:pr` flow. P1 findings
are always compounded; P2 findings only if the same pattern recurs across 2+
files in the review. The step is skipped if no P1 or P2 findings were reported.

---

## Stack Maintenance

**Plugins required:** the stacked-PR provider `/stack:status` reports
(`gt-workflow` on `READY_GRAPHITE`, `github-workflow` on `READY_GITHUB`)

### Daily Sync

`READY_GRAPHITE`:

```
/gt-sync → /gt-nav → /gt-amend or /smart-submit
```

`READY_GITHUB`:

```
/github-stack:sync → /github-stack:nav → /github-stack:amend
```

1. **Sync.** **`/gt-sync`** pulls latest from trunk, restacks branches, and
   cleans up merged PRs. **`/github-stack:sync`** pulls trunk and syncs the
   local stack with `gh stack sync` (pruning merged branches needs
   confirmation).

2. **Navigate.** **`/gt-nav`** visualizes the Graphite stack and moves between
   branches. **`/github-stack:nav`** checks out a stack number, PR, URL, or
   branch via `gh stack checkout`.

3. **Amend.** **`/gt-amend`** audits, amends, and re-submits the current
   Graphite branch. Use `/smart-submit` for larger Graphite changes.
   **`/github-stack:amend`** folds working-tree changes into the current commit
   and re-submits with `gh stack submit`. There is no GitHub `/smart-submit`.
