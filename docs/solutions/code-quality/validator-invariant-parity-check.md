---
title: 'Tool-grant invariants need a validator check, not just AGENTS.md prose'
date: 2026-09-05
category: code-quality
track: knowledge
problem: prose invariant "tool X required for feature Y" has no validator; drifts silently across multiple files
tags: [validate-agent-authoring, tool-grant, subagent-dispatch, rename-hygiene, agents-md]
components: [scripts/validate-agent-authoring.js, docs/solutions]
---

## Context

PR #742 (Claude 5 modernisation: widen `MODEL_VALUE_PATTERN`, rename the
`Task` tool to `Agent` across ~40 tool lists, add RULE 21 line ceilings)
surfaced a recurring class of drift in `scripts/validate-agent-authoring.js`
and its companion docs: a rule stated as prose ("if the body does X, the
frontmatter must grant tool Y") is enforced for exactly one (tool, trigger)
pair and left unenforced for structurally identical pairs, and renaming a
tool name across the repo does not automatically catch every quoted
reference to the old name in `docs/solutions/`.

Two concrete instances from the review:

1. **`validateSkillToolGrant` only covers `Skill`.** AGENTS.md/PR body now
   also states "any command that delegates to an agent must include `Agent`
   in `allowed-tools`", but `validateSkillToolGrant` (RULE 19,
   `scripts/validate-agent-authoring.js:1702`) hardcodes the `Skill` tool
   mention regex and the `Skill` grant check. Nothing generalizes it to
   `Agent`/`subagent_type` dispatch, so a command that mentions dispatching
   a subagent without granting `Agent` passes CI silently — the exact
   failure mode RULE 19 was written to catch for `Skill`.
2. **The same gap exists for `TaskOutput`.** Both
   `plugins/yellow-core/commands/flow/plan.md` (lines 107, 249, 283) and
   `plugins/yellow-debt/commands/debt/audit.md` (line 156) mandate collecting
   results "via `TaskOutput`" in the body, but neither file's
   `allowed-tools` grants `TaskOutput` (both currently list `Agent`, not
   `TaskOutput`) — the same body-mandates-a-tool-but-grant-is-missing shape,
   already recurring across two plugins before anyone wrote a validator rule
   for it.

Separately, the `Task` → `Agent` rename left stale references in
`docs/solutions/code-quality/subagent-frontmatter-field-catalog.md:112`
("Do NOT include `Task` in a subagent's `tools`") and
`docs/solutions/code-quality/subagent-ref-registry-gated-fence-aware-checks.md:19`
(quoted validator-output examples still suggesting the
`Task(subagent_type=...)` form) — the same staleness pattern in two files,
because the rename swept `plugins/**/*.md` (the CI-enforced surface) but not
`docs/solutions/**/*.md` (not walked by any renamed-tool validator).

## Guidance

When a rule takes the shape "if the body mentions dispatching via tool T,
the frontmatter must grant T":

- Don't hardcode it to one `(trigger regex, required tool)` pair. Model it
  as a table/list of `{ toolMentionRegex, requiredTool }` entries and iterate
  over all of them in one validator pass — new entries (like `Agent`,
  `TaskOutput`) become one line, not a new hand-rolled function.
- Before adding a new "prose says X must be granted" invariant to
  AGENTS.md or a command/agent template, check whether an existing
  validator function already enforces the same *shape* of rule
  (`validateSkillToolGrant` is the shape here) and extend it instead of
  leaving the new invariant doc-only.
- When two files independently need the same tool grant fix (as `plan.md`
  and `audit.md` do for `TaskOutput`), that recurrence is itself the signal
  a validator rule is now cheaper than fixing it by hand each time it's
  found in review.

When a tool is renamed repo-wide (e.g. `Task` → `Agent`):

- The rename sweep must include `docs/solutions/**/*.md`, not just
  `plugins/**/*.md` — solution docs quote validator output, frontmatter
  examples, and tool-usage rules verbatim, and none of those quotes are
  covered by `validate-agent-authoring.js`'s live-file checks.
- Grep for the old tool name across the whole repo (`grep -rn '\bTask\b'
  docs/ plugins/`) after a rename PR, not just in the files the diff
  touched, since stale doc references don't fail any existing CI gate.

## Why This Matters

A stated invariant that isn't validator-enforced degrades to "true until
someone forgets" — worse than not stating it, because reviewers and authors
alike now trust a rule that CI does not actually check. The `Skill`/`Agent`/
`TaskOutput` case is the concrete example: RULE 19 already proved the
pattern works for one tool; leaving the other two as prose-only means the
next command author who mandates `Agent` or `TaskOutput` dispatch without
granting it will pass review only by luck.

## When to Apply

- Adding or reviewing a new "body mandates tool T" convention in a command
  or agent file — check whether `validateSkillToolGrant`-shaped enforcement
  should be generalized to cover it.
- Any repo-wide rename of a tool, command, or subagent name — treat
  `docs/solutions/` as part of the rename's scope, not an afterthought.

## Examples

Generalizing `validateSkillToolGrant` (scripts/validate-agent-authoring.js:1702):

```js
const TOOL_GRANT_RULES = [
  { mentionRe: /\bSkill`?\s+tool\b/, requiredTool: 'Skill' },
  { mentionRe: /\b(?:Agent|subagent_type)\b/, requiredTool: 'Agent' },
  { mentionRe: /\bTaskOutput\b/, requiredTool: 'TaskOutput' },
];

function validateToolGrants(files, errors, { toolsKey }) {
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const body = stripFencedContent(content);
    const frontmatter = extractFrontmatter(content);
    const grantedTools = parseList(frontmatter, toolsKey);
    for (const { mentionRe, requiredTool } of TOOL_GRANT_RULES) {
      if (mentionRe.test(body) && !grantedTools.includes(requiredTool)) {
        errors.push(
          `${relative(filePath)}: RULE 19 — body invokes ${requiredTool} ` +
            `but "${toolsKey}" frontmatter does not include "${requiredTool}"`
        );
      }
    }
  }
}
```
