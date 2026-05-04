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
12 agents that were not covered by the parent PR's review-agent sweep:
yellow-core (repo-research-analyst, git-history-analyzer, security-reviewer,
performance-reviewer, security-lens, session-historian), yellow-research
(code-researcher, research-conductor), yellow-docs (doc-auditor,
doc-generator, diagram-architect), and yellow-review
(project-compliance-reviewer). After this PR, no agent in the repository
declares the invalid `memory: true`.

Note on tool surface: per Claude Code docs, `memory: <scope>` automatically
enables Read/Write/Edit so agents can persist learnings to
`.claude/agent-memory/<name>/`. For yellow-review's review agents — which
the plugin's CLAUDE.md documents as "report findings, do NOT edit project
files directly" — the prompt-level read-only contract remains the source
of truth; the orchestrating `/review:pr` command applies all fixes. The
implicit Write/Edit grant is required for memory persistence and does not
reflect a change in agent responsibility.

Sharpen the `description:` trigger clauses for two overlap pairs:
- security-sentinel (active vulnerabilities) vs security-debt-scanner (debt
  patterns that could become vulnerabilities)

The code-simplicity-reviewer vs code-simplifier pair already had clear
pre-fix/post-fix trigger clauses — no change needed there.
