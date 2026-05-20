---
title: 'Codex CLI 401 in non-TTY Task spawns — expected degradation mode'
date: 2026-05-18
category: integration-issues
track: knowledge
problem: ChatGPT OAuth keyring inaccessible from non-TTY subprocess; codex CLI returns HTTP 401 when spawned via Task
tags: [codex, oauth, non-tty, task-spawn, degradation]
components: [yellow-codex]
---

## Context

The `/yellow-codex:review:codex-reviewer` agent uses the `codex` CLI to run a
ChatGPT-backed review pass. The CLI authenticates via a keyring that is populated
when a user runs `codex` interactively in a terminal (TTY).

When the agent is spawned as a Task subagent (e.g., by `/review:sweep` or
`/review:sweep-all`), the subprocess runs in a non-TTY environment. The keyring
is not accessible from that context, and `codex` exits with HTTP 401.

## Observed failure

```text
Error: Request failed with status code 401
    at ... codex/src/utils/openai-client.ts
```

The reviewer agent catches this and falls back to manual analysis (human-written
summary without codex output), labeling the result as "degraded mode."

## Why This Matters

The 401 is not a configuration error or a credential problem — it is a
**structural constraint** of how the ChatGPT OAuth flow stores credentials. The
keyring requires an interactive TTY at the time of first authentication AND at
the time of use. Non-TTY subprocesses cannot inherit that session.

This means:

- The failure is **expected** when codex-reviewer is spawned as a Task.
- Retrying does not help.
- The degraded-to-manual path is correct behavior, not a bug.

## When to Apply

- If `/review:sweep` or `/review:sweep-all` reports a codex reviewer 401
  failure **AND the auth route is OAuth subscription** (no `OPENAI_API_KEY`
  in env): dismiss the 401. The manual analysis the agent produced is still
  valid — this is the documented non-TTY OAuth degradation path.
- If `OPENAI_API_KEY` is set: a 401 is NOT expected. Treat as a real
  auth/config error (revoked key, bad scope, expired) and investigate
  before assuming review coverage is intact. Do NOT dismiss API-key 401s
  as benign — that would hide actionable failures and produce false
  confidence in the sweep's coverage.
- If you want a real codex OAuth pass under TTY constraints, run
  `/yellow-codex:review:codex-reviewer` directly in an interactive session
  (not via Task spawn).

**Quick auth-route check before deciding:**
```bash
[ -n "${OPENAI_API_KEY:-}" ] && echo "api-key (401 is a real error)" \
                              || echo "oauth (401 may be benign)"
```

## Workarounds

| Approach | Notes |
|---|---|
| Run codex reviewer interactively | Works reliably; not automatable |
| Pre-authenticate in same TTY before sweep | Not helpful — keyring still not accessible in subprocess |
| Use an API key instead of OAuth | Sidesteps the keyring entirely — codex CLI accepts `OPENAI_API_KEY` as a first-class auth method (see `plugins/yellow-codex/README.md:18`, `plugins/yellow-codex/CLAUDE.md:21`, `plugins/yellow-codex/skills/codex-patterns/SKILL.md:294`). **Not the desired fix for subscription OAuth workflows** — it bypasses the OAuth credential the user wants to use. Treat as a fallback only when OAuth subscription auth is not in play. |

## Prevention

Document this constraint in the codex-reviewer agent's frontmatter or SKILL.md
so that sweep orchestrators know degradation is expected and do not retry or
surface false alerts.
