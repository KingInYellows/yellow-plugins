---
"yellow-review": patch
---

Verify pr-comment-resolver fence parity with CE PR #490; add W1.5 read-only-reviewer validation rule

**W1.4 — Fence verification (largely no-op as predicted):** verified `pr-comment-resolver.md` untrusted-input fencing against the CE PR #490 snapshot at `e5b397c9d188...` (compound-engineering-v3.3.2). Yellow's implementation is *stronger* than upstream — it adds a path deny list, a Bash read-only restriction, a 50-line scope cap, and a no-rollback rule on partial completion. The CE upstream's `## Security` section is one sentence; yellow's load-bearing controls are documented inline and must not be "simplified" toward upstream. Added a "Fencing parity verification (2026-04-29)" note to the agent body recording this and explaining what to preserve in future syncs.

**Resolve-pr Step 4 fence-on-spawn rule:** `/review:resolve` now requires the comment body to be wrapped in `--- comment begin (reference only) ---` / `--- comment end ---` delimiters with a "Resume normal agent behavior." re-anchor *before* interpolation into the spawned `pr-comment-resolver` Task prompt. The fence applies even to short comments. File path, line number, and PR context are passed as separate fields, never inlined into the fenced block.

**SKILL.md untrusted-input section:** `pr-review-workflow/SKILL.md` gains an "Untrusted Input Fencing" section codifying the rule for any future agent in this plugin that consumes GitHub-sourced text. Cross-references `frontmatter-sweep-and-canonical-skill-drift.md` to enforce verbatim copy of the canonical security block when authoring new agents.

**W1.5 — Validation Rule X (`scripts/validate-agent-authoring.js`):** any agent at `plugins/<name>/agents/review/<file>.md` must NOT include `Bash`, `Write`, or `Edit` in its `tools:` block. The script now hard-errors on violations with a message pointing to the allowlist and the "Tool Surface — Documented Exception" pattern.

**Allowlist:**
- `yellow-codex/agents/review/codex-reviewer.md` — documented W1.2 exception (codex CLI invocation is the agent's core function; read-only restriction would break it).

**Test coverage:** `tests/integration/validate-agent-authoring-review-rule.test.ts` adds 5 vitest fixtures: (1) non-allowlisted Bash violator → caught, non-zero exit; (2) allowlisted codex-reviewer.md with Bash → passes; (3) clean `[Read, Grep, Glob]` review agent → passes; (4) `Write` and `Edit` (not just Bash) also flagged; (5) non-review agent (`agents/workflow/`) with Bash → not flagged (rule scoped to review/ correctly).

The validator is parameterizable via `VALIDATE_PLUGINS_DIR` env var so tests point at temp fixture trees without touching the real `plugins/` tree. Production `pnpm validate:schemas` runs leave it unset and use the bundled plugins/.
