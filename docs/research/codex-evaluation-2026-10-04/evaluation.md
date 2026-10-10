# Codex compatibility evaluation

Evaluated October 4, 2026 (America/Chicago).

## Recommendation

Keep `yellow-plugins` as one repository. Its neutral catalog already generates
Claude, Codex, and Cursor distributions. Extend that machinery in small,
per-plugin changes. A separate Codex source repository would duplicate skill
bodies, release versions, security fixes, and validators without resolving any
of the actual host differences.

A generated distribution repository may be useful later for a release channel;
it should consume artifacts from this repository, not become another authoring
source. There is no demonstrated requirement for it today.

Implementation sequence:
[Codex development plan](../../../plans/codex-compatibility-expansion.md).

## Scope and evidence

- Original checkout:
  `/home/kinginyellow/workspaces/yellow-harness_workspace/yellow-plugins`, clean
  on `main` at `136afa03eb943407c11dff8c56d4a7fd6fe4a28b`.
- Evaluation worktree:
  `/home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04`.
- Evaluation base: latest fetched `origin/main`,
  `cb7469ffe5d7c5e455c53c65055dac1d0d7e35b0`; original checkout is six commits
  behind.
- Worktree is detached: this planning pass did not create a development branch.
- Execution: Ubuntu-24.04 WSL; Node 22.22.0, pnpm 8.15.0, Codex CLI 0.157.0. No
  secrets, existing configuration, or other worktrees copied.
- Existing pinned dependencies installed only in the new worktree with
  `pnpm install --frozen-lockfile --ignore-scripts`: exit 0, 692 packages
  reused, zero downloaded, no tracked lockfile change.
- Plugin Eval: user-invoked plugin version 0.1.2, whose package declares tool
  version 0.1.0. CLI ran under WSL Node from the installed tool files under
  `/mnt/c/Users/YellowKing/.codex/plugins/cache/openai-curated-remote/plugin-eval/0.1.2/`.
- Static evaluation used `start`, `analyze`, and `report` for each enabled
  plugin. The monorepo root is a marketplace, not a single Codex plugin.
- No model-driven benchmarks, authenticated MCP calls, hook trust changes,
  publishing, commits, or pushes performed.

The raw reports contain automated recommendations. Treat them as reference data,
not authority to edit generated manifests or change permissions.

## What already works

The catalog inventories 20 plugins, 69 source skills, 131 commands, and 78
agents. Codex currently exposes 23 skills across four plugins. The other 16
plugins are deliberately absent from the Codex marketplace.

| Plugin        | Codex skills | Current exposed scope                                              | Assessment                                                                  |
| ------------- | -----------: | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| gt-workflow   |           11 | Graphite CLI workflows and reference skills; MCP pointer and hooks | Broadest existing pilot; includes mutation workflows requiring confirmation |
| yellow-core   |            3 | Architecture, audit, plan dashboard                                | Strongest low-risk pilot; excludes commands, agents, hooks                  |
| yellow-review |            1 | Explicit thermonuclear structural review                           | Report-only rubric, not the full review orchestration                       |
| yellow-ci     |            8 | CI diagnosis, lint, setup, runner health and references            | Useful operational pilot; includes confirmed config writes and SSH          |

Source of truth remains `catalog/` plus `plugins/<name>/skills/`; generated
`.codex-plugin/plugin.json`, `codex/skills/`, and
`.agents/plugins/marketplace.json` must not be hand-edited. See
[canonical distribution documentation](../../codex-distribution.md).

### Installed packaging proof

In an empty, disposable profile, ran local marketplace add, then
`codex plugin add <name>@yellow-plugins --json` for all four plugins, followed
by `codex plugin list --json`. Every install exited 0. The list reports all four
installed and enabled at their expected versions:

- gt-workflow 2.0.6
- yellow-core 2.6.2
- yellow-review 3.5.3
- yellow-ci 1.5.6

HOME, CODEX_HOME and XDG directories were isolated per child process. Remote
plugin discovery was disabled. The scratch directory is retained at the path in
[isolated-smoke-location.txt](isolated-smoke-location.txt). Installation
produced a warning that helper PATH aliases cannot be created under /tmp;
marketplace registration, installation, and listing still succeeded.

