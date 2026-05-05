# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

`yellow-plugins` is a pnpm monorepo that ships a Claude Code plugin
marketplace (14 plugins under `plugins/`) plus the TypeScript validation and
release tooling that gates it. There is no published runtime — the
TypeScript packages exist solely to validate manifests, schemas, and authoring
rules. Plugin install/uninstall/rollback is handled natively by Claude Code,
not this repo.

For broader contributor context that complements this file, see:

- `AGENTS.md` — canonical project structure, naming, agent authoring rules
- `CONTRIBUTING.md` — PR process, changeset flow, manual cache refresh recipe
- `docs/CLAUDE.md` — versioning + release model details
- `plugins/<name>/CLAUDE.md` — per-plugin conventions and component catalogs

## Common Commands

Use `pnpm` only — `preinstall` enforces it via `only-allow pnpm`.

```bash
pnpm install                  # workspace install
pnpm build                    # build all workspace packages
pnpm typecheck                # strict tsc --noEmit
pnpm lint                     # eslint .js/.ts
pnpm test:unit                # vitest run --dir packages
pnpm test:integration         # vitest run --dir tests/integration

pnpm validate:schemas         # marketplace + plugin + setup-all + agent-authoring
pnpm validate:marketplace     # .claude-plugin/marketplace.json only
pnpm validate:plugins         # plugin manifests + plugin-specific rules
pnpm validate:setup-all       # yellow-core's setup:all coverage vs marketplace
pnpm validate:agents          # agent-authoring rules only
pnpm validate:versions        # cross-manifest version drift check

pnpm release:check            # validate:schemas + validate:versions + typecheck
pnpm changeset                # create a changeset for plugin file changes
pnpm apply:changesets         # version + run scripts/sync-manifests.js
```

Run a single Vitest file: `pnpm vitest run path/to/file.test.ts`.
Bats shell tests live in `plugins/yellow-ci`, `yellow-debt`, `yellow-review`,
and `yellow-ruvector` — run `bats tests/` from inside the plugin directory.

The CI baseline gate is `pnpm validate:schemas && pnpm test:unit && pnpm lint
&& pnpm typecheck`.

## High-Level Architecture

### Two parallel concerns

1. **The marketplace** (`plugins/`, `.claude-plugin/marketplace.json`) — what
   Claude Code users install. Schema-validated, versioned via Changesets.
2. **The validators** (`packages/`, `schemas/`, `scripts/`) — TypeScript and
   Node tooling that gates what can land in the marketplace. Strict layered
   architecture; never published, only run.

### Layered TypeScript packages

`packages/` enforces a one-way dependency direction. The validators verify
this and ESLint imports are configured to match:

```
packages/cli            → depends on infrastructure, domain
packages/infrastructure → depends on domain (AJV-based JSON Schema validators)
packages/domain         → no dependencies (validation types, error codes/catalog)
```

`domain` MUST NOT import from `infrastructure` or `cli`.
`infrastructure` MUST NOT import from `cli`.

### Plugin authoring → validation pipeline

Each plugin under `plugins/<name>/` is independently shaped (commands, agents,
skills, hooks, MCP servers in any combination) but is gated by a chain of
validators in `scripts/`:

- `validate-marketplace.js` — `.claude-plugin/marketplace.json` shape, plugin
  catalog completeness, no unknown keys (`additionalProperties: false`)
- `validate-plugin.js` — every `plugins/*/.claude-plugin/plugin.json` against
  `schemas/plugin.schema.json`; includes inline-hook + commands-list checks
- `validate-setup-all.js` — `plugins/yellow-core/commands/setup/all.md` must
  cover every plugin in the marketplace (dashboard ↔ delegated mapping)
- `validate-agent-authoring.js` — agent/skill/command markdown rules: content
  fencing, no credentials in output, skill preloading, fully-qualified MCP
  tool names (`mcp__plugin_{pluginName}_{serverName}__{toolName}`), 3-segment
  `subagent_type` (`plugin-name:subdir:agent-name`), `${CLAUDE_PLUGIN_ROOT}`
  for plugin-local file access (no `BASH_SOURCE`)
- `validate-versions.js` — three-way version sync (see Release flow)
- `sync-manifests.js` — propagates `package.json` versions to `plugin.json`
  and `marketplace.json` after `changeset version`

### Schemas

