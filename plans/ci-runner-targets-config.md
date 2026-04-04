# Feature: Layered Runner Targets Configuration for yellow-ci

> **Status: Implemented** — This plan has been implemented. Retained for historical context.

## Overview

Add a runner targets configuration system to yellow-ci that persists org-specific
runner pool definitions, routing rules, and semantic metadata (`best_for`,
`avoid_for`, JIT ephemeral behavior) so Claude knows which self-hosted runners
are available and how to route jobs — even when JIT ephemeral runners are
invisible to the GitHub API.

**Source brainstorm:**
`docs/brainstorms/2026-03-13-ci-runner-targets-config-brainstorm.md`

## Problem Statement

### Current Pain Points

- JIT ephemeral runners (ares, atlas) are invisible to the GitHub API while idle.
  Every CI command starts from zero knowledge about what runners exist.
- The runner-assignment agent scores purely on labels + load, with no semantic
  understanding of which runners are best for which workloads.
- Runner topology must be re-explained every session — no persistent config.
- Users with org-wide runner pools must repeat setup per-repo.

### User Impact

Without this, users must verbally describe their runner fleet every time they
want CI workflow optimization, runner assignment, or failure diagnosis involving
JIT ephemeral runners.

### Business Value

Enables intelligent, org-aware CI workflow optimization with zero per-session
setup cost after initial configuration.

## Proposed Solution

### High-Level Architecture

Three-layer config system:

1. **Global config** at `${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/runner-targets.yaml`
   — org-wide runner pool definitions and routing rules. Written once.
2. **Per-repo overrides** at `.claude/yellow-ci-runner-targets.yaml` — optional
   file that overrides specific runners or routing rules for a single repo.
3. **Session-start delivery** — hook reads merged config and surfaces a compact
   routing summary as `systemMessage`. All CI agents see runner context
   automatically.
4. **Active scoring** — runner-assignment agent uses `best_for`/`avoid_for` to
   influence job-to-runner matching.

### Key Design Decisions

1. **Separate file from SSH `.local.md`** — different concerns, different change
   cadences. Runner targets are routing policy; SSH config is connection
   credentials.

2. **Pure YAML (`.yaml` extension)** — primarily machine-read by hooks and
   agents. Simpler to parse with `yq`/`grep` than YAML-frontmatter markdown. No
   ambiguity about frontmatter boundaries.

3. **Pre-rendered routing summary** — the setup command writes a plain-text
   routing summary to `~/.cache/yellow-ci/routing-summary.txt` so the
   session-start hook only needs to `cat` it (no YAML parsing in the hook).
   This avoids adding `yq` as a hard dependency for the hook's 3s budget.

4. **Shallow merge by runner `name`** — local runner definition replaces the
   entire global definition for that name. No deep merge of individual fields.
   `routing_rules` from local replace global wholesale. Follows git config
   precedence model.

5. **New `/ci:setup-runner-targets` command** — keeps runner target setup
   separate from SSH setup (`/ci:setup`) and runner assignment
   (`/ci:setup-self-hosted`). Clean separation of concerns.

6. **XDG-compliant global path** — `${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/`
   follows the standard used by `gh`, `docker`, `kubectl`.

<!-- deepen-plan: codebase -->
> **Codebase:** The `${XDG_CONFIG_HOME:-$HOME/.config}` idiom is already used in
> this repo by `plugins/yellow-core/commands/setup/all.md` (line 89) and
> `plugins/gt-workflow/commands/gt-setup.md` (line 72). Consistent with existing
> convention. macOS does not set `XDG_CONFIG_HOME` by default but the `:-`
> fallback handles it. WSL works identically to native Linux.
<!-- /deepen-plan -->

7. **`best_for`/`avoid_for` are opaque strings** — matched via case-insensitive
   keyword substring against job characteristics. No vocabulary validation. The
   LLM handles fuzzy matching naturally.

8. **Graceful degradation** — if no runner targets config exists, all commands
   work exactly as today. Scoring changes are gated behind config existence.

9. **Per-repo config CAN be committed** — unlike `.local.md` (SSH credentials),
   runner targets contain routing policy with no secrets. Up to the user.

