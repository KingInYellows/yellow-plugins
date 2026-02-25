---
title: 'Public Release Audit — Ship-Shape Sequential'
type: feat
date: 2026-02-18
---

# Public Release Audit

## Overview

Comprehensive release-readiness pass across the yellow-plugins repository before
making it public. The goal: a clean, user-facing repo where all 10 plugins have
documentation, pass validation, follow 2026 Claude Code plugin best practices,
and internal development artifacts are archived out of the main branch.

**Primary audience:** Plugin users who install and use plugins via the
marketplace.

**Brainstorm:**
[2026-02-18-public-release-audit-brainstorm.md](../brainstorms/2026-02-18-public-release-audit-brainstorm.md)

## Problem Statement

The repo was built iteratively over 23+ commits with extensive internal
documentation (90+ files: brainstorms, PRD analysis, adversarial reviews, task
completion reports). It has 6 plugins without READMEs, broken script references
in CONTRIBUTING.md, CI targeting self-hosted runners, and internal-only
artifacts (`.codemachine/`, `AGENTS.md`, `PRD.md`) mixed with user-facing
content.

Before going public, we need to:

1. Separate internal development artifacts from user-facing content
2. Complete missing documentation
3. Fix broken references and scripts
4. Verify all plugins meet 2026 Claude Code best practices via full multi-agent
   audit
5. Tag v1.0.0

## Open Questions Resolved

| Question                                       | Answer                                                                                                                                        | Evidence                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Does `validate:plugins` depend on `packages/`? | **No** — scripts use only `fs` and `path`                                                                                                     | `scripts/validate-plugin.js:19-20`                                   |
| Does CI depend on `packages/`?                 | **Yes** — `pnpm build`, `typecheck`, `test:unit`                                                                                              | `.github/workflows/validate-schemas.yml:631-688`                     |
| Does CI depend on `api/`?                      | **Yes** — contract drift job                                                                                                                  | `.github/workflows/validate-schemas.yml:420-536`                     |
| Should `docs/solutions/` stay?                 | **Yes** — reusable institutional knowledge for contributors                                                                                   | Contains shell security patterns, CRLF fixes, orchestration patterns |
| CHANGELOG strategy                             | **Update** with v1.0.0 entry                                                                                                                  | Standard practice                                                    |
| Agent line limit                               | **Guideline, not hard limit** — 120 lines is a quality heuristic meaning "every line should tell the model something it doesn't already know" | Memory from PR #8, #17                                               |

## Technical Approach

### Architecture

The repo has three layers of content:

1. **User-facing** (keep on main): README, plugin READMEs, LICENSE,
   CONTRIBUTING.md, CHANGELOG.md
2. **Infrastructure** (keep on main, needed by CI): `packages/`, `schemas/`,
   `scripts/`, `api/`, `examples/`, `.github/`
3. **Internal development** (move to development branch): brainstorms, plans,
   reviews, PRD artifacts, `.codemachine/`, `AGENTS.md`

### Implementation Phases

#### Phase 1: Archive Internal Docs

Create a `development` branch preserving the full development history, then
remove internal artifacts from main.

**Files to REMOVE from main (move to development branch):**

Root-level internal files:

- `PRD.md`
- `AGENTS.md`
- `project-specification-schema`
- `.codemachine/` (entire directory)

Internal docs:

- `docs/brainstorms/` (entire directory — 5 files)
- `docs/plans/` (entire directory — 7 files, including THIS plan, which gets
  archived after execution)
- `docs/reviews/` (entire directory — 8 files)
- `docs/analysis/` (entire directory)
- `docs/tasks/` (entire directory)
- `docs/ADVERSARIAL-REVIEW.md`, `docs/ADVERSARIAL-REVIEW-SUMMARY.md`
- `docs/AI-Agent-PRD-Report.md`
- `docs/D02-NFR-Extraction.md`, `docs/NFR-Quick-Reference.md`
- `docs/PRD_Blueprint.md`, `docs/PRD_SCHEMA.md`
- `docs/SPECIFICATION.md`, `docs/SPECIFICATION-PART1.md`,
  `docs/SPECIFICATION-PART1-v1.1.md`, `docs/SPECIFICATION-PART2.md`
