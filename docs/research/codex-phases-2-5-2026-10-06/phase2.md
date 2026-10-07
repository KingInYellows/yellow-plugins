# Phase 2 manifest/resource contract

Codex CLI 0.157.0's generated local protocol was inspected first (app-server
generate-json-schema); its SkillsListResponse omits skill invocation policy.
Pinned upstream skills/src/model.rs confirms the boolean policy default, and
core-plugins/src/manifest.rs confirms developerName, websiteURL, keywords and
the legacy parser's ignored author/license fields. Schema and emitter now carry
shared attribution and real existing homepage links. No icons, invented URLs or
public submission requirements are added.

Primary sources:
- https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/skills/src/model.rs
- https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core-plugins/src/manifest.rs
- https://learn.chatgpt.com/docs/build-skills
- https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/config/src/mcp_types.rs

The generated skill tree supports exactly SKILL.md, flat references/*.md and
agents/openai.yaml containing only policy.allow_implicit_invocation:boolean.
Unknown policy fields, duplicate YAML keys, aliases, nested/extra resources and
symlinks fail. Cursor validates this host-only source resource then omits it,
preserving its generated skill bytes. Stale policy bytes and removal are gated
by generate --check. Permission preservation is unnecessary for this YAML/text
shape; selected Cursor runtime JS is shipped in its existing tracked dist tree
and executed with Node. No new scripts/assets resource mechanism or dependency
was necessary.

Target MCP override allows an explicitly selected HTTPS URL-only map. The
research slice ships only public DeepWiki; it cannot inherit Claude userConfig,
keys, headers, env or other servers. Default host approvals remain intact.
Disposable acceptance sets per-tool approval_mode=approve only for the existing
pre-authorized DeepWiki read operations, in a private profile. It does not grant
generic MCP approval or change owner config.

Local runtime/schema validity, marketplace presentation and optional public
submission are separate layers. The repository schema is an intentional narrow
exposure policy, not an exhaustive official host schema. Public publication
criteria are deliberately outside this local implementation.

Installed explicit, implicit and unrelated policy controls and final
regeneration/determinism are recorded by the integrated acceptance audit.
