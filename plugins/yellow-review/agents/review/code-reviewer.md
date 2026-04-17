---
name: code-reviewer
description: "DEPRECATED — renamed to project-compliance-reviewer. This stub keeps third-party installs that reference yellow-review:review:code-reviewer working for one minor version. Use when an external command still passes subagent_type yellow-review:review:code-reviewer; replace it with yellow-review:review:project-compliance-reviewer."
model: inherit
background: true
memory: project
tools:
  - Read
---

This agent has been renamed to `project-compliance-reviewer` as part of
the Wave 2 review-pipeline keystone. It will be removed in the next minor
version of yellow-review.

## What changed

The previous `code-reviewer` covered three distinct review territories
(general correctness, project-pattern compliance, and skill/agent frontmatter
rules). Wave 2 split the responsibility:

- **General correctness / logic bugs** → `correctness-reviewer`
- **`CLAUDE.md` / `AGENTS.md` compliance + naming patterns** →
  `project-compliance-reviewer`
- **Frontmatter, references, cross-platform portability** →
  `project-standards-reviewer`

## Migration

Any caller passing `subagent_type: "yellow-review:review:code-reviewer"` should
update to `subagent_type: "yellow-review:review:project-compliance-reviewer"` —
the closest one-for-one replacement for the rename. If your invocation
covered general logic-error review, you likely want `correctness-reviewer`
in addition.

## Behavior

When invoked, this stub:

1. Prints a deprecation notice to the agent's output.
2. Returns an empty findings list with a `residual_risks` entry pointing
   to the migration path.
3. Does NOT perform any analysis.

```json
{
  "reviewer": "code-reviewer",
  "findings": [],
  "residual_risks": [
    "DEPRECATED: yellow-review:review:code-reviewer is a stub. Re-invoke as yellow-review:review:project-compliance-reviewer (CLAUDE.md compliance) and/or yellow-review:review:correctness-reviewer (general logic bugs). This stub will be removed in the next minor version of yellow-review."
  ],
  "testing_gaps": []
}
```

Print this exact JSON to your output and stop. Do not perform any review,
do not read any files beyond what is required to print this notice, and do
not invoke any other agents.
