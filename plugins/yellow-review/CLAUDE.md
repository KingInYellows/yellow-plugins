# yellow-review Plugin

Multi-agent PR review with adaptive agent selection, parallel comment
resolution, and sequential stack review. Graphite-native workflow.

## Conventions

- Use the active stacked-PR provider (see `/stack:status`) for all branch
  management and PR creation — never raw `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Agents report findings — they do NOT edit project files directly. The
  `memory: project` frontmatter auto-enables Read/Write/Edit per Claude Code
  docs (so agents can persist learnings to `.claude/agent-memory/<name>/`), but
  the prompt-level "report findings only" rule remains in force; the
  orchestrating command applies all fixes
- Orchestrating commands apply fixes sequentially to avoid conflicts
- **Confidence gating is orchestrator-only for the four recall personas.**
  `agent-native-reviewer`, `agent-cli-readiness-reviewer`,
  `cli-readiness-reviewer`, and `thermonuclear-reviewer` report every in-scope
  finding with a confidence anchor and severity — no persona-side `< 75` filter.
  They cap at 40 findings; overflow is dropped silently and is not
  orchestrator-suppressed. Other persona reviewers still apply their own anchor
  floors before Step 6 (including `plugin-contract-reviewer`). `/review:pr` Step
  6 and `/review:all` Step 8 item 9 (the Aggregate-findings confidence gate) are
  the sole gates for those four (suppress below 75 except P0 at 50+; count only
  findings the gate actually removes as `suppressed` — surviving P0-at-50+
  exceptions are not suppressed). Pre-existing findings are gated before the
  Pre-existing section. If a recall persona would exceed 40 findings, rank
  gate-surviving items first (anchors 75/100, plus P0 at 50+) by severity then
  confidence, then remaining findings, and drop the lowest-ranked overflow —
  never emit partial JSON.
- **The compact-return schema has one source.**
  `skills/pr-review-workflow/references/compact-return-schema.md` holds it
  between `compact-return-schema` markers, plus the persona notes between
  `compact-return-notes` markers. Each persona keeps an inline marked copy
  (subagents cannot read the skill), and `pnpm validate:compact-return` fails a
  copy whose keys, order, types or `rule`/`scope` placeholders drift, whose
  enums widen, or whose notes differ. Edit the canonical block first.
- All shell scripts follow POSIX security patterns (quoted variables, input
  validation, `set -eu`)
- Working directory must be clean before running any review command
- Commit messages: `fix: address review findings from <agents>` or
  `fix: resolve PR #<num> review comments (<n> files)`. `/review:pr`,
  `/review:all`, `/review:triage` and `/review:resolve` always add a new commit
  via `commit-resolve-fixes` (explicit `git add`, then a new commit — never an
  amend)
- Always confirm with user via `AskUserQuestion` before pushing changes — never
  auto-push without human approval. **Exceptions** (commands that intentionally
  run unattended and suppress every push gate by design):
  - `/review:resolve-stack` — walks a Graphite stack invoking
    `/review:resolve --non-interactive` per PR (which may file up to 3 follow-up
    issues per PR unattended)
  - `/review:sweep` — invokes `/review:pr --non-interactive` then
    `/review:resolve --non-interactive` on a single PR with no gates
  - `/review:sweep-all` — loops `/review:sweep` over every open non-draft PR you
    authored; only the one upfront M3 confirmation is interactive

  The default `/review:pr` and `/review:resolve` paths (no flag) keep every
  gate. The `--non-interactive` flag opts a single invocation in to the
  unattended behavior.

## Plugin Components

Full detail for every component below (flags, exit codes, trust-boundary rules,
library behavior, hook budgets, testing map, usage guide) lives in
[`references/components-reference.md`](references/components-reference.md). Read
it before editing a script, library or command.

### Commands (9)

- `/review:setup` — validate GitHub, jq, yellow-core and ledger prerequisites;
  the Graphite CLI is reported but needed only with gt-workflow
- `/review:pr` — adaptive multi-agent review of one PR with auto-applied safe
  fixes; persists unapplied findings to the ledger; `--non-interactive`
  suppresses push and learnings prompts
