# Phase 1 — Plugin Inventory

Read-only survey of `KingInYellows/yellow-plugins` to support the Ceramic.ai
research-backend integration. Every claim cites `file:line`, a directory listing,
or a literal command output captured during the survey. No files were modified.

Survey date: 2026-04-26. Repo HEAD: `9ea2a7f` (`main`).

---

## 1. Repo shape

### Top-level layout

`/bin/ls -la` on the repo root (`/home/kinginyellow/projects/yellow-plugins`)
showed these top-level directories (omitting dotfiles other than the
plugin-relevant ones):

| Path | Role |
|------|------|
| `.changeset/` | Changesets release tooling state. |
| `.claude-plugin/` | Marketplace metadata — see `.claude-plugin/marketplace.json:1`. |
| `.codacy/` | Codacy CI config. |
| `.github/` | GitHub workflows + PR template. |
| `.graphite.yml` | Graphite stack config. |
| `api/cli-contracts/` | JSON CLI contract fixtures. |
| `docs/` | Architecture, audits, contracts, plans, research, ADRs. Subdirs include `solutions/{build-errors,code-quality,integration-issues,logic-errors,security-issues,workflow}`. |
| `examples/` | Example marketplace and plugin manifests used by validators. |
| `packages/{cli,domain,infrastructure}` | TypeScript workspace packages. See §3. |
| `plans/` | Active planning docs and scratch artifacts. |
| `plugins/` | 16 installable plugins (one dir per plugin). See §2. |
| `schemas/` | JSON schemas for marketplace and plugin manifests. |
| `scripts/` | Node-based validation, sync, release, and versioning utilities (`validate-marketplace.js`, `validate-plugin.js`, `validate-setup-all.js`, `validate-agent-authoring.js`, `validate-versions.js`, `sync-manifests.js`, `catalog-version.js`, `check-node-version.js`, `generate-release-notes.js`, `export-ci-metrics.sh`, plus `scripts/ci/`). |
| `tests/integration/` | Vitest integration coverage (currently minimal per `AGENTS.md:33`). |
| `tools/` | Local Node wrappers: `install.cjs`, `lint.cjs`, `run.cjs`, `test.cjs`. |

### Build system / package manager / language

- **Package manager:** `pnpm@8.15.0`, enforced by a `preinstall` hook
  (`package.json:13`: `"preinstall": "node scripts/check-node-version.js && npx only-allow pnpm"`).
- **Workspace:** pnpm workspaces (`pnpm-workspace.yaml:6-12`) with members
  `packages/cli`, `packages/domain`, `packages/infrastructure`, `scripts`,
  `plugins/*`.
- **Node engine:** `>=22.22.0 <25.0.0` (`package.json:8`); pinned to `22.22.0`
  via `.node-version` and `.nvmrc`.
- **Primary language:** TypeScript (strict mode — `tsconfig.base.json:6-22`
  enables `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` and
  related). Module system is `NodeNext` (`tsconfig.base.json:25`).
- **Plugin code:** primarily Markdown frontmatter (commands, agents, skills)
  with shell scripts under `plugins/<name>/{hooks,scripts}/`. Three plugins use
  Bats for shell tests (`AGENTS.md:80-83` lists `yellow-ci`, `yellow-debt`,
  `yellow-review`, `yellow-ruvector`).
- **Lint / format:** ESLint 8 + Prettier 3 (`package.json:42-50`),
  markdownlint via `markdownlint-cli` (`package.json:48`).

### Test framework

- **Vitest 1.2** (`package.json:54`). Unit tests under `packages/`
  (`package.json:17`: `"test:unit": "vitest run --dir packages
  --passWithNoTests"`). Integration under `tests/integration/`
  (`package.json:18`).
- **Bats** for shell/hook coverage in `yellow-ci`, `yellow-debt`,
  `yellow-review`, `yellow-ruvector` per `AGENTS.md:80-83`. Confirmed for
  yellow-ci by directory listing of `plugins/yellow-ci/tests/redaction.bats`.
