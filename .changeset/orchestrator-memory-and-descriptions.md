---
"yellow-core": patch
"yellow-devin": patch
"yellow-debt": patch
"yellow-research": patch
"yellow-docs": patch
---

Set memory scope on workflow orchestrators; sharpen overlap descriptions

Add `memory: project` to 4 workflow orchestrators (brainstorm-orchestrator,
knowledge-compounder, spec-flow-analyzer in yellow-core; devin-orchestrator
in yellow-devin) so they accrue cross-session learning per project. The
correct frontmatter form is a scope string (`user`/`project`/`local`), not
the boolean `memory: true` used elsewhere in the codebase.

Also correct invalid `memory: true` to `memory: project` on the remaining
7 agents that were not covered by the parent PR's review-agent sweep:
yellow-core (repo-research-analyst, git-history-analyzer), yellow-research
(code-researcher, research-conductor), yellow-docs (doc-auditor,
doc-generator, diagram-architect). After this PR, no agent in the
repository declares the invalid `memory: true`.

Sharpen the `description:` trigger clauses for two overlap pairs:
- security-sentinel (active vulnerabilities) vs security-debt-scanner (debt
  patterns that could become vulnerabilities)

The code-simplicity-reviewer vs code-simplifier pair already had clear
pre-fix/post-fix trigger clauses — no change needed there.
