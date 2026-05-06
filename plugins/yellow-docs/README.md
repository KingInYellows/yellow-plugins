# yellow-docs

Documentation audit, generation, and Mermaid diagram creation for any
repository. Detects project structure and adapts analysis accordingly.

## Commands

| Command | Description |
|---------|-------------|
| `/docs:setup` | Validate prerequisites and detect project structure |
| `/docs:audit` | Scan repo for documentation gaps, staleness, and coverage |
| `/docs:generate` | AI-assisted documentation generation with human review |
| `/docs:diagram` | Context-aware Mermaid diagram generation |
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
| `diagram-architect` | Context-aware Mermaid diagram generation |

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
- **Mermaid diagrams**: Auto-selects diagram type (flowchart, sequence, class,
  state, ER, mindmap) based on code structure analysis
- **Doc refresh**: Detects stale docs by comparing git history, generates
  per-file update diffs for review
- **General-purpose**: Works in any git repo — TypeScript, Python, Rust, Go,
  and more
