---
name: github-stack-status
description: 'Report GitHub-native stacked-PR tooling readiness and point to /stack:status (yellow-core) for the authoritative active-provider answer. Use when checking why gh stack tooling is unavailable or which stacked-PR provider is currently active.'
user-invokable: false
---

## What It Does

Read-only readiness report for the `github` provider of the `stacked-pr`
capability group. It answers two separate questions and never conflates
them:

1. **Is the tooling present?** (`gh`, authentication, the official
   `github/gh-stack` extension.)
2. **Is this provider the enabled one?** That question belongs to
   `yellow-core`'s `/stack:status`, which reads `claude plugin list --json`
   — this skill reports what that command says rather than guessing from
   the presence of `gh`.

Tooling being present does **not** mean this provider is active, and this
skill never implies otherwise.

## When to Use

- Diagnosing why GitHub stacked-PR tooling appears unavailable.
- Confirming which `stacked-pr` provider is currently enabled.
- Before asking for a provider switch, to see the starting state.

## Usage

### Step 1: Probe tooling

```bash
set -uo pipefail

if command -v gh >/dev/null 2>&1; then
  gh_version=$(gh --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  printf 'gh:                 OK (%s)\n' "${gh_version:-unknown}"
  gh_major=${gh_version%%.*}
  case "$gh_major" in
    ''|*[!0-9]*) printf 'gh_version_gate:    UNKNOWN (could not parse version)\n' ;;
    *) if [ "$gh_major" -ge 2 ]; then
         printf 'gh_version_gate:    OK (>= 2.0)\n'
       else
         printf 'gh_version_gate:    TOO OLD (need >= 2.0)\n'
       fi ;;
  esac
  gh auth status >/dev/null 2>&1 && printf 'gh_auth:            OK\n' || printf 'gh_auth:            NOT AUTHENTICATED\n'
  # Identity check, not a name check: third-party extensions also expose a
  # `gh stack` command. Only github/gh-stack is first-party.
  ext_list=$(gh extension list 2>/dev/null || true)
  if printf '%s\n' "$ext_list" | grep -qE '(^|[[:space:]])github/gh-stack([[:space:]]|$)'; then
    printf 'gh_stack_extension: OK (github/gh-stack)\n'
  elif printf '%s\n' "$ext_list" | grep -qi 'gh-stack'; then
    printf 'gh_stack_extension: WRONG OWNER (a non-github/gh-stack extension provides `gh stack`)\n'
  else
    printf 'gh_stack_extension: MISSING\n'
  fi
else
  printf 'gh:                 MISSING\n'
  printf 'gh_version_gate:    SKIPPED (gh not found)\n'
  printf 'gh_auth:            SKIPPED (gh not found)\n'
  printf 'gh_stack_extension: SKIPPED (gh not found)\n'
fi
```

### Step 2: Ask who the active provider is

Report the enabled-provider question by pointing at the authoritative
surface rather than re-deriving it here:

> Active-provider state is owned by `/stack:status` (yellow-core), which
> reads `claude plugin list --json`.

If `yellow-core` is installed, tell the user to run `/stack:status` for the
authoritative answer, and include that instruction in the output. Do not
infer the active provider from tooling presence — a machine can have `gh`
and `gh-stack` installed while Graphite is the enabled provider, and
reporting that as "GitHub active" would be wrong.

### Step 3: Report

```text
GitHub stacked-PR provider
==========================

  gh                  OK (2.97.0)
  gh_version_gate     OK (>= 2.0)
  gh auth             OK
  github/gh-stack     MISSING

  Tooling:            NOT READY — install with `gh extension install github/gh-stack`
  Active provider:    run /stack:status (yellow-core) for the authoritative answer
```

Classify tooling as:

- **READY** — `gh` OK, `gh_version_gate` OK, authenticated, and
  `github/gh-stack` installed.
- **NOT READY** — anything else, naming the specific gap. If
  `gh_version_gate` reports `TOO OLD`, say `gh` must be upgraded. If
  `gh_stack_extension` reports `WRONG OWNER`, say a non-official `gh
  stack` extension is installed and must be removed before installing
  `github/gh-stack`.

State the preview caveat once when tooling is READY: GitHub's native
stacked pull requests were in public preview as of 2026-08-17 and
merge-queue support was still rolling out.

## Boundaries

- Strictly read-only. No `gh stack` mutating subcommand, no plugin
  enable/disable, no settings edits.
- Never falls back to reporting Graphite state as if it were this
  provider's.
- Never claims this provider is active; that answer comes from
  `/stack:status`.