- Vitest aliases `@yellow-plugins/{cli,domain,infrastructure}` to package
  source roots (`vitest.config.ts:6-15`).

### Marketplace catalog

- `.claude-plugin/marketplace.json:1` declares **16 plugins** (counted via
  `python3 -c "len(d['plugins'])"`). Catalog version `1.1.0`
  (`marketplace.json:9`).

---

## 2. Per-plugin breakdown

Counts for each plugin from `find` over `commands/**/*.md`,
`agents/**/*.md`, `skills/**/SKILL.md`, `hooks/**/*.sh`. Versions and
descriptions taken verbatim from each `.claude-plugin/plugin.json`.

The **Research/web-fetch?** column is the explicit migration-candidate flag
requested for Phase 3. Three values:

- **YES — direct external research consumer.** Plugin invokes external HTTP/
  search/research APIs (Perplexity, Tavily, EXA, Parallel Task) or built-in
  WebSearch/WebFetch.
- **YES — code-context only.** Plugin invokes Context7 docs API — same
  category (LLM-grounded library docs lookup) but more narrowly scoped.
- **AST-grep only.** Plugin consumes `mcp__plugin_yellow-research_ast-grep__*`
  for *local* AST search. Not a web-research consumer; not a Ceramic
  candidate.
- **No.** No external research surface.

### 2.1 yellow-research — **PRIMARY MIGRATION TARGET**

| Field | Value |
|---|---|
| Path | `plugins/yellow-research/` |
| Version | `1.3.0` (`.claude-plugin/plugin.json:3`) |
| Counts | commands=4, agents=2, skills=1, hooks=0 |
| Stated purpose | "Deep research plugin with Perplexity, Tavily, EXA, Parallel Task, and ast-grep MCP servers. Code research inline; deep research saved to docs/research/." (`.claude-plugin/plugin.json:4`) |
| Public surface | Commands `/research:code`, `/research:deep`, `/research:setup`, `/workflows:deepen-plan`. Agents `code-researcher`, `research-conductor`. Skill `research-patterns`. |
| External dependencies | **Five MCP servers** declared in `plugin.json:21-67`: `perplexity` (npx `@perplexity-ai/mcp-server@0.8.2`, env `PERPLEXITY_API_KEY`), `tavily` (npx `tavily-mcp@0.2.17`, env `TAVILY_API_KEY`), `exa` (npx `exa-mcp-server@3.1.8` with `tools=web_search_exa,get_code_context_exa,company_research_exa,web_search_advanced_exa,crawling_exa,deep_researcher_start,deep_researcher_check`, env `EXA_API_KEY`), `parallel` (HTTP `https://task-mcp.parallel.ai/mcp`, OAuth), `ast-grep` (uvx, local AST). |
| Research/web-fetch? | **YES — direct external research consumer.** This is the single biggest migration target: ~16 distinct MCP-tool entry points across `agents/research/research-conductor.md:8-34` and `agents/research/code-researcher.md:8-22`. |

### 2.2 yellow-core

| Field | Value |
|---|---|
| Path | `plugins/yellow-core/` |
| Version | `1.4.1` (`.claude-plugin/plugin.json:3`) |
| Counts | commands=8, agents=13, skills=4, hooks=0 |
| Stated purpose | "Dev toolkit with review agents, research agents, and workflow commands for TypeScript, Python, Rust, and Go" (`.claude-plugin/plugin.json:4`) |
| Public surface | Commands `/workflows:plan`, `/workflows:work`, `/workflows:review`, `/workflows:compound`, `/workflows:brainstorm`, `/setup:all`, `/statusline:setup`, `/worktree:cleanup`. 13 agents — three under `agents/research/` (`best-practices-researcher`, `repo-research-analyst`, `git-history-analyzer`), seven under `agents/review/` (security-sentinel, performance-oracle, polyglot-reviewer, architecture-strategist, code-simplicity-reviewer, pattern-recognition-specialist, test-coverage-analyst), three under `agents/workflow/` (brainstorm-orchestrator, knowledge-compounder, spec-flow-analyzer). Skills: `brainstorming`, `create-agent-skills`, `git-worktree`, `mcp-integration-patterns`. |
| External dependencies | One MCP server: `context7` HTTP at `https://mcp.context7.com/mcp` (`plugin.json:14-17`). |
| Research/web-fetch? | **YES — direct external research consumer.** `agents/research/best-practices-researcher.md:8-14` lists `WebSearch`, `WebFetch`, `mcp__plugin_yellow-core_context7__resolve-library-id`, `mcp__plugin_yellow-core_context7__query-docs`. The other two research agents (`repo-research-analyst.md:8-12`, `git-history-analyzer.md:8-12`) are pure-local (Read/Grep/Glob/Bash only) — not migration candidates. |

