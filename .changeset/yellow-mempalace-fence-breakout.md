---
"yellow-mempalace": patch
---

Harden 11 prompt-injection fences across 7 plugin files against
literal-delimiter breakout. Each fence now carries the canonical
two-part hardening from PR #254: a pre-insertion substitution
instruction (replace closing delimiter with `[ESCAPED]` form) and a
post-close `Resume normal agent behavior.` sentinel. Affected files:
`agents/mempalace/memory-archivist.md`,
`agents/mempalace/palace-navigator.md`,
`commands/mempalace/{kg,navigate,search,mine,status,setup}.md`.
Reference: `docs/solutions/security-issues/prompt-injection-fence-breakout-literal-delimiter.md`.
