---
name: docs-conventions
description: "Shared documentation conventions — templates, diagram type selection, staleness detection, severity classification. Use when agents need doc generation or audit context."
user-invokable: false
---

# Documentation Conventions

Shared patterns for yellow-docs agents and commands.

## Severity Classification

| Level | Meaning | Examples |
|-------|---------|---------|
| P1 | Missing critical docs | No README, undocumented public API, no architecture overview |
| P2 | Stale docs | Code changed but docs not updated, broken references |
| P3 | Structural improvements | Missing sections, no cross-links, inconsistent formatting |

## Health Score Formula

```text
score = max(0, 100 - (P1_count * 15 + P2_count * 5 + P3_count * 1))
```

Primary output is the findings list; the score is a secondary summary metric.

## Document Templates

### README Template

```markdown
# {Project Name}

{One-line description.}

## Installation

{Install instructions.}

## Usage

{Basic usage with code examples.}

## API

{Public API surface — functions, classes, endpoints.}

## Contributing

{How to contribute.}

## License

{License type.}
```

### Module Doc Template

```markdown
# {Module Name}

{Purpose — what this module does and why it exists.}

## Exports

{List of exported functions, classes, types.}

## Dependencies

{What this module depends on.}

## Usage

{How to use this module, with examples.}
```

### Architecture Doc Template

```markdown
# Architecture

{High-level description of the system.}

## Components

{Mermaid diagram of components.}

{Description of each component.}

## Data Flow

{How data moves through the system.}

## Key Decisions

{Architectural decisions and rationale.}
```

### API Reference Template

````markdown
# API Reference

## {Function/Endpoint Name}

{Description.}

**Parameters:**
- `{name}` ({type}) — {description}

**Returns:** {type} — {description}

**Example:**
```
{Usage example}
```
````

## Diagram Type Selection

Select the Mermaid diagram type based on what is being visualized:

| Scenario | Diagram Type | Mermaid Syntax |
|----------|-------------|----------------|
| Module dependencies / imports | Flowchart | `flowchart LR` |
| API call sequences / message exchange | Sequence | `sequenceDiagram` |
| Class / type hierarchies | Class | `classDiagram` |
| State machines / workflows | State | `stateDiagram-v2` |
| Database schemas / entity relationships | ER | `erDiagram` |
| System architecture (high-level) | Flowchart | `flowchart TB` + subgraphs |
| Directory / file layout | Mindmap | `mindmap` |
| Data flow / pipelines | Flowchart | `flowchart LR` |
| Git branching strategies | Gitgraph | `gitgraph` (if supported) |

### Layout Direction

- `LR` (left-to-right) for process flows, pipelines, data flow
- `TB` (top-to-bottom) for hierarchies, architectures, org charts
- Use subgraphs to group related nodes and reduce visual clutter

### Node Limits

- Target: 15–30 nodes for readability
- Hard limit: 50 for dense graphs (density > 0.3), 100 for sparse
- Density formula: `density = 2 * edges / (nodes * (nodes - 1))`
- Mindmap: max 11 level-2 nodes (Mermaid rendering limitation)
- Max Mermaid text: 50,000 characters
- Node labels: max 30 characters; abbreviate if needed

### Collapse Strategies (when exceeding limits)

1. **Folder-depth collapse**: Summarize at directory depth N using subgraphs
2. **Focus mode**: Show selected module + immediate neighbors only

### Styling

- `classDef` for semantic coloring: green=active, gray=deprecated, red=error
- Keep labels concise (3–5 words)
- Use `linkStyle` sparingly — only for critical paths
- Include `accTitle` and `accDescr` for accessibility

## Staleness Detection

### Algorithm

Composite signal with multiple factors:

1. **Age factor**: Compare last-modified date of doc vs. related source files
   using `git log --format='%aI' -1 -- <file>`
2. **Proximity mapping**: Docs in the same directory as source, or docs that
   reference source file names/function names
3. **Age threshold**: Flag docs not updated in 90 days (configurable)
4. **Broken references**: Function/class names in docs that no longer exist in
   source

## Project Structure Detection

Detect project type from manifest files (most specific wins):

| Signal | Project Type | Doc Strategy |
|--------|-------------|-------------|
| `.claude-plugin/plugin.json` | Claude Code plugin | CLAUDE.md, command/agent docs |
| `Cargo.toml` | Rust | README, crate docs, `#[deny(missing_docs)]` |
| `pyproject.toml` / `setup.py` | Python | README, docstring coverage |
| `go.mod` | Go | README, godoc conventions |
| `package.json` + `tsconfig.json` | TypeScript | README, TSDoc/JSDoc coverage |
| `package.json` (no tsconfig) | JavaScript | README, JSDoc coverage |

### Monorepo Detection

- `pnpm-workspace.yaml` → pnpm workspaces
- Root `package.json` with `workspaces` → npm/yarn workspaces
- `Cargo.toml` with `[workspace]` → Rust workspace
- `go.work` → Go workspace
- Multiple manifest files at different directory levels

## Staleness Report Schema

Each entry in the staleness JSON array returned by `doc-auditor` in refresh
mode:

```json
{
  "doc_path": "string — relative path from repo root",
  "source_files": ["string — relative paths of changed source files"],
  "last_doc_update": "string — ISO 8601 date from git log",
  "last_source_update": "string — ISO 8601 date from git log",
  "staleness_signal": "string — one of: age_exceeded, source_newer, broken_ref"
}
```

## Output Location Conventions

- API docs: alongside source files
- Architecture docs / diagrams: `docs/architecture.md`
- Dependency diagrams: `docs/dependencies.md`
- Directory structure diagrams: `docs/structure.md`
- READMEs: at project/module root
- Diagrams: inline in the doc they illustrate

All generated files include provenance comment. Resolve the values first with
`git rev-parse --short HEAD` and `date -u +%Y-%m-%dT%H:%M:%SZ` (fall back to
`unknown` and a local date if needed), then write:

```html
<!-- generated by yellow-docs at ${COMMIT_SHA} on ${DOC_DATE} -->
```

## Path Validation (canonical pattern)

All commands that accept a path argument must validate it with this pattern:

```bash
# Neutralize leading-dash paths
case "$TARGET" in -*) TARGET="./$TARGET" ;; esac
# Resolve to absolute
case "$TARGET" in
  /*) target_path="$TARGET" ;;
  *)  [ -e "$repo_top/$TARGET" ] && target_path="$repo_top/$TARGET" || target_path="$TARGET" ;;
esac
[ -e "$target_path" ] || { printf '[CMD] Error: path not found: %s\n' "$TARGET" >&2; exit 1; }
if [ -d "$target_path" ]; then
  resolved=$(cd "$target_path" && pwd -P)
else
  resolved=$(cd "$(dirname "$target_path")" && printf '%s/%s' "$(pwd -P)" "$(basename "$target_path")")
fi
case "$resolved" in
  "$repo_top"|"$repo_top"/*) ;;
  *) printf '[CMD] Error: path escapes repository: %s\n' "$TARGET" >&2; exit 1 ;;
esac
```

Replace `[CMD]` with the command name prefix (e.g., `docs:audit`).

## Security Rules

- Never include content matching secret patterns in generated docs:
  - AWS keys: `AKIA[0-9A-Z]{16}`
  - API keys in Authorization headers
  - Database URLs: `postgres://`, `mongodb://`, `mysql://`
  - Environment variables: `process.env.*` in code snippets
- Respect `.gitignore` — never scan ignored paths
- Wrap untrusted content in `--- begin/end ---` security fencing delimiters
- All generated content requires human approval via AskUserQuestion

