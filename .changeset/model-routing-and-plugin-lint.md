---
"yellow-debt": patch
"yellow-semgrep": patch
"yellow-core": patch
"yellow-research": patch
---

Add deliberate model routing and per-repo plugin lint script

**Model routing** — set explicit models on 5 agents/commands where the
default `inherit` is wasteful or insufficient:

- `model: haiku` on pure display/status commands (`debt:status`,
  `semgrep:status`) — matches precedent in `ci:status`. Low reasoning needs
  don't require Sonnet-level inference.
- `model: opus` on heavy-reasoning agents: `architecture-strategist`
  (SOLID / coupling analysis), `research-conductor` (multi-source synthesis),
  `audit-synthesizer` (cross-scanner merging with severity scoring).

Caveats documented in the plan:
- GitHub Issue #14863 — verify Haiku + `tool_reference` block support in
  current Claude Code version; affected agents only use Bash/Skill/
  AskUserQuestion so low risk.
- GitHub Issue #29768 — model inheritance bug; setting `model:` explicitly
  (not relying on inherit) avoids this.

**Plugin lint script** — introduces `scripts/lint-plugins.sh`, a shell-only
lint that validates agent frontmatter (name/description/tools), flags the
`memory: true` mistake (correct form is a scope string), and verifies skill
references resolve to an existing SKILL.md. Wired into CI via
`.github/workflows/lint-plugins.yml`.

The lint currently reports 0 errors and 0 warnings — all `memory: true`
occurrences were migrated to valid scope strings in prior stack PRs (#253
and #255), so this lint lands clean on day one.