- `/review:resolve` — parallel resolution of unresolved PR threads via GraphQL;
  every thread gets a disposition (`fixed`, `addressed`, `oos`,
  `disagree`/`unclear`); ends with the `Resolve:` contract line;
  `--non-interactive` suppresses all gates
- `/review:resolve-stack` — walk a Graphite stack bottom-up running
  `/review:resolve --non-interactive`, fully unattended; ends with the
  `ResolveStack:` outcome line
- `/review:all` — sequential review of multiple PRs (stack, all open, or one)
- `/review:sweep` — `/review:pr` then `/review:resolve` then `/review:triage` on
  one PR, all non-interactive
- `/review:sweep-all` — `/review:sweep` over every open non-draft PR you
  authored; one upfront confirmation; ends with the `SweepAll:` outcome line
- `/review:triage` — own the review-findings ledger lifecycle for one PR
  (reconcile, apply, dismiss, restore); `rl prune` is the only ledger deletion
  path
- `/review:merge-ready` — read-only merge gate (threads, reviews, CI,
  mergeability, ledger P0-P2); ends with the `MergeReady:` contract line and
  never writes to GitHub or adds ledger records

### Agents (17)

Review agents report findings and never edit files; the orchestrating command
applies fixes.

- Always selected: `project-compliance-reviewer`, `correctness-reviewer`,
  `maintainability-reviewer`, `project-standards-reviewer`
- Conditional: `reliability-reviewer` (I/O or async), `adversarial-reviewer`
  (>200 lines or trust boundaries), `plugin-contract-reviewer`,
  `cli-readiness-reviewer`, `agent-cli-readiness-reviewer`,
  `agent-native-reviewer`
- Opt-in only, never auto-selected: `thermonuclear-reviewer` (name it in
  `reviewer_set.include`; opus/xhigh; unreachable under
  `review_pipeline: legacy`; skipped below the medium depth tier unless
  `reviewer_set.force_depth` names it)
- Specialists: `pr-test-analyzer`, `comment-analyzer`, `code-simplifier` (final
  pass), `type-design-analyzer`, `silent-failure-hunter`
- Workflow: `pr-comment-resolver` — one fix per comment cluster plus a proposed
  per-thread disposition; no Bash tool

### Skills (3)

`pr-review-workflow` (selection, output format, error handling, and the home of
all scripts), `stack-traversal` (shared by `/review:all` and
`/review:resolve-stack`), `yellow-thermonuclear-review` (rubric preloaded by
`thermonuclear-reviewer`; the only Codex/Cursor-distributed skill). None is
user-invocable.

### Scripts (18)

All live in `skills/pr-review-workflow/scripts/`; invoke as
`${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/<name>`. Exit codes for
the resolve scripts: `references/resolve/dispositions.md`.

- `get-pr-comments`, `get-pr-blockers`, `pr-changed-ranges`, `poll-new-threads`
  — read PR threads, blockers, changed ranges, and new threads for the Step 8
  re-pass
- `check-merge-ready` — read-only `/review:merge-ready` gate combining the
  readers above with a PR-state and CI read and the ledger summary; exits 0
  ready, 1 blocked, 3 unknown
- `apply-thread-actions` — the Step 7 write phase in one call: runs the three
  scripts below per thread from a JSONL plan; exit 4 stops, exit 5 resumes
- `reply-pr-thread`, `resolve-pr-thread`, `file-followup-issue` — write to
  GitHub with idempotency markers; exit 3/4 are distinct from 1; text-screened
  scripts exit 6 on refusal and 7 on a permanent GitHub refusal
- `check-resolve-text` — refuse credential-like, image, `@` mention or
  foreign-URL text; exit 6
- `pr-review-delta check` | `record` — zero-token change check against seen
  thread IDs
- `commit-resolve-fixes`, `run-verify-command` — commit and verify resolver
  fixes; both refuse worktree-resident `git`/`gh`/`jq` and screen `PATH` and git
  config (`yr_safe_path`, `harden_git_config`), `commit-resolve-fixes` also
  refuses worktree-resident `gt`/`node`/`awk`; neither pushes.
  `run-verify-command --revert-denied` also judges trusted-config symlinks
  (tracked, untracked or nested) and leaves FIFO, socket and device paths in
  place, reporting them instead of opening them
