# Feature: Description validators (single-line rule and budget ratchet)

Date: 2026-11-09 · Roadmap: `plans/claude-code-quality-and-cost-roadmap.md`,
initiative R2.1 · First PR of a three-PR stack (CLAUDE-307 and CLAUDE-308
follow and are out of scope).

## Problem Statement

`description:` frontmatter from every command, agent and skill is loaded into
each Claude Code session. Two things about it are unguarded:

- The single-line rule (RULE 15d) is checked only on `SKILL.md`. Two commands
  already carry Prettier-wrapped multi-line descriptions, and only review
  would catch a third.
- Nothing measures the total. It was 71,248 characters at plan time (70,817
  as shipped, after excluding manual-only commands) and can grow without
  anyone seeing it.

This PR adds both guards. It changes no model-visible behaviour.

## Linear Issues

- CLAUDE-291
- CLAUDE-306

## Settled Decisions

- CLAUDE-291 and CLAUDE-306 ship as one PR. (session-settled: user-approved —
  chosen over separate PRs: both edit the same validator.)
- No eval gate for this PR. (session-settled: user-approved — chosen over
  gating every change on the eval set: validators cannot alter model output.)
- The budget check fails when a plugin's total exceeds its committed baseline;
  the author raises that plugin's number in the same PR. A drop only prints a
  notice. (session-settled: user-approved — chosen over warn-only and over
  also failing until a lower number is committed: growth becomes a reviewable
  diff, and parallel PRs that shrink the same plugin do not collide.)
- The single-line rule stays advisory for agents and commands, with a reworded
  message. (session-settled: user-approved — chosen over making it an error:
  the truncation claim is unverified for current Claude Code, and every other
  RULE 15 sub-rule is a warning.)
- The two yellow-goal commands are fixed in this PR. (session-settled:
  user-approved — chosen over deferring them: the new rule then reports zero
  warnings, at the cost of one yellow-goal changeset.)

## Current State

- `scripts/validate-agent-authoring.js` holds RULE 15d at lines 1696–1733,
  inside `validateSkillFiles`. It reads the raw frontmatter string from
  `extractFrontmatter` and pushes a `[RULE 15d advisory]` warning. Warnings
  never change the exit code; only `errors` do (lines 1831–1842).
- Agents are validated in `validateAgentFile` (line 503), which has the raw
  frontmatter and `warnings`. Commands have only
  `validateCommandFiles(commandFiles, errors)` (line 1028).
- File discovery is in `main()` (lines 1761–1849). The skill walk also matches
  33 generated copies under `plugins/*/codex/skills/**` and
  `plugins/*/cursor/skills/**`.
- Violations today: `plugins/yellow-goal/commands/goal/request.md` and
  `plugins/yellow-goal/commands/goal/setup.md`. No agent or skill violates.
- 44 files already use a `# prettier-ignore` comment above `description:`.
  `format:check` exists in `package.json` but no workflow runs it.
- Baseline, counting `YAML.parse(frontmatter).description.length` over 307
  source files: commands 30,813, agents 23,240, skills 17,195. With the
  generated copies the figure would be 78,381.
