---
name: cursor-delegation
description: Host-neutral reference for the Cursor Cloud Agent delegation lifecycle, the yellow-cursor CLI's JSON contract, and its safety/idempotency rules. Use when building or reasoning about a surface that delegates work to a Cursor Cloud Agent through the CLI.
---

# Cursor Cloud Agent Delegation

## What It Does

Describes the lifecycle of delegating work to a Cursor Cloud Agent through the
yellow-cursor CLI, and the JSON contract that CLI exposes on every invocation.
This is a host-neutral reference: it names no host-specific mechanism (no slash
commands, no host environment variables, no host-specific tool-call syntax) so
the same description holds for any integration built on top of the CLI.

Two entities matter:

- **Agent** — a persistent, addressable unit of work against one repository.
  Created lazily: nothing happens server-side until the first message is sent to
  it.
- **Run** — one dispatched execution created by sending a message (the initial
  delegation prompt, or a later follow-up). A run carries its own status, target
  branch, and pull request, if any. An agent can accumulate multiple runs over
  its lifetime.

## When to Use

Use this reference when building or reasoning about any surface that delegates
work to a Cursor Cloud Agent through the CLI — deciding what to show a user
before a billable launch, how to interpret the CLI's JSON output, or how to
recover from an ambiguous or failed call.

## Usage

### Lifecycle

1. **Setup** — resolve credentials (an API key or a stored login) and the SDK
   runtime before attempting anything else.
2. **Delegate** — validate the plan with a zero-network dry run, show it to the
   person authorizing the spend, get explicit confirmation, then launch for
   real. Delegation always costs money once confirmed; nothing here should
   launch without that confirmation step.
3. **Follow-up** — continue an existing agent's conversation with a new prompt.
   Also billable, also requires confirmation before sending.
4. **Status** — poll an agent (and optionally one of its runs). Always
   re-fetches live rather than trusting cached state, and can reconcile a local
   record against what the server actually reports.
5. **Cancel** — stop a specific run. Re-checks the run's state immediately
   before acting; cancelling an already-finished run is reported as a successful
   no-op, not an error.
6. **Archive / unarchive** — lifecycle housekeeping, not deletion. Both are
   idempotent: archiving an already-archived agent (or unarchiving one that
   isn't archived) succeeds without a server call.
7. **Artifacts / usage** — read-only introspection into what a run produced and
   what it cost. Both may be unsupported depending on SDK/account capability —
   that is a permanent condition, not something worth retrying.

### Safety rules

- **No delete.** Nothing in this surface can delete an agent, even though the
  underlying SDK exposes a delete operation. Archiving is as destructive as this
  gets.
- **Confirm before billable action.** Delegating and following up both spend
  money. Never send either without the operator explicitly confirming a plan
  that was shown to them first.
- **Idempotency keys are reused, not regenerated.** Every delegate/follow-up
  call is tagged with an idempotency key — supplied by the caller, or generated
  once if not. That exact key must be reused for every retry of the _same_
  attempt. Minting a new key on retry defeats the point: it lets a
  genuinely-failed-then-retried call look like two separate launches to the
  server.
- **Ambiguous outcomes are not failures to retry blindly.** A network failure
  that happens _after_ a message has actually been dispatched cannot tell you
  whether the run was created. That case is reported distinctly from an ordinary
  network failure specifically so a caller does not treat it as safe to retry.
  The correct response is to look up the true state (by the known agent id, or
  by the idempotency key if the id isn't known yet) before deciding what to do
  next — never re-send automatically.
- **No nested delegation.** An agent already running inside a remote-delegated
  context must refuse to delegate or follow up again — that guard exists to
  prevent runaway chains of paid launches.
- **Concurrency is capped per repository**, checked before every new launch,
  with a caller-adjustable limit.

### JSON contract essentials

Every invocation of the CLI prints exactly one JSON object to stdout and nothing
else (diagnostics go to stderr). The object always has an `ok` boolean:

- `ok:true` responses share `{ok:true, operation:<name>, ...}` plus
  operation-specific fields.
- `ok:false` responses share
  `{ok:false, operation:<name>, error:{code, message, retryable, recoveryAction, requestId?}}`.
  Every error names a stable `code`, whether it's worth retrying (`retryable`),
  and what to do about it (`recoveryAction`) — surface `recoveryAction` to the
  operator rather than inventing your own remediation text.
- Delegating and following up always echo an `idempotencyKey` at the top level,
  on success _and_ on every failure path (including a plain usage error) —
  capture it every time, not just on success, since a failed call is exactly
  when you need it for a correct retry.

Never treat the absence of a field as a value — a missing `targetBranch` or
`pullRequestUrl` means Cursor hasn't created one yet, not that the launch
failed.