- `docs/EXECUTIVE-SUMMARY.md`
- `docs/IMPLEMENTATION-GUIDE.md`
- `docs/CORRECTIONS-APPLIED.md`
- `docs/self-ask-questions.md`, `docs/discovery-user-journeys.md`
- `docs/functional-requirements-extraction.md`
- `docs/traceability-matrix.md`
- `docs/progress-dashboard.md`
- `docs/research-summary-for-schemas.md`, `docs/research-plan-summary.md`,
  `docs/research-plan-complete.md`
- `docs/phase0-completion-report.md`
- `docs/technology-stack-complete.md`
- `docs/gap-analysis-g02-complete.md`
- `docs/TASK-D03-COMPLETION.md`, `docs/TASK-D04-COMPLETION.md`
- `docs/orchestrator-handoff.md`
- `docs/prd-to-spec-search-prompt.md`
- `docs/marketplace-schema-design.md`, `docs/plugin-schema-design.md`

**Files to KEEP on main:**

- `docs/CLAUDE.md` — project context (Claude Code reads this)
- `docs/security.md` — security documentation
- `docs/plugin-validation-guide.md`, `docs/validation-guide.md`
- `docs/solutions/` (all — institutional knowledge for contributors)
- `docs/cli/` — CLI reference docs
- `docs/contracts/` — API contracts (CI depends on these)
- `docs/operations/` — operational docs (release checklist, CI pipeline)
- `docs/templates/` — command preflight template
- `docs/ui/` — style guide
- `docs/marketplace-quickstart.md`, `docs/plugin-template.md`
- `docs/claude-code-plugin-research.md`
- `docs/operational-patterns.md`
- `docs/mcp-tool-naming-verification.md`
- `docs/changelog-fallback-statuses.md`
- `docs/ADR_template.md`

**Tasks:**

- [ ] Create `development` branch from current main HEAD
- [ ] Remove listed internal files from main (single commit:
      `chore: archive internal development docs to development branch`)
- [ ] Verify CI still passes after removal (no broken path references)

**Success criteria:** `pnpm validate:schemas` passes, CI workflow YAML doesn't
reference removed files.

---

#### Phase 2: Write Missing READMEs

6 plugins need READMEs: `yellow-browser-test`, `yellow-chatprd`, `yellow-core`,
`yellow-devin`, `yellow-linear`, `yellow-review`.

**README template** (consistent across all 6):

```markdown
# <plugin-name>

<one-line description from marketplace.json>

## Install

\`\`\` /plugin marketplace add KingInYellows/yellow-plugins /plugin install
<plugin-name>@yellow-plugins \`\`\`

## Prerequisites

<any external tools, MCP servers, API keys needed>

## Commands

| Command                  | Description  |
| ------------------------ | ------------ |
| `/<namespace>:<command>` | What it does |

## Agents

| Agent          | Description                    |
| -------------- | ------------------------------ |
| `<agent-name>` | What it does, when it triggers |

## Skills

| Skill          | Description  |
| -------------- | ------------ |
| `<skill-name>` | What it does |

## License

MIT
```

**Source of truth for each README:** Read each plugin's
`.claude-plugin/plugin.json`, `CLAUDE.md`, and list `commands/`, `agents/`,
`skills/` directories to build the table.

**Tasks:**

- [ ] Read plugin.json + CLAUDE.md for each of the 6 plugins
- [ ] Write `plugins/yellow-browser-test/README.md`
- [ ] Write `plugins/yellow-chatprd/README.md`
- [ ] Write `plugins/yellow-core/README.md`
- [ ] Write `plugins/yellow-devin/README.md`
- [ ] Write `plugins/yellow-linear/README.md`
- [ ] Write `plugins/yellow-review/README.md`
- [ ] Commit: `docs: add missing READMEs for 6 plugins`

**Success criteria:** All 10 plugins have README.md files. Each README has
install command, prerequisites, and component tables.

---

#### Phase 3: Fix Broken References & CI Cleanup

