---
title: 'Codex exposure-lint vs Claude `.claude/`-config retention: host-neutral skill bodies'
date: 2026-07-23
category: integration-issues
track: knowledge
problem: 'R31 .claude/-config retention conflicts with R15 exposure-lint banning .claude/ and CLAUDE_* tokens in Codex skill bodies'
tags:
  - codex
  - cross-host
  - exposure-lint
  - host-neutral-skills
  - config-retention
components:
  - scripts/validate-codex.js
  - plugins/yellow-ci/codex/skills
  - plugins/yellow-ci/.claude
---

# Codex exposure-lint vs Claude `.claude/`-config retention: host-neutral skill bodies

## Context

While expanding shell 5 of 5 in the Claude Code + Codex dual-host pilot for
yellow-ci (`claude-code-codex-plugin-pilot-05-yellow-ci-pilot`), two
pattern-survey subagents flagged a conflict between the parent spec's own
requirements that the shell's own "Open Questions: None" had missed:

- R29 mandates that all six new yellow-ci operational skills be
  Codex-exposed.
- R31 mandates retaining the existing `.claude/`-rooted config path
  (`.claude/yellow-ci-runner-targets.yaml`) with no migration.
- R15's exposure lint (`scripts/validate-codex.js`) unconditionally rejects
  any `.claude/` substring or `CLAUDE_(PLUGIN_ROOT|PLUGIN_DATA|PROJECT_DIR|
  ENV_FILE|EFFORT|CODE_REMOTE)` token anywhere in Codex-exposed content.

Three of the six mandatory skills (ci-setup, ci-setup-runner-targets,
ci-runner-health) source that `.claude/`-rooted config as a core function,
so exposing them as-is fails the lint for the whole plugin — the lint runs
across every allowlisted skill at once, so one failing skill blocks
`pnpm validate:codex` for the entire plugin, not just that skill.

## Guidance

The conflict is resolvable without amending the spec, because the exposure
lint and the config-retention requirement operate on different scopes —
confirmed by reading `scripts/validate-codex.js` directly rather than
trusting the survey subagents' "blocking" framing:

- The exposure lint's file-collection step scans only the generated Codex
  plugin manifest and the generated skill tree (or a plugin's configured
  skill-path override). It never reads the hook, lib, or command-wrapper
  layers behind those skills.
- Therefore `.claude/`-rooted paths and `CLAUDE_PLUGIN_ROOT`/
  `CLAUDE_PLUGIN_DATA` references are permitted in the hook/lib/wrapper
  layer — banned only inside Codex-exposed SKILL.md bodies.
- Cross-host research (Codex's own skill-authoring docs, the Codex CLI
  source) confirms Codex never reads `.claude/` at all: it resolves its own
  config from `~/.codex/`, `CODEX_HOME`, and `.codex/skills`/`.agents/skills`.
  Codex does set `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` in the
  plugin-hook environment for Claude-compat, but not in the skill/model
  context a SKILL.md body is read into.
- Resolution: keep SKILL.md bodies host-neutral by describing behavior in
  terms of an already-existing host-neutral config location (an XDG-style
  global path) as the primary path they name; keep the `.claude/`-rooted
  per-repo override and any `CLAUDE_PLUGIN_DATA` cache logic entirely in
  the non-linted hook/lib/wrapper layer. R31's "retain `.claude/` with no
  migration" is then satisfied at the config-storage level — the
  Claude-side hook/lib code still reads and writes it — not at the
  skill-body-prose level. Naming `.claude/` inside a Codex-exposed skill
  body would instruct the Codex model to touch a directory that doesn't
  exist in a Codex session, which is a worse outcome than failing the lint.

## Why This Matters

The tempting shortcut — reword the skill body just enough to dodge the
literal `.claude/` substring match while still instructing the model to
read or write that path — would pass the lint but defeat its intent: the
skill body still assumes a Claude-only filesystem location, producing
non-executable guidance on an actual Codex session. Picking that shortcut
silently would bury a verified spec conflict for whoever implements the
shell next.

## When to Apply

Before allowlisting a skill for Codex exposure
(`targets.codex.skillAllowlist`) when its Claude-side implementation
depends on `.claude/`-rooted config or `CLAUDE_*` env vars:

- Check whether the dependency lives in the SKILL.md body (linted, must be
  host-neutral) or only in the hook/lib/command layer behind it (not
  scanned by the exposure lint's file-collection step).
- If the skill body must describe config behavior at all, describe a
  host-neutral location the skill can plausibly reach on both hosts, and
  push any Claude-specific override/cache path down into the hook/lib
  layer.
- Re-run `pnpm validate:codex` after rewriting, and separately confirm the
  rewritten body no longer instructs the model to touch a Claude-only path
  — a passing lint is necessary but not sufficient.

## Examples

`scripts/validate-codex.js`'s direct-pattern checks
(`claude-config-dir-write`, `claude-env-var-reference`) are what fire on a
literal `.claude/` or `CLAUDE_PLUGIN_ROOT`-family token; its exposed-file
collector is what limits their reach to the generated manifest and skill
tree rather than the whole plugin directory.

## Related Docs

- [OpenAI Codex plugin manifest, marketplace, and hook contract](codex-plugin-manifest-and-hook-contract.md)
  — primary-source Codex plugin/hook contract facts; this doc is about this
  repo's own validator scope plus an authoring pattern, not Codex's contract
  itself.
- [Codex-exposed skills assume Claude-only capabilities with no validator coverage](codex-skill-exposure-validator-blind-spots.md)
  — a sibling finding set, but in the opposite direction: cases the
  exposure lint fails to catch. This doc is about the lint correctly
  catching a real over-restriction that a skill-body pattern must design
  around.
- [Spec-Shells Dependency Oracle](../workflow/spec-shells-dependency-oracle-plans-complete.md)
  — the expand-shell process learning from the same session (verified spec
  conflicts are a legitimate escalation gate).
