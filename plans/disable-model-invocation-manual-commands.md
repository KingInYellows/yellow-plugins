# Feature: RULE 25 for disable-model-invocation (no new flags)

Linear CLAUDE-308, roadmap initiative R2.3
(`plans/claude-code-quality-and-cost-roadmap.md`). Third PR of the stack, on
top of `agent/feat/CLAUDE-307-gt-workflow-name-collisions` (PR #1769).

## Problem Statement

Every command and user-invocable skill description is loaded into every
session. RULE 23 measures the total at 68,893 characters. Only two commands
set `disable-model-invocation: true` (`ci:runner-cleanup`, `goal:run-real`),
so commands that only the user ever types still pay for a description.

The flag is not free. It also stops Claude from running the entry point, and a
flag on anything another command dispatches by name breaks that chain. A
February 2026 review had to remove the flag from `linear:sync` and
`linear:plan-cycle` for that reason
(`docs/solutions/security-issues/yellow-linear-plugin-pr-review-fixes.md`).
Nothing in the validators stops that from happening again.

## Settled Decisions

- Ship RULE 25 and the `create-agent-skills` correction, and flag no new
  entry point in this PR (session-settled: user-directed — chosen over
  flagging nine cursor, devin and linear commands, or a minimum of
  `cursor:cancel` and `linear:sync-all`: review showed the key hides a
  command without removing the capability, yellow-devin is security-only,
  yellow-cursor is the preferred provider, and the saving was under 2%).

<!-- deepen-plan: codebase -->
> **Codebase:** The first scope choice (all 20 undispatched commands) rested
> on "nothing else mentions them", which was wrong. None is dispatched, but
> several are named as hints to the user in sibling commands and docs, and
> every one has a "Use when user says ..." description (for example
> `plugins/yellow-cursor/commands/cursor/cancel.md:3`,
> `plugins/yellow-ci/commands/ci/status.md:3`). The maintainer narrowed the
> scope to side-effecting commands after seeing this.
<!-- /deepen-plan -->
- Cross-plugin Skill dispatches to gt-workflow use the qualified
  `gt-workflow:<name>` form (session-settled: user-directed — chosen over bare
  names: a user-level command can shadow a bare name).
- gt-workflow entry points ship as user-invocable skills with no same-named
  wrapper commands (session-settled: user-approved — chosen over renaming the
  commands: no user-facing rename).

## Outcome

Tasks 3.1, 3.4 and 4.1 were done and then reverted after the PR review
(`/review:pr 1773`). The PR ships tasks 2.1 to 2.5, 3.2 and 3.3 only: the
validator rule, its tests, and the doc corrections. The description total is
unchanged at 68,893 characters, so CLAUDE-308 stays open. What the review
found:

- The key stops the Skill tool running an entry point by name. It does not
  stop Claude reading the command or calling the CLI it wraps, and a hidden
  command's ask-first step is skipped if Claude calls the CLI directly.
- With the description gone, nothing tells Claude the command exists, so it
  cannot ask the user to type it.
- yellow-jules is scheduled for removal (CLAUDE-262) and yellow-devin is
  `support: security-only`; neither should take behaviour changes.

Before any entry point is flagged: probe whether Claude falls back to the
CLI, add a model-visible line naming the typed-only commands, and audit the
candidates against an eval (CLAUDE-304, CLAUDE-305).

## Current State

What the key does, probed on Claude Code 2.1.322 with a scratch plugin
(a command and a skill, each with and without the key):

| Check | With the key |
| --- | --- |
| Description in the session listing | Absent |
| Skill tool, qualified name | Refused: "cannot be used with Skill tool due to disable-model-invocation" |
| Typed `/plugin:name` in headless `-p` | Runs the body |

So a flagged entry point leaves the context, cannot be dispatched by another
command or skill, and cannot be run by Claude when the user asks in plain
language. The documentation adds that a flagged skill cannot be preloaded by an
agent's `skills:` list and does not run for a scheduled task. Upstream issue
anthropics/claude-code#22345 (plugins ignore the key) does not reproduce.

Repository facts:

- Only `scripts/validate-agent-authoring.js` reads the key. RULE 23 skips a
  command or skill whose value is boolean `true`.
- No schema or lint constrains command or skill frontmatter keys.
- Codex and Cursor copies keep only `name` and `description`, and commands are
  not exposed there, so the change is Claude-only.
- `plugins/yellow-core/skills/create-agent-skills/SKILL.md` (lines 83 and 95)
  describes the key wrongly, as "prints markdown only (no LLM call)".
- 54 entry points are dispatched by name and cannot take the key: the 8
  gt-workflow skills and 9 `github-stack:*` commands (targets in
  `plugins/yellow-core/lib/stack-operation-registry.js`), the 22 setup entry
  points `/setup:all` dispatches, `flow:plan`, `flow:work`, `flow:spec`,
  `flow:deepen-plan`, `flow:expand-shell`, `flow:compound`, `review:pr`,
  `review:resolve`, `review:triage`, `review:sweep`, `council`, `linear:sync`,
  `linear:work`, `linear:delegate`, `devin:delegate`, `worktree:cleanup`, and
  the `library-context` skill (preloaded by an agent).
- That answers the open question from PR #1769: `gt-merge`, `gt-cleanup`,
  `gt-setup` and `gt-sync` stay model-invocable, because the registry and
  `/setup:all` dispatch them.

## Proposed Solution

1. Add the key to the 9 undispatched commands that start, change or cancel
   remote work. yellow-jules is left alone: it is scheduled for removal after
   2026-12-31 (CLAUDE-262), and the roadmap excludes it from description work.
2. Add RULE 25 so a flagged entry point can never be a dispatch target.
3. Correct the description of the key in `create-agent-skills`.
4. Lower the RULE 23 baseline to the new totals.

Candidates (confirmed in tasks 1.1 and 1.2; any that fails is dropped):

| Plugin | Commands |
| --- | --- |
| yellow-cursor | `cursor:delegate`, `cursor:follow-up`, `cursor:cancel`, `cursor:archive`, `cursor:unarchive` |
| yellow-devin | `devin:archive`, `devin:cancel`, `devin:tag` |
| yellow-linear | `linear:sync-all` |

Left model-invocable although undispatched: `cursor:list`, `cursor:usage`,
`cursor:artifacts`, `ci:status`, `codex:status`, `semgrep:scan`,
`browser-test:report`, `setup:claude-web`.

Result: 1,500 of 68,893 characters (cursor 933, devin 403, linear 164).

<!-- deepen-plan: codebase -->
> **Codebase:** Description plus `when_to_use` for all 20 undispatched
> commands sums to 3,683 characters (cursor 1,442, devin 403, jules 720,
> linear 164, ci 142, codex 122, semgrep 197, browser-test 195, core 298).
> The 12 kept here are devin 403, jules 720, linear 164 and five of the
> eight cursor commands. `plugins/yellow-devin/CLAUDE.md:166` already calls
> `devin:cancel` "Always manual".
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Mentions of the 12 that must keep working as hints to the
> user: `cursor:delegate` in `plugins/yellow-devin/CLAUDE.md:19`,
> `plugins/yellow-devin/README.md:16`, `cursor/follow-up.md:13` and
> `cursor/status.md:60`; `cursor:archive` in `cursor/list.md:13` and
> `cursor/unarchive.md:12`; `cursor:unarchive` in `cursor/follow-up.md:70,83`;
> `cursor:follow-up` in `cursor/status.md:60`; `linear:sync-all` in
> `plugins/yellow-linear/skills/linear-workflows/SKILL.md:431`. Task 1.2
> reads each one and confirms it tells the user, not the model, to run it.
<!-- /deepen-plan -->

Accepted regression: asking Claude in plain language to do what one of these
commands does no longer runs the command. Claude is told to ask the user to
type it. Nothing can verify plain-language reachability today, so the PR body
and the changesets say so.

RULE 25, in `scripts/validate-agent-authoring.js`:

- Error when an entry point with the key is the target of any real dispatch:
  a `skill: "..."` value (qualified, or bare and resolved in the same plugin),
  an agent `skills:` preload, the `/setup:all` delegated list, or a
  `stack-operation-registry.js` entry.
- Error when a skill sets the key and `user-invocable: false`: nothing could
  reach it.
- Error when the key's value is not a boolean, so `"true"` cannot silently
  leave the description counted.
- Advisory when a hook script or a `CLAUDE.md` names the slash form of a
  flagged entry point. Those messages are read by the model, and the flag
  would make them dead ends. It stays advisory because prose hints to the
  user are legitimate.

## Implementation Plan

### Phase 1: Verify

- [x] 1.1: Confirm with a script that none of the 12 is a real dispatch
      target: no `skill:` value, agent `skills:` preload, `/setup:all`
      delegated entry or registry entry names it.
- [x] 1.2: Read the 12 command bodies and every mention listed above. Drop a
      command when a mention instructs the model, not the user, to run it, or
      when the body shows it is not side-effecting. Record the final list
      here.

### Phase 2: Validator

- [x] 2.1: RULE 25 errors: flagged entry point as a `skill:` target (reuse
      RULE 18's target index; add bare-name resolution), as an agent `skills:`
      preload, in the `/setup:all` delegated list, or in the stack-operation
      registry.
- [x] 2.2: RULE 25 errors for a skill with the key and `user-invocable: false`,
      and for a non-boolean value.
- [x] 2.3: RULE 25 advisory for a hook script or the root `CLAUDE.md` that
      names a flagged entry point's slash form.

<!-- deepen-plan: codebase -->
> **Codebase:** Each plugin's own `CLAUDE.md` lists its commands in slash
> form (for example `plugins/yellow-cursor/CLAUDE.md:144-154`), so an
> advisory over every `CLAUDE.md` would fire for each flagged command on day
> one. Scope it to `plugins/*/hooks/` scripts and the root `CLAUDE.md`.
<!-- /deepen-plan -->
- [x] 2.4: `tests/integration/validate-agent-authoring-rule25.test.ts`, on the
      RULE 24 test's pattern: one failing fixture per dispatch kind, the two
      extra errors, the advisory, a fenced example that is ignored, and a
      passing tree.
- [x] 2.5: `tests/integration/stack-operation-registry.test.ts` asserts no
      registry target sets the key.

### Phase 3: Flags and docs

- [x] 3.1: Add `disable-model-invocation: true` to the commands from 1.2.
- [x] 3.2: Correct the key's description and the invocation matrix in
      `plugins/yellow-core/skills/create-agent-skills/SKILL.md`.
- [x] 3.3: `AGENTS.md`: RULE 25 bullet, with the rule for choosing manual-only
      commands. `CONTRIBUTING.md`: one sentence where the budget section
      mentions the key.
- [x] 3.4: Each touched plugin's `README.md` or `CLAUDE.md` says which commands
      are typed-only, where it lists commands.

<!-- deepen-plan: codebase -->
> **Codebase:** Command lists to update: cursor `README.md:49-57` and
> `CLAUDE.md:144-154`; devin `README.md:85-88`, `CLAUDE.md:128-132,166-169`
> and `docs/commands.md:14-17`; jules `README.md:54-57` and
> `CLAUDE.md:587-591`; linear `README.md:38` and `CLAUDE.md:39`.
> `plugins/yellow-cursor/README.md:129-132` maps devin commands to cursor
> ones. `scripts/validate-doc-counts.js` counts plugins, not commands, so no
> count changes. Run `plugins/yellow-jules/tests/delegate-command-binding.test.ts`
> after editing `approve.md` and `reply.md`; it reads their text.
<!-- /deepen-plan -->

### Phase 4: Quality

- [x] 4.1: `pnpm update:description-baseline`; commit the lower baseline.
- [x] 4.2: Changeset for each plugin touched, stating that the listed commands
      now run only when typed.
- [x] 4.3: `pnpm validate:schemas`, `pnpm lint:plugins`,
      `pnpm validate:versions`, `pnpm lint`, `pnpm typecheck`,
      `pnpm test:integration`, `pnpm generate:manifests` (expect no change).
- [x] 4.4: Headless probes against the real plugins: one flagged command runs
      when typed and is absent from the listing; `gt-workflow:smart-submit` and
      one setup entry point still load through the Skill tool.

## Technical Details

- Modify: `scripts/validate-agent-authoring.js`,
  `scripts/description-budget-baseline.json`,
  `tests/integration/stack-operation-registry.test.ts`, 12 command files,
  `plugins/yellow-core/skills/create-agent-skills/SKILL.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, plugin READMEs.
- Create: `tests/integration/validate-agent-authoring-rule25.test.ts`,
  changesets.
- The registry module has no dependencies, so the validator can `require` it.
  `scripts/validate-setup-all.js` already parses the delegated list; move its
  parser to `scripts/lib`.

<!-- deepen-plan: codebase -->
> **Codebase:** `scripts/validate-setup-all.js` has no `module.exports` and
> calls `main()` at line 685, so requiring it runs the whole validation.
> Move `parseDelegatedCommands` (:149-155) and `extractMarkedSection`
> (:127-133) into a `scripts/lib` module both scripts require.
> `buildDispatchTargetIndex` (`scripts/validate-agent-authoring.js:1396-1460`)
> maps a command `name:` or `<plugin>:<skill name>` to its file and carries
> no flag, so RULE 25 re-reads the target's frontmatter with
> `parseFrontmatter` (:348-424), which tells a boolean from a string. Use
> `isUserInvocableSkill` from `scripts/lib/skill-frontmatter.js` for the
> `user-invocable: false` check and `parseList(frontmatter, 'skills')` (:765)
> for agent preloads. The authoring validator also runs `main()` on load, so
> RULE 25 is tested by subprocess, as the RULE 24 test does.
<!-- /deepen-plan -->
- RULE 18 strips fenced code and checks only values containing a colon. RULE
  25 needs bare names too, resolved within the calling plugin.
- No dependencies to add.

## Acceptance Criteria

- `pnpm validate:agents` passes, and fails on a fixture for each RULE 25 case.
- The baseline total drops by the summed descriptions of the flagged commands.
- No entry point in the 54-item dispatched set carries the key.
- Probes in 4.4 give the expected results on the installed Claude Code.
- The PR body and changesets state the plain-language regression.

## Edge Cases

- A command named in a hook message read by the model
  (`/debt:status`, `/ruvector:status`): not in the candidate list; the
  advisory guards future flags.
- `stack:status` and `stack:select`: root `CLAUDE.md` tells the model to run
  them; not candidates.
- A cross-plugin dispatch whose target plugin is absent from a fixture tree:
  RULE 25 skips it, as RULE 18 does.
- A flagged command may omit `description` (AGENTS.md); RULE 25 does not
  require one.

<!-- deepen-plan: codebase -->
> **Codebase:** RULE 23 skips a file only when the value is strictly boolean
> `true` (`scripts/validate-agent-authoring.js:1898`), so `"true"` is counted
> today with no message; RULE 25's non-boolean error closes that. A plugin
> under its baseline gets a `[RULE 23 notice]` (:1961-1965), not an error, so
> validation passes before task 4.1. The update command rewrites every
> per-plugin number and refuses when any file is malformed or undescribed
> (:2065-2078). The baseline file holds per-plugin numbers only; the 68,893
> total comes from the validator's output.
<!-- /deepen-plan -->
- Baseline merge conflicts with other open PRs: re-run the update command on
  the merged tree.
- Upstream reports that a typed bare name for a flagged skill is sometimes not
  recognised (anthropics/claude-code#78523). No skill is flagged here, and
  plugin commands are typed in their `namespace:verb` form.

## Open Questions

- Whether the flagged plugins take a patch or a minor bump. The commands keep
  working when typed, but Claude can no longer run them on request.
- The 77 entry points that other files mention (about 16.8k characters) are
  left for a follow-up once the eval floor (CLAUDE-304, CLAUDE-305) exists.

## References

- `plans/specs/authoring-evals-and-context-budget.md` R14, R16, R17
- `plans/claude-code-quality-and-cost-roadmap.md` R2.3
- `tests/integration/validate-agent-authoring-rule24.test.ts` (test pattern)
- `docs/solutions/security-issues/yellow-linear-plugin-pr-review-fixes.md`
- https://code.claude.com/docs/en/skills (invocation control table)
- Linear follow-ups from the two PRs below: CLAUDE-331, CLAUDE-333
