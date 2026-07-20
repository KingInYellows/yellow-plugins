---
'yellow-core': minor
---

Extract `/plan:status`'s Phase 1/2 bash logic into a canonical `plan-status` skill under `plugins/yellow-core/skills/plan-status/`, with `/plan:status` converted into a thin wrapper that invokes it via the `Skill` tool (behavior parity proven by `plugins/yellow-core/tests/plan-status-parity.bats` against captured golden fixtures). Also enables Codex distribution for yellow-core — the first Codex-enabled plugin in this marketplace — exposing exactly three read-only skills (`agent-native-architecture`, `agent-native-audit`, `plan-status`) via `catalog/plugins/yellow-core.json`'s `targets.codex` block, with `includeHooks: false` keeping yellow-core's Claude-side Stop/SessionStart hooks out of its Codex manifest.

<!-- markdownlint-disable-file MD041 -->

