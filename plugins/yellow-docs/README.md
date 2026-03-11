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

## Installation

```
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
