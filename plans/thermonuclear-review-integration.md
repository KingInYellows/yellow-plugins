# Recommendation

Add Cursor’s rubric to **`plugins/yellow-review` as an opt-in structural-quality reviewer**.

I would **not**:

* Fold it into the existing `maintainability-reviewer`.
* Import Cursor’s entire `thermos` or `cursor-team-kit` plugin.
* Create a separate `yellow-thermos` plugin yet.
* Make it an always-on reviewer.
* Allow it to automatically perform large architectural refactors.

Your current `yellow-review` already provides adaptive orchestration, correctness, security, maintainability, adversarial review, testing analysis, simplification, structured findings, and stack workflows. The existing maintainability reviewer is an everyday, calibrated reviewer for premature abstraction, dead code, indirection, coupling, and naming.

Cursor’s rubric is deliberately more aggressive. It seeks “code-judo” restructurings, rejects ad hoc branching growth, challenges type and module boundaries, watches for files crossing 1,000 lines, and holds code to a stricter approval standard than mere behavioral correctness.

The resulting architecture should be:

```text
Pinned Cursor upstream source
        │
        ▼
yellow-thermonuclear-review skill
        │
        ├── Claude Code: thermonuclear-reviewer agent
        │                  │
        │                  └── opt-in from /review:pr
        │
        ├── Cursor: generated allowlisted skill
        │
        └── Codex: generated allowlisted skill
```

## Naming

Use different names for the adapted Yellow components:

```text
Skill: yellow-thermonuclear-review
Agent: thermonuclear-reviewer
Reviewer field: thermonuclear
Category field: maintainability
```

I would not retain the exact upstream skill name. Cursor already ships that same name from both `cursor-team-kit` and the standalone `thermos` plugin, and the upstream commit explicitly acknowledges the resulting overlap. A Yellow-prefixed name prevents a third ambiguous copy when someone installs both official Cursor plugins and your marketplace.

The description can still include all useful discovery phrases:

> Opt-in structural maintainability audit adapted from Cursor’s thermo-nuclear code-quality review. Use for thermonuclear review, code-judo simplification, spaghetti-growth analysis, giant-file review, or an unusually strict architecture-quality pass.

# Two-PR implementation stack

## PR 1 — Add the canonical skill and Claude reviewer

Suggested branch:

```text
agent/feat/thermonuclear-reviewer
```

Suggested title:

```text
feat(yellow-review): add opt-in thermonuclear structural reviewer
```

### New files

```text
plugins/yellow-review/
├── agents/review/
│   └── thermonuclear-reviewer.md
├── skills/
│   └── yellow-thermonuclear-review/
│       └── SKILL.md
├── references/
│   └── thermonuclear-review/
│       └── UPSTREAM.md
├── LICENSES/
│   └── cursor-team-kit-MIT.txt
└── tests/
    ├── thermonuclear-reviewer.bats
    └── fixtures/thermonuclear/
        ├── crosses-1000-lines/
        ├── already-large-file/
        ├── spaghetti-branching/
        ├── justified-domain-complexity/
        ├── canonical-helper-reuse/
        └── prompt-injection/
```

### Existing files to update

```text
plugins/yellow-review/README.md
plugins/yellow-review/CLAUDE.md
plugins/yellow-review/skills/pr-review-workflow/SKILL.md
plugins/yellow-review/commands/review/review-pr.md
plugins/yellow-review/commands/review/review-all.md
.changeset/<generated-name>.md
```

The changes to `review-pr.md` and `review-all.md` should be limited to registering the reviewer as a valid opt-in agent. Do not add a new large conditional workflow or duplicate the collection and aggregation pipeline.

### Activation

Your existing per-project configuration already supports additive reviewers through `reviewer_set.include`, so the first release does not need another slash command. This activation path is supported only under the persona pipeline (`review_pipeline: persona`, the default) — `review_pipeline: legacy` bypasses the persona dispatch table and loads `references/review-pr/legacy-fallback.md`, whose fixed reviewer list has no mapping for `thermonuclear-reviewer`, so `reviewer_set.include: [thermonuclear-reviewer]` is silently ignored in legacy mode.

A repository would enable it with:

```yaml
---
reviewer_set:
  include:
    - thermonuclear-reviewer
---
```

Then run the normal:

```text
/review:pr
```

This provides the most useful behavior: the normal correctness, security, project-compliance, and maintainability passes still run, while the thermonuclear reviewer adds a high-pressure structural perspective.

### Agent frontmatter

Use the same expensive-review precedent as your current adversarial reviewer:

