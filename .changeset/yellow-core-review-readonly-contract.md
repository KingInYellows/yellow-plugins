---
"yellow-core": patch
---

Restore the read-only contract on 7 review agents and gate it in CI.

architecture-strategist, code-simplicity-reviewer, pattern-recognition-specialist,
performance-oracle, performance-reviewer, polyglot-reviewer, and
test-coverage-analyst carried `memory: project` (which auto-enables
Read/Write/Edit) but no `disallowedTools` block — so they ran write-capable
against untrusted PR diffs despite the documented read-only contract. Added
`disallowedTools: [Write, Edit, MultiEdit]` to all 7, matching the 3 security
review agents. A new W1.5b rule in `scripts/validate-agent-authoring.js` now
fails CI when any `review/` agent sets a valid `memory:` scope
(`user`/`project`/`local`) without a `disallowedTools` entry containing Write
and Edit, so this cannot regress silently. The rule is covered by
`tests/integration/validate-agent-authoring-w15b.test.ts`.
