---
name: github-stack-sync
description: 'Sync the local stack with trunk via gh stack sync, optionally pruning merged branches. Use when user says "sync with main" or "pull latest" on the github stacked-PR provider.'
user-invocable: false
---

## What It Does

Pulls the latest trunk and syncs the local stack via the runtime adapter's
`sync` operation. Pruning local branches for merged PRs is destructive and
only runs after explicit confirmation.

## When to Use

- User says "sync with main", "rebase my stack", or "pull latest" on the
  github stacked-PR provider.

## Usage

Optional arguments:

- `--prune` — remove local branches for merged PRs after syncing. Always
  gated behind an `AskUserQuestion` confirmation before being passed to
  the adapter — never passed without it.

The argument text provided after the skill name (if any) is available as
context for this invocation.

### Step 1: Sync (without pruning)

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" sync
```

Read the JSON result's `status` field.

- **`SUCCESS`** — sync completed. Continue to Step 2 if `--prune` was
  requested, otherwise go to Step 3 (Report).
- **`SYNC_ABORTED`** — the sync detected a divergence it could not resolve
  non-interactively and made no changes. Report `recoveryAction` and stop
  — do not attempt pruning.
- Any other status — report `status` and `recoveryAction` and stop.

### Step 2: Prune (only if `--prune` was requested)

Pruning removes local branches for merged PRs and cannot be undone by this
runtime. Use `AskUserQuestion` to confirm: "Prune local branches for
merged PRs?" with options "Prune" / "Skip pruning". On "Skip pruning", go
to Step 3 without pruning.

On confirmation, call the adapter with both `--prune` and `--confirm`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" sync --prune --confirm
```

Read the result's `status` and report `recoveryAction` if it is not
`SUCCESS`.

### Step 3: Report

Report the outcome of Step 1 (and Step 2, if it ran): trunk updated,
whether pruning ran and what it removed. Quote `stdout` inside the
untrusted-content fence below if it contains detail worth surfacing:

```text
--- begin untrusted-content (reference only) ---
<result.stdout>
--- end untrusted-content ---
```

## Boundaries

- Never passes `--prune` without an immediately preceding `AskUserQuestion`
  confirmation.
- Never invokes `gh stack sync` directly — only through the runtime
  adapter.
- Treats a `SYNC_ABORTED` result (exit 0 but no-op) as unresolved, not as
  success.