### 2.3 yellow-devin

| Field | Value |
|---|---|
| Path | `plugins/yellow-devin/` |
| Version | `2.1.0` (`.claude-plugin/plugin.json:3`) |
| Counts | commands=10, agents=1, skills=1, hooks=0 |
| Stated purpose | "Devin.AI V3 API integration — delegate tasks, manage sessions, review and remediate PRs, research codebases via DeepWiki, orchestrate plan-implement-review chains" |
| Public surface | Commands under `/devin:*` — `delegate`, `status`, `message`, `cancel`, `archive`, `tag`, `wiki`, `review-prs`, `setup`, `README` reference. One agent: `devin-orchestrator`. Skill: `devin-workflows`. |
| External dependencies | Two MCP servers: `deepwiki` and `devin` (Devin V3 API). |
| Research/web-fetch? | **No (specialized).** DeepWiki is repo-targeted Q&A — different domain from Ceramic.ai's web/document search. The orchestrator agent (`agents/workflow/devin-orchestrator.md:7-13`) lists only `Bash, Read, Grep, Glob, AskUserQuestion, Task` — no web tools. Not a migration candidate, but Phase 3 should mention DeepWiki as a non-overlapping alternative for repo-scoped questions. |

### 2.4 yellow-codex

| Field | Value |
|---|---|
| Path | `plugins/yellow-codex/` |
| Version | `0.1.0` (`.claude-plugin/plugin.json:3`) |
| Counts | commands=4, agents=3, skills=1, hooks=0 |
| Stated purpose | "OpenAI Codex CLI wrapper with review, rescue, and analysis agents for workflow integration" |
| Public surface | Commands `/codex:setup`, `/codex:review`, `/codex:rescue`, `/codex:status`. Agents `codex-analyst` (research), `codex-executor` (rescue), `codex-reviewer` (review). Skill `codex-patterns`. |
| External dependencies | OpenAI Codex CLI (local binary). |
| Research/web-fetch? | **No.** All three agents have `tools: Bash, Read, Grep, Glob` only (`codex-analyst.md:5-9`, `codex-executor.md:5-9`, `codex-reviewer.md:5-9`). The "research" the analyst does is a `codex exec` call against the local codebase — not external web research. |

### 2.5 yellow-debt

| Field | Value |
|---|---|
| Path | `plugins/yellow-debt/` |
| Version | `1.2.0` |
| Counts | commands=6, agents=7, skills=1, hooks=1 |
| Stated purpose | "Technical debt audit and remediation with parallel scanner agents" |
| Public surface | Commands `/debt:audit`, `/debt:fix`, `/debt:status`, `/debt:sync`, `/debt:triage`, `/debt:setup`. Seven scanner agents under `agents/scanners/` (ai-pattern, architecture, complexity, duplication, security-debt) + `synthesis/audit-synthesizer` + `remediation/debt-fixer`. SessionStart hook. |
| External dependencies | Local-only. |
| Research/web-fetch? | **AST-grep only.** `complexity-scanner.md:15-17` and `duplication-scanner.md:15-17` declare `mcp__plugin_yellow-research_ast-grep__find_code`, `find_code_by_rule`, `dump_syntax_tree`. These are local AST search tools, not external research. Not a migration candidate. Note the soft cross-plugin dep on `yellow-research` for the bundled ast-grep MCP. |

