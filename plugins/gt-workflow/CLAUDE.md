# gt-workflow Plugin

Graphite-native workflow commands for stacked PR development.

## MCP Server

- **Graphite** — Bundled stdio server via `gt mcp` (requires gt CLI v1.6.7+)
- Declared in `.mcp.json` at the plugin root (shared by both hosts) —
  `plugin.json`'s `mcpServers` field points at `"./.mcp.json"` rather than
  inlining the server def, so Claude and Codex read one declaration
- Authentication: Inherited from `gt` CLI auth — no separate token required
- Tool prefix: `mcp__plugin_gt-workflow_graphite__`
- Tool names must be discovered empirically via ToolSearch after installation
- If `gt` is not installed or is below v1.6.7, the server silently fails to
  start and graphite MCP tools are simply unavailable — run `/gt-setup` to
  diagnose

## Namespace exception

The seven commands shipped by gt-workflow (`gt-amend`, `gt-sync`, `gt-nav`,
`gt-stack-plan`, `gt-cleanup`, `gt-setup`, `smart-submit`) are
**un-namespaced** — they do NOT carry the `namespace:verb` prefix that
later marketplace conventions adopted (where `namespace` is the
`commands/<namespace>/` directory the file ships under, producing forms
like `/ci:diagnose` or `/review:plan`). This is intentional, not a bug:

1. **Historical:** these commands predate the `namespace:verb`
   namespacing convention and shipped under their bare names.
2. **Low collision risk:** six of the seven are `gt-`-prefixed and no other
   marketplace plugin would plausibly register them. `smart-submit` is the
   only generic name; no observed competing plugin ships it.
3. **No re-flagging without a trigger:** future contributors and auditors
   should not propose renaming these commands without a concrete trigger —
   either an actual collision in the marketplace or an incoming plugin that
   would clash. Theoretical collision concerns alone are not sufficient
   justification for the rename churn across user habits, documentation,
   and external references.

If a real collision arises, the migration path is to relocate the files
under `commands/gt/` (yielding `/gt:amend`, `/gt:nav`, etc.) and
dual-publish under both the new `gt:<verb>` and the bare `<name>` for
one minor release, then remove the bare form in the next major.

## Conventions

- **ALWAYS** use `gt` (Graphite CLI) for branch management, commits, and PR
  submission
- **NEVER** use raw `git push` or `gh pr create` — Graphite manages the stack
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Keep commits atomic and focused — one concern per PR in a stack

## Key `gt` Commands

| Command                      | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `gt create <name> -m "msg"`  | Create a new branch (stacks on current) |
| `gt modify -m "msg"`         | Update the current branch's default commit (preferred) |
| `gt modify --commit -m "msg"` | Add an extra commit to the current branch when intentional |
| `gt commit create -m "msg"`  | Add a commit (deprecated, use `gt modify --commit`) |
| `gt commit amend -m "msg"`   | Amend the current branch commit         |
| `gt submit --no-interactive` | Push stack and create/update PRs        |
| `gt sync`                    | Fetch trunk, detect merged branches     |
| `gt stack restack`           | Rebase stack on latest trunk            |
| `gt log` / `gt log short`    | Visualize the stack                     |
| `gt up` / `gt down`          | Navigate up/down the stack              |
| `gt top` / `gt bottom`       | Jump to top/bottom of stack             |
| `gt trunk`                   | Show trunk branch name                  |
| `gt checkout <name>`         | Switch to a branch                      |
| `gt pr`                      | Show PR link for current branch         |
| `gt continue`                | Continue after resolving conflicts      |
| `gt delete <name>`           | Delete branch + Graphite metadata       |
| `gt get <branch>`            | Sync branches from remote to given branch |

## Plugin Commands

Each command below is a thin wrapper (`commands/<name>.md`) that invokes a
same-named canonical skill (`skills/<name>/SKILL.md`) via the `Skill` tool —
the shell-03 wrapper idiom (see
`plugins/yellow-core/commands/plan/status.md` for the precedent this repo's
RULE 17 validator checks against). The skill body is the actual
implementation and is what both Claude (via the command) and Codex (skill
invoked directly, no command layer) execute.

- `/gt-setup` — validate Graphite CLI, configure AI agent settings, generate `.graphite.yml` convention file
- `/smart-submit` — Audit + commit + submit in one flow
- `/gt-amend` — Audit + amend current branch commit + re-submit (quick fix path)
- `/gt-stack-plan` — Decompose a feature into stacked PRs (plan-only, no branch creation)
- `/gt-cleanup` — Scan branches for staleness and divergence, clean up or
  reconcile; optionally offers worktree cleanup via yellow-core
- `/gt-sync` — Sync repo, restack, clean up
- `/gt-nav` — Visualize and navigate the stack

Three additional skills exist with no command wrapper (Claude Code reaches
them only via cross-references from the seven skills above, or the `Skill`
tool directly; Codex reaches all ten identically since it has no command
layer):