<!-- deepen-plan: codebase -->
> **Codebase:** The yellow-plugins repo `.gitignore` (line 2) contains `.claude/`
> which globally ignores all files in `.claude/` directories. This blocks
> committing `.claude/yellow-ci-runner-targets.yaml` in end-user repos that
> inherit this gitignore. Options: (a) users add `!.claude/yellow-ci-runner-targets.yaml`
> to their repo's `.gitignore`, (b) document that per-repo config at `.claude/`
> is gitignored by default and must be explicitly un-ignored if the team wants
> to share it, or (c) place committable config elsewhere (e.g.,
> `.github/yellow-ci-runner-targets.yaml`). Note: this `.gitignore` is for the
> plugin dev repo — end-user repos may have different gitignore rules.
> **Recommendation:** Keep `.claude/` path for consistency with other plugin
> configs, document that users must add a negation rule to commit it.
<!-- /deepen-plan -->

10. **Linter rule updates (W06/W07) deferred** — ship as fast follow to keep
    this PR focused.

### Trade-offs Considered

| Option | Chosen? | Reason |
|---|---|---|
| Extend `.local.md` instead of new file | No | Mixes credentials with policy; different change cadences |
| YAML-frontmatter `.local.md` format | No | Pure YAML simpler for hook/agent parsing |
| Parse YAML in session-start hook | No | Adds `yq` dependency; risk of exceeding 3s budget |
| Deep merge of runner fields | No | Creates confusion about which nested value "won" (ESLint abandoned this) |
| Global config only (no per-repo) | No | Can't handle per-repo overrides without full duplication |

## Implementation Plan

### Phase 1: Config Schema and Resolution Library

- [ ] 1.1: Create `plugins/yellow-ci/schemas/runner-targets.schema.json`
  - JSON Schema defining: `schema` (integer, required), `runner_targets` (array),
    `routing_rules` (string array)
  - Runner target object: `name` (required, DNS-safe regex), `type` (enum:
    `pool`, `static-family`, `static-host`), `mode` (enum: `jit_ephemeral`,
    `persistent`), `preferred_selector` (string array, label regex
    `^[a-zA-Z0-9][a-zA-Z0-9._:-]*$`), `best_for` (string array), `avoid_for`
    (string array), `notes` (string array)
  - Constraints: max 20 runner targets, max 20 routing rules, max 10 items per
    array field, max 200 chars per string, max 32KB total file size

<!-- deepen-plan: codebase -->
> **Codebase:** No `schemas/` directory exists inside `plugins/yellow-ci/`. The
> only `schemas/` directory is at the repo root (`schemas/marketplace.schema.json`,
> `plugin.schema.json`, etc.) for repo-level infrastructure schemas. No existing
> plugin has its own schemas directory. The existing validation pattern in
> yellow-ci uses shell functions in `lib/validate.sh` (13 functions, 435 lines),
> not JSON Schema. **Options:** (a) Create `plugins/yellow-ci/schemas/` as a new
> convention for plugin-specific schemas, (b) place at `schemas/runner-targets.schema.json`
> alongside existing repo-level schemas, or (c) implement validation purely via
> shell functions in `validate.sh` (consistent with existing pattern). Option (c)
> is most consistent with the codebase but less rigorous; option (a) sets a clean
> precedent for other plugins. Consider using JSON Schema as the specification
> document but implementing validation via shell functions for runtime use.
<!-- /deepen-plan -->

- [ ] 1.2: Create `plugins/yellow-ci/hooks/scripts/lib/resolve-runner-targets.sh`
  - Shell function `resolve_runner_targets()` that:
    1. Resolves global path: `${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/runner-targets.yaml`
    2. Resolves local path: `.claude/yellow-ci-runner-targets.yaml`
    3. If neither exists: return empty string (graceful degradation)
    4. If only one exists: use it as-is
    5. If both exist: merge by runner `name` — extract names from both, local
       wins per-name. `routing_rules` from local replaces global wholesale.
       If local has no `routing_rules` key, inherit global's.
       If local has no `runner_targets` key, inherit global's.
    6. Write pre-rendered routing summary to
       `~/.cache/yellow-ci/routing-summary.txt`:
       ```
       [yellow-ci] Runner pools: ares (pool/jit, heavy CI), atlas (pool/jit, lightweight). 6 routing rules loaded.
       ```
       Target: under 300 characters.
    7. Write merged config JSON to `~/.cache/yellow-ci/runner-targets-merged.json`
       for agents that need full details (runner-assignment, linter).
  - Dependencies: `grep`, `awk`, `sed` for YAML extraction (no `yq` required).
    Parse only the structured fields, not arbitrary YAML. The config schema is
    simple enough for line-oriented extraction.
  - Fallback: if extraction fails, emit warning to stderr and return empty.

