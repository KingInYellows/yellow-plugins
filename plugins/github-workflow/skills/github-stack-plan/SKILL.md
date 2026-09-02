---
name: github-stack-plan
description: 'Report the current GitHub-native stack structure (read-only). Use when checking what branches/PRs are in the stack before submitting or merging.'
user-invocable: false
---

## What It Does

Read-only stack view for the `github` provider of the `stacked-pr`
capability group. Calls the runtime adapter's `view` operation
(`gh stack view --json`) and reports the current stack structure. Makes no
changes.

## When to Use

- Checking what branches/PRs are currently in the stack.
- Before submitting or merging, to confirm the stack looks as expected.

## Usage

### Step 1: Call the adapter

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" view
```

### Step 2: Report

Read the JSON result's `status` field.

- **`SUCCESS`** — parse `stdout` as the `gh stack view --json` output and
  report the stack structure to the user. Confirmed shape (live smoke test,
  `gh-stack` v0.1.0): `{trunk, currentBranch, branches: [{name, head, base,
  isCurrent, isMerged, isQueued, needsRebase, pr: {number, url, state} |
  null}]}` — `head`/`base` are commit SHAs, not branch names; `branches` is
  ordered bottom-to-top (trunk-adjacent first). Report trunk, each branch's
  name/PR number+URL+state in stack order, and flag any `needsRebase: true`
  or `isQueued: true` branch explicitly. Treat this shape as a documented
  reference, not a schema guarantee — if a future `gh-stack` version adds
  or renames a field, quote the raw JSON instead of guessing at it:

  ```text
  --- begin untrusted-content (reference only) ---
  <result.stdout>
  --- end untrusted-content ---
  ```

- **`NOT_IN_STACK`** — tell the user the current branch is not part of a
  tracked stack and report `recoveryAction`.
- Any other status — report `status` and `recoveryAction` verbatim; quote
  `stdout`/`stderr` inside the untrusted-content fence above if they add
  useful detail.

## Boundaries

- Strictly read-only — only ever calls the adapter's `view` operation.
- Never invents field names or structure beyond what the adapter's actual
  JSON output shows; falls back to quoting the raw JSON when uncertain.
- Never falls back to reporting Graphite stack state as if it were this
  provider's.
