---
title: 'Codex command migration bypasses an explicit skill allowlist'
date: 2026-10-05
category: integration-issues
track: knowledge
problem:
  'Codex 0.157.0 loaded three migrated command wrappers beyond the 23 intended
  plugin skills'
tags: [codex, plugin-manifest, exposure-lint, runtime-discovery]
components:
  - scripts/lib/generate/emit-codex.js
  - schemas/codex-plugin.schema.json
  - scripts/smoke-codex-plugin-install.js
---

# Codex command migration bypasses an explicit skill allowlist

## Symptom

All four plugins installed and their declared `codex/skills` trees contained 23
expected skills. Actual app-server `skills/list` exposed 26: Codex also migrated
gt-merge, gt-setup and plan-status command wrappers into
`.codex-plugin/migrated-command-skills/`. Inspecting manifest skill paths or
using `plugin/read` against the source marketplace missed those extras.

## Cause and correction

In Codex CLI 0.157.0, an omitted `commands` declaration falls back to discovery
under `commands/` even when the manifest explicitly selects `./codex/skills`.
The generated overlay now emits `commands: []`, and the repository schema
requires an empty array. This is a repository exposure policy; it does not claim
that Codex rejects other command declarations.

The pinned
[manifest parser](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core-plugins/src/manifest.rs)
preserves an explicit empty array, and the
[command migration implementation](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core-plugins/src/command_migration/plugin.rs)
uses default discovery only when the declaration is absent. A paired disposable
fixture confirmed the difference, followed by a real four-plugin
install/discovery run: 26 before, exactly 23 after.

Claude commands remain in the source packages. The generator correction changes
only Codex manifests; Claude and Cursor generated artifacts remain identical.

## Regression gate

`pnpm smoke:codex` installs from a local marketplace into a fresh isolated
profile, compares all selected skill resources with source, and asserts exact
loaded skill names, plugin IDs and installed paths against catalog allowlists.
Missing, duplicate, disabled and additional plugin skills fail the gate.

Hook registration is recorded separately from execution; no model turn or MCP
server starts. See the
[Phase 1 receipts](../../research/codex-phase-1-2026-10-05/report.md).
Revalidate this boundary when upgrading the pinned CLI or introducing a portable
root manifest: manifest precedence may change component discovery.