<!-- deepen-plan: external -->
> **Research:** Line-oriented YAML parsing of a schema you control the generation
> of is an established pragmatic pattern (Docker Compose scripts, Helm chart
> preprocessors). The merge algorithm should split each file into per-runner
> blocks delimited by `- name: X`, build an associative array keyed on name,
> with local overwriting global. **Critical constraint:** enforce canonical format
> in generated YAML (2-space indent, block sequences only, no flow syntax like
> `[a, b]`, no multi-line scalars with `|` or `>`). If a user hand-edits and
> introduces flow syntax, the parser should fail gracefully rather than silently
> misparse. Document this format constraint in the schema.
<!-- /deepen-plan -->

- [ ] 1.3: Add validation functions to `plugins/yellow-ci/hooks/scripts/lib/validate.sh`

<!-- deepen-plan: codebase -->
> **Codebase:** Pre-existing inconsistency found: `CLAUDE.md` and `/ci:setup`
> Step 4 say runner names are min 2 chars (`^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`),
> but `validate_runner_name()` in `validate.sh` (line 92) accepts min 1 char
> (length check is `${#name} -lt 1`). The new `validate_runner_target_name()`
> should either reuse `validate_runner_name()` as-is (accepting the inconsistency)
> or fix the min-length check in the existing function. Recommend fixing to min 2
> as documented.
<!-- /deepen-plan -->

  - `validate_runner_target_name()` — reuse existing `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
  - `validate_runner_type()` — enum: `pool`, `static-family`, `static-host`
  - `validate_runner_mode()` — enum: `jit_ephemeral`, `persistent`
  - `validate_selector_label()` — `^[a-zA-Z0-9][a-zA-Z0-9._:-]*$`
  - `validate_runner_targets_file()` — checks schema version, required fields,
    array sizes, string lengths, total file size (<32KB)

### Phase 2: Setup Command

- [ ] 2.1: Create `plugins/yellow-ci/commands/ci/setup-runner-targets.md`
  - New command: `/ci:setup-runner-targets`
  - `allowed-tools`: Bash, Read, Write, AskUserQuestion
  - `model: sonnet`

  **Step 1: Check Prerequisites**
  - Verify `gh` auth (for API-seeded template path)
  - Check if global config exists at `~/.config/yellow-ci/runner-targets.yaml`
  - Check if local config exists at `.claude/yellow-ci-runner-targets.yaml`
  - If either exists: display current state, ask "Reconfigure?"

  **Step 2: Choose Target**
  - Ask: "Where should the runner targets config be saved?"
    - **Global** (`~/.config/yellow-ci/`) — applies to all repos (recommended
      for org-wide pools)
    - **This repo only** (`.claude/yellow-ci-runner-targets.yaml`) — overrides
      for this specific repo
  - Create target directory if needed (`mkdir -p`)

  **Step 3: Choose Input Path**
  - Ask: "How would you like to configure runner targets?"
    - **Interactive wizard** — walk through each pool/target one at a time
    - **Import from YAML** — paste or provide a file path
    - **Discover from GitHub API** — query API for registered runners, generate
      a template, then fill in semantic fields

  **Step 3a: Interactive Wizard Path**
  - For each runner target (loop until "done"):
    - Name (validate DNS-safe)
    - Type: pool / static-family / static-host
    - Mode: jit_ephemeral / persistent
    - Preferred selector labels (comma-separated, validate each)
    - Best for (comma-separated, free text)
    - Avoid for (comma-separated, free text)
    - Notes (comma-separated, free text)
  - After all targets: collect routing rules (one per line, free text)
  - Show summary, confirm before writing

  **Step 3b: Import Path**
  - Ask: "Paste your YAML config below, or provide a file path:"
  - If file path: read and validate
  - If pasted YAML: validate schema, field constraints
  - On validation failure: report specific errors, re-prompt
  - On success: show parsed summary, confirm before writing

  **Step 3c: API-Seeded Template Path**
  - Fetch runners via `gh api repos/{owner}/{repo}/actions/runners` and
    `gh api orgs/{owner}/actions/runners` (graceful fallback on org failure)
  - Generate template with discovered runners pre-populated (name, labels)
  - **Explicit prompt for invisible runners:** "Do you have additional runner
    pools not visible in the API (e.g., JIT ephemeral pools like ares/atlas)?
    Add them now."
  - For each runner (discovered + manually added): ask user to fill in `type`,
    `mode`, `best_for`, `avoid_for`, `notes`
  - Collect routing rules
  - Show summary, confirm before writing

  **Step 4: Write Config**
  - Write the YAML file to the chosen target location
  - Format:
    ```yaml
    # Runner targets configuration for yellow-ci
    # Generated by /ci:setup-runner-targets on {ISO-8601-UTC}
    # Edit directly or re-run /ci:setup-runner-targets to reconfigure.
    schema: 1
    runner_targets:
      - name: ares
        type: pool
        mode: jit_ephemeral
        preferred_selector:
          - self-hosted
          - pool:ares
          - tier:cpu
          - size:m
        best_for:
          - heavy CI
          - Terraform plan/validate/test
        avoid_for:
          - tiny status or hygiene jobs
        notes:
          - default heavy autoscaling pool
    routing_rules:
      - prefer pool:ares for heavy CI
      - prefer pool:atlas for lightweight checks
    ```
  - Run `resolve_runner_targets()` to generate the cached routing summary and
    merged JSON

  **Step 5: Validate and Report**
  - Read back the written file, verify runner count and names match
  - Run `resolve_runner_targets()` to verify merge logic works
  - Display summary:
    ```
    Runner Targets Configuration
    ============================
    Location: ~/.config/yellow-ci/runner-targets.yaml (global)
    Runners:  3 target(s): ares, atlas, gh-vm-static-family
    Rules:    6 routing rule(s)
    Cache:    routing-summary.txt written

    Overall: PASS
    ```
  - Ask next steps: `/ci:setup-self-hosted` (optimize runs-on assignments),
    `/ci:lint-workflows` (check workflows), `Done`

- [ ] 2.2: Register command in `plugins/yellow-ci/.claude-plugin/plugin.json`
  - No plugin.json changes needed — commands are auto-discovered from
    `commands/` directory

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: `plugin.json` has no `"commands"` key. Commands in
> `commands/*.md` are auto-discovered by Claude Code's plugin system. Same
> pattern across all plugins (yellow-review, yellow-chatprd, etc.). Only hooks
> require explicit `plugin.json` registration. No manifest changes needed.
<!-- /deepen-plan -->

- [ ] 2.3: Update `/ci:setup` (Step 7 report) to offer `/ci:setup-runner-targets`
  as a next-step option alongside `/ci:setup-self-hosted`

- [ ] 2.4: Update `/ci:setup-self-hosted` to check for runner targets config
  - At the start of Step 4 (before spawning runner-assignment agent): if
    runner targets config exists, include the merged config in the fenced
    inventory context passed to the agent
  - This is additive — if no config exists, behavior is unchanged

### Phase 3: Session-Start Hook Enhancement

> **Note:** This phase is already implemented in `plugins/yellow-ci/hooks/scripts/session-start.sh` (routing_cache block, lines ~37-43).

- [ ] 3.1: Update `plugins/yellow-ci/hooks/scripts/session-start.sh`
  - After the early-exit checks (lines 31-44) and before the cache check
    (line 46), add a routing summary read:
    ```bash
    # --- Runner targets context (fast path: read pre-rendered summary) ---
    routing_summary=""
    routing_cache="${HOME}/.cache/yellow-ci/routing-summary.txt"
    if [ -f "$routing_cache" ]; then
      routing_summary=$(head -c 500 "$routing_cache" 2>/dev/null) || routing_summary=""
    fi
    ```
  - Budget impact: single `head -c 500` on a local file = <1ms. No YAML
    parsing. No `yq` dependency.

<!-- deepen-plan: codebase -->
> **Codebase:** Line numbers verified against actual `session-start.sh`: lines
> 30-44 are early exits (`.github/workflows` check, `gh` check, `gh auth`
> check), line 46 begins cache section. Line 106+ is output generation. The
> existing hook uses `json_exit()` (lines 18-28) which takes a single string
> argument and wraps it in `{"systemMessage": $msg, "continue": true}` via `jq`.
> Concatenating routing summary + failure message into one string before passing
> to `json_exit()` is the correct approach — the function already handles this.
> **Enhancement:** Consider adding mtime-based staleness detection — if config
> files are newer than `routing-summary.txt`, the cached summary may be stale.
> Use `stat -c '%Y'` (GNU/Linux/WSL) to compare. Skip this check on macOS
> (`stat -f '%m'` syntax differs) or accept stale cache until next setup run.
<!-- /deepen-plan -->

  - In the output generation section (line 106+), concatenate routing summary
    with failure info:
    ```bash
    output=""
    # Routing rules (always present if configured)
    if [ -n "$routing_summary" ]; then
      output="$routing_summary"
    fi
    # CI failures (conditional)
    if [ "$failure_count" -gt 0 ] 2>/dev/null; then
      # ... existing failure message logic ...
      if [ -n "$output" ]; then
        output="${output}\n${failure_msg}"
      else
        output="$failure_msg"
      fi
    fi
    ```
  - Update budget comment at line 4:
    ```
    # Budget: 3s total (routing cache 1ms, filesystem 1ms, cache check 5ms,
    #   gh API 2s, parse 50ms, buffer 500ms)
    ```

### Phase 4: Runner-Assignment Agent Enhancement

- [ ] 4.1: Update `plugins/yellow-ci/agents/ci/runner-assignment.md`
  - Add new Step 2b after "Parse Runner Inventory" (Step 2):

    **Step 2b: Load Runner Targets Config (Optional)**

    Check if a merged runner targets JSON exists in the fenced inventory context
    (provided by `/ci:setup-self-hosted` when runner targets config is present).
    If present, parse `runner_targets` array and `routing_rules`.

    For each runner target in the config, store:
    - `preferred_selector` — the recommended `runs-on` label array
    - `best_for` / `avoid_for` — semantic routing hints
    - `type` / `mode` — pool type and ephemeral/persistent classification

    If runner targets config is not present: skip this step. All subsequent
    scoring changes are gated behind config existence (no behavior change for
    users without config).

  - Modify Step 5 scoring algorithm to add semantic scoring:

    After label eligibility (Step 5.2) and before load tiebreaker (Step 5.3),
    insert:

    **Step 5.2b: Semantic Score (when runner targets config present)**

    For each eligible runner, check if it matches a `runner_targets` entry by
    name. If matched:

    1. **Infer job characteristics** from step contents (already done in Step 4):
       keywords like "terraform", "docker", "security", "lint", "test",
       "deploy", "docs"
    2. **best_for bonus**: for each `best_for` string, if any inferred keyword
       appears as a case-insensitive substring: +15 to score. Multiple matches
       stack (cap at +45).
    3. **avoid_for penalty**: for each `avoid_for` string, if any inferred
       keyword appears as a case-insensitive substring: -25 to score. Multiple
       penalties stack (cap at -50).
    4. **Effective score**: `load_score + best_for_bonus + avoid_for_penalty`,
       clamped 0–100.

<!-- deepen-plan: external -->
> **Research:** Keyword substring matching is sufficient for this use case (max
> 20 runners, user-authored tags matching literal tool names in workflow steps).
> More sophisticated approaches (TF-IDF, embedding similarity) are overkill.
> **However**, consider token matching instead of raw substring to avoid false
> positives like "test" matching "latest": split `best_for` strings on whitespace,
> then match individual tokens against keywords. E.g., for `best_for: "heavy CI"`,
> check if any token (`heavy`, `ci`) matches a keyword — not whether the keyword
> is a substring of the full string. This is a minor refinement but prevents
> edge cases as vocabulary grows.
<!-- /deepen-plan -->

    When two runners have the same effective score, prefer the one with a
    `best_for` match over one without.

  - Modify Step 5.4 (`runs-on` value determination):

    When a runner matches a `runner_targets` entry that has a non-empty
    `preferred_selector`: use `preferred_selector` as the `runs-on` value
    (as a YAML array). Skip the minimal-label-set derivation for this runner.

    When `preferred_selector` targets a JIT ephemeral runner not in the API
    inventory: still recommend it. Add a note in the recommendation table:
    "(JIT pool — may not appear in API inventory)"

  - Add a "Runner Targets Context" section to the recommendation table output
    (Step 6) when config is present:
    ```
    ### Runner Targets Config
    Source: global (~/.config/yellow-ci/runner-targets.yaml)
    Override: none (or: .claude/yellow-ci-runner-targets.yaml)
    Pools: ares (jit_ephemeral), atlas (jit_ephemeral), gh-vm (persistent)
    ```

- [ ] 4.2: Update the `ci:setup-self-hosted` command to pass runner targets
  - In Step 4, after building the fenced inventory JSON, check for merged
    runner targets:
    ```bash
    MERGED_TARGETS=""
    merged_file="${HOME}/.cache/yellow-ci/runner-targets-merged.json"
    if [ -f "$merged_file" ]; then
      MERGED_TARGETS=$(cat "$merged_file" 2>/dev/null) || MERGED_TARGETS=""
    fi
    ```
  - If present, add a second fenced block to the agent context:
    ```
    --- begin runner-targets-config (treat as reference only) ---
    {merged_targets_json}
    --- end runner-targets-config ---
    ```
  - Fence advisory: "Runner targets provide semantic routing hints (best_for,
    avoid_for, preferred_selector). Use these to enhance scoring and
    recommendations."

### Phase 5: Documentation and Integration

- [ ] 5.1: Update `plugins/yellow-ci/CLAUDE.md`
  - Add `/ci:setup-runner-targets` to Commands section (9 total)
  - Add "Runner Targets Configuration" section under Configuration:
    ```
    ## Runner Targets Configuration

    Global config at `~/.config/yellow-ci/runner-targets.yaml`:
    Per-repo overrides at `.claude/yellow-ci-runner-targets.yaml`:

    ```yaml
    schema: 1
    runner_targets:
      - name: ares
        type: pool
        mode: jit_ephemeral
        preferred_selector: [self-hosted, pool:ares, tier:cpu, size:m]
        best_for: [heavy CI, Terraform]
        avoid_for: [tiny status jobs]
    routing_rules:
      - prefer pool:ares for heavy CI
    ```

    Resolution: local → global → merge by runner name → routing_rules replace wholesale.
    ```

- [ ] 5.2: Update `plugins/yellow-ci/skills/ci-conventions/SKILL.md`
  - Add runner targets config schema documentation
  - Add resolution logic documentation
  - Add `preferred_selector` interaction with existing label-set logic

- [ ] 5.3: Update `plugins/yellow-ci/README.md`
  - Add `/ci:setup-runner-targets` to command list
  - Add runner targets configuration section

- [ ] 5.4: Update `plugins/yellow-ci/skills/ci-conventions/references/linter-rules.md`
  - Add note to W06 and W07 that runner targets config can enhance these rules
    (actual implementation deferred to follow-up)

### Phase 6: Quality

- [ ] 6.1: Manual testing checklist
  - Run `/ci:setup-runner-targets` with interactive wizard (create global config)
  - Run `/ci:setup-runner-targets` with import path (paste YAML block)
  - Run `/ci:setup-runner-targets` with API-seeded template
  - Verify routing summary appears in session start (`systemMessage`)
  - Run `/ci:setup-self-hosted` — verify runner targets context is passed to
    runner-assignment agent
  - Test per-repo override: create `.claude/yellow-ci-runner-targets.yaml` with
    one overridden runner, verify merge
  - Test graceful degradation: delete config files, verify no errors
  - Test validation: provide invalid YAML, invalid runner names, oversized
    file

- [ ] 6.2: Changeset
  - Run `pnpm changeset` — minor bump for yellow-ci (new command)

## Technical Specifications

### Files to Modify

| File | Changes |
|---|---|
| `plugins/yellow-ci/hooks/scripts/session-start.sh` | Add routing summary read + concatenated systemMessage |
| `plugins/yellow-ci/hooks/scripts/lib/validate.sh` | Add runner target validation functions |
| `plugins/yellow-ci/agents/ci/runner-assignment.md` | Add Step 2b (load targets), modify Step 5 (semantic scoring), modify Step 6 (output) |
| `plugins/yellow-ci/commands/ci/setup.md` | Add `/ci:setup-runner-targets` to Step 7 next-steps |
| `plugins/yellow-ci/commands/ci/setup-self-hosted.md` | Add runner targets passthrough in Step 4 |
| `plugins/yellow-ci/CLAUDE.md` | Add command + config documentation |
| `plugins/yellow-ci/README.md` | Add command + config documentation |
| `plugins/yellow-ci/skills/ci-conventions/SKILL.md` | Add runner targets schema docs |
| `plugins/yellow-ci/skills/ci-conventions/references/linter-rules.md` | Add deferred note to W06/W07 |

### Files to Create

| File | Purpose |
|---|---|
| `plugins/yellow-ci/commands/ci/setup-runner-targets.md` | New setup command (3 input paths) |
| `plugins/yellow-ci/hooks/scripts/lib/resolve-runner-targets.sh` | Config resolution + merge + cache generation |
| `plugins/yellow-ci/schemas/runner-targets.schema.json` | JSON Schema for validation |

### Dependencies

No new runtime dependencies. YAML parsing uses `grep`/`awk`/`sed` (already
available). Pre-rendered cache avoids `yq` dependency in the hook.

### Config Schema

```yaml
schema: 1                          # integer, required
runner_targets:                    # array, max 20 items
  - name: string                   # required, ^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$
    type: enum                     # required: pool | static-family | static-host
    mode: enum                     # required: jit_ephemeral | persistent
    preferred_selector: [string]   # required, max 10, label regex
    best_for: [string]             # optional, max 10, max 200 chars each
    avoid_for: [string]            # optional, max 10, max 200 chars each
    notes: [string]                # optional, max 10, max 200 chars each
routing_rules: [string]            # optional, max 20, max 200 chars each
```

### Scoring Algorithm

```
For each eligible runner with runner targets config match:

  keywords = infer_from_job_steps(steps)  # e.g., ["terraform", "docker"]

  best_for_bonus = 0
  for bf in runner_target.best_for:
    if any keyword is substring of bf (case-insensitive):
      best_for_bonus += 15
  best_for_bonus = min(best_for_bonus, 45)

  avoid_for_penalty = 0
  for af in runner_target.avoid_for:
    if any keyword is substring of af (case-insensitive):
      avoid_for_penalty -= 25
  avoid_for_penalty = max(avoid_for_penalty, -50)

  effective_score = clamp(load_score + best_for_bonus + avoid_for_penalty, 0, 100)

Sort: effective_score desc, then best_for_match > no_match as tiebreak
```

### Resolution Logic

```
global = read(${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/runner-targets.yaml)
local  = read(.claude/yellow-ci-runner-targets.yaml)

if neither exists: return empty (graceful degradation)
if only one exists: use it

merge:
  runner_targets = union by name (local runner replaces global runner entirely)
  routing_rules  = local.routing_rules if present, else global.routing_rules

write cache:
  ~/.cache/yellow-ci/routing-summary.txt   (compact text for hook systemMessage)
  ~/.cache/yellow-ci/runner-targets-merged.json  (full merged config for agents)
```

## Acceptance Criteria

1. `/ci:setup-runner-targets` creates a valid runner targets YAML file at the
   chosen location (global or per-repo)
2. All three input paths work: interactive wizard, import/paste, API-seeded
   template
3. Session-start hook emits routing summary in `systemMessage` when config exists
4. Session-start hook continues to emit CI failure info alongside routing summary
5. Runner-assignment agent uses `best_for`/`avoid_for` for scoring when config
   is present
6. Runner-assignment agent uses `preferred_selector` for `runs-on` recommendations
7. Graceful degradation: no config = no errors, no behavior change
8. Global + local merge works correctly (local runner wins, routing_rules replace)
9. Config validation catches invalid runner names, types, modes, and oversized
   files
10. Hook budget remains under 3s (routing cache read adds <1ms)

## Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| No global, no local config | Graceful degradation — all commands work as today |
| Global only | Use global as-is |
| Local only (no global) | Use local as-is — stands alone |
| Both exist, no name overlap | Union of all runners |
| Both exist, name overlap | Local definition wins entirely for that name |
| Local has only `routing_rules` | Inherit `runner_targets` from global |
| Local has only `runner_targets` | Inherit `routing_rules` from global |
| Config file corrupt / invalid YAML | Hook skips with warning to stderr; commands report validation error |
| Config file >32KB | Setup rejects; hook skips with warning |
| `preferred_selector` targets JIT runner not in API | Still recommend; note "(JIT pool)" in table |
| Job matches `best_for` AND `avoid_for` of same runner | Both apply; penalties are stronger (-25 vs +15) |
| Job matches `best_for` of two runners | Both get bonus; load tiebreaker decides |
| Empty `preferred_selector` array | Use minimal-label-set derivation (existing behavior) |
| Schema version higher than supported | Hook skips with warning; setup prompts to update plugin |
| Concurrent setup writes to global config | Atomic write via tmp + mv pattern |
| `~/.config` does not exist | `mkdir -p` creates it |
| File permissions | Global config written with default umask (typically 644) |

<!-- deepen-plan: external -->
> **Research:** XDG best practices: `mkdir -p` is idempotent and safe. Do NOT
> `chmod 700` the `~/.config/yellow-ci/` directory — that breaks tools like `gh`,
> `docker`, and `kubectl` that share `~/.config/` and expect standard permissions
> (755 for dirs, 644 for files). Only tighten if the file contains secrets
> (runner targets does not). Use atomic writes: `tmp_file="${config_dir}/runner-targets.yaml.tmp.$$"`,
> write to tmp, then `mv`. The existing `session-start.sh` already uses this
> pattern (lines 122-124).
<!-- /deepen-plan -->

## Security Considerations

- Runner target names validated against DNS-safe regex (no injection)
- `preferred_selector` labels validated against safe character regex
- `routing_rules` surfaced in `systemMessage` are user-authored text — fenced
  with `--- begin/end ---` pattern when passed to agents
- `best_for`/`avoid_for`/`notes` are free-text but not executed — used only for
  keyword matching
- No secrets in runner targets config (unlike SSH `.local.md`)
- Global config at `~/.config/` readable by user only (standard umask)

## Migration & Rollback

- **No breaking changes** — all new behavior is gated behind config existence
- **Rollback:** Delete config files and cache. Everything reverts to current
  behavior.
- **Schema versioning:** `schema: 1` enables future migration. Additive changes
  (new optional fields) auto-migrate with defaults. Breaking changes require
  re-running `/ci:setup-runner-targets`.

## Future Work (Deferred)

- Linter rules W06/W07 updated with runner targets awareness
- Schema auto-migration for additive changes
- `async: true` hook option for non-blocking config loading
- Validation CLI (`pnpm validate:runner-targets`) for CI enforcement

## References

<!-- deepen-plan: external -->
> **Research:** Additional external references for implementation:
> - XDG Base Directory Specification: https://specifications.freedesktop.org/basedir-spec/latest/
> - ESLint flat config migration (why deep merge was abandoned): https://eslint.org/blog/2022/08/new-config-system-part-1/
> - Kubernetes node affinity (weighted preference scoring model, closest analog to best_for/avoid_for): https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity
> - Claude Code hooks reference (SessionStart, systemMessage, timeout): https://code.claude.com/docs/en/hooks
> - Known Claude Code issue: `hookSpecificOutput.additionalContext` may not work reliably for plugins (GH #16538) — prefer `systemMessage`
<!-- /deepen-plan -->

- Brainstorm: `docs/brainstorms/2026-03-13-ci-runner-targets-config-brainstorm.md`
- Session-start hook: `plugins/yellow-ci/hooks/scripts/session-start.sh`
- Runner-assignment agent: `plugins/yellow-ci/agents/ci/runner-assignment.md`
- Setup command: `plugins/yellow-ci/commands/ci/setup.md`
- Setup-self-hosted: `plugins/yellow-ci/commands/ci/setup-self-hosted.md`
- Validate library: `plugins/yellow-ci/hooks/scripts/lib/validate.sh`
- Linter rules: `plugins/yellow-ci/skills/ci-conventions/references/linter-rules.md`
- CI conventions: `plugins/yellow-ci/skills/ci-conventions/SKILL.md`
- Plugin manifest: `plugins/yellow-ci/.claude-plugin/plugin.json`
- XDG Base Directory Spec: https://specifications.freedesktop.org/basedir-spec/latest/
- Plugin settings pattern: `plugins/yellow-core/skills/create-agent-skills/SKILL.md`
- Hook error handling: `docs/solutions/code-quality/hook-set-e-and-json-exit-pattern.md`
