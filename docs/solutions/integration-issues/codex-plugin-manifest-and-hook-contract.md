---
title: 'OpenAI Codex plugin manifest, marketplace, and hook contract (primary-source facts)'
date: 2026-07-16
category: integration-issues
track: knowledge
problem: 'Codex plugin manifest/marketplace/hook contract facts, verified vs primary docs, distinct from Claude Code'
tags:
  - codex
  - openai-codex
  - plugin-manifest
  - hooks
  - cross-host-adapter
components:
  - .codex-plugin/plugin.json
  - .agents/plugins/marketplace.json
  - agents/openai.yaml
---

# OpenAI Codex plugin manifest, marketplace, and hook contract

## Context

While planning a Claude Code + Codex dual-host plugin pilot, primary-source
verification against developers.openai.com/codex/plugins/build and
learn.chatgpt.com/docs/hooks (fetched 2026-07-16, against Codex CLI 0.144.x)
established facts about Codex's OWN plugin contract — distinct from this
repo's existing `codex-cli-*` docs, which cover using the Codex CLI as a
reviewer/executor, not authoring plugins Codex itself loads.

## Guidance (verified facts)

### Manifest and marketplace

- Manifest lives at `.codex-plugin/plugin.json`; required fields are `name`,
  `interface.displayName`, `interface.category`. Optional: `version`,
  `description`, `author`, `homepage`, `repository`, `license`, `keywords`,
  and interface extras (`shortDescription`, `longDescription`,
  `developerName`, `capabilities`, `defaultPrompt`, `brandColor`, icons).
- Marketplace lives at `.agents/plugins/marketplace.json` (repo/team scope)
  or `~/.agents/plugins/marketplace.json` (personal); entries are
  **version-less**, and carry `name`, `source: {source: "local", path}`,
  `category`, and `policy.installation`
  (`AVAILABLE | INSTALLED_BY_DEFAULT | NOT_AVAILABLE`) plus
  `policy.authentication` (`ON_INSTALL | ON_USE`). Array order = display
  order.
- Plugins distribute skills, hooks, MCP servers (`.mcp.json`), apps, and
  assets. Plugins **cannot ship custom TOML agents** — those are project or
  user configuration only (`.codex/agents/`, `~/.codex/agents/`); built-in
  agents are `default`, `worker`, `explorer`.

### Hooks

- Ten events exist: SessionStart, SubagentStart, PreToolUse,
  PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit,
  SubagentStop, Stop.
- Hook **stdin is snake_case** (`hook_event_name`, `tool_name`, `tool_input`,
  `tool_response`, `cwd`, `session_id`) while hook **output is camelCase**
  (`hookSpecificOutput.permissionDecision`). Claude's hook envelope is
  camelCase both ways, so cross-host adapters must case-transform on the
  Codex leg only — budget for it explicitly.
- PreToolUse denial shape:
  `{"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "deny", "permissionDecisionReason": "..."}}`.
- `continue` is unsupported **only** on PreToolUse and PermissionRequest; it
  IS supported (with `continue: false` halting) on SessionStart,
  UserPromptSubmit, PreCompact, PostCompact, SubagentStop, and Stop — so a
  SessionStart hook emitting `{"continue": true}` works unmodified on both
  hosts.
- The manifest may point `hooks` at an alternate file
  (`"hooks": "./hooks/codex-hooks.json"`); the path must be relative,
  `./`-prefixed, and inside the plugin root. Default is `./hooks/hooks.json`.
  `commandWindows` (JSON) / `command_windows` (TOML) provide Windows command
  overrides.
- Hook trust is keyed to a **hash of the hook definition**: non-managed hooks
  require explicit review/trust via `/hooks`, and any edit requires
  re-approval. Consequence: any generator emitting Codex hook config must be
  hash-stable (deterministic key order, no timestamps) or users get spurious
  re-trust prompts on every regeneration — determinism is a user-facing
  requirement, not hygiene.

### Skills

- SKILL.md frontmatter in the primary spec is `name` + `description` only;
  Claude-only fields (`allowed-tools`, `context`, `hooks`,
  `user-invokable`) must be stripped when generating Codex-side copies.
- Discovery locations: repo `.agents/skills` (walked up to repo root), user
  `$HOME/.agents/skills`, admin `/etc/codex/skills`, plus plugin-bundled
  trees at whatever path the manifest's `skills` field references
  (manifest-relative — a custom path like `codex/skills/` is a choice, not a
  convention).

## Unverified (do not build on without an empirical check)

Pending the pilot's PR1 spike (`plans/specs/claude-code-codex-plugin-pilot.md`
R17(a)(b)(c)):

1. `$ARGUMENTS` interpolation in Codex skills — absent from primary docs; one
   third-party source states runtime expansion cannot be statically converted
   from Claude commands. Plan a prompt-text argument fallback.
2. `codex plugin list --available --json` — only the interactive `/plugins`
   browser is documented; verify with `codex plugin list --help` before
   scripting CI against it.
3. The exact `agents/openai.yaml` field for marking a skill non-implicit
   (`allow_implicit_invocation` is third-party-sourced; the file location
   itself is primary-confirmed).

## Related Docs

- [codex exec/exec review flag rejection on 0.140.0](codex-cli-exec-review-flags-rejected-0140.md)
  — using the Codex CLI as a tool (distinct concern from this doc)
- [Codex sandbox_mode does not fence MCP tools](../security-issues/codex-sandbox-mode-does-not-fence-mcp-tools.md)
- [CI schema drift: local vs remote validator](../build-errors/ci-schema-drift-hooks-inline-vs-string.md)
  — the Claude-side contract-drift counterpart, updated 2026-07-16 with the
  reopened hooks file-path question
