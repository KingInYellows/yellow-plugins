# Brainstorm: CI Runner Targets Configuration

**Date:** 2026-03-13
**Plugin:** yellow-ci
**Approach:** Layered Config with Hook Delivery (Approach A)

## What We're Building

A runner targets configuration system for yellow-ci that persists org-specific
runner pool definitions, routing rules, and semantic metadata (best-for,
avoid-for, JIT ephemeral behavior) so that Claude knows which self-hosted
runners are available and how to route jobs to them -- even when JIT ephemeral
runners are invisible to the GitHub API.

The system has three layers:

1. **Global config** at `~/.config/yellow-ci/runner-targets.yaml` -- defines
   org-wide runner pools, their selectors, capabilities, and routing rules.
   Written once, applies to all repos.

2. **Per-repo overrides** at `.claude/yellow-ci-runner-targets.yaml` -- optional
   file that overrides or extends specific runner definitions for a single repo.
   Merged with global config by runner `name` (local wins per-key).

3. **Session-start delivery** -- the existing session-start hook reads the
   resolved (merged) config and surfaces a compact routing rules summary as a
   `systemMessage`, so all CI agents and commands see runner context
   automatically without each needing to parse the config file.

### Config Schema

The runner targets file uses a structured YAML format:

```yaml
schema: 1
runner_targets:
  - name: ares
    type: pool              # pool | static-family | static-host
    mode: jit_ephemeral     # jit_ephemeral | persistent
    preferred_selector:
      - self-hosted
      - pool:ares
      - tier:cpu
      - size:m
    best_for:
      - heavy CI
      - Terraform plan/validate/test
      - security scans
    avoid_for:
      - tiny status or hygiene jobs when atlas is enough
    notes:
      - default heavy autoscaling pool
      - usually absent from GitHub org runner list while idle

routing_rules:
  - prefer pool:ares for heavy CI, infra, Docker, Terraform, deploy, security
  - prefer pool:atlas for lightweight repo automation and fast checks
  - prefer static gh-vm hosts only when host affinity or always-on capacity matters
  - never assume ares or atlas hosts will be visible in the org runner list while idle
  - do not use bare [self-hosted] alone for routing
  - do not mix static-family selectors with pool selectors in the same runs-on
```

### Setup Input Paths

The setup commands (`ci:setup` and `ci:setup-self-hosted`) offer three ways to
populate the config:

- **Interactive wizard** -- walks through defining each pool/target one at a
  time (name, type, mode, selectors, best-for, avoid-for, notes). Best for
  first-time setup or adding individual runners.

- **Import from file/paste** -- accepts a YAML block (pasted inline or read
  from a file path), validates the schema, and writes it. Best for users who
  already have their config ready (like the data provided in this brainstorm).

- **API-seeded template** -- queries the GitHub org/repo runner API to discover
  registered runners, generates a template file pre-populated with discovered
  names and labels, then asks the user to fill in the semantic fields
  (best-for, avoid-for, type, mode, notes) that cannot be inferred from the
  API. Best for initial discovery when the user doesn't have a pre-built config.

### Resolution Logic

When any CI command or agent needs runner target data, the resolution order is:

1. Check `.claude/yellow-ci-runner-targets.yaml` (per-repo local)
2. Check `~/.config/yellow-ci/runner-targets.yaml` (global)
3. Merge: iterate runner_targets by `name` -- if the same runner name appears
   in both files, the local definition wins entirely for that runner. Runners
   only in global are inherited. Runners only in local are added.
   `routing_rules` from local completely replace global if present (no
   per-rule merge -- rules are a coherent set).
4. If neither file exists: no runner targets available (graceful degradation,
   commands proceed without runner awareness).

### Active Scoring Integration

The runner-assignment agent's Step 5 scoring algorithm is updated to use
`best_for` and `avoid_for` fields:

- After OS and label filtering, apply a **semantic match bonus/penalty** based
  on job characteristics (inferred from step contents) matching `best_for`
  entries (+15 points) or `avoid_for` entries (-25 points).
- The `type` and `mode` fields inform the agent about runner availability
  expectations -- JIT ephemeral runners get a note in output that they may not
  appear in the API inventory but are still valid targets.
- The `preferred_selector` field provides the recommended `runs-on` label array
  for each pool, used directly in recommendations instead of inferring minimal
  label sets.

## Why This Approach

**The core problem is that JIT ephemeral runners are invisible.** The GitHub
API only shows runners that are currently registered and online. Pools like
ares and atlas spin up on demand and disappear when idle. Without persisted
configuration, every CI command starts from zero knowledge about what runners
exist, what they're good at, and how to route work to them.

