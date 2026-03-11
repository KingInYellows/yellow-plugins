# Documentation Plugin Brainstorm

**Date:** 2026-03-10
**Status:** Brainstorm
**Approach:** Audit + Generate (Approach B)

## What We're Building

A general-purpose `yellow-docs` plugin that both diagnoses and treats
documentation problems in any repository. The plugin detects project structure
(package.json, Cargo.toml, pyproject.toml, go.mod,
`.claude-plugin/plugin.json`, etc.) and
adapts its analysis and generation to the repo it's working in.

### Target Audiences

- **Plugin/library users** -- people consuming the software and needing to
  understand how to use it
- **Developers/contributors** -- people building, extending, or maintaining the
  codebase

### Pain Points Addressed

1. **Docs go stale** -- code changes ship but docs don't get updated, leading
   to drift between what the code does and what the docs say
2. **Missing docs** -- features exist with no documentation at all
3. **No visual aids** -- architecture and flows are described in prose when
   diagrams (Mermaid) would be clearer
4. **Hard to discover** -- docs exist but people can't find what they need

### Primary Interaction Model

- **On-demand commands** (primary) -- explicit invocation of `/docs:audit`,
  `/docs:generate`, `/docs:diagram`, `/docs:refresh`
- **Workflow-integrated** (secondary) -- opportunistic suggestions after
  `/workflows:work` completes if code changes touched documented areas
- **Agent-driven** (secondary) -- open-ended queries like "document this
  module" or "what's undocumented?"

## Why This Approach

The Audit + Generate approach was chosen over two alternatives:

- **Audit-First (Approach A)** was too narrow -- it only reports problems
  without helping fix them, and omits Mermaid diagram generation entirely.
- **Full Documentation Platform (Approach C)** was too broad -- features like
  link checking, prose linting, and SessionStart hooks risk YAGNI violations
  and duplicate existing standalone tools (Vale, markdown-link-check). These
  can be added later if needed without rework.

Approach B hits the sweet spot: it covers all four pain points, follows the
established plugin pattern (commands + agents + skills), and uses the
audit-then-generate workflow to ensure quality. AI-generated docs always go
through human review gates, matching the brainstorm/plan workflow pattern
already established in yellow-core.

### Research Findings That Shaped This

**Codebase patterns:**
- 13 plugins follow a consistent structure (`.claude-plugin/plugin.json`,
  CLAUDE.md, commands/,
  agents/, skills/) -- the docs plugin should follow this same structure
- The `knowledge-compounder` agent already generates docs to `docs/solutions/`
  and MEMORY.md -- precedent for doc-generating agents exists
- Cross-plugin composition via Skill tool is established -- `/docs:refresh`
  can integrate with `/workflows:work` via this pattern