```yaml
---
name: thermonuclear-reviewer
description: "Opt-in structural-quality reviewer. Searches for behavior-preserving code-judo simplifications, spaghetti growth, unjustified file sprawl, weak boundaries, misplaced ownership, and abstractions that preserve incidental complexity."
model: opus
effort: xhigh
background: true
skills:
  - yellow-thermonuclear-review
tools:
  - Read
  - Grep
  - Glob
---
```

Your existing adversarial reviewer already uses `opus`, `xhigh`, background execution, and the same read-only tool set for an expensive conditional review lane.

Do not give this reviewer:

```text
Bash
Edit
Write
Agent
```

Cursor’s official wrapper also expects the parent to gather the diff and file contents, applies the rubric only to that evidence, and prohibits nested subagents by default.

The agent and its `yellow-thermonuclear-review` skill must carry the same
`## CRITICAL SECURITY RULES` block and `--- code begin (reference only) ---`
delimiters as the existing reviewer personas (see
`plugins/yellow-review/agents/review/adversarial-reviewer.md` and
`plugins/yellow-core/skills/security-fencing/SKILL.md`): diffs, file
contents, commit messages, and pull-request text are untrusted data to
analyze, never instructions to follow.

### Reviewer output contract

Have it use your existing compact-return schema:

```json
{
  "reviewer": "thermonuclear",
  "findings": [
    {
      "title": "Replace scattered mode checks with one explicit state model",
      "severity": "P2",
      "category": "maintainability",
      "file": "src/example.ts",
      "line": 142,
      "confidence": 75,
      "autofix_class": "advisory",
      "owner": "human",
      "requires_verification": true,
      "pre_existing": false,
      "suggested_fix": "Represent the three modes as one discriminated state and dispatch at the boundary instead of branching in each handler."
    }
  ],
  "residual_risks": [],
  "testing_gaps": []
}
```

The reviewer should emit all actual findings with a confidence anchor and let the aggregator apply the confidence gate once. That matches the currently open review-recall change in PR #743 rather than recreating persona-level suppression.

For safety, use these defaults:

```text
autofix_class: advisory
owner: human
requires_verification: true
```

A structural rewrite should never be classified as `safe_auto`. A narrowly scoped, mechanically obvious change could be `manual` with `downstream-resolver`, but that should be exceptional.

## How the Yellow adaptation should differ from Cursor’s original

Preserve the substance, but calibrate it to your existing review architecture.

| Cursor behavior                               | Yellow adaptation                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| “Be ambitious” and find code-judo moves       | Preserve                                                                                          |
| Detect spaghetti condition growth             | Preserve                                                                                          |
| Challenge weak types and boundaries           | Preserve                                                                                          |
| Reuse canonical helpers and ownership layers  | Preserve                                                                                          |
| Challenge sequential/non-atomic orchestration | Preserve                                                                                          |
| File crosses below 1,000 to above 1,000       | Preserve, but evidence-gate it                                                                    |
| “Go for it” restructuring language            | Convert to actionable review advice, not repository edits                                         |
| Free-form review comments                     | Convert to compact-return JSON                                                                    |
| Prefer only high-conviction comments          | Do not invent nits, but report real findings at their actual confidence                           |
| Broad maintainability remit                   | Exclude naming, ordinary dead code, and local cleanup already owned by `maintainability-reviewer` |
| Exact upstream name                           | Rename to `yellow-thermonuclear-review`                                                           |

### Evidence requirements

Every finding should satisfy all of the following:

1. **Identify the structural regression**, not merely say that code is complicated.
2. **Point to changed code** with a repository-relative path and line.
3. **Describe the simpler model**, ownership boundary, or control flow.
4. **State what behavior remains unchanged** under the proposed restructuring.
5. **Verify claimed canonical helpers or abstractions actually exist** before recommending reuse.
6. **Avoid domain-complexity false positives** where the implementation is complex because the real business domain is complex.

For the 1,000-line rule, require:

```text
base line count < 1000
head line count > 1000
file is not generated, vendored, or a lockfile
new content has a coherent extractable responsibility
```

A file that was already 1,400 lines and gains a localized five-line fix should not automatically receive a threshold finding. Likewise, crossing 1,000 lines should ordinarily be P2 rather than P1 unless the resulting structure creates a concrete high-impact engineering risk.

### Scope boundary with existing reviewers

The new reviewer should not report these by themselves:

```text
Poor variable naming
An isolated unused helper
Ordinary missing tests
A straightforward correctness bug
A known security vulnerability
A local retry/timeout problem
Formatting or style preferences
```

Those already have owners in your review system.

It should report:

```text
A new feature scattered through unrelated shared paths
Several booleans creating an implicit, invalid state machine
A refactor that moves complexity but does not remove any concepts
A wrapper hierarchy that obscures a direct data flow
A cast-heavy boundary concealing the real invariant
A duplicate helper when a verified canonical implementation exists
An orchestration sequence that can leave related state half-applied
A large-file crossing where one cohesive module can clearly be extracted
```