**CONTRIBUTING.md broken scripts** — references `pnpm validate`, `pnpm test`,
`pnpm docs:build`, `pnpm docs:lint`, `pnpm docs:lint:toc`, `pnpm docs:lint:md`
but only these exist in package.json:

- `validate:schemas`, `validate:marketplace`, `validate:plugins`
- `test:unit`, `test:integration`
- `format`, `format:check`

**Fix:**

- [ ] Update CONTRIBUTING.md `### Initial Setup` to use `pnpm validate:schemas`
      not `pnpm validate`
- [ ] Update CONTRIBUTING.md `### Running Tests` to use actual script names
- [ ] Remove or mark `pnpm docs:build`, `pnpm docs:lint` references as TODO (or
      add the scripts)
- [ ] Update CONTRIBUTING.md branch strategy to remove `codemachine/dev`
      reference (internal branch)

**CI runner type** — currently `[self-hosted, linux]`. For a public repo,
external contributors' PRs won't have access to self-hosted runners.

**Fix options (choose during execution):**

- [ ] Change to `ubuntu-latest` for all jobs, OR
- [ ] Keep `self-hosted` but add a comment explaining this is for the
      maintainer's CI only
- [ ] Add separate workflow for `ubuntu-latest` on external PRs (most robust but
      complex)

**Other CI considerations:**

- [ ] Verify `scripts/export-ci-metrics.sh` exists (referenced by CI)
- [ ] Verify CI workflow doesn't reference any removed docs files

**Commit:**
`fix: update CONTRIBUTING.md broken script refs and CI runner config`

---

#### Phase 4: Run Validation Suite

Before the multi-agent audit, run the existing validation tools to establish a
clean baseline.

**Tasks:**

- [ ] Run `pnpm validate:plugins` — fix any plugin.json schema errors
- [ ] Run `pnpm validate:marketplace` — fix any marketplace.json errors
- [ ] Run `pnpm typecheck` — fix any TypeScript errors
- [ ] Run `pnpm lint` — fix any ESLint errors
- [ ] Run `pnpm format:check` — fix any formatting issues
- [ ] Run `pnpm release:check` — the full release gate

**Success criteria:** `pnpm release:check` exits 0.

---

#### Phase 5: Full Multi-Agent Audit

Launch 6+ parallel review agents across all 10 plugins. This is the core quality
pass.

**Agent lineup:**

