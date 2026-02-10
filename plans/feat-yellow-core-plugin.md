# feat: Build yellow-core Plugin — A Comprehensive Claude Code Development Toolkit

## Overview

Build a comprehensive Claude Code plugin called **yellow-core** that serves as your personal engineering multiplier — inspired by compound-engineering but tailored to your stack (TypeScript/JavaScript, Python, Rust, Go) and your Graphite-based workflow. This plugin will live alongside the existing `gt-workflow` plugin in the yellow-plugins marketplace.

## Problem Statement

The compound-engineering plugin by Every is powerful but Rails/Ruby-centric and carries opinions that don't match your stack. You need a comprehensive plugin that:

1. Provides universal code review agents (not Rails-specific)
2. Integrates with your Graphite (`gt`) workflow (already started with `gt-workflow`)
3. Covers your primary languages: TypeScript, Python, Rust, Go
4. Follows the **official Claude Code plugin format** (minimal, auto-discovered)
5. Includes the most impactful features: research agents, review agents, workflow commands, and skills

## Current State Analysis

### What You Have

```
yellow-plugins/
├── .claude-plugin/marketplace.json     # Official format, 1 plugin listed
├── plugins/gt-workflow/                # 4 commands (smart-submit, gt-sync, gt-nav, gt-stack-plan)
├── schemas/                            # Extended validation schemas (over-engineered)
├── packages/                           # TypeScript validation toolkit (over-engineered)
├── serena/                             # Vendored Python LSP tool (separate concern)
├── docs/                               # Extensive specification docs
└── examples/                           # Example JSON files
```

### Issues Found

1. **gt-workflow plugin.json has a syntax error** — duplicate `keywords` field at lines 11-12
2. **Over-engineered infrastructure** — Extended schemas, TypeScript packages, validation CLI are unnecessary for the official plugin format which is minimal
3. **`serena/` directory** is a separate project vendored into the repo — should be its own thing
4. **README references `yellow-starter`** plugin that doesn't exist (only `gt-workflow` exists)
5. **marketplace.json uses the official format** correctly — this is good, keep it

### What Works Well

- `gt-workflow` commands are well-structured with YAML frontmatter, clear phases, and proper tool declarations
- `smart-submit` command demonstrates excellent multi-agent audit pattern
- marketplace.json follows the official format perfectly
- Good command structure with argument handling (`#$ARGUMENTS`)

## Proposed Architecture

### Marketplace Structure (After)

```
yellow-plugins/
├── .claude-plugin/
│   └── marketplace.json              # Lists both plugins
├── plugins/
│   ├── gt-workflow/                   # KEEP — Graphite-specific (already great)
│   │   ├── .claude-plugin/plugin.json
│   │   ├── CLAUDE.md
│   │   └── commands/
│   │       ├── smart-submit.md
│   │       ├── gt-sync.md
│   │       ├── gt-nav.md
│   │       └── gt-stack-plan.md
│   │
│   └── yellow-core/                   # NEW — Comprehensive dev toolkit
│       ├── .claude-plugin/plugin.json
│       ├── CLAUDE.md
│       ├── agents/
│       │   ├── review/                # Code review specialists
│       │   ├── research/              # Research & analysis
│       │   ├── workflow/              # Workflow automation
│       │   └── design/               # Design & UI
│       ├── commands/
│       │   ├── workflows/             # Core workflow commands
│       │   └── *.md                   # Utility commands
│       └── skills/
│           └── */SKILL.md             # AI-invocable capabilities
├── schemas/                           # SIMPLIFY — keep official schema only
└── README.md                          # UPDATE
```

### Plugin Format (Official/Minimal)

The official Claude Code plugin format auto-discovers components from directory structure. No need for `entrypoints`, `compatibility`, or `permissions` fields.