- `audit-review` — the `quick-code-review`/`quick-security-scan`/
  `quick-error-check` audit prompts, consolidated out of `smart-submit` and
  `gt-amend` so both invoke one shared implementation
- `stack-decomposition-format` / `stack-plan-style` — cross-host copies of
  the two `output-styles/*.md` files (Codex has no `outputStyles` manifest
  field), referenced by `gt-stack-plan`

## Submit Paths

- **`/smart-submit`** — Ad-hoc commit+submit for working changes. Runs 1-3
  audit agents (configurable via `audit.agents` in `.graphite.yml`, default 3),
  generates conventional commit, submits via Graphite. Use when committing
  standalone changes outside a plan.
- **`/workflows:work`** (yellow-core) — Plan-driven implementation. Delegates to
  `/smart-submit` in its final phase. Use when executing a structured plan from
  `/workflows:plan`.

Both paths use `gt submit --no-interactive` for submission. Both read
`.graphite.yml` for repo-level behavior overrides (draft mode, audit agent
count, skip-on-draft, branch prefix, merge-when-ready, restack-before).

## Convention File: `.graphite.yml`

A gt-workflow convention file committed to the repo root. **This is NOT a
Graphite CLI feature** — it is read only by gt-workflow plugin commands.
Generated by `/gt-setup` Phase 3.

### Schema

```yaml
submit:
  draft: false              # Submit PRs as draft (default: false)
  merge_when_ready: false   # Auto-merge when CI passes (default: false)
  restack_before: true      # Restack before every submit (default: true)

audit:
  agents: 3                 # Parallel audit agents, 1-3 (default: 3)
  skip_on_draft: false      # Skip audit when submitting as draft (default: false)

branch:
  prefix: ""                # Prepended to branch names (default: "")
                            # Repo-level; overrides gt user branch-prefix when non-empty

pr_template:
  create: true              # Whether gt-setup creates PR template (default: true)
```

### Consumer Commands

| Key | Read by |
| --- | ------- |
| `submit.draft` | `/smart-submit`, `/gt-amend` |
| `submit.merge_when_ready` | `/smart-submit` |
| `submit.restack_before` | `/smart-submit` |
| `audit.agents` | `/smart-submit`, `/gt-amend` |
| `audit.skip_on_draft` | `/smart-submit`, `/gt-amend` |
| `branch.prefix` | `/smart-submit`, `/gt-stack-plan` |
| `pr_template.create` | `/gt-setup` (Phase 3 only) |

### Parsing

Consumer commands parse `.graphite.yml` using `yq` (kislyuk variant). When `yq`
is absent or the file does not exist, commands fall back to hardcoded defaults.
When `.graphite.yml` exists but `yq` is missing, commands warn to stderr.

Required `yq` variant check:

```bash
yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk'
```

Always use `yq -r` for raw string output (kislyuk/yq returns quoted strings
without `-r`).

## Hooks

Both hooks run through a shared cross-host Node runtime under
`hooks/scripts/` rather than standalone bash scripts (the original
`check-git-push.sh` / `check-commit-message.sh` were deleted once
`tests/hook-parity.bats` proved byte/semantic-equivalent behavior):

- `hooks/scripts/lib/policy-check-git-push.js` /
  `lib/policy-check-commit-message.js` — pure decision functions
  (`camelCaseEnvelope -> {decision, message}`), host-agnostic
