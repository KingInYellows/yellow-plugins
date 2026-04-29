---
name: local-config
description: "Defines the yellow-plugins.local.md per-project config file schema. Use when authoring commands that should accept per-project overrides for review pipeline behavior, reviewer set narrowing, depth controls, or focus-area filtering."
user-invokable: false
---

# yellow-plugins.local.md — per-project configuration

`yellow-plugins.local.md` is an **optional** per-project config file that
lets a project override defaults for yellow-plugins commands. Place it at
the repo root (next to `CLAUDE.md`). The file uses YAML frontmatter for
structured settings and an optional markdown body for human-readable
notes.

## What It Does

- Provides a single, discoverable location for per-project overrides to
  yellow-plugins command behavior.
- Doubles as the **rollback escape hatch** for the Wave 2 review-pipeline
  rewrite — projects experiencing high false-positive review noise can
  set `review_pipeline: legacy` and the pre-Wave-2 adaptive selection is
  used instead.
- Supports optional `reviewer_set.{include,exclude}` for narrowing or
  expanding the persona dispatch table without forking commands.

## When to Use

- A project wants to skip specific reviewer personas
  (`reviewer_set.exclude: [adversarial-reviewer]`)
- A project wants to force the legacy pipeline during the Wave 2
  dogfooding period (`review_pipeline: legacy`)
- A project wants to narrow review focus to specific areas
  (`focus_areas: [security, correctness]`)
- A project wants a custom `review_depth` regardless of diff size
  (`review_depth: large` to always invoke `adversarial-reviewer`)

When the file is **absent**, all commands use their built-in defaults.
The file is purely additive — no command behavior depends on its
existence.

## Usage

### File location and shape

```
<repo-root>/yellow-plugins.local.md
```

Frontmatter-only is the typical shape; a markdown body is optional and
used only by humans (commands ignore the body).

### Schema (Wave 2 minimum)

```yaml
---
# review:pr / review:all behavior overrides
review_pipeline: persona | legacy        # default: persona (Wave 2 default)
review_depth: small | medium | large     # default: auto-detect from diff size
focus_areas: [security, correctness, ...]  # default: all areas
reviewer_set:
  include: [<agent-name>, ...]            # additional agents to spawn beyond defaults
  exclude: [<agent-name>, ...]            # agents to skip
---
```

### Field reference

| Field | Type | Default | Effect |
|-------|------|---------|--------|
| `review_pipeline` | `persona` \| `legacy` | `persona` | `legacy` falls back to pre-Wave-2 adaptive selection (no learnings pre-pass, no confidence rubric, no new personas). Use as escape hatch only. |
| `review_depth` | `small` \| `medium` \| `large` | auto | Forces a depth tier regardless of computed diff size. `large` always invokes `adversarial-reviewer`; `small` skips it even on large diffs. |
| `focus_areas` | array of strings | empty (= all) | Narrows reviewer set to those whose `category` matches one of the listed areas. Recognized areas: `security`, `correctness`, `reliability`, `performance`, `maintainability`, `project-compliance`, `project-standards`, `architecture`, `testing`, `documentation`, `types`. |
| `reviewer_set.include` | array of agent names | empty | Additive — agents are spawned even if their conditional triggers don't fire. |
| `reviewer_set.exclude` | array of agent names | empty | Subtractive — agents are skipped even if always-on or their triggers fire. Applied after `include`. |

### Example: tighten review for a security-critical project

```yaml
---
review_pipeline: persona
review_depth: large
focus_areas: [security, correctness, reliability]
reviewer_set:
  include: [security-reviewer, adversarial-reviewer]
  exclude: [comment-analyzer, type-design-analyzer]
---
```

### Example: rollback escape hatch during Wave 2 dogfooding

```yaml
---
review_pipeline: legacy
---

# Notes for humans (commands ignore this body)

We hit unexpected false-positive noise from `correctness-reviewer` on
2026-04-29; reverting to legacy pipeline until upstream lands a fix.
Re-enable persona pipeline by removing `review_pipeline: legacy` (or
flipping it to `persona`).
```

### Reading the config from a command

Commands that honor this config (today: `review:pr`, `review:all`) read
the file from the project root and merge values with their built-in
defaults. The merge precedence is:

1. Command argument overrides (e.g., explicit flags) — highest
2. `yellow-plugins.local.md` frontmatter
3. Command built-in defaults — lowest

Pseudo-code:

```text
config = load_yaml_frontmatter("yellow-plugins.local.md")
review_pipeline = config.review_pipeline ?? "persona"
review_depth = command_arg.depth ?? config.review_depth ?? auto_detect()
focus_areas = config.focus_areas ?? []  # empty = no filter
include = config.reviewer_set.include ?? []
exclude = config.reviewer_set.exclude ?? []

# After computing the default reviewer set per Step 4 of review-pr.md:
reviewer_set = (defaults ∪ include) \ exclude
if focus_areas: reviewer_set = filter_by_category(reviewer_set, focus_areas)
if review_pipeline == "legacy":
  use_legacy_dispatch(reviewer_set)
else:
  use_persona_dispatch(reviewer_set)
```

### Validation

- Unknown top-level keys → emit a warning to stderr but do not abort.
  Forward-compatibility matters more than strictness for an optional
  config.
- Unknown reviewer names in `reviewer_set.include` → emit a warning naming
  the unrecognized name. The graceful-degradation guard in `review:pr`
  Step 4 handles missing agents at dispatch time anyway.
- Mutually exclusive entries (same name in both `include` and `exclude`)
  → `exclude` wins; emit a warning naming the conflicting agent.
- `review_pipeline` values other than `persona` / `legacy` → fall back to
  `persona` and emit a warning.

### Wave 3 expansion (preview)

The Wave 3 plan adds these keys (deferred until Wave 3 lands):

| Field | Type | Default | Effect |
|-------|------|---------|--------|
| `stack` | array of strings | auto-detect | Force language-specific reviewer behavior, e.g., `[ts, py]`. |
| `agent_native_focus` | boolean | `false` | When `true`, always invoke the agent-native reviewers from W3.5 regardless of triggers. |
| `confidence_threshold` | int | `75` | Override the Wave 2 confidence gate. Lower values surface more findings; raise above `100` to suppress everything. |

These are documented here for forward visibility; Wave 2 commands ignore
them.

## Migration

Projects that previously relied on hard-coded defaults need no migration —
the absence of `yellow-plugins.local.md` keeps existing behavior. The
file is opt-in.

## Related

- `RESEARCH/upstream-snapshots/<sha>/confidence-rubric.md` — the
  confidence rubric that the persona pipeline uses for aggregation.
- `plugins/yellow-review/commands/review/review-pr.md` — primary consumer
  of the config keys defined here.
- `plugins/yellow-review/commands/review/review-all.md` — secondary
  consumer; its inline pipeline references the same overrides.
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — selection
  rules and severity definitions.