- The message text, `CLAUDE.md` and `AGENTS.md` all say Claude Code "silently
  truncates" multi-line descriptions. One user's test on Claude Code 2.1.274
  (issue anthropics/claude-code#94301) found valid multi-line forms load in
  full for skills and commands; an unindented continuation drops all
  frontmatter. Agents were not tested.
- CI runs `node scripts/validate-agent-authoring.js` as its own step in
  `.github/workflows/validate-schemas.yml`, so a check inside that script
  needs no workflow change.

## Proposed Solution

Keep both checks inside `scripts/validate-agent-authoring.js`.

**Single-line rule.** Move the 15d block into one helper,
`checkDescriptionSingleLine(frontmatter, filePath, warnings)`, and call it for
skills, agents and commands. New message: the description spans several
lines; Prettier rewrapping produces this form, an unindented continuation
drops all frontmatter, and other parsers may read only the first line; keep it
on one line.

**Budget check.** In `main()`, after the per-file rules:

- Count the parsed `description` string length in characters (JS string
  length after YAML parse), plus `when_to_use` when present.
- Counted set: `.md` under `commands/` and `agents/`, and
  `skills/<name>/SKILL.md`, per plugin. Excluded: anything under a `codex/` or
  `cursor/` path segment, and any command or skill whose frontmatter has
  `disable-model-invocation: true` (boolean true only).
- A file with unparseable frontmatter is skipped; the per-file rules report it
  as an error (added for commands in this PR). A command or skill with no
  string description is an error: Claude Code would list its first body text,
  which the count cannot see. (Changed in review from "counts as 0".)
- Placement is by the directory directly under the plugin (`commands/`,
  `agents/`, `skills/`), not by excluding `codex/` and `cursor/` segments,
  which would have dropped real commands such as `commands/cursor/setup.md`.
- Compare each plugin with `scripts/description-budget-baseline.json`.

| Case | Result |
|---|---|
| Plugin total above its baseline | Error: plugin, baseline, current, delta, and the update command |
| Plugin with no baseline entry | Error, treated as baseline 0 |
| Plugin total below its baseline | Notice with the update command; exit code unchanged |
| Baseline entry with no plugin directory | Notice; `--update` drops it |
| `unit` in the file is not `chars` | Error |

- Always print one summary line: the derived overall total and the split by
  commands, agents and skills. The overall total is reported, never gated.
- `node scripts/validate-agent-authoring.js --update-description-baseline`
  rewrites the file from the working tree and exits 0 without running the
  other rules. Exposed as `pnpm update:description-baseline`.
- The baseline path comes from `VALIDATE_DESCRIPTION_BASELINE` when set. When
  `VALIDATE_PLUGINS_DIR` is set and that variable is not, the budget check is
  skipped, so the existing fixture tests are unaffected.

Baseline file shape, keys sorted, one per line, trailing newline:

```json
{
  "unit": "chars",
  "plugins": {
    "github-workflow": 0,
    "gt-workflow": 0
  }
}
```

No total is stored: a single shared number would conflict in every parallel
PR, and it is derivable.

## Implementation Plan

### Phase 1: Single-line rule

- [x] 1.1 Extract `checkDescriptionSingleLine` from lines 1696–1733 and call
  it from `validateSkillFiles`.
- [x] 1.2 Call it from `validateAgentFile` after the frontmatter guards.
- [x] 1.3 Add a loop over `commandFiles` in `main()` that extracts
  frontmatter and calls the helper.
- [x] 1.4 Reword the message and the RULE 15 catalog comment (lines ~256–270).
- [x] 1.5 Collapse the two yellow-goal descriptions to one line each, with
  `# prettier-ignore` above `description:`. Do not run `prettier --write` on
  `plugins/**`.

### Phase 2: Budget check

- [x] 2.1 Add `collectDescriptionBudget(agentFiles, commandFiles, skillFiles)`
  returning per-plugin totals and the split by kind, with the exclusions
  above.
- [x] 2.2 Add `checkDescriptionBudget` implementing the table, pushing to
  `errors` and to a notices list printed with the warnings.
- [x] 2.3 Add the `--update-description-baseline` flag and the
  `update:description-baseline` npm script.
- [x] 2.4 Generate and commit `scripts/description-budget-baseline.json` from
  the tree after 1.5.
- [x] 2.5 Give the check the next free RULE number in the catalog comment
  (check `AGENTS.md` for the current highest).

### Phase 3: Tests and docs

- [x] 3.1 Add
  `tests/integration/validate-agent-authoring-description-rules.test.ts`
  using `helpers/validator-harness.ts`. Cases:
  - 15d fires on an agent and on a command (block scalar; indented
    continuation); silent on single-line; exit status 0.
  - A `SKILL.md` violation is reported once, not twice.
  - Budget: at baseline passes; above fails with the plugin, both numbers and
    the update command; below passes with a notice.
  - New plugin with no entry fails; baseline entry for a missing plugin is a
    notice.
  - Generated `codex/skills` copy is not counted.
  - `disable-model-invocation: true` is excluded; the string `"true"` and an
    absent key are counted.
  - A command, skill or agent with no string description fails (changed in
    review from "counts 0"); a CRLF file counts the same as its LF twin.
  - Budget check is skipped when `VALIDATE_DESCRIPTION_BASELINE` is unset in
    a fixture run.
  - `--update-description-baseline` writes sorted keys and a trailing
    newline, and drops a removed plugin.
- [x] 3.2 Update the rule's scope and wording wherever it is stated:
  `CLAUDE.md` (lines 148–151: delete the "only runs on SKILL.md" gotcha),
  `AGENTS.md` (lines 321–324 and the RULE list; add the budget rule and the
  bump procedure), `CONTRIBUTING.md` (line 140), `docs/plugin-template.md`
  (line 408), `docs/plugin-validation-guide.md` (lines 61–66).
- [x] 3.3 State in `AGENTS.md` that the budget measures Claude Code's listing;
  Codex and Cursor still list commands that set `disable-model-invocation`.
- [x] 3.4 Add a patch changeset for yellow-goal.
- [x] 3.5 Run `pnpm validate:schemas`, `pnpm lint:plugins`,
  `pnpm validate:generated`, `pnpm test:integration`, `pnpm lint`,
  `pnpm typecheck`.

## Technical Details

- Modify: `scripts/validate-agent-authoring.js`, `package.json`, `CLAUDE.md`,
  `AGENTS.md`, `CONTRIBUTING.md`, `docs/plugin-template.md`,
  `docs/plugin-validation-guide.md`,
  `plugins/yellow-goal/commands/goal/request.md`,
  `plugins/yellow-goal/commands/goal/setup.md`.
- Create: `scripts/description-budget-baseline.json`,
  `tests/integration/validate-agent-authoring-description-rules.test.ts`,
  `.changeset/<name>.md`.
- No new dependencies. No workflow change.

## Acceptance Criteria

1. `pnpm validate:agents` prints no `[RULE 15d advisory]` line on the tree.
2. A multi-line description in an agent or command fixture produces the
   advisory and exit status 0.
3. Adding description text to any plugin without raising its baseline makes
   `pnpm validate:schemas` and the CI authoring step fail, naming the plugin
   and the update command.
4. Removing description text passes and prints a notice.
5. The committed baseline equals what `pnpm update:description-baseline`
   produces on the PR head.
6. No doc still says the single-line rule runs only on `SKILL.md`, and none
   states truncation as established fact.
7. The existing validator test files pass unchanged.

## Edge Cases

- **Stale branch.** `--update` writes the working tree's numbers. If `main`
  lowered a plugin after the branch point, restack before updating, or the
  merge can leave slack above the real total. Slack is tolerated by design;
  the next update removes it.
- **Two PRs lowering the same plugin.** Neither fails; the second to merge
  resolves a one-line conflict by re-running the update command.
- **Legitimate growth.** A new command or agent raises its plugin's number in
  the same PR. The reviewer of that diff is the approver.
- **Following PRs.** CLAUDE-307 and CLAUDE-308 each lower totals and re-run
  the update command.

## Open Questions

- Whether Claude Code still truncates multi-line agent descriptions is
  unverified. The reworded message avoids the claim; a direct test on the
  current version would settle whether the rule could be relaxed further.

## References

- `scripts/validate-agent-authoring.js` (lines 320–420 helpers, 503, 1028,
  1605–1735, 1761–1849)
- `tests/integration/helpers/validator-harness.ts`,
  `tests/integration/validate-agent-authoring-skill-rules.test.ts`
- `docs/solutions/code-quality/prettier-description-wrap-silent-truncation.md`
- `docs/solutions/workflow/skill-split-caveat-and-claude-md-drift.md`
- <https://code.claude.com/docs/en/skills> (listing budget and the 1,536
  character cap), <https://code.claude.com/docs/en/sub-agents>
- <https://github.com/anthropics/claude-code/issues/94301>