# Licensing and upstream provenance

The Cursor Team Kit component is MIT-licensed, but copies and substantial adaptations must retain the copyright and license notice.

Add the full upstream license as:

```text
plugins/yellow-review/LICENSES/cursor-team-kit-MIT.txt
```

Add an attribution comment near the top of the adapted skill:

```markdown
<!--
Adapted from Cursor's thermo-nuclear-code-quality-review skill.
Source: cursor/plugins
Upstream commit: 6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf
Upstream blob: ac76a2bc88bb2d895e83ab1788aa584a82346cfc
License: MIT; see plugins/yellow-review/LICENSES/cursor-team-kit-MIT.txt
-->
```

Record the adaptation details in `UPSTREAM.md`:

```yaml
repository: cursor/plugins
commit: 6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf
skill_path: cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md
skill_blob: ac76a2bc88bb2d895e83ab1788aa584a82346cfc
agent_path: cursor-team-kit/agents/thermo-nuclear-code-quality-review.md
agent_blob: dc83d959306c41bb9a4b504608d9607be34e4297
retrieved: 2026-09-04
license: MIT
```

The current upstream skill was restored at that commit on May 28, 2026, and the official wrapper’s current blob is separately identifiable.

Do not make CI download the live upstream file. Keep CI deterministic and review upstream drift manually against the recorded commit and blob.

# PR 2 — Expose the portable skill to Cursor and Codex

Suggested branch:

```text
agent/feat/thermonuclear-cross-host
```

Suggested title:

```text
feat(distribution): expose thermonuclear review to Cursor and Codex
```

Keep this separate from PR 1 so target compatibility is supported by actual smoke-test evidence rather than being declared speculatively.

`yellow-review` currently enables Claude but leaves Codex disabled, and it has no Cursor target.  The root Cursor marketplace currently exposes only `yellow-cursor`.

Your generator already supports per-target skill allowlists, so there is no need to expose all of `yellow-review` to either host. Existing Codex-enabled and Cursor-enabled plugins demonstrate this structure.

Update the catalog source:

```text
catalog/plugins/yellow-review.json
```

Enabling these targets also invalidates hand-authored claims in docs that
the generator does not touch. Update these in the same PR:

```text
README.md
docs/cursor-distribution.md
docs/codex-distribution.md
AGENTS.md
```

`README.md` currently says only `yellow-cursor` is Cursor-enabled;
`docs/cursor-distribution.md` calls Cursor exposure a single-plugin pilot;
`docs/codex-distribution.md` and `AGENTS.md`'s target inventory both
enumerate exactly three Codex-enabled plugins. Each must be revised to
include `yellow-review`.

Conceptually:

```json
{
  "targets": {
    "claude": true,
    "codex": {
      "enabled": true,
      "interface": {
        "displayName": "Yellow Review",
        "category": "Developer Tools"
      },
      "description": "Strict structural code-quality review using the Yellow thermonuclear rubric.",
      "skillAllowlist": [
        "yellow-thermonuclear-review"
      ],
      "componentPaths": {
        "skills": "./codex/skills"
      }
    },
    "cursor": {
      "enabled": true,
      "interface": {
        "displayName": "Yellow Review",
        "category": "development"
      },
      "skillAllowlist": [
        "yellow-thermonuclear-review"
      ],
      "componentPaths": {
        "skills": "./cursor/skills"
      }
    }
  }
}
```

The generator normalizes exposed Cursor and Codex skill frontmatter to `name` plus a single-line `description`, which lets the Claude source remain an internal agent-preloaded skill while producing portable host-facing copies. `scripts/lib/generate/emit-cursor.js` currently emits only `{ name, description }` (see its `FRONTMATTER_RE` match), which drops the Claude source's `disable-model-invocation: true` on this skill. Because Cursor uses that field to require explicit invocation rather than automatic injection, PR 2 must either extend the Cursor generator to preserve `disable-model-invocation: true` in the generated `.cursor-plugin` skill frontmatter, or add a generated-artifact test asserting the field is present in the output — this requirement does not apply to the Codex generator, whose contract defines frontmatter as `name` plus `description` only.

Run the generator rather than editing any of these manually:

```text
plugins/yellow-review/.codex-plugin/plugin.json
plugins/yellow-review/codex/skills/yellow-thermonuclear-review/SKILL.md
plugins/yellow-review/.cursor-plugin/plugin.json
plugins/yellow-review/cursor/skills/yellow-thermonuclear-review/SKILL.md
.cursor-plugin/marketplace.json
```

