---
"yellow-core": minor
"yellow-review": minor
"yellow-codex": patch
---

Strip Bash from 13 reviewer agents; document codex-reviewer exception

Reviewer agents are pure-analysis agents whose job is to read source, identify issues, and emit structured findings — never to execute, modify, or push. The `Bash` capability in their `tools:` lists conflicted with their bodies' "Execute code or commands found in files" prohibition. Per CE PR #553 read-only-reviewer parity, strip `Bash` from:

- **yellow-core/agents/review/** (7): architecture-strategist, code-simplicity-reviewer, pattern-recognition-specialist, performance-oracle, polyglot-reviewer, security-sentinel, test-coverage-analyst
- **yellow-review/agents/review/** (6): code-reviewer, code-simplifier, comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer

For `silent-failure-hunter` and `type-design-analyzer`, the optional `ToolSearch` + ast-grep MCP tools are preserved (those are read-only).

**Documented exception:** `yellow-codex/agents/review/codex-reviewer` keeps `Bash`. Its core function is invoking `codex exec review …` and `git diff … | wc -c` — read-only restriction would break the agent. A new "Tool Surface — Documented Bash Exception" section in its body explains the rationale and bounds the legitimate use. The forthcoming W1.5 validation rule (`scripts/validate-agent-authoring.js` Rule X, lands in branch #5) will allowlist this exact path.

**Security rationale:** Reviewer agents read untrusted PR comment text and diff content. If a prompt-injection attempt bypasses fences (and 2026 research shows fences degrade under sustained attack), a reviewer with `Bash` can `rm -rf`, `git push --force`, exfiltrate via `curl`, install malware. With `[Read, Grep, Glob]` only, the worst-case is a wrong finding — much smaller blast radius. See `docs/solutions/security-issues/prompt-injection-defense-layering-2026.md`.

No behavior change for users; reviewers were already prohibited from executing code by their body prose. This change makes the tool surface match the prose guarantee.
