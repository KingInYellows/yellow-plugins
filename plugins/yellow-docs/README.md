# yellow-docs

Documentation audit, generation, and evidence-backed technical diagrams for any
repository. Detects project structure and adapts analysis accordingly.

## Commands

| Command | Description |
|---------|-------------|
| `/docs:setup` | Validate prerequisites and detect project structure |
| `/docs:audit` | Scan repo for documentation gaps, staleness, and coverage |
| `/docs:generate` | AI-assisted documentation generation with human review |
| `/docs:diagram` | Evidence-backed technical diagrams |
| `/docs:refresh` | Update stale docs based on code changes |
| `/docs:review` | Multi-persona review of a planning document (PRD, brainstorm, spec, ADR) using 6 always-applicable personas plus 1 conditional adversarial reviewer |

## Agents

### Analysis (1)

| Agent | Description |
|-------|-------------|
| `doc-auditor` | Scans repos for doc gaps, staleness, and coverage; reports findings with P1/P2/P3 severity |

### Generation (2)

| Agent | Description |
|-------|-------------|
| `doc-generator` | AI-assisted content creation with human review gates |
| `diagram-architect` | Evidence-backed technical diagrams |

### Review (7)

Persona-based document review (read-only; report findings only). Adapted from
upstream compound-engineering v3.3.2 at locked SHA
`e5b397c9d1883354f03e338dd00f98be3da39f9f`.

| Agent | Description |
|-------|-------------|
| `coherence-reviewer` | Internal consistency, contradictions, terminology drift, broken cross-references |
| `design-lens-reviewer` | Information architecture, interaction states, user flows, accessibility, AI-slop check |
| `feasibility-reviewer` | Architecture reality, shadow path tracing, dependencies, performance, migration safety |
| `product-lens-reviewer` | Premise challenge, strategic consequences, alternatives, goal-requirement alignment |
| `scope-guardian-reviewer` | Right-sized for goals; complexity challenge; priority dependency analysis |
| `security-lens-reviewer` | Plan-level threat model: attack surface, auth/authz, data exposure, secrets |
| `adversarial-document-reviewer` | Conditional persona for high-stakes documents; premise challenging, assumption surfacing, decision stress-testing, simplification pressure, alternative blindness |

## Installation

```text
/plugin marketplace add KingInYellows/yellow-plugins
```

Then enable `yellow-docs` from the plugin list.

## Features

- **Doc audit**: Coverage analysis, staleness detection via git blame, gap
  identification with P1/P2/P3 severity
- **Doc generation**: Template-driven generation with human review gates for
  READMEs, API references, architecture overviews, and module docs
- **Technical diagrams**: Use `/docs:diagram architecture` for a Mermaid
  overview, or ask `technical-diagrams` to revise an existing draw.io file or
  selected collaborative board. Review the proposed edit before saving.
  Each view has one editable source. The skill preserves manual layout,
  checks the rendered result, and reports missing renderer or board access.
- **Doc refresh**: Detects stale docs by comparing git history, generates
  per-file update diffs for review
- **Document review (`/docs:review`)**: `coherence-reviewer` reports every
  finding with a confidence score, no longer pre-filters below 75, and
  caps at 40 findings (overflow dropped, not listed as suppressed); the
  other personas still suppress below anchor 50 in their own prompts. Step 6
  applies the sole gate (suppress `< 75` except `safe_auto` and P1 at 50+).
  Sub-75 coherence output is expected orchestrator input; the Suppressed
  Findings Summary lists 50–74 individually and rolls sub-50 counts per
  persona (only for findings the orchestrator actually received).
- **General-purpose**: Works in any git repo — TypeScript, Python, Rust, Go,
  and more

## Try a draw.io revision

Move and rename a node in the editor, note its position and label, and save.
Ask the skill to connect two other nodes. Review the change, then open the
same cloud file on a second device. Check that the moved node kept its label
and position and the new arrow points from the intended source to the intended
target. Use the board or file link to identify the shared original. [draw.io collaboration guide](https://www.drawio.com/docs/manual/collaboration/concurrent-editing/).

## Codex skills

Use `$yellow-docs:technical-diagrams` to create or revise a diagram and
`$yellow-docs:docs-audit` for a read-only documentation audit. See the
[Codex distribution](../../docs/codex-distribution.md) for installation and
the [installed audit evidence](../../docs/research/codex-phases-2-5-2026-10-06/report.md)
for the audit workflow.