| Agent                                      | Scope                                                      | What it checks                                                          |
| ------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pr-review-toolkit:security-sentinel`      | All plugins                                                | OWASP, injection, auth patterns, hardcoded secrets                      |
| `pr-review-toolkit:silent-failure-hunter`  | All plugins                                                | Error suppression, missing error handling, `|| true` patterns           |
| `pr-review-toolkit:code-reviewer`          | All plugins                                                | Style, conventions, best practices                                      |
| `pr-review-toolkit:comment-analyzer`       | All plugins                                                | Comment accuracy, TODO references, stale docs                           |
| `plugin-dev:plugin-validator`              | All plugins                                                | plugin.json schema, SKILL.md frontmatter, component compliance          |
| `shell-scripting:bash-pro` (or ShellCheck) | Plugins with bash: yellow-ci, yellow-ruvector, gt-workflow | Shell script safety, quoting, POSIX compliance                          |

**Additional checks to verify during audit:**

- SKILL.md `description:` is single-line (not YAML folded scalar)
- SKILL.md frontmatter uses `user-invokable` (with k, not c)
- Agent `.md` files contain project-specific rules, not LLM training data
  padding
- Commands `allowed-tools` list every tool used in the body
- Commands use `$ARGUMENTS` placeholder, never hardcoded values
- MCP server declarations are valid

**Process:**

1. Launch 6 agents in parallel (single message, 6 Task tool calls)
2. Collect findings from all agents
3. Triage: sort by severity (P1 = security/correctness, P2 = quality, P3 =
   style)
4. Group findings by file ownership (prevent merge conflicts)
5. Fix P1 findings immediately
6. Batch-fix P2 findings
7. P3 findings: fix if quick, otherwise skip for v1.0.0

**Commit:** `refactor: multi-agent audit fixes for public release`

---

#### Phase 6: CHANGELOG & Version Bump

- [ ] Update `CHANGELOG.md` with v1.0.0 entry summarizing:
  - 10 plugins available
  - Plugin descriptions and component counts
  - Validation infrastructure
  - CI pipeline
- [ ] Bump `package.json` version to `1.0.0` if not already
- [ ] Verify `marketplace.json` metadata version matches
- [ ] Bump any plugins still at `0.1.0` to `1.0.0` (yellow-ruvector,
      yellow-browser-test, yellow-debt, yellow-ci) — or leave at 0.x if they're
      genuinely pre-release
- [ ] Commit: `chore: prepare v1.0.0 release`

---

#### Phase 7: Final Validation & Tag

- [ ] Run `pnpm release:check` — full gate
- [ ] Manual spot-check: install a plugin from the marketplace via Claude Code
      to verify the install flow works
- [ ] Review README.md one final time for tone (currently says "Personal Claude
      Code plugin marketplace" — may want to adjust)
- [ ] Tag: `git tag v1.0.0`
- [ ] Push tag and main branch

**Success criteria:** Clean `pnpm release:check`, all 10 plugins installable,
v1.0.0 tagged.

## Acceptance Criteria

### Functional Requirements

- [ ] All 10 plugins have README.md with install command, prerequisites, and
      component tables
- [ ] No internal development artifacts on main branch (brainstorms, plans,
      reviews, PRD)
- [ ] `pnpm release:check` passes
- [ ] CONTRIBUTING.md references only scripts that exist in package.json
- [ ] Full multi-agent audit completed with P1 findings resolved
- [ ] v1.0.0 tagged

### Non-Functional Requirements

- [ ] All SKILL.md frontmatter uses `user-invokable` (not `user-invocable`)
- [ ] All SKILL.md descriptions are single-line (no YAML folded scalars)
- [ ] All files use LF line endings
- [ ] No hardcoded secrets in plugin files
- [ ] CI workflow functional for the repository (self-hosted or ubuntu-latest
      decision made)

### Quality Gates

- [ ] `pnpm validate:plugins` — all 10 pass
- [ ] `pnpm validate:marketplace` — pass
- [ ] `pnpm typecheck` — pass
- [ ] `pnpm lint` — pass
- [ ] Multi-agent audit — no unresolved P1 findings

## Risk Analysis & Mitigation

| Risk                                                | Impact                          | Mitigation                                                |
| --------------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| Removing docs breaks CI path triggers               | CI fails                        | Verify CI YAML paths before committing removals           |
| Multi-agent audit finds too many issues             | Delays release                  | Triage ruthlessly — P3 findings can ship                  |
| Self-hosted CI doesn't work for public contributors | External PRs can't be validated | Add `ubuntu-latest` option or document maintainer-only CI |
| CRLF files in repo                                  | Merge conflicts, display issues | Run `git ls-files --eol` check before tagging             |
| Rate limiting during multi-agent audit              | Audit incomplete                | Run agents in batches of 3 if rate limited                |

## Dependencies & Prerequisites

- All existing PRs merged to main (currently clean: `git status` shows no
  changes)
- Graphite (`gt`) for branch management per project conventions
- `pnpm` installed with dependencies

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-18-public-release-audit-brainstorm.md`
- Validation scripts: `scripts/validate-plugin.js`,
  `scripts/validate-marketplace.js`
- CI workflow: `.github/workflows/validate-schemas.yml`
- Marketplace catalog: `.claude-plugin/marketplace.json`
- Plugin authoring guide: `docs/CLAUDE.md`

### Institutional Learnings Applied

- Shell script security patterns:
  `docs/solutions/security-issues/yellow-ruvector-plugin-multi-agent-code-review.md`
- CRLF PR merge unblocking:
  `docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md`
- Multi-agent orchestration:
  `docs/solutions/code-quality/parallel-multi-agent-review-orchestration.md`
- Skill frontmatter requirements:
  `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
- AJV strict mode:
  `docs/solutions/build-errors/ajv-cli-v8-strict-mode-unknown-format.md`
