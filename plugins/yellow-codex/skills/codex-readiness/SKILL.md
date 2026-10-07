---
name: codex-readiness
description: 'Check local Codex CLI and login. Use when checking Codex setup.'
user-invocable: true
---

# Check local Codex readiness

## What It Does

Checks the CLI and native authentication readiness on one selected host without
making a model request. This is the bounded prerequisite subset of the plugin's
status procedure. It does not prove server access, quota, model availability or
successful review/execution.

## When to Use

Use for an explicit local Codex installation/authentication check. Do not
activate for general review, coding, arithmetic, or another provider's status.
Use WSL's CLI for a WSL repository and Windows' native CLI for Windows work.
Treat those installations and login contexts independently.

## Usage

Read `references/readiness-contract.md` relative to this installed skill. Use
the provided bounded host probe or its equivalent. Run the CLI version probe
once and the native login-status probe at most once. Capture login stdout/stderr
privately in memory; print only the classification, never the captured text or
key fragments. Each probe has a 15-second deadline and no automatic retry.
API-key presence alone is configuration evidence, not proof of authenticated
server access. Do not print its value or length.

Report `operation:"codex-readiness"`, host, CLI state/version, sanitized
authentication state, and `modelRequest:false`. Keep unsupported CLI version,
missing CLI, missing auth, native probe errors and authenticated-local-state
distinct. A successful native login check still leaves remote execution
unverified. Do not open credential/config files, enumerate sessions/process
arguments, install tools, run login, edit config, or copy credentials.

Never invoke `codex exec`, review, rescue, a model smoke test or another agent
from this skill, including when already running inside Codex. No fan-out or
recursive execution is allowed. Memory reads/writes require a separate explicit
request. Stop on missing tools, timeout or probe errors and give the bounded
classification without attempting recovery operations.
