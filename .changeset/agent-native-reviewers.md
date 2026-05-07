---
"yellow-review": minor
"yellow-core": minor
---

**yellow-review:** add three new conditional reviewer personas for the
agent-authoring surface.

- `cli-readiness-reviewer` — flags CLI commands that hurt autonomous-agent
  invocation (interactive prompts without bypass, missing structured output,
  vague errors, unsafe retries on mutating commands, ANSI/spinners in pipes,
  unbounded list output).
- `agent-cli-readiness-reviewer` — adapted from upstream
  compound-engineering v3.3.2 (locked SHA
  e5b397c9d1883354f03e338dd00f98be3da39f9f). Deeper 7-principle
  Blocker/Friction/Optimization rubric: non-interactive defaults, structured
  output, actionable errors, safe retries, bounded output, composability,
  discoverability. Suited for design-doc audits and full-CLI evaluations.
- `agent-native-reviewer` — adapted from upstream compound-engineering. Action
  parity, context parity, shared workspace, primitives over workflows,
  dynamic context injection. Anti-pattern catalog (Orphan Feature, Context
  Starvation, Sandbox Isolation, Silent Action, Capability Hiding, Workflow
  Tool, Decision Input).

All three agents are read-only (`tools: [Read, Grep, Glob]`), 3-segment
`subagent_type` compliant, and wired into `commands/review/review-pr.md`'s
conditional dispatch table on the same plugin-authoring globs as
`plugin-contract-reviewer` (concerns are disjoint —
plugin-contract-reviewer flags renames-breaking-callers; the three new
reviewers flag structurally-correct-new-files). `commands/review/review-all.md`
needs no edit (delegates dispatch to `review-pr.md` by reference).

**yellow-core:** add two new internal skills that codify the
agent-native review's domain knowledge:

- `agent-native-architecture` — canonical reference for the five
  agent-native architecture principles. Applied by
  `yellow-review:review:agent-native-reviewer`.
- `agent-native-audit` — step-by-step audit checklist. Capability mapping,
  noun test, anti-pattern catalog. Used for both PR-incremental reviews
  and full codebase audits.

Both skills are `user-invokable: false` (internal references).