Receipts: [installed list](installed-plugins.json), individual `*-install.json`,
and [marketplace receipt](marketplace-add.txt).

This proves local discovery and installation. It does not prove installed skill
invocation, registered MCP availability, hooks firing, Windows desktop behavior,
or publication acceptance.

## Interpreting Plugin Eval

All four raw evaluations score F / 0. That aggregate is not a compatibility
verdict: nine common manifest findings alone deduct 126 points, and the actual
Codex CLI installed every package.

| Plugin        | Strongest skill surface                                                              | Main skill improvement                                                                                              |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| gt-workflow   | stack-plan-style (36 lines), gt-merge (72); compact single-purpose instructions      | gt-setup (440) has no reference split; plugin budget sums all 11 skill bodies                                       |
| yellow-core   | plan-status (90); architecture (119) and audit (168) have no skill-specific findings | No substantive exported-skill defect identified by this analyzer                                                    |
| yellow-review | Clear report-only and explicit-request contract                                      | Rubric is 414 lines; keep required attribution and consider splitting detail; do not broaden its deliberate trigger |
| yellow-ci     | ci-status (116), diagnose-ci (101) are compact                                       | ci-runner-health (995) and ci-diagnose (612) need progressive disclosure                                            |

The CI description warnings deserve activation tests, not automatic rewriting:
the reference skills and explicitly requested review rubric may intentionally
avoid broad triggering.

Three evaluator limits affect the results:

