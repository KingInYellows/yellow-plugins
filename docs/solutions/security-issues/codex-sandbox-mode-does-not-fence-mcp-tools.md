---
title: 'Codex sandbox_mode does not fence MCP tool calls'
date: 2026-07-09
category: 'security-issues'
track: bug
problem: 'codex -s read-only / sandbox_mode="read-only" only sandboxes model-generated shell commands — MCP tool calls bypass it entirely'
tags:
  - security-issues
  - codex-cli
  - mcp
  - sandbox
  - prompt-injection
---

# Codex sandbox_mode does not fence MCP tool calls

## Problem

`codex exec -s read-only` (and `-c 'sandbox_mode="read-only"'`) is easy to
read as "this invocation cannot write anything." It cannot — but only for
model-generated **shell commands**. The CLI's own `--help` scopes `-s` to
"the sandbox policy to use when executing model-generated shell commands."
MCP servers configured in `~/.codex/config.toml` run as separate processes
and their tools are NOT constrained by the sandbox.

## Symptoms

- A "read-only" `codex exec` analysis run (e.g. yellow-codex's
  `codex-analyst`, which analyzes untrusted/adversarial code) still exposes
  the user's configured MCP servers to the model — verified on a machine
  with 9 live servers including a `github` stdio server carrying
  `GITHUB_PERSONAL_ACCESS_TOKEN` and a filesystem server that can apply
  edits.
- A prompt injection in the code under analysis could direct a call to a
  write-capable MCP tool, sidestepping "read-only" entirely.

## Solution

Pass `-c 'mcp_servers={}'` on read-only Codex contexts in addition to the
sandbox flag (applied to `codex-analyst.md` in PR #628; the two
`exec review` sites already carried it for stall prevention). Write-capable
contexts (rescue/executor) intentionally keep user MCP servers — they match
those contexts' posture.

Scope caveat (empirical, codex-cli 0.140.0): `-c 'mcp_servers={}'`
suppresses **stdio** MCP servers (not launched), but **remote-URL** servers
still log fast-failing auth errors at startup — they do not stall the run
and their tools are unavailable, but the override is not a total "disable
all MCP" switch, so docs must not claim it is.

## Prevention

- Treat "sandbox" claims from external CLIs as scoped until proven
  otherwise — read the flag's own help text for what it actually covers.
- When an agent surface is labeled read-only, enumerate every capability
  channel (shell, MCP, network), not just the one the sandbox flag names.
- Verified fix pattern for yellow-codex: read-only analysis =
  `-c 'approval_policy="never"' -c 'mcp_servers={}' -s read-only`.
