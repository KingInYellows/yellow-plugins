---
"yellow-core": minor
---

Add `debugging` skill (W3.1) — systematic root-cause debugging with causal-chain
gate and prediction-for-uncertain-links hypothesis testing

Introduces `plugins/yellow-core/skills/debugging/SKILL.md` (user-invokable as
`/yellow-core:debugging`) for bug investigation that biases toward understanding
the trigger-to-symptom causal chain before touching code. Adapted from upstream
`EveryInc/compound-engineering-plugin` `ce-debug` skill at locked SHA
`e5b397c9d1883354f03e338dd00f98be3da39f9f`.

**Five phases (each self-sizes):**

1. **Triage** — parse `<bug_description>` (untrusted input fenced for prompt-injection safety), fetch issue thread if a tracker reference is supplied (GitHub via `gh`, Linear via `mcp__plugin_yellow-linear_linear__get_issue` MCP, others via `WebFetch` with paste fallback), reach a clear problem statement. Read **all** comments — narrowed reproduction or pivots often appear in late comments.

2. **Investigate** — reproduce the bug, verify environment sanity (correct branch / dependencies / runtime / env vars / build artifacts / dependent services), then trace the code path **backward** from error to where valid state first became invalid.

3. **Root Cause** — assumption audit (verified vs assumed), hypothesis ranking with file:line + causal chain + prediction for uncertain links, **causal-chain gate** that blocks Phase 3 until trigger-to-symptom is fully explained, smart escalation table when 2–3 hypotheses are exhausted (subsystem-divergence → suggest `/yellow-core:workflows:brainstorm`; evidence-contradiction → re-read without assumptions; CI-vs-local → focus on env; symptom-fix → keep investigating).

4. **Fix** — workspace and branch check (detect default branch via `git rev-parse --abbrev-ref origin/HEAD` with `origin/` prefix stripped — unstripped comparison silently never matches), test-first cycle (failing test for right reason → minimal fix → broad regression run), 3-failed-attempts trigger for re-diagnosis, conditional defense-in-depth (entry validation / invariant check / environment guard / diagnostic breadcrumb) when the pattern recurs in 3+ files or the bug would have been catastrophic, conditional post-mortem when production-affecting or pattern-recurrent.

5. **Handoff** — structured Debug Summary template, then either auto-commit-and-submit (skill-owned branch) or AskUserQuestion menu (pre-existing branch) routing to Graphite (`gt modify` + `gt submit --no-interactive`, prefer `/gt-workflow:smart-submit` if installed). Optional learning capture via `/yellow-core:workflows:compound` when the lesson generalizes (3+ recurrences or wrong assumption about a shared dependency); skip silently for mechanical fixes.

**Yellow-plugins divergence from upstream:**

- **Multi-platform tool plumbing dropped** — upstream supports Codex `request_user_input`, Gemini `ask_user`, and Pi `ask_user`; yellow-plugins is Claude Code only, so the skill assumes `AskUserQuestion` (with `ToolSearch` schema-load fallback) and removes the per-platform branching.
- **CE command refs replaced** — `/ce-brainstorm` → `/yellow-core:workflows:brainstorm`, `/ce-commit-push-pr` → `gt submit` (or `/gt-workflow:smart-submit` if installed), `/ce-commit` → `gt modify`, `/ce-compound` → `/yellow-core:workflows:compound`.
- **Investigation techniques and anti-patterns inlined** — upstream splits methodology into a `references/` subdirectory (`anti-patterns.md`, `defense-in-depth.md`, `investigation-techniques.md`). yellow-core skills consistently use a single SKILL.md, so the substantive content is folded inline at ~270 lines. The detailed intermittent-bug techniques (binary search, retry-with-logging variations, environment snapshots) are referenced compactly rather than reproduced verbatim — agents follow the principles without needing the full upstream playbook.
- **`<bug_description>` fence** — wraps `$ARGUMENTS` in an explicit untrusted-reference advisory rather than the upstream's bare placeholder, matching the prompt-injection fencing pattern used across yellow-plugins (PR #281 W1.5).

**Methodology preserved verbatim** — causal-chain gate, prediction-for-uncertain-links, one-change-at-a-time, three-failed-attempts diagnostic table, the four-pattern smart-escalation matrix (different subsystems / contradicting evidence / CI-vs-local / wrong prediction), and the design-problem-vs-localized-bug brainstorm-suggestion test (wrong responsibility / wrong requirements / every-fix-is-a-workaround).

Discoverable via auto-discovery from `plugins/yellow-core/skills/debugging/SKILL.md` — no `plugin.json` registration required.
