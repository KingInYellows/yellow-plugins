# Changelog

All notable changes to the Yellow Plugins project will be documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-02-18

Initial public release of the yellow-plugins marketplace — 10 Claude Code
plugins for development productivity, code quality, and workflow automation.

### Plugins

#### Development

- **gt-workflow** (1.0.0) — Graphite-native workflow commands for stacked PRs,
  smart commits, sync, and stack navigation. 5 commands.
- **yellow-core** (1.0.0) — Dev toolkit with review agents, research agents, and
  workflow commands for TypeScript, Python, Rust, and Go. 10 agents, 3 commands,
  2 skills.
- **yellow-review** (1.0.0) — Multi-agent PR review with adaptive agent
  selection, parallel comment resolution, and sequential stack review. 8 agents,
  3 commands, 1 skill.
- **yellow-debt** (1.0.0) — Technical debt audit and remediation with parallel
  scanner agents for AI-generated code patterns. 7 agents, 5 commands, 1 skill.
- **yellow-ruvector** (1.0.0) — Persistent vector memory and semantic code
  search for Claude Code agents via ruvector MCP server. 2 agents, 6 commands, 2
  skills, 3 hooks.
- **yellow-ci** (1.0.0) — CI failure diagnosis, workflow linting, and runner
  health management for self-hosted GitHub Actions runners. 3 agents, 5
  commands, 2 skills, 1 hook.

#### Productivity

- **yellow-linear** (1.0.0) — Linear MCP integration with PM workflows for
  issues, projects, initiatives, cycles, and documents. 3 agents, 5 commands, 1
  skill.
- **yellow-chatprd** (1.0.0) — ChatPRD MCP integration with document management
  and Linear bridging. 2 agents, 5 commands, 1 skill.

#### Integrations

- **yellow-devin** (1.0.0) — Devin.AI integration for multi-agent workflows —
  delegate tasks, research codebases via DeepWiki, orchestrate
  plan-implement-review chains. 1 agent, 5 commands, 1 skill.

#### Testing

- **yellow-browser-test** (1.0.0) — Autonomous web app testing with
  agent-browser — auto-discovery, structured flows, and bug reporting. 3 agents,
  4 commands, 2 skills.

### Marketplace Infrastructure

- Schema-validated plugin manifests (`plugin.json` + `marketplace.json`)
- Plugin validation scripts (`scripts/validate-plugin.js`,
  `scripts/validate-marketplace.js`)
- Contribution guide with plugin authoring conventions
- MIT licensed

### Totals

- **10 plugins** across 4 categories
- **39 agents** for autonomous task execution
- **46 commands** for manual workflows
- **13 skills** for shared conventions and patterns
- **5 hooks** for automated event-driven behavior
- **3 MCP server integrations** (Linear, ruvector, DeepWiki)

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows) **Format**:
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) **Versioning**:
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)
