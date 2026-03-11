---
name: docs:diagram
description: "Generate context-aware Mermaid diagrams from code analysis. Use when you want architecture, dependency, sequence, or structure diagrams."
argument-hint: '[scope] [--max-nodes <n>]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Agent
  - AskUserQuestion
---

# Mermaid Diagram Generator

Generates context-aware Mermaid diagrams from actual code structure analysis.
Auto-selects the best diagram type based on what is being visualized.

## Arguments

- `[scope]` — What to diagram. Can be:
  - A file or module path → dependency/import graph (`flowchart LR`)
  - A command or workflow name → execution sequence (`sequenceDiagram`)
  - A directory path → file structure (`mindmap`)
  - `architecture` → system-level component diagram (`flowchart TB`)
  - Omitted → auto-detect the most useful diagram for the repo
- `--max-nodes <n>` — Override the default node limit (default: 50 for dense
  graphs, 100 for sparse)

## Workflow

### Step 1: Resolve Scope

Parse `$ARGUMENTS` to determine the diagram scope:

1. If empty: analyze the repo structure and suggest the most useful diagram
   via AskUserQuestion: "What would you like to diagram?" with options:
   - "Architecture overview" — top-level component diagram
   - "Module dependencies" — import/dependency graph
   - "Directory structure" — file layout mindmap
   - "A specific file or module" — ask for path

2. If `architecture`: generate a system-level component diagram.

3. If a file, directory, or module path: validate it exists and determine the
   appropriate diagram type.

4. Parse `--max-nodes` if provided, otherwise use defaults from
   docs-conventions.

### Step 2: Validate Environment

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$repo_top" ]; then
  printf '[docs:diagram] Error: not in a git repository\n' >&2
  exit 1
fi
```

### Step 3: Delegate to diagram-architect Agent

Launch the `diagram-architect` agent:

> --- user input begin ---
> Generate a Mermaid diagram for: $scope
> --- user input end ---
> Repository root: $repo_top
> Max nodes: ${max_nodes:-default}
>
> Follow the generation workflow:
> 1. Analyze the code structure at the given scope — read imports, exports,
>    function calls, directory layout
> 2. Select the appropriate Mermaid diagram type based on the analysis
> 3. Enforce node limits (target 15-30, hard limit per density rules)
> 4. If scope exceeds limits, collapse leaf nodes into group subgraphs
> 5. Generate valid Mermaid syntax with stable node IDs, concise labels,
>    semantic coloring, and accessibility properties
> 6. Validate syntax before presenting
> 7. Present the diagram for human review via AskUserQuestion
> 8. On approval: embed the diagram as a mermaid fenced code block in the target markdown file
>
> Generate from actual code analysis, not templates or guesses.
> Total Mermaid text must not exceed 50,000 characters.

### Step 4: Confirm Output

After the agent writes the diagram, confirm the output and suggest related
actions:

- "Diagram written to {path}"
- "View it on GitHub or in any Mermaid-compatible renderer"
