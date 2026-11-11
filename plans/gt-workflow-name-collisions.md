# Feature: Resolve the gt-workflow command/skill name collisions

Date: 2026-11-09 · Roadmap: `plans/claude-code-quality-and-cost-roadmap.md`,
initiative R2.2 · Second PR of the stack, on top of
`agent/feat/CLAUDE-291-description-validators` (PR #1768). CLAUDE-308 follows
and is out of scope.

## Problem Statement

Eight names in gt-workflow exist twice: as `commands/<name>.md`, a thin
wrapper that tells Claude to invoke the Skill tool with that name, and as
`skills/<name>/SKILL.md`, the real body. The names are gt-amend, gt-sync,
gt-nav, smart-submit, gt-setup, gt-merge, gt-cleanup and gt-stack-plan.

Tested on Claude Code 2.1.321 on 2026-11-09: the Skill tool with
`gt-workflow:gt-nav` returns the command wrapper, and bare `gt-nav` resolves
to the same wrapper. The skill body cannot be reached. Root `CLAUDE.md` works
around this by telling Claude to read the installed `SKILL.md` by hand. Each
pair also loads two descriptions into every session.

The Claude Code docs say the skill wins a name collision. The observed
behaviour is the opposite and is not documented anywhere.

## Linear Issues

- CLAUDE-307

## Settled Decisions

- Remove one side of each pair and keep the existing name.
  (session-settled: user-approved — chosen over renaming with a deprecated
  alias or renaming outright: no user-facing rename.)
- The changeset for gt-workflow is a minor bump. (session-settled:
  user-approved — chosen over major and patch: every name keeps working, and
  what is removed is a broken wrapper path.)
- Cross-plugin dispatches are written `gt-workflow:<name>`.
  (session-settled: user-approved — chosen over keeping bare names: a
  user-level `smart-submit` command makes the bare name ambiguous.)
- `disable-model-invocation` is not set in this PR. (session-settled:
  user-approved — chosen over restricting gt-merge, gt-cleanup, gt-setup and
  gt-sync now: CLAUDE-308 decides it for every manual-only command, with the
  cross-reference check that flag needs.)
- The fix is verified before release with headless `claude -p` probes against
  the worktree. (session-settled: user-approved — chosen over a manual
  interactive check and over verifying only after release.)

## Current State

- `plugins/gt-workflow/commands/` holds exactly the eight wrappers, 18 to 28
  lines each. Each carries `argument-hint` and `allowed-tools`, and passes
  `$ARGUMENTS` to the Skill call.
- The eight `SKILL.md` files have only `name`, `description` and
  `user-invocable: false`. No body uses `$ARGUMENTS`; each says the argument
  text "is available as context". `user-invocable: false` blocks typing
  `/name`.
- The layout came from the Codex pilot (commit `de669b89c`, PR #661): Codex
  has no command layer, so the skill is the body it reaches. The flag was
  added only to avoid a duplicate menu entry. No recorded reason requires a
  command file.
- Codex and Cursor copies are generated from the skills with frontmatter
  reduced to `name` and `description`, and the Codex manifest emits
  `commands: []`. Those outputs do not change.
- Two checks assume a command file:
  - `scripts/validate-setup-all.js` `loadCommandPlugins` (lines 322–355)
    walks only `commands/`; `plugins/yellow-core/commands/setup/all.md`
    delegates to `gt-setup`.
  - `tests/integration/stack-operation-registry.test.ts` (lines 36–39 and
    85–95) asserts `plugins/<plugin>/commands/<ref>.md` exists for each
    `type: 'command'` entry in
    `plugins/yellow-core/lib/stack-operation-registry.js`.
- `scripts/validate-codex.js` `buildCommandNameRegistry` (line 463) reads
  `commands/*.md` to flag stray slash references in Codex-exposed text.
- Bare-name dispatch sites: `plugins/yellow-core/commands/flow/work.md:966`,
  `plugins/yellow-core/commands/flow/plan.md:647`,
  `plugins/yellow-linear/commands/linear/work.md:241`.
  `plugins/yellow-core/skills/debugging/SKILL.md:294` is already qualified.
- These eight are the only equal-name pairs in the repo. github-workflow,
  yellow-ci and yellow-core use wrappers with different names.
- RULE 23 baseline for gt-workflow is 4,487 characters.

## Proposed Solution

Delete the eight command wrappers and make the skills the single entry point.

Each `SKILL.md` gains the wrapper's `argument-hint` and `allowed-tools`, loses
`user-invocable: false`, and gets an explicit arguments line where it takes
flags. `Skill` stays in `allowed-tools` only where the body itself invokes
another skill.

The registry keeps `type: 'command'`, read as "invoked by name through the
Skill tool"; only the test's file resolver changes. Renaming the type would
touch every consumer for no gain.

A new validator rule makes the collision impossible to reintroduce.

## Implementation Plan

### Phase 1: Prove the starting point

- [x] 1.1 Check `gh pr list` and `git worktree list` for other sessions'
  open work on gt-workflow before editing.
- [x] 1.2 Run the baseline headless probe on the unmodified tree (see
  Verification) and record which text the Skill tool returns, with the Claude
  Code version.

### Phase 2: Skills become the entry point

- [x] 2.1 For each of the eight skills, move `argument-hint` and
  `allowed-tools` from the wrapper into `SKILL.md`, and remove
  `user-invocable: false`. Grep each body for Skill-tool calls; keep `Skill`
  only where one exists.
- [x] 2.2 Dropped during implementation: no `$ARGUMENTS` line is added. The
  bodies are copied to Codex, which would not substitute it, and probe 4
  shows Claude Code appends typed arguments as `ARGUMENTS: <text>`, which is
  what the bodies already read.
- [x] 2.3 Dropped during implementation: the descriptions keep "use the …
  skill". They are copied to Codex, where the slash-reference lint rejects
  `/name`, and the wording is now literally accurate.
- [x] 2.4 Delete `plugins/gt-workflow/commands/` and its eight files.

### Phase 3: Checks and callers

- [x] 3.1 `scripts/validate-setup-all.js`: have `loadCommandPlugins` also
  read `skills/<name>/SKILL.md` names, skipping skills that set
  `user-invocable: false`. Add a test.
- [x] 3.2 `tests/integration/stack-operation-registry.test.ts`: resolve an
  entry to `commands/<ref>.md` or `skills/<ref>/SKILL.md`. Update the
  registry comments that describe the wrapper layout.
- [x] 3.3 `scripts/validate-codex.js`: build the slash-name registry from
  user-invocable skills as well as commands. Add a test.
- [x] 3.4 New rule in `scripts/validate-agent-authoring.js`: error when a
  command and a skill in the same plugin have the same `name:`. Tests for a
  hit and a clean tree. Give it the next free RULE number and a catalog entry.
- [x] 3.5 Qualify the three bare dispatch sites as `gt-workflow:smart-submit`
  and `gt-workflow:gt-stack-plan`.

### Phase 4: Docs, generated files, verification

- [x] 4.1 Delete the "Observed on Claude Code 2.1.259" paragraph from root
  `CLAUDE.md` (lines 110–115).
- [x] 4.2 Update `plugins/gt-workflow/CLAUDE.md` (lines 32, 97–123, 311–328)
  and `README.md`: no command wrappers, eleven skills of which eight are
  user-invocable. Fix the "7 commands" count in root `README.md`. Say that
  `/gt-workflow:<name>` is the unambiguous typed form.
- [x] 4.3 Swept: the prose `/name` mentions stay valid as typed forms; only
  the wrapper descriptions in root `CLAUDE.md`, `plugins/gt-workflow/CLAUDE.md`
  and `README.md` and the registry comments changed.
- [x] 4.4 Run `pnpm generate:manifests` and `pnpm update:description-baseline`;
  confirm the Codex and Cursor outputs are unchanged and the gt-workflow
  baseline dropped.
- [x] 4.5 Changesets: gt-workflow minor; yellow-core and yellow-linear patch.
- [x] 4.6 Probes run on Claude Code 2.1.321, model haiku, 2026-11-09:
  before, `gt-workflow:gt-nav` returned the wrapper ("# Stack Navigator");
  after, it returned the skill body ("## What It Does"); bare `smart-submit`
  returned the plugin skill (run without user-level settings, so the
  user-level command was not in play); `--probe-flag-7391` arrived as
  `ARGUMENTS: --probe-flag-7391`. Four calls, about $0.015 in total.
- [x] 4.7 Run `pnpm validate:schemas`, `pnpm lint:plugins`,
  `pnpm validate:generated`, `pnpm validate:versions`, `pnpm test:integration`,
  `pnpm lint`, `pnpm typecheck`, and `bats tests/` in `plugins/gt-workflow/`.

## Verification

Headless probes, each a single short `claude -p` call with
`--plugin-dir <worktree>/plugins/gt-workflow`, a cheap pinned model, a budget
cap, and a prompt that asks only for the first heading of the text the Skill
tool returned. Run from a scratch directory, never from either clone.

1. Before any edit: `gt-workflow:gt-nav`. Expected today: the wrapper heading.
2. After: `gt-workflow:gt-nav`. Expected: the skill's first heading.
3. After: bare `smart-submit`, with the user-level command present. Record
   which one wins; this is information, not a pass condition.
4. After: `gt-workflow:gt-nav` with an argument, asking the model to repeat
   the argument text it received.

If `--plugin-dir` loads the plugin beside the installed copy and the result is
ambiguous, record that and fall back to an interactive check.

## Acceptance Criteria

1. Probe 2 returns the skill body, and probe 4 shows the argument reached it.
2. `plugins/gt-workflow/commands/` does not exist, and `git diff` shows no
   change under `plugins/gt-workflow/codex/`, `.codex-plugin/`,
   `.cursor-plugin/` or `.agents/`.
3. The new rule fails a fixture with a same-name pair and passes the real
   tree.
4. `validate-setup-all.js` passes with `gt-setup` resolved from the skill.
5. Every gate in 4.7 exits 0.
6. Root `CLAUDE.md` no longer contains the workaround paragraph.
7. The gt-workflow entry in `scripts/description-budget-baseline.json` is
   lower than 4,487.

## Edge Cases

- **Typed bare `/gt-nav`.** Whether a bare name reaches a plugin skill on this
  version is unverified. `/gt-workflow:gt-nav` is the documented form and is
  what the docs here will recommend.
- **Tool grants.** `allowed-tools` now lives in `SKILL.md`. If the Skill-tool
  path did not honour it, smart-submit would prompt on each Bash call. The
  probes do not cover this; note the first real run.
- **Model invocation.** The model could already trigger the wrappers from
  their descriptions, so direct invocation of the skills is not new. Any
  restriction is CLAUDE-308's decision.
- **Stack.** Regenerate the baseline only on top of #1768's current tip. If
  #1768 restacks, re-run the generators instead of hand-merging.
- **Codex slash lint.** Without 3.3, a stray `/gt-sync` in Codex-exposed text
  would stop being flagged.

## Open Questions

- Why Claude Code 2.1.321 resolves a same-name pair to the command when its
  docs say the skill wins. Not needed for this fix; worth an upstream report.

## References

- `plugins/gt-workflow/commands/`, `plugins/gt-workflow/skills/`
- `scripts/validate-agent-authoring.js` (`validateSkillWrapperDrift`, line
  1250), `scripts/validate-setup-all.js`, `scripts/validate-codex.js`
- `tests/integration/stack-operation-registry.test.ts`,
  `plugins/yellow-core/lib/stack-operation-registry.js`
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  (sections 28–29),
  `docs/solutions/integration-issues/codex-command-migration-bypasses-skill-allowlist.md`
- `plans/complete/claude-code-codex-plugin-pilot-04-gt-workflow-pilot.md`
- <https://code.claude.com/docs/en/skills>,
  <https://code.claude.com/docs/en/plugins-reference>