**yellow-core/.claude-plugin/plugin.json:**
```json
{
  "name": "yellow-core",
  "version": "1.0.0",
  "description": "Comprehensive dev toolkit: review agents, research agents, workflow commands, and skills for TypeScript, Python, Rust, and Go",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/kinginyellow"
  },
  "repository": "https://github.com/kinginyellow/yellow-plugins",
  "license": "MIT",
  "keywords": ["code-review", "workflow", "research", "typescript", "python", "rust", "go"],
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

Key insight: `mcpServers` goes directly in plugin.json (like compound-engineering does), not in a separate file or entrypoints array.

## Component Plan

### Phase 1: Agents (15 agents across 4 categories)

#### review/ (8 agents) — Universal Code Review

| Agent | File | Purpose |
|-------|------|---------|
| code-simplicity-reviewer | `review/code-simplicity-reviewer.md` | YAGNI enforcement, simplification analysis |
| security-sentinel | `review/security-sentinel.md` | Security audit, OWASP, secrets scanning |
| performance-oracle | `review/performance-oracle.md` | Performance bottlenecks, scalability |
| architecture-strategist | `review/architecture-strategist.md` | Architectural compliance, design patterns |
| pattern-recognition-specialist | `review/pattern-recognition-specialist.md` | Anti-patterns, code smells, consistency |
| polyglot-reviewer | `review/polyglot-reviewer.md` | **NEW** — Language-idiomatic review for TS/Py/Rust/Go |
| test-coverage-analyst | `review/test-coverage-analyst.md` | **NEW** — Test quality, coverage gaps, edge cases |
| deployment-verification-agent | `review/deployment-verification-agent.md` | Pre-deploy checklists, migration safety |

#### research/ (4 agents)

| Agent | File | Purpose |
|-------|------|---------|
| repo-research-analyst | `research/repo-research-analyst.md` | Repository structure, conventions |
| best-practices-researcher | `research/best-practices-researcher.md` | External docs, community standards |
| framework-docs-researcher | `research/framework-docs-researcher.md` | Framework/library documentation |
| git-history-analyzer | `research/git-history-analyzer.md` | Git archaeology, change history |

#### workflow/ (2 agents)

| Agent | File | Purpose |
|-------|------|---------|
| spec-flow-analyzer | `workflow/spec-flow-analyzer.md` | User flow analysis, gap identification |
| bug-reproduction-validator | `workflow/bug-reproduction-validator.md` | Bug report verification |

#### design/ (1 agent)

| Agent | File | Purpose |
|-------|------|---------|
| design-iterator | `design/design-iterator.md` | Iterative visual refinement |

### Phase 2: Commands (8 commands)

#### workflows/ (4 core workflow commands)

| Command | File | Purpose |
|---------|------|---------|
| workflows:plan | `workflows/plan.md` | Transform feature descriptions into structured plans |
| workflows:work | `workflows/work.md` | Execute work plans systematically |
| workflows:review | `workflows/review.md` | Multi-agent comprehensive code review |
| workflows:compound | `workflows/compound.md` | Document solved problems as knowledge |

#### Utility Commands (4)

| Command | File | Purpose |
|---------|------|---------|
| plan-review | `plan-review.md` | Multi-agent plan review (DHH-style not needed; use polyglot + simplicity + arch) |
| resolve-parallel | `resolve-parallel.md` | Resolve TODO comments using parallel agents |
| triage | `triage.md` | Categorize findings for the CLI todo system |
| changelog | `changelog.md` | Generate changelogs from recent merges |

### Phase 3: Skills (6 skills)

| Skill | Directory | Purpose |
|-------|-----------|---------|
| frontend-design | `skills/frontend-design/` | Distinctive, production-grade UI creation |
| skill-creator | `skills/skill-creator/` | Guide for creating effective skills |
| compound-docs | `skills/compound-docs/` | Captured solved problems as documentation |
| git-worktree | `skills/git-worktree/` | Git worktree management for parallel development |
| create-agent-skills | `skills/create-agent-skills/` | Expert guidance for writing agents/skills |
| shell-scripting | `skills/shell-scripting/` | **NEW** — POSIX sh & Bash best practices (matches your zsh usage) |

### Phase 4: MCP Server

| Server | Config | Purpose |
|--------|--------|---------|
| context7 | In plugin.json `mcpServers` | Up-to-date library documentation |

### What We're NOT Including (and why)

| Compound-Eng Component | Reason to Skip |
|------------------------|----------------|
| dhh-rails-reviewer | Rails-specific, you don't use Rails |
| kieran-rails-reviewer | Rails-specific |
| kieran-python-reviewer | Covered by polyglot-reviewer |
| kieran-typescript-reviewer | Covered by polyglot-reviewer |
| julik-frontend-races-reviewer | Too niche (Stimulus/Rails frontend) |
| every-style-editor | Every.to-specific style guide |
| data-integrity-guardian | Database-migration specific to Rails |
| data-migration-expert | Rails migration specific |
| agent-native-reviewer | Niche concern |
| schema-drift-detector | Database-specific |
| ankane-readme-writer | Ruby gem specific |
| dspy-ruby | Ruby-specific |
| andrew-kane-gem-writer | Ruby-specific |
| dhh-ruby-style | Ruby-specific |
| rclone | Too niche |
| brainstorming | Nice to have, not essential |
| agent-browser | Complex, separate concern |
| gemini-imagegen | External API dependency |
| various test/xcode commands | Platform-specific |

## Key Format Decisions

### Agent Format (YAML frontmatter + Markdown)

```markdown
---
name: agent-name
description: "What it does. When to use it."
model: inherit
---

<examples>
<example>
Context: When this should be used.
user: "User request"
assistant: "How assistant responds"
<commentary>Why this agent is appropriate.</commentary>
</example>
</examples>

You are a [role] specializing in [domain]...

[Agent instructions]
```

### Command Format (YAML frontmatter + Markdown)

```markdown
---
name: command-name
description: "What it does"
argument-hint: "[optional args]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Command Title