- Hooks (like yellow-ci's SessionStart) show how workflow integration works
- Mermaid is barely used today (3 files, none in plugin docs) -- significant
  opportunity

**External research:**
- Doc-drift detection via change impact analysis (compare git diffs against doc
  references) is the most practical staleness detection approach
- Documentation coverage analysis (what % of features are documented) provides
  quantifiable audit metrics
- AI-assisted generation with human review gates is the emerging best practice
  (Mintlify, Fern patterns) -- LLMs draft, humans approve
- Contract-based validation (machine-readable specs tested against behavior)
  is powerful but heavyweight -- defer to Approach C if needed later
- Mermaid diagrams render natively on GitHub, store as markdown code blocks
  for Git tracking, and can be auto-generated from code structure analysis

## Key Decisions

### Plugin Structure

```text
plugins/yellow-docs/
  .claude-plugin/
    plugin.json
  CLAUDE.md
  CHANGELOG.md
  README.md
  package.json
  commands/
    docs/
      audit.md          # /docs:audit -- find gaps, staleness, coverage
      generate.md       # /docs:generate -- AI-assisted doc creation
      diagram.md        # /docs:diagram -- Mermaid diagram generation
      refresh.md        # /docs:refresh -- update stale docs from code changes
  agents/
    analysis/
      doc-auditor.md    # Analyzes repo for doc gaps, drift, coverage
    generation/
      doc-generator.md  # AI-assisted content creation with structure detection
      diagram-architect.md  # Context-aware Mermaid diagram generation
  skills/
    docs-conventions/
      SKILL.md          # Shared patterns, templates, diagram type selection
```

### Command Design

**`/docs:audit [path]`**
- Scans the repo (or specified path) for documentation problems
- Reports: coverage gaps (undocumented modules/commands/APIs), stale docs
  (files not updated since related code changed), structural issues (missing
  standard sections), and discoverability problems (no index, no cross-links)
- Output: structured report with severity levels (P1: missing critical docs,
  P2: stale docs, P3: structural improvements)
- Uses `doc-auditor` agent for analysis

**`/docs:generate [target]`**
- Generates documentation from code analysis
- Target can be: a file path, a module/directory, "readme", "architecture",
  or "api-reference"
- Detects project structure to determine what kind of docs to generate
- Always presents draft to user via AskUserQuestion before writing
- Uses `doc-generator` agent for content creation

**`/docs:diagram [scope]`**
- Generates context-aware Mermaid diagrams
- Scope determines diagram type:
  - File/module path -> dependency/import graph (flowchart)
  - Command/workflow name -> execution sequence (sequence diagram)
  - Directory path -> file structure (mindmap or class diagram)
  - "architecture" -> system-level component diagram
  - No scope -> auto-detect most useful diagram for the repo
- Embeds diagrams as fenced `mermaid` code blocks in markdown files
- Uses `diagram-architect` agent for generation

**`/docs:refresh [--since <ref>]`**
- Analyzes what code changed since the given ref (default: last commit on main)
- Cross-references changes against existing docs to find what needs updating
- For each stale doc, generates a suggested update diff
- Presents changes to user for approval before writing
- Uses `doc-auditor` for drift detection, `doc-generator` for update drafts

### Mermaid Diagram Strategy

The `diagram-architect` agent selects diagram type based on context:

| Context | Diagram Type | Mermaid Syntax |
|---------|-------------|----------------|
| Plugin dependencies | Flowchart | `graph TD` |
| Command/workflow execution | Sequence diagram | `sequenceDiagram` |
| Module imports/relationships | Flowchart | `graph LR` |
| Directory/file layout | Mindmap | `mindmap` |
| System architecture | C4 or flowchart | `graph TD` with subgraphs |
| Data flow | Flowchart | `graph LR` |
| State transitions | State diagram | `stateDiagram-v2` |

Diagrams are generated from actual code analysis (imports, function calls,
directory structure), not from templates or guesses. The agent reads the
codebase to build an accurate model before rendering Mermaid syntax.

### Agent Design

**`doc-auditor`** -- Analysis specialist
- Scans repo structure to build a map of what exists
- Compares code artifacts against doc artifacts to find gaps
- Uses git history to detect staleness (code changed but docs didn't)
- Produces structured findings with severity and location
- Does NOT generate content -- only identifies problems

**`doc-generator`** -- Content creation specialist
- Reads code to understand structure, purpose, and behavior
- Generates markdown documentation following detected conventions
- Adapts output format to project type (plugin docs vs. library API vs.
  application guides)
- Always produces drafts for human review -- never auto-writes
- Can generate: READMEs, API references, architecture overviews, module docs,
  getting-started guides

**`diagram-architect`** -- Mermaid diagram specialist
- Analyzes code structure (imports, exports, function calls, directory layout)
- Selects appropriate diagram type based on what's being visualized
- Generates syntactically valid Mermaid that renders on GitHub
- Keeps diagrams focused -- target 15-30 nodes, hard limit 50 for dense graphs
  and 100 for sparse graphs
- Can update existing diagrams when code structure changes

### Project Structure Detection

The plugin adapts to any repo by detecting structure signals:

| Signal | Project Type | Doc Strategy |
|--------|-------------|-------------|
| `.claude-plugin/plugin.json` + `commands/` | Claude Code plugin | Plugin CLAUDE.md, command docs, skill docs |
| `package.json` + `src/` | Node.js library/app | README, API reference, module docs |
| `Cargo.toml` | Rust project | README, crate docs, module docs |
| `pyproject.toml` or `setup.py` | Python project | README, API reference, module docs |
| `go.mod` | Go project | README, package docs |
| `.github/workflows/` | CI-enabled repo | Workflow docs, contribution guide |
| `docs/` directory | Existing docs structure | Integrate with existing conventions |

### Workflow Integration

**After `/workflows:work` completes:**
- If code changes touched files that have associated documentation, suggest:
  "Code changes may have affected documentation. Run `/docs:refresh` to check."
- This is a suggestion, not a blocker -- the user decides whether to act

**Cross-plugin composition:**
- `/docs:audit` can be invoked from other workflows via Skill tool
- `/docs:generate` respects existing doc conventions detected in the repo
- `/docs:diagram` can be called standalone or as part of `/docs:generate`

### What This Plugin Does NOT Do (YAGNI Deferred)

- **Documentation site generation** (Docusaurus/MkDocs) -- out of scope; this
  plugin produces markdown files, not hosted sites
- **Prose linting / style enforcement** -- use Vale or similar standalone tools
- **Link checking** -- use markdown-link-check or similar
- **SessionStart hook for doc health** -- could be noisy; add later if needed
- **Contract-based validation** -- heavyweight; defer unless demand emerges
- **Documentation versioning** -- rely on git branches/tags for now
- **Search indexing** -- defer to future iteration

## Open Questions

1. **Naming convention for generated docs:** Should generated docs go into
   `docs/generated/` (clearly separated) or alongside hand-written docs?
   Separation avoids accidental edits to generated files but reduces
   discoverability. Alongside keeps everything together but risks overwriting
   hand-written content.

2. **Staleness threshold:** How far back should `/docs:refresh` look by
   default? Last commit? Last week? Since the doc was last modified? The
   default matters because it determines signal-to-noise ratio.

3. **Diagram placement:** Should Mermaid diagrams be embedded inline in the
   docs they relate to, or collected in a `docs/diagrams/` directory with
   links? Inline is more discoverable but makes docs longer. Separate keeps
   docs clean but adds indirection.

4. **Audit scoring:** Should `/docs:audit` produce a numeric "documentation
   health score" (e.g., 73/100) or just a list of findings? A score is more
   actionable for tracking progress over time but risks gamification.

5. **Plugin detection priority:** When a repo has multiple project type signals
   (e.g., both `package.json` and `plugin.json`), which takes precedence?
   Need a priority order or composite detection strategy.