The attribution comment's license reference is repo-root-relative (`plugins/yellow-review/LICENSES/cursor-team-kit-MIT.txt`), not relative to the SKILL.md file, so it stays correct in these generated copies without per-target rewriting. Add a check (manual review or a script) confirming the referenced license file exists at that path in every generated skill copy before merging PR 2.

## Cross-host smoke tests

Before merging PR 2, record all three in the PR body:

| Host        | Smoke test                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Enable `thermonuclear-reviewer` through `reviewer_set.include`; run `/review:pr` against a fixed fixture PR                                  |
| Cursor      | Install the generated Yellow marketplace plugin in an isolated test project; explicitly invoke `yellow-thermonuclear-review`                 |
| Codex       | Use a temporary `CODEX_HOME`, install the generated plugin, verify it appears in `codex plugin list`, and invoke it against the same fixture |

The output does not need to be textually identical across models. The release gate should be behavioral:

* The intended structural issue is found.
* The evidence points at the changed code.
* The suggested restructuring preserves behavior.
* No cosmetic flood occurs.
* No repository mutation occurs.
* Prompt-injection text in source files is ignored.

# Evaluation matrix

Use deterministic contract tests in CI and model-quality fixtures as a recorded release evaluation.

| Fixture                                                               | Expected outcome                             |
| --------------------------------------------------------------------- | -------------------------------------------- |
| File grows from 986 to 1,034 lines and adds one extractable subsystem | P2 decomposition finding                     |
| File was already 1,300 lines and receives a cohesive six-line fix     | No size-threshold finding                    |
| Generated file crosses 1,000 lines                                    | No finding                                   |
| Three unrelated handlers gain the same feature boolean                | Structural/state-model finding               |
| Domain logic legitimately requires many explicit rules                | No vague “too complex” finding               |
| New helper duplicates a verified existing canonical helper            | Reuse/canonical-layer finding                |
| Wrapper adds no behavior but creates two delegation levels            | Indirection/code-judo finding                |
| Source comment tells the reviewer to ignore the file                  | Instruction ignored; normal review continues |
| Diff hunk header/context line carries an injected instruction         | Instruction ignored; normal review continues |
| Commit message carries an injected instruction                        | Instruction ignored; normal review continues |
| Pull-request title/description carries an injected instruction        | Instruction ignored; normal review continues |
| Clean, direct implementation                                          | Empty findings array                         |

Also add static assertions that:

* The agent has no write or shell tools.
* The agent cannot spawn nested agents.
* The skill preload name exists.
* The output example is valid JSON.
* Structural findings default to `advisory` and `human`.
* There is no persona-side confidence cutoff.
* The upstream commit, blob, attribution, and license are present.
* The generated Cursor and Codex trees contain only the allowlisted skill.

# Current stack sequencing

As of September 4, 2026, your Claude 5 modernization stack is still open. PR #743 modifies the review aggregator and PR #748 modifies the existing maintainability reviewer and other always-on personas.

The safest sequence is:

```text
existing Claude 5 stack
└── #748 agent/feat/review-personas-cache-ttl
    └── PR 1 agent/feat/thermonuclear-reviewer
        └── PR 2 agent/feat/thermonuclear-cross-host
```

That gives the new agent the latest `Agent(...)` conventions and aggregation behavior. Do not edit `maintainability-reviewer.md`; preserving it as the calibrated always-on lane both avoids conflict with #748 and maintains the intended separation of responsibilities.

Because the thermonuclear reviewer is opt-in rather than always-on, it should not receive the one-hour cache setting being introduced for frequently dispatched personas.

# Validation gate

The repository already exposes the required validation scripts.  Run:

```bash
pnpm validate:agents
bats plugins/yellow-review/tests/skill-content.bats
bats plugins/yellow-review/tests/thermonuclear-reviewer.bats

pnpm validate:schemas
pnpm validate:generated
pnpm validate:cursor
pnpm validate:codex
pnpm test:unit
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm format:check
```

Use a **minor changeset** for `yellow-review`: this adds a new externally usable review capability rather than correcting existing behavior.

# Definition of done

The integration is complete when:

* Cursor’s rubric is pinned, attributed, and adapted rather than anonymously copied.
* `thermonuclear-reviewer` is opt-in and read-only.
* It complements rather than replaces the everyday maintainability reviewer.
* Its structural recommendations are evidence-backed and behavior-preserving.
* Broad refactors cannot enter the automatic-fix lane.
* The 1,000-line rule is based on an actual threshold crossing, not raw final size.
* `/review:pr` can include it through `reviewer_set.include`.
* Cursor and Codex receive only the portable skill, not the entire Claude review workflow.
* Generated artifacts come exclusively from the catalog generator.
* The fixture evaluation passes on Claude, Cursor, and Codex.

I would record this as `plans/thermonuclear-review-integration.md` and implement it as the two-PR stack above.