- `head-ignore-probe`, `guard-local-config` — protect the ignored
  `yellow-plugins.local.md` for sweep and resolve-stack
- `read-resolve-config` — the Step 1 config snapshot as JSON; never parse the
  config in prose
- `check-addressed-evidence` — the Step 5 `addressed` evidence rules
- `file-line-counts` — base/head line counts for `thermonuclear-reviewer`

### Resolve references

`references/resolve/` holds the `/review:resolve` mechanics loaded by step
(`dispositions.md` is the contract). Offloaded detail stays under each command's
own `references/<slug>/`.
`references/review-resolve-stack/dirty-tree-cleanup.md` and
`references/review-sweep-all/dirty-tree-cleanup.md` must stay byte-identical
(`skill-content.bats` fails on drift), as must the three `resolve-contract.md`
copies under `references/review-sweep/`, `review-sweep-all/` and
`review-resolve-stack/`.

### Library

- `lib/resolve-paths.sh` — canonical-path check, resolver deny list, runner-file
  list, `harden_git_config`
- `lib/resolve-text.sh` — text screen (`rt_text_clean`, `rt_code_clean`); a hit
  means the text is never posted
- `lib/resolve-gh.sh`, `lib/gh-graphql.sh` — `gh` calls under
  `YELLOW_REVIEW_GH_TIMEOUT`, failure classifiers; test rate limit before
  permission (a secondary rate limit is also a 403)
- `lib/verify-run.sh` — timeout, process-group and redacted-log helpers for the
  verify run
- `lib/sibling-plugin.sh` — `sp_sibling_file`, the one lookup of a file in a
  sibling plugin
- `lib/run-github-stack-runtime.js` — entry to github-workflow's runtime;
  byte-identical copy of yellow-core's
- `lib/review-ledger.sh` — durable per-PR findings ledger (append-only JSONL
  under the git common dir); never put a PR-controlled file name on a command
  line; a ledger error never aborts a review; procedure in
  `references/review-pr/ledger.md`, so keep `/review:pr` and `/review:all` in
  parity through that file
- `lib/persona-shadow.sh` — opt-in persona-selection shadow log for `/review:pr`
  Step 4; procedure in `references/review-pr/persona-shadow.md`
- `lib/stage-learning.sh` — stages unattended `/review:pr` learnings in
  yellow-core's compound-staging ledger; separate from the review-findings
  ledger

### Hooks (1)

`SessionStart` → `hooks/scripts/session-start.sh` (timeout 3 s; declared in
`catalog/plugins/yellow-review.json`). Reports pending ledger findings for open
PRs as integers and PR numbers only, never ledger text; always
`{"continue": true}`, no `set -e`. Budgets and edge cases are in the reference.

## When to Use What

`/review:pr` for one PR, `/review:resolve` for its comment threads,
`/review:all` for a stack or backlog, `/review:resolve-stack` for stack-wide
unattended resolve, `/review:sweep` and `/review:sweep-all` for fire-and-forget
review plus resolve, `/review:triage` for residual ledger findings,
`/flow:review` (yellow-core) for plan adherence. Full guidance is in the
reference.

## Cross-Plugin Agent References

When conditions warrant, commands spawn these agents via Agent tool (using the
three-segment `yellow-core:<dir>:<name>` subagent_type — e.g.
`yellow-core:review:security-reviewer`). The Wave 2 pipeline dispatches the
calibrated reviewer variants; the legacy fallback (`review_pipeline: legacy` in
`yellow-plugins.local.md`) keeps the deeper-audit variants.

- `security-reviewer` — for auth, crypto, and shell-script changes (Wave 2
  default; the deeper-audit `security-sentinel` is the legacy fallback)
- `architecture-strategist` — for large (10+ file) cross-module changes
- `performance-reviewer` — for query-heavy or high-line-count PRs (Wave 2
  default; the deeper-audit `performance-oracle` is the legacy fallback)
- `pattern-recognition-specialist` — for new pattern introductions and plugin
  authoring convention checks
- `code-simplicity-reviewer` — additional simplification pass for large PRs