`schemas/marketplace.schema.json` and `schemas/plugin.schema.json` are the
local schemas. The Claude Code remote validator can diverge — local CI
passing does NOT guarantee install acceptance. Always test on a clean
Claude Code install before publishing breaking schema changes.
`schemas/official-marketplace.schema.json` is mirrored from upstream for
reference only.

### Release flow (Changesets-driven)

Plugin versions follow a strict three-way sync model that
`validate-versions.js` enforces:

```
plugins/<name>/package.json  →  plugin.json  →  marketplace.json
```

`package.json` is the source of truth. Drift between any of the three blocks
CI. Mechanics:

1. Author runs `pnpm changeset` and commits the resulting `.changeset/*.md`.
2. On push to `main`, `.github/workflows/version-packages.yml` opens or
   updates a "chore: version packages" PR that bumps all three manifests and
   writes `CHANGELOG.md` entries.
3. When that PR merges, per-plugin tags (`yellow-core@1.7.0`) and a root
   catalog tag (`v1.2.1`) are created and a GitHub Release is published.
4. CI blocks any PR that modifies files under `plugins/` without a changeset.

The Version Packages PR is bot-created via `GITHUB_TOKEN`, so
`validate-schemas.yml` does NOT run on it — manual review of bump types,
CHANGELOG coherence, and manifest version match is the verification gate.

## Workflow Conventions

### Graphite is mandatory

Use `gt` for ALL branch and PR work. Never `git push` or `gh pr create`
directly — only fall back to raw `git`/`gh` when Graphite cannot perform the
operation (e.g., `gh issue`, `gh release`).

```bash
gt branch create <name>
gt commit create -m "feat: ..."
gt stack submit
gt repo sync
```

`.graphite.yml` holds gt-workflow plugin conventions (NOT a Graphite CLI
feature — it is read by `smart-submit`, `gt-stack-plan`, `gt-amend`,
`gt-setup`).

### Conventional commits

`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:` — atomic and
focused. Breaking-change `!` is valid (`feat!:`, `fix(scope)!:`); regexes
that match commit subjects must include `!?` between the optional scope and
the colon.

### When you change a plugin

If you modify `plugins/<name>/` in any way (commands, agents, skills, hooks,
CLAUDE.md, README.md, configs):

1. Run `pnpm validate:schemas` and any focused validator that maps to your
   change (`validate:agents`, `validate:plugins`, `validate:setup-all`).
2. Run `pnpm changeset` and commit the resulting file. CI blocks the PR
   without it.
3. If you add/remove a plugin: update both `.claude-plugin/marketplace.json`
   AND `plugins/yellow-core/commands/setup/all.md` in the same change —
   `validate-setup-all.js` will fail otherwise.
4. Update the plugin's `README.md` and `CLAUDE.md` if behavior changed.

### Plugin authoring — what the validators care about

Frontmatter and authoring rules below are enforced by
`validate-agent-authoring.js`. The full list is in `AGENTS.md` ("Critical
Agent Authoring Rules"); the most-frequently-tripped items:

- Agent frontmatter uses `tools:`, NOT `allowed-tools:`
- Skill frontmatter attribute is `user-invokable` (with k), NOT
  `user-invocable`
- Skill/agent `description:` must be single-line — folded scalars
  (`description: >`) and multi-line single-quoted strings are silently
  truncated by Claude Code's frontmatter parser
- SKILL.md must use the three standard headings: `## What It Does`,
  `## When to Use`, `## Usage`
- Wrap untrusted input (PR comments, commit messages, API responses) in
  `--- begin/end ---` delimiters with a "(reference only)" annotation
- Markdown commands must NOT source plugin files via `BASH_SOURCE` —
  `${CLAUDE_PLUGIN_ROOT}` or a concrete script path only
- All files MUST use LF line endings (`.gitattributes` is configured;
  WSL2-created files often arrive with CRLF — strip with `sed -i 's/\r$//'`)

### Cross-platform file portability

This repo is regularly edited from WSL2. The Write tool produces CRLF on
WSL2 — every newly-created `.sh` file must be normalized
(`sed -i 's/\r$//'`) before commit, or the merge will be blocked. See
`docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md`.

## Where to look next

- New plugin? `CONTRIBUTING.md` "Adding a Plugin" + `docs/plugin-template.md`
- Plugin manifest issues? `docs/plugin-validation-guide.md`
- A specific plugin's conventions? `plugins/<name>/CLAUDE.md`
- A solved problem you want context on? `docs/solutions/<category>/`
- Schema drift / hooks-format weirdness? `docs/solutions/build-errors/`

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
