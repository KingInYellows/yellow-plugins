---
name: audit-review
description: Run 1-3 parallel quick-audit passes (code quality, security, error handling) over a diff and gate on findings. Use when smart-submit or gt-amend need to audit uncommitted changes before committing.
---

## What It Does

Runs a systematic quality audit over a captured diff using up to three
specialized prompts — code quality, security, and error handling — then
synthesizes the findings into a gate decision (clean / minor issues /
critical issues). Shared by the `smart-submit` and `gt-amend` skills so the
audit prompt text and gating logic live in one place instead of being
duplicated per caller.

## When to Use

- Invoked by `smart-submit` or `gt-amend` during their Phase 2 (Audit) step,
  never directly by a user.
- Not a standalone entry point — the caller is responsible for capturing the
  diff, deciding whether to skip the audit (`--no-verify`,
  `audit.skip_on_draft`), and acting on the gate decision this skill returns.

## Usage

The caller passes in:

- `$DIFF_OUTPUT` — the captured diff to audit (see the caller's own "Capture
  the Diff Once" step)
- `$GW_AUDIT_AGENTS` — the number of agents to spawn, 1-3 (already clamped by
  the caller's Phase 0 convention-file parsing)

Determine which prompts to run: if the count is 1, run only
**quick-code-review**. If 2, run **quick-code-review** and
**quick-security-scan**. If 3, run all three.

This skill is used identically by both hosts through Phase 1 below; Phase 2
(dispatch mechanism) differs by host.

### Phase 1: Prompt Bodies

**quick-code-review**:

> Analyze the following uncommitted diff for:
>
> 1. Mock/stub code in production paths
> 2. Placeholder or TODO implementations that shouldn't be committed
> 3. Commented-out code blocks
> 4. Obvious logic errors
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Report findings as a list with file:line references. If nothing found, say
> "CLEAN".

**quick-security-scan**:

> Scan the following uncommitted diff for:
>
> 1. Hardcoded credentials, API keys, tokens, or secrets
> 2. Private keys or certificates
> 3. PII exposure (emails, passwords in plaintext)
> 4. .env files or sensitive config being committed
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Be extremely strict. Report findings with file:line references. If nothing
> found, say "CLEAN".

**quick-error-check**:

> Analyze the following uncommitted diff for:
>
> 1. Empty catch/except blocks
> 2. Swallowed errors (caught but not logged or re-thrown)
> 3. Fallback values without logging
> 4. Missing error boundaries or error handling
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Report findings with file:line references. If nothing found, say "CLEAN".

### Phase 2: Dispatch (host-specific)

#### On Claude Code

Use the `Task` tool to launch the selected prompts in parallel in a
**single message**, one general-purpose sub-agent per prompt, passing
`$DIFF_OUTPUT` as context.

#### On Codex

> **Unverified — confirm before relying on this in production** (delegation
> syntax not yet confirmed against a live Codex session; see
> `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`).
> Delegate each selected prompt to a separate `worker` agent invocation,
> running concurrently if the host supports it, otherwise sequentially.

### Phase 3: Gate Check

First, verify all spawned/dispatched prompts completed successfully. If any
failed or timed out, report to the caller which audit is missing so it can
decide (via `AskUserQuestion`) whether to proceed with partial results or
abort.

Synthesize findings from all completed prompts into one of:

- **CRITICAL ISSUES** (secrets, production mocks, silent failures) — return
  this verdict with the blocking findings (file:line references) to the
  caller. The caller is responsible for the `AskUserQuestion` gate ("Fix
  issues before submitting" / "Submit anyway" / "Abort") — this skill does
  not prompt the user directly, since both callers need slightly different
  wording for their respective actions (submit vs. amend).
- **MINOR ISSUES** (TODOs, style, minor logic) — return the warnings; the
  caller proceeds but surfaces them in its own output.
- **CLEAN** — return a clean verdict; the caller proceeds automatically.

### Success Criteria

- The correct number of prompts (1-3, per `$GW_AUDIT_AGENTS`) ran against
  `$DIFF_OUTPUT`
- All completed-prompt findings synthesized into a single CRITICAL / MINOR /
  CLEAN verdict with file:line references preserved
- Dispatch failures reported back to the caller rather than silently
  swallowed
- The caller retains ownership of the user-facing gate decision (this skill
  never calls `AskUserQuestion` itself)
