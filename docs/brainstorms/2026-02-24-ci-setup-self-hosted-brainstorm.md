# Brainstorm: `ci:setup-self-hosted` Command

**Date:** 2026-02-24
**Status:** Ready for planning
**Plugin:** `yellow-ci`

---

## What We're Building

A new `/ci:setup-self-hosted` command that inventories a repository's available
GitHub Actions self-hosted runners and automatically optimizes workflow files to
route each job to the best available runner. It combines GitHub API data (runner
labels, online status) with live SSH health checks (CPU, memory, disk load) to
score runner fitness, then applies `runs-on` changes after user confirmation.

**End state:** After running the command, every workflow job uses a
strategically chosen `runs-on` value — matching OS, required labels, and current
runner load — instead of a hardcoded name or `ubuntu-latest`.

---

## Why This Approach

### Command + New Agent Split (Approved)

The command (`setup-self-hosted.md`) handles **data gathering** and **user
interaction**:

1. Fetch registered runners from GitHub API
2. SSH health check each online runner (CPU, memory, disk)
3. Pass inventory to the agent
4. Present the agent's recommendations as a diff table
5. AskUserQuestion confirmation
6. Apply edits

A new **`runner-assignment` agent** handles the **analytical work**:

- Read all `.github/workflows/*.yml` files
- For each job: infer required OS and capabilities from step content
- Score each runner against each job's requirements
- Generate a recommended `runs-on` value for every job
- Return a structured list of proposed changes

This follows the existing plugin pattern (`/ci:diagnose` → `failure-analyst`,
`/ci:runner-health` → `runner-diagnostics`) and keeps the agent independently
reusable.

---

## Key Decisions

### 1. Runner Discovery: GitHub API + SSH

The plugin currently discovers runners **exclusively via SSH** (from
`.claude/yellow-ci.local.md`). This command adds a **GitHub API layer first**:

```bash
gh api repos/{owner}/{repo}/actions/runners
```

Returns: name, status (`online`/`offline`), `busy`, and `labels[]` (including
OS, size, and custom tags).

SSH health data then **enriches** this inventory with real-time load metrics.
Graceful fallback: if no SSH config exists, the command still works using API
data only (label + OS matching, no load balancing).

### 2. Job Requirement Inference

The `runner-assignment` agent infers required runner capabilities from job
content using these signals:

| Signal | Capability Inferred |
|---|---|
| `docker build`, `docker-compose` | `docker` label or Linux runner |
| GPU keywords (`cuda`, `inference`, `gpu`) | `gpu` label |
| ARM keywords (`arm64`, `aarch64`) | `arm64` label |
| Windows paths (`C:\`, `.exe`, `powershell`) | `windows` OS |
| macOS tools (`brew`, `xcode`, `codesign`) | `macos` OS |
| Large compile jobs (Rust, C++, Go with many packages) | prefer high-CPU runner |
| Standard Node.js, Python, test jobs | any compatible OS runner |

### 3. Runner Scoring

Each job-runner pair gets a composite score:

- **Label match** (0-100): required labels covered by runner labels
- **OS compatibility** (binary): hard filter, no score if incompatible
- **Load score** (0-100): based on current CPU%, available memory, disk free
  (from SSH data, or 50 if no SSH config)

Best runner = highest composite score among compatible runners.

### 4. Conflict Handling

If no available runner satisfies a job's requirements:
- Leave the job's `runs-on` unchanged
- Report a warning: "No compatible runner found for job `X` (requires: `gpu`)"

### 5. Scope: Repo-Level Runners Only

Start with repository-level runners (`/repos/{owner}/{repo}/actions/runners`).
Org-level runners (`/orgs/{org}/actions/runners`) are out of scope — they
require org-admin permissions not guaranteed to be available.

### 6. `runs-on` Value Format

The command writes the runner's registered **name** (from the API) as a simple
string, not a label array. For example:

```yaml
# Before
runs-on: ubuntu-latest

# After
runs-on: gpu-runner-01
```

If a job needs multiple labels for routing, use an array:

```yaml
runs-on: [self-hosted, linux, gpu]
```

The agent decides format based on runner label structure.

---

## Open Questions

1. **Org-level runners**: Should a future iteration query org runners if
   repo-level yields no results? (Scoped out for now — add as an option flag
   later.)

2. **Offline runner handling**: If a runner is registered but offline, should it
   still appear in recommendations (with a warning), or be excluded entirely?
   Current decision: exclude from scoring, warn in output.

3. **Runner re-use across jobs**: Should the load balancer account for jobs
   *within the same workflow run* that will all execute concurrently? GitHub
   Actions picks runners at job start time, not planning time. Scoped out — too
   complex for v1.

4. **Pinned runner names**: Some repos pin `runs-on` to a specific runner name
   intentionally (e.g., secrets only on one runner). The command should detect
   when a job's current `runs-on` is an exact runner name that still exists
   online — treat as possibly intentional. Warn rather than auto-reassign.

5. **`runs-on` label arrays**: If the existing value is already a label array
   (e.g., `[self-hosted, linux]`) and a named runner satisfies it, should we
   replace with the name or leave the array? Decision: leave label arrays
   unchanged unless user explicitly opts in.

---

## New Files

- `plugins/yellow-ci/commands/ci/setup-self-hosted.md` — the command
- `plugins/yellow-ci/agents/ci/runner-assignment.md` — new analysis agent

No new skills — the `ci-conventions` skill already covers validation patterns
and SSH rules that both files will reference.

---

## Out of Scope

- Org-level runners
- Adding new runners (this is discovery + optimization, not provisioning)
- Changing other workflow settings (caching, concurrency) — that's
  `workflow-optimizer`
- Windows/macOS SSH health checks (SSH health only works for Linux runners
  currently)