[Command instructions with phases, code blocks, and clear steps]
```

### Skill Format (SKILL.md in named directory)

```markdown
---
name: skill-name
description: What it does and when to use it. Use when [trigger conditions].
---

[Skill instructions — what to do, how to behave, guidelines]
```

### Naming Conventions

- **Agents**: kebab-case, descriptive role names (e.g., `code-simplicity-reviewer`)
- **Commands**: kebab-case, namespaced with `:` for workflows (e.g., `workflows:plan`)
- **Skills**: kebab-case directory names with `SKILL.md` inside
- **All**: Use imperative/infinitive form in descriptions

## Cleanup Tasks

### Remove or Simplify

1. **Remove `serena/` directory** — separate project, not a Claude Code plugin component
2. **Remove extended schemas** (`schemas/marketplace.schema.json`, `schemas/plugin.schema.json`) — the official format doesn't need these
3. **Keep `schemas/official-marketplace.schema.json`** as reference only
4. **Simplify `packages/` directory** — validation toolkit is unnecessary for official format
5. **Remove `.codemachine/` directory** — build artifact from another tool
6. **Fix `gt-workflow` plugin.json** — remove duplicate `keywords` field
7. **Update README.md** — list both plugins, remove references to `yellow-starter`
8. **Update marketplace.json** — add yellow-core plugin entry

### Files to Keep

- `.claude-plugin/marketplace.json` (update with yellow-core)
- `plugins/gt-workflow/` (fix syntax error, keep as-is)
- `plugins/yellow-core/` (new)
- `README.md` (update)
- `.gitignore`, `.eslintrc.cjs`, etc. (keep standard tooling)
- `examples/` (update with yellow-core example)

## Implementation Phases

### Phase 1: Foundation (scaffold + 5 review agents)
1. Create `plugins/yellow-core/` directory structure
2. Write `plugin.json` with context7 MCP server
3. Write `CLAUDE.md` with conventions
4. Create 5 core review agents: code-simplicity-reviewer, security-sentinel, performance-oracle, architecture-strategist, pattern-recognition-specialist
5. Update marketplace.json to include yellow-core

### Phase 2: Research + Workflow Agents (6 agents)
1. Create 4 research agents: repo-research-analyst, best-practices-researcher, framework-docs-researcher, git-history-analyzer
2. Create 2 workflow agents: spec-flow-analyzer, bug-reproduction-validator

### Phase 3: Unique Agents (4 agents)
1. Create polyglot-reviewer (TS/Py/Rust/Go idiomatic review)
2. Create test-coverage-analyst
3. Create deployment-verification-agent
4. Create design-iterator

### Phase 4: Core Workflow Commands (4 commands)
1. workflows:plan — Planning workflow
2. workflows:work — Execution workflow
3. workflows:review — Multi-agent review
4. workflows:compound — Knowledge documentation

### Phase 5: Utility Commands (4 commands)
1. plan-review
2. resolve-parallel
3. triage
4. changelog

### Phase 6: Skills (6 skills)
1. frontend-design
2. skill-creator
3. compound-docs
4. git-worktree
5. create-agent-skills
6. shell-scripting

### Phase 7: Cleanup & Polish
1. Fix gt-workflow plugin.json syntax error
2. Remove serena/, .codemachine/, unnecessary schemas
3. Update README.md
4. Update marketplace.json
5. Validate everything works with `/plugin install yellow-core`

## Success Criteria

- [ ] `yellow-core` plugin installs cleanly via `/plugin install yellow-core`
- [ ] All 15 agents appear in the Task tool's agent type list
- [ ] All 8 commands are invocable via `/command-name`
- [ ] All 6 skills are discoverable and usable
- [ ] context7 MCP server connects successfully
- [ ] `gt-workflow` plugin still works alongside yellow-core
- [ ] No duplicate functionality between gt-workflow and yellow-core
- [ ] Plugin follows official Claude Code format (no extended schemas needed)
- [ ] All agents have proper examples and clear trigger conditions
- [ ] Commands have clear phases with parallel agent spawning where appropriate

## Component Counts Summary

| Component | Count | Categories |
|-----------|-------|------------|
| Agents | 15 | review (8), research (4), workflow (2), design (1) |
| Commands | 8 | workflows (4), utility (4) |
| Skills | 6 | frontend-design, skill-creator, compound-docs, git-worktree, create-agent-skills, shell-scripting |
| MCP Servers | 1 | context7 |
| **Total** | **30** | |

## References

- Official plugin format: `examples/plugin-minimal.example.json`
- compound-engineering reference: `~/.claude/plugins/marketplaces/every-marketplace/plugins/compound-engineering/`
- Official marketplace schema: `schemas/official-marketplace.schema.json`
- Existing gt-workflow commands: `plugins/gt-workflow/commands/`
- [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- [obra/superpowers-marketplace](https://github.com/obra/superpowers-marketplace)
