# Public Release Audit — Brainstorm

**Date:** 2026-02-18 **Status:** Decided **Approach:** Ship-Shape Sequential
(Approach A)

## What We're Building

A comprehensive release-readiness pass across the yellow-plugins repository
before making it public. The goal is a clean, user-facing repo where all 10
plugins have documentation, pass validation, follow 2026 Claude Code plugin best
practices, and internal development artifacts are archived out of the main
branch.

**Primary audience:** Plugin users who want to install and use the plugins via
the marketplace.

## Why This Approach

Approach A (Ship-Shape Sequential) was chosen over parallel blitz or two-phase
launch because:

- Methodical ordering ensures each step builds on the previous (can't audit what
  hasn't been cleaned up)
- Consistent README quality across all 6 missing plugins (vs. 6 parallel writers
  producing inconsistent docs)
- Matches the established workflow from PRs #10, #17, #18
- Full multi-agent review gives confidence for a v1.0.0 tag rather than shipping
  a soft-launch

## Key Decisions

### 1. Internal docs → development branch

- Create a `development` branch from current main state
- Remove from main: brainstorms, plans, reviews, adversarial reviews, PRD,
  AGENTS.md, .codemachine/, task completion reports
- Keep on main: validation guides, plugin-validation-guide.md, security.md
  (user-relevant)

### 2. Infrastructure: keep but minimize

- **Keep:** schemas/, scripts/ (validate:plugins, validate:schemas),
  package.json scripts
- **Remove or relocate:** api/ (CLI contracts), config/memory-config.json,
  packages/ (only if validate:plugins doesn't depend on them — needs
  verification)
- **Keep:** examples/ (useful for plugin developers who find the repo)

### 3. Missing READMEs (6 of 10 plugins)

- Plugins needing READMEs: yellow-browser-test, yellow-chatprd, yellow-core,
  yellow-devin, yellow-linear, yellow-review
- Template: what it does, install command, prerequisites/config, commands list,
  agents list, any MCP servers needed
- Keep concise — these are user-facing, not developer deep-dives

### 4. Full multi-agent audit

- Launch 6+ parallel review agents across all 10 plugins
- Agent types: security-sentinel, shell quality (for bash hooks/scripts),
  frontmatter compliance, best-practices (2026 standards)
- Batch triage findings, fix in groups by file ownership
- Verify: plugin.json schema, SKILL.md frontmatter (single-line descriptions,
  user-invokable spelling), agent .md files under 120 lines

### 5. Git strategy

- Keep full commit history on main
- Archive internal docs to development branch
- Tag v1.0.0 after all fixes land

## Release Checklist (Execution Order)

1. **Archive internal docs** — branch, remove from main, commit
2. **Write 6 missing READMEs** — consistent template, concise
3. **Minimize infrastructure** — verify dependencies, remove unused dirs
4. **Run pnpm validate:plugins** — fix any schema/structural issues
5. **Full multi-agent audit** — parallel security + quality + frontmatter review
6. **Batch fix findings** — group by file ownership, fix in parallel groups
7. **Final validation pass** — pnpm release:check, manual spot-check
8. **Tag v1.0.0** — publish

## Open Questions

- Does `pnpm validate:plugins` depend on `packages/` code? Need to verify before
  removing
- Should `docs/solutions/` stay on main? They document reusable patterns (shell
  security, CRLF fixes) that could help advanced users
- CHANGELOG.md — update with a v1.0.0 entry or start fresh?

## Tools & Agents for the Audit

| Step           | Tool/Agent                       | Purpose                             |
| -------------- | -------------------------------- | ----------------------------------- |
| Archive docs   | Bash (git branch, rm)            | Branch management and file cleanup  |
| READMEs        | Write tool                       | Generate 6 plugin READMEs           |
| Validation     | pnpm validate:plugins            | Schema and structural validation    |
| Security audit | security-sentinel agent          | OWASP, injection, auth patterns     |
| Shell quality  | ShellCheck + shell review agents | Bash script safety                  |
| Frontmatter    | plugin-validator agent           | SKILL.md and plugin.json compliance |
| Best practices | code-reviewer agent              | 2026 Claude Code plugin standards   |
| Performance    | performance-oracle agent         | Query patterns, memory, scalability |

## Next Steps

Run `/workflows:plan` to create a detailed implementation plan from this
brainstorm.