### 2.6 yellow-review

| Field | Value |
|---|---|
| Path | `plugins/yellow-review/` |
| Version | `1.2.0` |
| Counts | commands=4, agents=7, skills=1, hooks=0 |
| Stated purpose | "Multi-agent PR review with adaptive agent selection, parallel comment resolution, and sequential stack review" |
| Public surface | Commands `/review:pr` (a.k.a. `review-pr`), `/review:stack` (`review-all`), `/review:resolve`, `/review:setup`. Seven review agents (code-reviewer, code-simplifier, comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, pr-comment-resolver). |
| External dependencies | None declared in `plugin.json` (no `mcpServers`). |
| Research/web-fetch? | **AST-grep only.** `silent-failure-hunter.md:12-13`, `type-design-analyzer.md:12-13` reference the same yellow-research bundled ast-grep tools. Not a migration candidate. |

### 2.7 yellow-docs

| Field | Value |
|---|---|
| Path | `plugins/yellow-docs/` |
| Version | `1.1.0` |
| Counts | commands=5, agents=3, skills=1, hooks=0 |
| Stated purpose | "Documentation audit, generation, and Mermaid diagram creation for any repository" |
| Public surface | Commands `/docs:audit`, `/docs:generate`, `/docs:diagram`, `/docs:refresh`, `/docs:setup`. Agents `doc-auditor`, `doc-generator`, `diagram-architect`. Skill `docs-conventions`. |
| External dependencies | Local-only. |
| Research/web-fetch? | **No.** All three agents declare `tools: Read, Glob, Grep, Bash` plus `Write/Edit/AskUserQuestion` for the generators (`doc-generator.md:8-15`, `diagram-architect.md:8-15`, `doc-auditor.md:7-11`). |

### 2.8 yellow-ruvector

| Field | Value |
|---|---|
| Path | `plugins/yellow-ruvector/` |
| Version | `1.1.2` |
| Counts | commands=6, agents=2, skills=3, hooks=6 |
| Stated purpose | "Persistent vector memory and semantic code search for Claude Code agents via ruvector" |
| Public surface | Commands `/ruvector:{search,index,status,learn,memory,setup}`. Two agents under `agents/ruvector/`. Skills `ruvector-conventions`, `agent-learning`, `memory-query`. Five hook events declared (`plugin.json` declares `PreToolUse`, `UserPromptSubmit`, `SessionStart`, `PostToolUse`, `Stop`). |
| External dependencies | Bundled `ruvector` MCP server (npx) + env `RUVECTOR_*`. Local SQLite DB at `ruvector.db`. |
| Research/web-fetch? | **No.** Vector search is a local code-similarity tool, not external web research. (Phase 3 may consider it as a *complementary* source — local semantic search + Ceramic web search — but the migration is not about replacing it.) |

### 2.9 yellow-ci

| Field | Value |
|---|---|
| Path | `plugins/yellow-ci/` |
| Version | `1.2.0` |
| Counts | commands=9, agents=4, skills=2, hooks=4 |
| Stated purpose | "CI failure diagnosis, workflow linting, and runner health management for self-hosted GitHub Actions runners" |
| Public surface | Commands `/ci:setup`, `/ci:status`, `/ci:diagnose`, `/ci:lint-workflows`, `/ci:report-linear`, `/ci:runner-health`, `/ci:setup-runner-targets`, `/ci:setup-self-hosted`. Agents `failure-analyst`, `workflow-optimizer`, `runner-assignment`, `runner-diagnostics`. Skills `ci-conventions`, `diagnose-ci`. SessionStart hook. |
| External dependencies | `gh` CLI, SSH for self-hosted runner checks. |
| Research/web-fetch? | **No.** GitHub Actions API access via `gh`, no web research. |

### 2.10 yellow-linear

