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

> **2026-07-20 update:** the contract below describes hook events,
> envelopes, and trust — it does not mean hooks execute. On codex-cli
> 0.144.1, hooks distributed via a Codex plugin never fire (`plugin_hooks`
> is stage `removed`). See "Update — 2026-07-20" at the end of this doc
> before building on live hook delivery.

- Ten events exist: SessionStart, SubagentStart, PreToolUse,
  PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit,
  SubagentStop, Stop.
- Hook **stdin is snake_case** (`hook_event_name`, `tool_name`, `tool_input`,
  `tool_response`, `cwd`, `session_id`) while hook **output is camelCase**
  (`hookSpecificOutput.permissionDecision`). **Correction (2026-07-20):**
  Claude's hook stdin is ALSO snake_case — confirmed against
  code.claude.com/docs/en/hooks and against this repo's own
  `check-commit-message.sh`, which reads `.tool_input.command` and
  `.tool_result.exit_code` directly and is the currently-functioning
  behavior captured in `plugins/gt-workflow/tests/fixtures/hooks/`. Only
  hook OUTPUT is camelCase on both hosts; a prior version of this doc
  claimed Claude's input was camelCase too — that was wrong. Cross-host
  adapters must case-transform snake_case→camelCase on BOTH legs for
  input, not the Codex leg only. The output-side split is unaffected:
  Claude's PreToolUse denial is exit-2 + stderr (no JSON at all, see
  below), while PostToolUse/warn output and Codex's PreToolUse denial both
  use camelCase JSON.
- PreToolUse denial shape:
  `{"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "deny", "permissionDecisionReason": "..."}}`.
- `continue` is unsupported on PreToolUse and PermissionRequest (parsed but
  ignored). SubagentStart also parses `continue: false` but it does **not**
  stop the subagent from starting — it's silently ignored there too, so
  don't treat the unsupported set above as exhaustive. `continue: false`
  DOES halt further processing on SessionStart, UserPromptSubmit,
  PostToolUse, PreCompact, PostCompact, SubagentStop, and Stop — so a
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

## Previously unverified — resolved by the 2026-07-16 spike

The pilot's R17 spike
(`docs/research/2026-07-16-codex-plugin-contract-spike.md`) resolved all
three items empirically on codex-cli 0.144.1:

1. `$ARGUMENTS` interpolation in Codex skills — **no such primitive** (spike
   finding (a)). Arguments arrive as verbatim prompt text; port pattern is to
   reference "the argument text the user provided after the skill name" in
   SKILL.md prose. Skills are namespaced `<plugin-name>:<skill-name>` in the
   model's context.
2. `codex plugin list --available --json` — **exists and works** (spike
   finding (b)); documented in `codex plugin list --help` with a verbatim
   example. Safe to script CI against.
3. The `agents/openai.yaml` non-implicit-invocation field — **moot on
   0.144.1** (spike finding (c)): the file is not parsed from plugins at all
   (even invalid YAML produces no error). Treat `allow_implicit_invocation`
   as nonexistent until a future CLI parses the file.

## Related Docs

- [codex exec/exec review flag rejection on 0.140.0](codex-cli-exec-review-flags-rejected-0140.md)
  — using the Codex CLI as a tool (distinct concern from this doc)
- [Codex sandbox_mode does not fence MCP tools](../security-issues/codex-sandbox-mode-does-not-fence-mcp-tools.md)
- [CI schema drift: local vs remote validator](../build-errors/ci-schema-drift-hooks-inline-vs-string.md)
  — the Claude-side contract-drift counterpart, updated 2026-07-16 with the
  reopened hooks file-path question

---

## Update — 2026-07-20

While expanding shell 04 (`claude-code-codex-plugin-pilot-04-gt-workflow-pilot`)
into a concrete plan, two facts surfaced that the "Previously unverified"
section above never absorbed — that section folded in spike findings (a),
(b), (c) only. (e) and (f) are already covered by
`ci-schema-drift-hooks-inline-vs-string.md`'s own 2026-07-16 update; finding
(d) belongs here.

### Codex plugin hooks are inert on codex-cli 0.144.1 (spike finding (d))

A manifest's `hooks` pointer (inline or the `./hooks/codex-hooks.json`
override) is accepted by the parser and the plugin installs with no
validation error — but no hook ever fires. `codex features list` shows
`hooks` and `plugins` as stable/true but **`plugin_hooks` as
removed/false**. A SessionStart hook writing a sentinel file did not fire
across multiple live `codex exec` sessions, even after force-enabling
`features.plugin_hooks=true` in `config.toml` and passing
`--enable plugin_hooks`. Consequence: Codex-side hook runtime work can be
schema/unit-tested but not live end-to-end verified right now — do not gate
delivery on live Codex hook firing, and treat any generated
`codex-hooks.json` as inert until upstream restores the feature. Re-check
`codex features list | grep plugin_hooks` on any future CLI version before
relying on this.

### PreToolUse blocking is a different mechanism per host, not a field-name change

The PreToolUse denial shape documented above
(`hookSpecificOutput.permissionDecision: "deny"`) is Codex-specific. Claude
Code's PreToolUse hooks block via **exit code 2 with a stderr message** —
there is no JSON envelope in the block path at all. Confirmed by reading
this repo's live `plugins/gt-workflow/hooks/check-git-push.sh`, whose
header states the contract directly: "Exit 0 → allow the action. Exit 2 →
block the action and show the message on stderr to the user." A migration
plan that treats "port a PreToolUse blocking hook from Claude to Codex" as
"change the JSON field names" misses that Claude's side isn't JSON-based
for this case at all — the two hosts use categorically different blocking
mechanisms, not just different envelope shapes.