1. The scanner requires every listed interface field, including defaultPrompt
   and public MCP-review URLs. Current official documentation distinguishes
   package, listing and MCP-review requirements; starter prompts are optional
   and skills-only packages do not need every MCP-review URL. Missing author is
   a real documented schema gap despite current local parser acceptance. See
   [manifest requirements](https://developers.openai.com/plugins/deploy/submission#manifest-fields).
2. `computePluginBudget` sums all implicitly eligible exposed skills as an
   invocation ceiling, then scans the entire plugin root for deferred files.
   Claude commands/agents and non-exposed source skills inflate that deferred
   number. It is not observed usage for a task. Code/coverage findings also
   include files outside the exposed skill set.
3. The reported ci-runner-health broken link is the regex on generated
   `SKILL.md:181`, `[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?`, inside a shell
   fence. It is not a Markdown link. Do not alter working validation logic to
   silence this finding.

Reported static totals (trigger / aggregate invocation / deferred tokens):

| Plugin        | Trigger | Aggregate invocation | Whole-root deferred |
| ------------- | ------: | -------------------: | ------------------: |
| gt-workflow   |     686 |               20,080 |              66,384 |
| yellow-core   |     225 |                3,729 |             338,591 |
| yellow-review |     207 |                5,257 |             235,808 |
| yellow-ci     |     499 |               36,810 |              97,503 |

No observed usage supplied. Scores and token estimates are retained unchanged in
the raw JSON and Markdown reports for reproducibility.

## Changes needed for wider Codex support

### Refresh the host contract before broadening claims

The repository schema is explicitly repo-derived from a July spike. The
generator omits shared author, license, repository and keywords; its interface
schema accepts only displayName and category. Update schema, catalog metadata
and emitter together, guided by current package requirements and real runtime
tests. Separate local compatibility from public submission requirements; do not
invent privacy policies or listing URLs.

The old `plugin_hooks removed` observation is insufficient today: our CLI
reports `hooks stable true` and `plugin_hooks removed false`, while official
documentation describes plugin hooks loaded after trust review. Hook execution
remains untested in this pass. Re-test the installed lifecycle; do not infer
firing from a feature flag. Codex provides PLUGIN_ROOT / PLUGIN_DATA and Claude
compatibility aliases. See
[current packaging and hooks](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)
and
[hook discovery/trust](https://learn.chatgpt.com/docs/hooks#where-codex-looks-for-hooks).

Retain explicit `./hooks/codex-hooks.json`. This monorepo forbids
`plugins/<name>/hooks/hooks.json` because Claude would auto-load a duplicate.
Codex's default-file convention is not a reason to break that rule.

### Preserve workflow intent, adapt host entrypoints

Reuse neutral skills and scripts. Convert selected Claude commands into explicit
Codex skills; move useful agent procedures into skills, retaining task inputs,
output contracts and approval boundaries. Claude frontmatter tools,
subagent_type, model aliases, memory semantics and outputStyles are not a
portable execution contract. Several existing skills already explain how Codex
substitutes ordinary questions for AskUserQuestion and direct loading for Skill.
Keep those semantics. See
[official Claude conversion guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin).

The `yellow-codex` plugin is a Claude wrapper around the Codex CLI; its name
does not mean it is itself Codex compatible. Port its useful procedures only
when they add value for a Codex-hosted workflow.

### Extend resources with containment intact

The generator currently permits SKILL.md and flat Markdown references only. It
rejects scripts, assets and agents/openai.yaml. Start with tightly validated
agents/openai.yaml support, so explicit-only skills can ship
`policy.allow_implicit_invocation: false`. Then add scripts/assets only for
specific selected workflows, with symlink, traversal, stale-output, permissions,
and byte-identity tests. Current skills can also use the existing flat reference
path without waiting for generator changes.

### Add MCP and credentials deliberately

Only file-reference mcpServers pass through the Codex emitter. Inline Claude MCP
definitions in disabled plugins do not translate automatically. Define a Codex
MCP schema/normalizer and test installed registration and safe startup. Claude
userConfig prompts and variable expansion need explicit host configuration,
environment or OAuth alternatives. Preserve userConfig behavior on Claude.

Do not assume CLI auth propagates into Windows desktop or that a connector with
similar tools is the same bundled MCP. Keep host-specific credentials out of
repository sources. Recheck dependency paths and cross-plugin imports against
the installed layout; Claude dependency declarations are not Codex dependencies.

### Keep portable packaging optional

Current docs also describe a root portable `plugin.json`, and retain the Codex
compatibility manifest. Portable root packages discover root skills and MCP
components; overlay skill declarations do not override those components.
Dropping that root manifest into current plugin directories could expose the
Claude-only skill tree. Keep the current explicit Codex layout while hardening
it. If portable distribution becomes necessary, generate a separate staged
package containing only the allowed resources. See
[portable component behavior](https://developers.openai.com/plugins/deploy/submission#manifest-fields).

## Validation and workspace readiness

Original checkout at 136afa03e:

| Check                             | Exit | Result                                                                                |
| --------------------------------- | ---: | ------------------------------------------------------------------------------------- |
| git status, staged/unstaged diffs |    0 | Clean before and after audit                                                          |
| validate:schemas                  |    1 | Ignored .ruvector/intelligence.json triggers council roster discovery                 |
| validate:versions:dry             |    0 | Explicit output says all 20 plugin versions in sync                                   |
| test:integration                  |    0 | 54 files; 1,731 passed, 1 skipped                                                     |
| lint                              |    0 | Passed                                                                                |
| lint:plugins                      |    0 | Zero errors/warnings                                                                  |
| typecheck                         |    1 | Jules SDK module missing from existing dependency tree                                |
| test:unit                         |    1 | Core/Cursor/Goal passed; Jules has compile-related suite failures and 3 test failures |

That checkout is Git-clean but is not a fully passing development baseline. The
Jules missing module is an observed dependency-install issue; not every test
failure was independently attributed to it.

Fresh evaluation worktree at cb7469ffe, using the existing lockfile: schemas,
version consistency, typecheck and unit tests pass. Unit totals: 3 core + 125
Cursor + 323 Goal + 336 Jules = 787. This confirms a usable baseline here; it
does not repair the original checkout. Final ESLint and version checks also
passed. Integration initially failed one RuVector empty-PID lock-recovery test;
the focused 32-test suite and a full rerun then passed (54 files, 1,733 tests
passed, 1 skipped). A timing cause was not proven. Installed-cache inspection
verified all 23 declared skill files. Preserve the initial failure alongside
both passing reruns.

Formatting, authored-document local links and JSON parsing passed. Exact results
and limitations are recorded in [validation.json](validation.json).

## Evidence inventory

- Four `<plugin>-start.md` routing receipts.
- Four `<plugin>.json` static evaluations and `<plugin>.md` rendered reports.
- [Catalog inventory](catalog-inventory.json): all 20 plugin records, counts,
  target allowlists, MCP names and credential field names; no credential values.
- Four installation receipts, installed plugin list and marketplace receipt.
- [Phased implementation plan](../../../plans/codex-compatibility-expansion.md).