| Field | Value |
|---|---|
| Path | `plugins/yellow-linear/` |
| Version | `1.3.0` |
| Counts | commands=9, agents=3, skills=1, hooks=0 |
| Stated purpose | "Linear MCP integration with PM workflows for issues, projects, initiatives, cycles, and documents" |
| Public surface | Commands under `/linear:*` (sync, create, status, work, triage, plan-cycle, sync-all, delegate, setup). Three agents. |
| External dependencies | Top-level `mcpServers.linear` — Linear MCP. |
| Research/web-fetch? | **No.** Project-management automation, not research. |

### 2.11 yellow-chatprd

| Field | Value |
|---|---|
| Path | `plugins/yellow-chatprd/` |
| Version | `1.3.0` |
| Counts | commands=6, agents=4, skills=1, hooks=0 |
| Stated purpose | "ChatPRD MCP integration with document management workflows and Linear bridging for Claude Code" |
| Public surface | Commands `/chatprd:{create,search,update,list,link-linear,setup}`. Four workflow agents. Skill `chatprd-conventions`. |
| External dependencies | `chatprd` MCP server. |
| Research/web-fetch? | **No.** Product-doc storage/retrieval against ChatPRD — different domain. |

### 2.12 yellow-semgrep

| Field | Value |
|---|---|
| Path | `plugins/yellow-semgrep/` |
| Version | `2.0.0` |
| Counts | commands=5, agents=2, skills=1, hooks=0 |
| Stated purpose | "Semgrep security finding remediation — fetch, fix, and verify 'to fix' findings from the Semgrep AppSec Platform" |
| Public surface | Commands `/semgrep:{setup,scan,status,fix,fix-batch}`. Agents `finding-fixer`, `scan-verifier`. Skill `semgrep-conventions`. |
| External dependencies | `semgrep` MCP, env `SEMGREP_APP_TOKEN`. |
| Research/web-fetch? | **No.** Security-finding remediation, not research. |

### 2.13 yellow-morph

| Field | Value |
|---|---|
| Path | `plugins/yellow-morph/` |
| Version | `1.0.0` |
| Counts | commands=2, agents=0, skills=0, hooks=0 |
| Stated purpose | "Intelligent code editing and search via Morph Fast Apply and WarpGrep" |
| Public surface | Commands `/morph:setup`, `/morph:status`. |
| External dependencies | `morph` MCP, env `MORPH_API_KEY`. |
| Research/web-fetch? | **No.** Local code-edit accelerator. |

### 2.14 yellow-composio

| Field | Value |
|---|---|
| Path | `plugins/yellow-composio/` |
| Version | `1.0.0` |
| Counts | commands=2, agents=0, skills=1, hooks=0 |
| Stated purpose | "Optional Composio accelerator for batch workflows with usage tracking" |
| Public surface | Commands `/composio:setup`, `/composio:status`. Skill `composio-patterns`. |
| External dependencies | None declared. |
| Research/web-fetch? | **No.** Composio is a multi-tool bus for batch workflows; the plugin itself does not call research APIs. |

### 2.15 yellow-browser-test

| Field | Value |
|---|---|
| Path | `plugins/yellow-browser-test/` |
| Version | `1.1.0` |
| Counts | commands=4, agents=3, skills=2, hooks=0 |
| Stated purpose | "Autonomous web app testing with agent-browser — auto-discovery, structured flows, exploratory testing, and bug reporting" |
| Public surface | Commands `/browser-test:{setup,test,explore,report}`. Agents `app-discoverer`, `test-runner`, `test-reporter`. Skills `agent-browser-patterns`, `test-conventions`. |
| External dependencies | Local `agent-browser` binary. |
| Research/web-fetch? | **No.** Browser automation against the user's *own* web app — different category from web research. |

### 2.16 gt-workflow

