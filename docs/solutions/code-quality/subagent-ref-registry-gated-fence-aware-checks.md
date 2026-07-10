---
title: 'Registry-Gated, Fence-Aware Subagent Reference Validation'
date: 2026-07-09
category: code-quality
track: knowledge
problem: New agent-dispatch lint checks must registry-gate on last-segment plugin ownership, not token shape
tags: [validate-agent-authoring, subagent-type, task-dispatch, fence-stripping, registry-gating, rule-13, plugin-authoring]
components: [scripts/validate-agent-authoring.js, yellow-ci, yellow-browser-test]
---

## Context

`scripts/validate-agent-authoring.js`'s subagent-dispatch reference check
(`pluginSubagentPattern`, requires >=1 colon) had two silent gaps:

1. Colon-less `subagent_type: "runner-assignment"` values were invisible to
   the pattern entirely (found in
   `plugins/yellow-ci/commands/ci/setup-self-hosted.md`).
2. The `Task(bareword):` shorthand (found at 6 dispatch sites across
   `plugins/yellow-browser-test/commands/browser-test/*.md`) is not a real
   dispatch form — Claude Code requires
   `Task(subagent_type="plugin:dir:name")`.

Both fail silently at runtime (no error surfaces; the agent either doesn't
dispatch or dispatches the wrong thing) and neither was caught by the
existing raw-content registry scan in `validateSubagentReferences`, which
only recognizes the colon-ful `plugin:dir:name` / `plugin:name` shapes.
PR #633 (`agent/feat/subagent-ref-hardening`, Wave 2 of the 2026-07-09
audit-remediation stack) added two new checks to close both gaps.

---

## Guidance

### 1. Registry-gate, don't shape-gate (RULE 13 lesson, generalized)

A new lint check for agent-dispatch references (colon-less values, bareword
shorthand, or any other malformed-but-plausible reference) must not flag
every token that merely *looks like* an agent reference. It must check the
extracted last-path-segment against an actual registry of known
plugin-owned agents before erroring:

```js
// Map final agent-name segment → Set of fully-qualified 3-segment refs.
function buildLastSegmentIndex(pluginAgents) {
  const index = new Map();
  for (const ref of pluginAgents) {
    const parts = ref.split(':');
    if (parts.length !== 3) continue;
    if (!index.has(parts[2])) index.set(parts[2], new Set());
    index.get(parts[2]).add(ref);
  }
  return index;
}
```

Both new checks look up `lastSegmentIndex.get(bare)` and only push an error
when a match exists. Shape-only gating (e.g. "lowercase alphanumeric plus
hyphens") would false-positive on Claude Code's built-in agent types
(`general-purpose`, etc.) and on incidental prose that happens to look like
a bareword — the exact class of bug RULE 13 already paid down once for
allowlist logic anchored to token shape instead of plugin ownership (see
`docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md`).

### 2. Pair fence-aware NEW checks with the EXISTING unfenced registry scan

Teaching docs deliberately show illustrative `Task(...)` dispatch syntax
inside fenced code blocks, so the two new checks run on
`stripFencedContent(content)` (frontmatter + fenced blocks stripped) to
avoid tripping on those examples:

```js
function stripFencedContent(content) {
  return content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/^[ \t]{0,3}```[^\n]*\r?\n[\s\S]*?^[ \t]{0,3}```[ \t]*\r?$/gm, '');
}
```

But real dispatch instructions also commonly live *inside* fenced blocks —
that's how command markdown documents a `Task(...)` call in the first
place. So the design does not fence-strip everything: the pre-existing
`pluginSubagentPattern` scan keeps running on raw (unfenced) content,
because it already validates the canonical `subagent_type="plugin:dir:name"`
form against the registry wherever it appears. Once a site is converted to
that canonical form, it's covered regardless of fencing. Coverage and
false-positive avoidance trade off **per check**, not globally — decide
fence-awareness independently for each new pattern based on where its real
instances live.

### 3. Factor shared helpers at the second call site, not the first

`stripFencedContent()` was extracted from RULE 15b's inline
frontmatter/fence stripping (the three-heading-rule check) the moment a
second caller needed identical logic — no behavior change to RULE 15b, pure
de-duplication.

### 4. Red-then-green inside the same PR

This repo's standing pattern for validator hardening: add the check(s),
grep the full tree for newly-red sites, fix every one in the same PR, prove
the full tree green, and call out the "innocent bystander" effect explicitly
in the PR description — open PRs rebasing onto the branch will go red if
they carry the old patterns; the fix is mechanical (update to the
fully-qualified form the error message suggests).

---

## Why This Matters

A membership check that only validates shape re-derives the exact bug this
repo already paid for once under RULE 13. This PR is the second and third
instance of an agent-dispatch-reference check in this file — treat
shape-only matching as a bug smell in review for any future one.

---

## When to Apply

When adding a new validator rule in `validate-agent-authoring.js` (or a
sibling plugin-authoring validator) that recognizes agent-dispatch
references in free-form markdown prose, not just structured frontmatter.
Two questions up front:

- **Can this token collide with a built-in or incidental prose match?**
  Registry-gate on last-segment membership.
- **Does this pattern also appear inside fenced teaching examples?**
  Decide per-check whether fence-awareness helps (exempts illustrative
  examples) or hurts (misses real fenced dispatch instructions); if real
  instances live in both fenced and unfenced content, pair a fenced new
  check with an existing unfenced one that already covers the canonical
  form.

---

## Examples

- **Colon-less pattern:**
  `` /subagent_type\s*(?:=|:)\s*[`"']*([a-z0-9-]+)(?![a-z0-9:-])/g `` — the
  negative lookahead prevents partial-matching the first segment of a
  colon-ful reference already covered by `pluginSubagentPattern`.
- **Bareword pattern:** `` /\bTask\(\s*([a-z0-9-]+)\s*\)\s*:/g `` catches
  `Task(test-runner): "..."` and suggests
  `Task(subagent_type="yellow-browser-test:testing:test-runner")`.
- **Fixed sites:** `plugins/yellow-ci/commands/ci/setup-self-hosted.md`
  (`subagent_type: "runner-assignment"` →
  `"yellow-ci:ci:runner-assignment"`); 6 sites across
  `plugins/yellow-browser-test/commands/browser-test/{explore,report,setup,test}.md`
  (`Task(test-runner):` / `Task(test-reporter):` → canonical
  `Task(subagent_type="yellow-browser-test:testing:{test-runner,test-reporter}")`).
- **Test harness (RULE 16 shape):**
  `tests/integration/validate-agent-authoring-subagent-refs.test.ts` — 6
  cases (green, colon-less red, bareword red, fenced-example
  false-positive guard, unregistered-value guard, red-then-fixed) using the
  repo's `writeAgent`/`runValidator` harness.
