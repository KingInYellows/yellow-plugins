---
'yellow-core': patch
---

# RUN_DIR Hardening

Harden the RUN_DIR / result-file convention introduced in PR #260
against the bash-block subshell isolation anti-pattern (per
`docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`)
and add atomic-write semantics + cleanup.

`plugins/yellow-core/commands/workflows/work.md` Phase 3:

- **Shell-variable isolation fix.** The previous step 3a captured
  `RUN_DIR=$(mktemp …)` in one Bash call and referenced `$RUN_DIR` in
  later Task input prompts as if the variable persisted. Bash variables
  do not survive across separate Bash tool calls — each call is a
  fresh subprocess. Step 3a now instructs the orchestrator to capture
  the printed path and substitute the **literal value** into Task
  input prompts (not the variable name `$RUN_DIR`). Flagged by
  adversarial (P1) and matches the documented anti-pattern in
  `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`.
- **Empty-RUN_DIR error path.** If `mktemp -d` fails (disk full,
  permission denied) the captured path is empty. Step 3a now requires
  reporting the failure and skipping parallel review rather than
  spawning agents with an empty `run_dir`. Flagged by correctness +
  silent-failure-hunter (P3).
- **Cleanup step.** New step after collection: `rm -rf "<literal mktemp
  path>"`. Result files may contain diff excerpts including secrets;
  retention in `/tmp` is a data-residue risk on multi-user or
  long-lived machines. Skip-cleanup is allowed only with explicit
  user-visible documentation. Flagged by adversarial (P2).

`plugins/yellow-core/skills/create-agent-skills/SKILL.md` §Subagent
Failure Convention:

- **Atomic write `.tmp` → `mv` to `.json`.** Agents now MUST write to
  a `.tmp` file first then `mv` to `.json` (POSIX rename atomicity).
  The orchestrator globs only `*.json`, never `*.tmp` — partial writes
  are invisible. Lock files remain unnecessary because each agent
  owns a unique filename. Pattern validated against community
  conventions (barkain claude-code-workflow-orchestration).
- **Orchestrator example refresh.** Re-frames the `mktemp` capture so
  the variable-substitution requirement is explicit at the canonical
  source, alongside the empty-path error advice and the data-residue
  cleanup rationale.

No code changes — all updates are prose-instruction edits to two
authoring docs. The downstream effect is that `/workflows:work` Phase 3
becomes correctness-readable (an LLM following the steps top-to-bottom
no longer carries a phantom `$RUN_DIR` shell variable across Bash calls)
and parallel-orchestrator authors get the atomic-write convention
documented at the canonical source.