| Field | Value |
|---|---|
| Path | `plugins/gt-workflow/` |
| Version | `1.3.0` |
| Counts | commands=7, agents=0, skills=0, hooks=2 |
| Stated purpose | "Graphite-native workflow commands for stacked PR development. Provides smart commit-and-submit with parallel audit agents, stack planning, sync, and navigation — all through the gt CLI." |
| Public surface | Commands `/gt-amend`, `/gt-cleanup`, `/gt-nav`, `/gt-setup`, `/gt-stack-plan`, `/gt-sync`, `/smart-submit`. PreToolUse + PostToolUse hooks. |
| External dependencies | `gt` CLI, `graphite` MCP. |
| Research/web-fetch? | **No.** Branch/PR workflow tooling. |

### Summary table — migration candidates

| Plugin | Migration class | Where calls live | Notes |
|---|---|---|---|
| **yellow-research** | **Primary** | `agents/research/{code-researcher,research-conductor}.md`; tools list at lines 8-22 / 8-34 respectively. Endpoints surface in `commands/research/setup.md:200-260` (Step 3 probes hit `https://api.exa.ai/search`, `https://api.tavily.com/search`, `https://api.perplexity.ai/chat/completions`). | All access via 5 MCP servers in `plugin.json:21-67`. |
| **yellow-core** | **Secondary** | `agents/research/best-practices-researcher.md:8-14` — uses built-in `WebSearch`/`WebFetch` + Context7 MCP. | Migrating this means swapping `WebSearch`/`WebFetch` calls for Ceramic. Context7 stays (different domain — official library docs). |
| All other plugins | None | n/a | yellow-debt and yellow-review *consume* the bundled ast-grep MCP from yellow-research — out of scope. yellow-devin owns DeepWiki — out of scope. |

---

## 3. Cross-cutting concerns

### 3.1 TypeScript packages (`packages/`)

Three workspace packages, all `private: true`, all version `2.0.0`:

- `packages/domain/` — types and error catalog
  (`packages/domain/src/validation/{errorCatalog,types,index}.ts`).
- `packages/infrastructure/` — AJV-based schema validation
  (`packages/infrastructure/src/validation/{ajvFactory,validator,validator.test}.ts`,
  with a README at `packages/infrastructure/src/validation/README.md`).
- `packages/cli/` — CLI validator binary `yellow-validate`
  (`packages/cli/package.json:9-11`, single source file `src/index.ts`).

Layered dependency direction enforced by `AGENTS.md:75-77`:
> `domain` must not depend on `infrastructure` or `cli`; `infrastructure` must
> not depend on `cli`.

**Important for Phase 3:** there is **no shared HTTP client utility in
`packages/`**. The packages exist solely for plugin-manifest validation.
Adding a Ceramic client here would be the first non-validation utility.
Phase 3 must decide: new package (`@yellow-plugins/ceramic`?) or per-plugin
script.

### 3.2 Plugin auto-discovery

Per `AGENTS.md:5-12` and confirmed by listing
`find plugins -maxdepth 3 -name plugin.json`:

- Every plugin has `.claude-plugin/plugin.json` as its manifest. All 16
  plugins followed this — none use a top-level `plugin.json`.
- Each plugin is mostly Markdown: `commands/<group>/<name>.md`,
  `agents/<group>/<name>.md`, `skills/<name>/SKILL.md`, optional
  `hooks/scripts/*.sh`, optional `tests/*.bats`.

### 3.3 Secrets handling pattern

- Env vars are referenced from `mcpServers.<name>.env` in `plugin.json` via
  `${VAR}` interpolation. Confirmed in:
  - `plugins/yellow-research/.claude-plugin/plugin.json:29-31`
    (`PERPLEXITY_API_KEY`, `PERPLEXITY_TIMEOUT_MS`),
    `:40-42` (`TAVILY_API_KEY`),
    `:51-53` (`EXA_API_KEY`).
  - `plugins/yellow-morph/.claude-plugin/plugin.json:17` (`MORPH_API_KEY`).
  - `plugins/yellow-semgrep/.claude-plugin/plugin.json:25-27`
    (`SEMGREP_APP_TOKEN`).
  - `plugins/yellow-ruvector/.claude-plugin/plugin.json:21-29`
    (RUVECTOR_*).
