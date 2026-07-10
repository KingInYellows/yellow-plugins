---
title: 'codex exec/exec review reject -a/-s flags on codex-cli 0.140.0'
date: 2026-07-09
category: integration-issues
track: bug
problem: 'codex exec/exec review reject -a/-s flags on codex-cli 0.140.0, exit 2 misreads as auth'
tags: [codex-cli, cli-flag-drift, argument-parsing, exit-code-misclassification, config-override]
components: [yellow-codex]
---

# codex exec/exec review reject -a/-s flags on codex-cli 0.140.0

## Problem

On codex-cli 0.140.0, the `-a`/`--ask-for-approval` flag — and, on the
`exec review` subcommand, `-s`/`--sandbox` too — are rejected by clap at
argument-parse time (exit code 2). Every non-interactive Codex invocation
site in yellow-codex (review, rescue, analyst, executor, setup smoke test)
shipped with these flags, and every exit-2 handler unconditionally printed
"authentication failed. Run /codex:setup." This masked a CLI flag-drift
break as an auth problem across the whole plugin.

## Symptoms

- `codex exec review --base main -a never -s read-only --ephemeral --json`
  → exit 2, stderr: `error: unexpected argument '-a' found`.
- Plain `codex exec -a never -s workspace-write ...` (rescue/analyst/executor
  paths) also exits 2 with the same `unexpected argument '-a'` error — `-a`
  does not exist on `exec` in 0.140.0 either; only `-s` remains valid there.
- `--instructions` on `exec review` also fails to parse — it does not exist
  on that subcommand.
- Every plugin site mapping exit 2 → "authentication failed" misdiagnoses
  the real cause, sending users to `/codex:setup` for a problem `/codex:setup`
  cannot fix.
- A prior session finding (PR #601, 2026-07-01) concluded `-a`/`-s` "exist
  only on plain codex exec" — that conclusion is now also wrong. The flag
  surface moved again between the two checkpoints; `-a` no longer exists on
  `exec` either.

## What Didn't Work

- **Hoisting flags to the top level** (`codex -a never -s read-only exec
  review --base main --ephemeral --json`) parses and runs, but was rejected
  as the fix: it splits posture flags from the subcommand where `--ephemeral`
  and the other subcommand flags live, diverging from the single mechanism
  already proven for `mcp_servers={}` (see below).
- **Dropping the posture flags entirely** (`codex exec review --base main`
  with no `-a`/`-s`/`-c` override) is not safe. The startup header showed the
  effective default comes from the user's `~/.codex/config.toml` — on the
  verification machine that was `approval: never` / `sandbox:
  danger-full-access`. An invocation with no explicit posture silently
  inherits whatever the local machine's config happens to be, up to full
  filesystem access.

## Solution

Replace `-a`/`-s` with `-c key=value` config overrides scoped to the
subcommand, on every Codex invocation site:

```bash
# exec review (read-only, ephemeral)
codex exec review \
  --base "$BASE_REF" \
  -c 'approval_policy="never"' \
  -c 'sandbox_mode="read-only"' \
  -c 'mcp_servers={}' \
  --ephemeral \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  -o "$OUTPUT_FILE"
```

`-s` is still valid on plain `codex exec` (rescue/analyst/executor) — only
`-a` needs to move to `-c` there:

```bash
codex exec \
  -c 'approval_policy="never"' \
  -s workspace-write \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  ...
```

Harden every exit-2 handler to distinguish a CLI argument-parse error from a
real auth failure by grepping stderr before choosing a message:

```bash
elif [ "$codex_exit" -eq 2 ]; then
  # Exit 2 is also clap's argument-parse error — check before blaming auth.
  # Match clap's full parse-error vocabulary, not just "unexpected argument";
  # display only clap error lines (allowlist) to respect the redaction rule.
  if grep -qE "unexpected argument|invalid value|unrecognized subcommand|required arguments" "$STDERR_FILE" 2>/dev/null; then
    printf '[yellow-codex] Error: CLI rejected the invocation (argument parse error — flag drift?):\n'
    grep -m2 -E "^error:" "$STDERR_FILE" 2>/dev/null
  else
    printf '[yellow-codex] Error: authentication failed. Run /codex:setup.\n'
  fi
```

Bump the documented CLI floor from v0.118.0 to v0.140.0 across every
enforcement site (`CLAUDE.md`, `setup.md` version check, setup smoke test,
`README.md`) — the old floor cannot be verified against the current flag
syntax.

## Why This Works

`-c key=value` sets arbitrary `config.toml` keys as a CLI override and is
accepted by both `exec` and `exec review`. Empirically, a
`-c 'sandbox_mode="read-only"'` override measurably beats a permissive
`~/.codex/config.toml` (`danger-full-access`) in the emitted startup
header — confirming it is a real override, not a silent parse-success
no-op that falls back to config defaults. Checking stderr for clap's
parse-error vocabulary before assuming exit 2 means "auth failure" works
because those strings are stable regardless of which flag was rejected —
but `unexpected argument` alone is only the vocabulary for an unknown
flag. Other parse-error shapes share exit 2 with different wording
(empirically on 0.140.0: `invalid value '<x>' for '--sandbox
<SANDBOX_MODE>'`), so handlers must match the broader set
(`unexpected argument|invalid value|unrecognized subcommand|required
arguments`) or a differently-shaped drift recreates the misdiagnosis.

## Prevention

- Treat exit 2 (or any single exit code) from an external CLI as ambiguous
  by default. Disambiguate via stderr content before choosing a
  user-facing message rather than mapping one exit code to one fixed
  meaning.
- When a plugin depends on a fast-moving external CLI's flag surface,
  re-verify flag acceptance empirically (`--help` output plus a live
  invocation) every time the documented floor version is bumped — not just
  once at initial integration. The `exec review` flag surface changed
  twice in 8 days across two "verified" checkpoints (PR #601 on
  2026-07-01, this PR on 2026-07-09).
- Never drop posture/sandbox flags to simplify an invocation of an
  agentic CLI tool. The effective default is whatever the user's local
  config file says, which can be permissive (`danger-full-access`).
- When updating flag syntax for one subcommand, sweep every other
  invocation site in the plugin (agents, commands, skills, setup smoke
  test) in the same change — a partial fix that only touches `exec review`
  leaves plain `exec` sites silently broken, as happened here.
