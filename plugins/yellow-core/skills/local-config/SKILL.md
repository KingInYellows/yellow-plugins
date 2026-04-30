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

### Schema

```yaml
---
# review:pr / review:all behavior overrides (Wave 2 keys)
review_pipeline: persona | legacy        # default: persona (Wave 2 default)
review_depth: small | medium | large     # default: auto-detect from diff size
focus_areas: [security, correctness, ...]  # default: all areas
reviewer_set:
  include: [<agent-name>, ...]            # additional agents to spawn beyond defaults
  exclude: [<agent-name>, ...]            # agents to skip

# Wave 3 keys (documented; consumer adoption tracked per-key below)
stack: [ts, py, rust, go]                 # default: auto-detect from repo
agent_native_focus: true | false          # default: false
confidence_threshold: 0..100              # default: 75
---
```

**Consumer adoption status (Wave 3 keys):** the keys are valid frontmatter
today and parsers do not warn on them, but the commands that act on them
land in separate Wave 3 PRs:

| Key                    | Acted on by                        | Status |
|------------------------|------------------------------------|--------|
| `stack`                | `polyglot-reviewer`, `review:pr` Step 4 dispatch | Pending W3 polyglot scoping. Until then: documented but ignored. |
| `agent_native_focus`   | `review:pr` Step 4 dispatch (forces W3.5 reviewers) | Pending W3.5 (`agent-native-reviewers` branch). Until then: documented but ignored. |
| `confidence_threshold` | `review:pr` aggregation gate, `audit-synthesizer` | Pending W3.13b (`yellow-debt-confidence-calibration` branch). Until then: documented but ignored. |

Authors may set Wave 3 keys today without breaking Wave 2 consumers — the
graceful-degradation rule (unknown keys emit a warning but do not abort)
means the file remains valid forward-and-backward.

### Field reference

| Field | Type | Default | Effect |
|-------|------|---------|--------|
| `review_pipeline` | `persona` \| `legacy` | `persona` | `legacy` falls back to pre-Wave-2 adaptive selection (no learnings pre-pass, no confidence rubric, no new personas). Use as escape hatch only. |
| `review_depth` | `small` \| `medium` \| `large` | auto | Forces a depth tier regardless of computed diff size. `large` always invokes `adversarial-reviewer`; `small` skips it even on large diffs. |
| `focus_areas` | array of strings | empty (= all) | Narrows reviewer set to those whose `category` matches one of the listed areas. Recognized areas: `security`, `correctness`, `reliability`, `performance`, `maintainability`, `project-compliance`, `project-standards`, `architecture`, `testing`, `documentation`, `types`, `adversarial`. Always-on personas (`project-compliance-reviewer`, `correctness-reviewer`, `maintainability-reviewer`, `project-standards-reviewer`) survive the filter regardless of `focus_areas` — filtering them out would defeat the always-on contract. |
| `reviewer_set.include` | array of agent names | empty | Additive — agents are spawned even if their conditional triggers don't fire. |
| `reviewer_set.exclude` | array of agent names | empty | Subtractive — agents are skipped even if always-on or their triggers fire. Applied after `include`. |
| `stack` | array of `ts` \| `py` \| `rust` \| `go` | auto-detect | Forces language-specific reviewer behavior. When set, `polyglot-reviewer` (when triggered) scopes to listed languages and skips non-matching files. Auto-detect uses repo root signals: `package.json` → `ts`, `pyproject.toml`/`requirements.txt` → `py`, `Cargo.toml` → `rust`, `go.mod` → `go`. Multi-stack repos may set this explicitly to scope review to a subset. Acted on by W3-pending consumers (see status table). |
| `agent_native_focus` | boolean | `false` | When `true`, always invokes the W3.5 agent-native reviewer triplet (`cli-readiness-reviewer`, `agent-cli-readiness-reviewer`, `agent-native-reviewer`) regardless of whether the diff touches `plugins/*/agents/`, `plugins/*/skills/`, or `plugins/*/commands/`. Useful for repos that author Claude Code plugins but house plugin code outside the standard `plugins/` layout. Acted on by W3.5 (pending). |
| `confidence_threshold` | integer 0–100 | `75` | Override the Wave 2 confidence aggregation gate used by `review:pr` and `audit-synthesizer`. Values below `75` surface more findings (more false positives, fewer missed issues); values above `75` suppress more (fewer false positives, more missed issues). Set above `100` to suppress all findings (effectively a dry-run). Acted on by W3.13b (pending). |

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
if focus_areas:
  # Always-on personas survive the filter regardless of focus_areas; filtering
  # them would defeat the always-on contract documented in
  # plugins/yellow-review/commands/review/review-pr.md Step 4.
  always_on = {project-compliance-reviewer, correctness-reviewer,
               maintainability-reviewer, project-standards-reviewer}
  reviewer_set = always_on ∪ filter_by_category(reviewer_set \ always_on, focus_areas)
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
- `stack` entries other than `ts` / `py` / `rust` / `go` → drop the
  unknown entry, emit a warning naming it. An empty array after dropping
  unknowns falls back to auto-detection.
- `agent_native_focus` non-boolean values → fall back to `false` and
  emit a warning. Common mistake: quoting the value (`"true"`) — YAML
  parses that as a string, not a boolean.
- `confidence_threshold` outside `0..100` → clamp to the range and emit
  a warning. Non-integer values fall back to the default (`75`).

### Example: TypeScript-focused plugin repo with strict gating

```yaml
---
review_pipeline: persona
review_depth: large
focus_areas: [security, correctness, project-compliance]
stack: [ts]
agent_native_focus: true
confidence_threshold: 60
---
```

Effect, once Wave 3 consumers land: `polyglot-reviewer` scopes to
TypeScript only, the W3.5 agent-native reviewer triplet is always
invoked, and the confidence gate fires earlier (60 vs. default 75) so
borderline findings surface for human review.

## Migration

Projects that previously relied on hard-coded defaults need no migration —
the absence of `yellow-plugins.local.md` keeps existing behavior. The
file is opt-in.

## Related

- `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/confidence-rubric.md` — the
  confidence rubric that the persona pipeline uses for aggregation.
- `plugins/yellow-review/commands/review/review-pr.md` — primary consumer
  of the config keys defined here.
- `plugins/yellow-review/commands/review/review-all.md` — secondary
  consumer; its inline pipeline references the same overrides.
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — selection
  rules and severity definitions.