Optional supplementary agent via Agent tool (using the three-segment
`yellow-codex:review:codex-reviewer` subagent_type):

- `codex-reviewer` — parallel review when yellow-codex is installed AND diff >
  100 lines. Tags findings with `[codex]`. Silently skipped when yellow-codex is
  not installed.

yellow-review requires yellow-core for full review coverage. Without it,
cross-plugin agents (security-reviewer / security-sentinel,
architecture-strategist, performance-reviewer / performance-oracle,
pattern-recognition-specialist, code-simplicity-reviewer) silently degrade —
only yellow-review's own agents run.

### Prompt cache TTL

The four always-selected reviewers and `code-simplifier` set
`experimental.cacheTtl: 1h`; conditional personas intentionally omit it. Claude
Code 2.1.259+ honors it on subagent files only, and a `subagentPromptCacheTtl`
setting or environment variable overrides it. Rationale and cost in the
reference.

### MCP Tool Integration

- **yellow-linear** (optional) — `/review:resolve` files out-of-scope follow-up
  issues through yellow-linear's `save_issue`, `list_issues` and `list_teams`
  when ToolSearch finds `save_issue` and the branch name carries a Linear issue
  ID; the issue holds a generated title, the resolver's `oos_reason`, a thread
  link and a dedupe marker, never the reviewer's comment text. Otherwise, or
  when Linear fails, it files once on GitHub (the Resolve report names the
  tracker, e.g. `tracker=github (linear unavailable)`).

- **ruvector** — Recall past learnings at workflow start; tiered remember at
  workflow end (Auto for P0/P1 findings, Prompted for P2). Graceful skip if
  yellow-ruvector not installed.
- **morph** — Preferred for intent-based code search (blast radius, callers,
  similar patterns) in review agents. Discovered via ToolSearch at runtime;
  falls back to built-in Grep silently.

## Codex and Cursor Distribution

The generated Codex manifest sets `commands: []` to prevent automatic conversion
of Claude command wrappers into additional skills. Codex exposes only the skills
selected by the catalog allowlist.

`targets.codex.enabled: true` and `targets.cursor.enabled: true` in
`catalog/plugins/yellow-review.json`, each with a `skillAllowlist` of exactly
one entry: `yellow-thermonuclear-review`. Every command, agent, and other skill
in this plugin stays Claude-only, including the SessionStart hook
(`targets.codex.includeHooks: false`; the generator has no Cursor hook path).
See [`docs/codex-distribution.md`](../../docs/codex-distribution.md) and
[`docs/cursor-distribution.md`](../../docs/cursor-distribution.md).

Generated artifacts (`pnpm generate:manifests`; checked by
`pnpm validate:generated`): `.codex-plugin/plugin.json`,
`.cursor-plugin/plugin.json`,
`codex/skills/yellow-thermonuclear-review/SKILL.md`,
`cursor/skills/yellow-thermonuclear-review/SKILL.md`, plus the root
`.agents/plugins/marketplace.json` and `.cursor-plugin/marketplace.json`
entries. The host copies carry the canonical skill body byte-for-byte with
frontmatter normalised to `name` + `description`; edit
`skills/yellow-thermonuclear-review/SKILL.md` and regenerate, never the copies.
Because neither host applies the agent's `tools:` restriction or
`user-invocable: false`, the rails, the input contract, and the
explicit-invocation wording live in the skill body and description.

## Testing

`bats tests/` from the plugin directory. Per-suite descriptions are in the
reference; `review-ledger.bats` ctags cases skip locally and fail when `CI` is
set.

## Known Limitations

- GraphQL scripts require `gh` and `jq` to be installed
- The `PATH` screen (`yr_safe_path`) reads every entry of every `PATH` directory
  at each script start and is not cached (a resolver runs as the user and could
  forge a cache). On WSL2 with `appendWindowsPath = true` the `/mnt/c` entries
  make that take ~90 s; README "Limitations" has the `/etc/wsl.conf` fix
- Cross-plugin agents require the `yellow-core` plugin to be installed
- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs are excluded from `/review:all scope=all` by default
- `gt track` may fail on non-Graphite PRs — falls back to raw git (degraded
  mode)