- `AGENTS.md:99-103` lists `PERPLEXITY_API_KEY`, `TAVILY_API_KEY`,
  `EXA_API_KEY`, `DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID` explicitly as
  "never commit". Adding `CERAMIC_API_KEY` to this list will be a Phase 3
  doc change.
- API-key documentation pattern: each plugin's `CLAUDE.md` documents its
  required env vars. Confirmed via `grep -lE '^export [A-Z_]+_API_KEY'
  plugins/*/CLAUDE.md` — match in
  `plugins/yellow-research/CLAUDE.md:export EXA_API_KEY="..."`,
  `:export TAVILY_API_KEY="..."`,
  `:export PERPLEXITY_API_KEY="..."`.
- The `/<plugin>:setup` command convention (15 of 16 plugins have one — see
  `find plugins -name 'setup.md' -path '*/commands/*'`) provides a uniform UX
  for env-var validation, format check, optional live probe.

### 3.4 Logging convention (shell/hooks)

From `CLAUDE.md` memory + spot-checks:

- All hook output goes to stderr with a `[component] message\n` prefix.
  Example: `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh:15`:
  `printf '[validate] Warning: cd+pwd canonicalization failed, ...\n' >&2`.
- SessionStart hooks must always end with `printf '{"continue": true}\n'`
  even on error paths — enforced lesson from PRs #72/#73 (recorded in
  global `MEMORY.md`).
- Three plugins ship a sourced `lib/validate.sh`:
  `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh`,
  `plugins/yellow-ci/hooks/scripts/lib/validate.sh`,
  `plugins/yellow-debt/lib/validate.sh`. Each is currently
  copy-paste-divergent (no shared module).

### 3.5 MCP server delivery patterns

Three patterns in use (counted across all `mcpServers` in plugin manifests):

- **`npx -y <package>@<version>`** (stdio): yellow-research perplexity,
  tavily, exa; yellow-morph; yellow-ruvector; (per memory) others.
- **`uvx --python 3.13 ...`** (stdio): yellow-research ast-grep
  (`plugin.json:60-65`).
- **`type: http`**: yellow-core context7 (`plugin.json:14-17`),
  yellow-research parallel (`plugin.json:55-57`).

The Phase 3 client design will need to pick one of these packaging patterns
or fall through to a direct `curl`/`fetch` since `/search` is a single
HTTP endpoint.

### 3.6 Validation tooling enforced before merge

`package.json:19-26` exposes:

- `pnpm validate:schemas` — runs `validate-marketplace`,
  `validate-plugin`, `validate-setup-all`, `validate-agent-authoring`.
- `pnpm validate:setup-all` — checks that `yellow-core/commands/setup/all.md`
  matches the marketplace catalog. **Adding any plugin or changing the env-var
  story will require updating this.**
- `pnpm validate:versions` — version consistency between `package.json`,
  `plugin.json`, `marketplace.json`.

### 3.7 Frontmatter authoring rules

`AGENTS.md:113-141` lists seven mandatory rules for agent/command markdown,
all enforced by `validate-agent-authoring.js`:

1. Content fencing of untrusted input.
2. No credentials in output (use `--- redacted credential at line N ---`).
3. Skill preloading via frontmatter `skills:`.
4. MCP tool name qualification: `mcp__plugin_{plugin}_{server}__{tool}`.
5. Agent frontmatter uses `tools:`, NOT `allowed-tools:` (commands use the
   latter — yellow-research `commands/research/code.md:6` confirms).
6. `subagent_type` references must resolve to a declared
   `plugin-name:agent-name`.
7. No `BASH_SOURCE` in command markdown — use `${CLAUDE_PLUGIN_ROOT}` or
   concrete script path.

These constraints will shape how a Ceramic client is exposed to agents
(MCP tool name conventions in particular).

---

## 4. Gaps observed (logged, not fixed)

These are observations about the existing code/docs. None should be addressed
during this Ceramic integration. Logging only.