- `hooks/scripts/lib/envelope.js` — `snakeToCamelEnvelope` (both hosts'
  stdin is snake_case, only output differs — see
  `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`),
  plus `formatClaudeOutput`/`formatCodexOutput` (Claude's PreToolUse deny is
  exit-2 + stderr; Codex's is a `hookSpecificOutput` JSON envelope — see the
  same doc's "different mechanism per host" note)
- `hooks/scripts/lib/run-hook.js` — shared `runHook(argv, formatOutput)`:
  reads stdin, transforms the envelope, dispatches to the matching policy,
  formats output; preserves each hook's original fail-open/fail-closed
  behavior on parse failure
- `hooks/scripts/entrypoint-claude.js` / `entrypoint-codex.js` — thin
  per-host wrappers (~13 lines) calling `runHook` with the matching
  formatter

Behavior (unchanged from the original bash hooks):

- **PreToolUse (Bash)** — Backstop that blocks raw `git push` and points the
  workflow back to `gt submit --no-interactive`
- **PostToolUse (Bash)** — Warns when a `gt commit`, `gt modify`, or
  `gt create` command uses a non-conventional commit message (warn-only, never
  blocks execution)

Hooks are carried into the generated Codex manifest
(`hooks/codex-hooks.json`, `targets.codex.includeHooks` left at its default
of `true` — unlike yellow-core, which opts out) but currently **never
fire** on Codex: `plugin_hooks` is stage `removed` on codex-cli 0.144.1 (see
the manifest-and-hook-contract doc's "Update — 2026-07-20" section). This is
schema/unit-tested but not live end-to-end verifiable right now.

## Testing

Bats shell tests live in `tests/` — run `bats tests/` from inside this
plugin directory (see root `CLAUDE.md`'s bats list).

- `tests/hook-parity.bats` — parity gate proving the Node hook runtime
  (`hooks/scripts/entrypoint-claude.js`) reproduces the deleted bash hooks'
  behavior exactly, against golden fixtures in `tests/fixtures/hooks/`.
- `tests/gt-cleanup.bats` — the deterministic bash embedded in
  `skills/gt-cleanup/SKILL.md`: flag parsing, branch classification, the
  batch-cap-15 review queue, the `gt get` conflict-stop path, and the
  `gt delete` not-tracked fallback. Fixture:
  `tests/fixtures/gt-cleanup/branches-mixed.txt`.
- `tests/smart-submit.bats` / `tests/gt-amend.bats` — the deterministic
  bash embedded in the matching `SKILL.md` (Phase 0's `.graphite.yml`
  clamping, Phase 4's submit-flag construction) plus the `--dry-run` /
  `--no-submit` guarantee that `gt submit` is never invoked on those paths.

`tests/mocks/git` and `tests/mocks/gt` are pattern-match-on-`"$*"` fake
executables (mirrors `plugins/yellow-review/tests/mocks/gh`), logging every
invocation to `$MOCK_GIT_LOG` / `$MOCK_GT_LOG` so tests can assert a
state-changing command was (or was never) invoked.

**Scope limitation** (matches `plugins/yellow-core/tests/plan-commands.bats`'s
own documented limitation): these suites cover only the deterministic bash a
skill's body embeds. The agent-orchestrated control flow around it — audit
dispatch via the `audit-review` skill, `AskUserQuestion` confirmation gates,
PR-status `gh` lookups — is interpreted by an LLM reading the markdown, not
executed as a script, and cannot be exercised in bats.

## Codex Distribution

`targets.codex.enabled: true` in `catalog/plugins/gt-workflow.json` — the
second plugin in this repo (after yellow-core) to enable Codex. Unlike
yellow-core's narrow read-only allowlist, gt-workflow exposes its **entire**
skill surface: all ten skills are allowlisted —
`gt-setup`, `gt-nav`, `gt-stack-plan`, `gt-sync`, `smart-submit`, `gt-amend`,
`gt-cleanup`, `audit-review`, `stack-decomposition-format`,
`stack-plan-style` — since gt-workflow's commands are thin wrappers with no
Claude-only logic of their own (contrast yellow-core, which excludes 17 of
its 20 skills along with all 21 agents and both hooks). `includeHooks` is
left at its default (`true`, not `false` like yellow-core) — see "Hooks"
above for why they're carried but currently inert.

Generated artifacts (`pnpm generate:manifests`, never hand-edited):
`.codex-plugin/plugin.json`, `hooks/codex-hooks.json`,
`codex/skills/<name>/SKILL.md` (ten directories, frontmatter normalized to
`name` + single-line `description` only).

Two syntax gaps remain unverified against a live Codex session (flagged
inline where relevant, not silently assumed): the exact
`worker`/`explorer` built-in-agent delegation syntax a skill body uses
(`audit-review`'s Codex dispatch section), and whether the Codex-side
`mcpServers` manifest pointer this shell added to `buildCodexPluginManifest`
actually causes Codex to load the shared `.mcp.json`. Both are called out
in the PR description's manual Codex-app acceptance checklist rather than
assumed to work.

## Stack Decomposition Format

`gt-stack-plan` produces a `## Stack Decomposition` section in plan documents.
`workflows:work` (yellow-core) consumes it for bottom-up stacked PR execution.

Format contract:
- `## Stack Decomposition` heading with `<!-- stack-topology: linear|parallel|mixed -->`
  and `<!-- stack-trunk: main -->` HTML comment metadata
- Numbered `### N. type/branch-name` subsections, each with required fields:
  **Type**, **Description**, **Scope**, **Tasks**, **Depends on**; optional: **Linear**
- `workflows:work` writes a `## Stack Progress` section to track completion

See `output-styles/stack-decomposition.md` for the full specification with
examples for all topologies. The `stack-decomposition-format` skill is an
identical Codex-reachable copy (Codex has no `outputStyles` manifest field);
both stay in sync manually — there is no generator step deriving one from
the other.

### Input Integrations

- **Linear issues** — `/gt-stack-plan` reads a `## Linear Issues` section from
  plan files (written by `/workflows:plan` when Linear context is detected).
  When present, defaults to 1:1 issue-to-branch mapping with
  `feat/<ISSUE-ID>-<slug>` naming and includes issue IDs as `Linear:` fields in
  the `## Stack Decomposition` output. This is input-only (reads plan metadata)
  and does not create a runtime dependency on yellow-linear.

### MCP Tool Integration

- **ruvector** — Not directly integrated. gt-workflow commands are thin
  wrappers around Graphite CLI; memory operations happen in calling workflows
  (e.g., `/workflows:work`). Graceful skip if yellow-ruvector not installed.
- **morph** — Not applicable. gt-workflow operates on git/Graphite CLI, not
  file editing.