**Global config eliminates repetitive setup.** Runner pools are org-level
infrastructure. Defining them once in `~/.config/yellow-ci/` means every repo
benefits immediately. Without this, you'd paste the same 80-line config block
into every new repo's `.claude/` directory.

**Hook delivery makes routing rules ambient.** By surfacing rules through
`systemMessage` on session start, every CI-related agent and command gets
runner context automatically. The workflow-optimizer sees "prefer pool:ares for
heavy CI" without needing explicit config parsing code. The failure-analyst
knows that a job queued on `pool:ares` might be waiting for JIT capacity, not
stuck. Future agents inherit this context for free.

**Separate file from SSH config respects different concerns.** The existing
`.claude/yellow-ci.local.md` holds SSH connection credentials (hosts, users,
keys) that change when infrastructure moves. Runner targets describe logical
routing policy that changes when you add or remove pools. These evolve
independently and mixing them creates maintenance friction.

**Per-repo overrides handle edge cases without duplication.** A machine-learning
repo might override `ares` to add GPU-specific best-for entries while inheriting
the standard `atlas` and `gh-vm` definitions from global. The merge-by-name
strategy means overrides are surgical, not wholesale.

## Key Decisions

1. **Separate file, not extended `.local.md`.** Runner targets are logical
   routing policy; SSH config is connection credentials. Different change
   cadences, different sensitivity levels, different audiences. Keeping them
   separate avoids a monolithic config that's hard to reason about.

2. **Global-to-local merge by runner name (per-key).** First plugin in the
   ecosystem to introduce this pattern. Merge is per-key by runner `name`:
   local wins per-key for that runner. If local defines `ares`, its entire
   definition replaces the global `ares`. `routing_rules` from local also
   merge per-key by runner name (local wins per-key), consistent with the
   top-level merge strategy.

3. **Session-start hook delivery for routing rules.** The hook reads the
   resolved config and emits a compact `systemMessage` with the routing rules
   and a one-line summary of available pools. Budget impact: under 50ms for
   file read + YAML extraction (well within the 3s budget alongside the
   existing failure check). The full runner target details are NOT in the
   systemMessage -- only the routing rules and pool names. Agents that need
   full details (runner-assignment, linter) read the config file directly.

4. **Three input paths for setup.** Interactive wizard for hands-on users,
   import for power users with existing configs, and API-seeded template for
   discovery. The setup command asks which path the user wants at the start.

5. **Active scoring in runner-assignment agent.** The `best_for`/`avoid_for`
   fields directly influence the scoring algorithm with bonus/penalty points.
   This makes the semantic metadata actionable rather than just documentation.
   The `preferred_selector` field replaces the current "infer minimal label
   set" logic with explicit, user-defined selector arrays.

6. **`routing_rules` stored in config, not hardcoded.** Rules like "prefer
   ares for heavy CI" are user-defined policy, not plugin logic. Storing them
   in the config means different orgs with different runner setups get
   different rules. The plugin provides the mechanism; the user provides the
   policy.

7. **Graceful degradation.** If no runner targets config exists, all commands
   and agents work exactly as they do today. The session-start hook emits no
   runner context. The runner-assignment agent falls back to label-only
   scoring. No breaking changes.

## Open Questions

1. **Schema versioning strategy.** The config uses `schema: 1`. When the
   schema evolves (e.g., adding GPU tier fields), should the plugin
   auto-migrate old configs, or require the user to re-run setup? Auto-migrate
   is friendlier but adds complexity.

2. **Validation depth for `best_for`/`avoid_for`.** These are free-text string
   arrays. Should the plugin validate them against a known vocabulary (e.g.,
   "Terraform", "Docker", "security scans") to improve scoring accuracy, or
   treat them as opaque strings matched via substring/keyword? Vocabulary
   validation is more precise but less flexible.

3. **Config file format: YAML vs YAML-frontmatter markdown.** The existing
   `.local.md` convention uses YAML frontmatter with markdown notes below.
   The new file could follow this convention (`.yaml` frontmatter + markdown
   notes) or be pure YAML. Pure YAML is simpler to parse programmatically;
   frontmatter+markdown follows the established plugin convention and allows
   human-readable notes alongside the structured data.

4. **Linter rule updates.** W06 (ubuntu-latest on self-hosted) and W07
   (missing self-hosted label) would benefit from runner targets awareness.
   Should these rules be updated as part of this work, or deferred to a
   follow-up? Updating them now provides immediate value but expands scope.

5. **Hook systemMessage size budget.** The routing rules summary needs to be
   compact enough to not bloat context but detailed enough to be useful. What
   is the right format -- full rules list, or a condensed 3-4 line summary
   with pool names and primary use cases?