1. **Multi-line description anti-pattern in `yellow-research/skills/research-patterns/SKILL.md:4`.** The frontmatter uses

   ```yaml
   description:
     Reference conventions for yellow-research plugin — slug naming, ...
   ```

   This is the multi-line bare style flagged in the global `MEMORY.md` (`Plugin Authoring Quality Rules` → `Skill and agent descriptions: must be single-line`). Per the recorded lesson, multi-line forms can be silently truncated by Claude Code's frontmatter parser. **Confirmed via `awk 'NR<=10'`** — the value spans lines 4–7. Fix is out of scope for this task.

2. **Cross-plugin tool dependency leakage from `yellow-research/agents/research/code-researcher.md:13-14`.** The code-researcher agent declares `mcp__plugin_yellow-core_context7__resolve-library-id` and `mcp__plugin_yellow-core_context7__query-docs` in its `tools:` block — meaning yellow-research has a hard runtime dependency on yellow-core being installed. This is documented but not advertised in the plugin's `description` field. Phase 3 should not entangle Ceramic with this dependency direction further.

3. **`code-researcher` body says "Never use Parallel Task or Tavily"** (`code-researcher.md:97`) but the agent's `tools:` block at `:8-22` does not declare those tools either, so the prose is reinforcing what the schema already forbids — not contradicting it. Defensive but borderline redundant.

4. **No shared HTTP client utility in `packages/`.** Three plugins independently spawn MCP servers via `npx`/`uvx`; no shared TypeScript module exists for direct API calls. Phase 3 needs a deliberate decision: introduce `@yellow-plugins/<something>` or rely on a bundled MCP server.

5. **`docs/research/` directory is referenced everywhere but not enforced.** `commands/research/deep.md:46-49` creates it on demand; nothing in CI guarantees it exists. Not a bug — just a convention rather than a contract.

6. **`yellow-research/CLAUDE.md` describes graceful degradation for missing API keys but the runtime degradation is the agent's own logic, not enforced anywhere.** Means a malformed key (e.g., `pplx-` prefix passing format check but rejected by the API at runtime) results in a per-tool failure rather than a startup-time block. Acceptable but worth knowing — the same pattern will apply to Ceramic.

7. **`tests/integration/` is empty.** Per `AGENTS.md:33` — "currently minimal". So the existing repo has no integration-test pattern for the new client to follow. Phase 4 will need to create one rather than extend.

8. **Mixed deferred-tool surface.** Agents that consume MCP tools must use `ToolSearch` to verify the names at runtime (per `agents/research/code-researcher.md:55-61`). This is a strong convention — any new Ceramic MCP/tool name must work the same way to fit the existing UX.

9. **No "research" entry in `setup-all` summary classification.** `validate-setup-all.js` enforces alignment between `yellow-core/commands/setup/all.md` and `marketplace.json`. If a Ceramic key joins the env-var family, both files must be updated atomically.

---

## Phase 1 conclusions for Phase 2/3 framing

1. The migration's "blast radius" is **two plugins**: yellow-research (heavy,
   ~16 tool entry points across 2 agents and 4 commands) and yellow-core
   (light, 1 agent uses WebSearch/WebFetch + Context7).
2. Every other plugin either uses local AST/grep tools, talks to a non-search
   MCP (Linear, Devin, ChatPRD, Semgrep, Morph), or doesn't research at all.
3. The repo already has a strong `mcpServers.<name>.env` injection convention
   and a per-plugin `<plugin>:setup` UX. **Whatever Ceramic integration looks
   like, it must fit those two patterns** — not invent a new config story.
4. There is **no existing shared HTTP client** to extend. Phase 3 must decide
   whether to add one or to ship a Ceramic MCP server in the same npx style as
   the other research providers.
5. Frontmatter, `tools:`, validate-setup-all, and the marketplace catalog
   are all schema-validated. A Ceramic-related env-var addition or new MCP
   server will require coordinated updates across `marketplace.json`,
   each affected `plugin.json`, the relevant `<plugin>/CLAUDE.md`, and
   `plugins/yellow-core/commands/setup/all.md`.
