# Plugin Eval Start Here: yellow-review

## At a Glance
- Recommended path: Evaluate Plugin
- Benchmark config present: no
- Usage log present: no
- Quick local entrypoint: `plugin-eval start ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --request 'Evaluate this plugin.' --format markdown`
- First local command: `plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown`

## Why It Matters
- Start with a natural chat request, then let plugin-eval show the exact local command sequence behind it.
- Plugin Eval routed "Evaluate this plugin." to Evaluate Plugin because it asks for the overall evaluation report or prioritized findings from it.

## Fix First
- Start with the recommended path before branching into secondary workflows.

## Recommended Next Step
- Evaluate Plugin
- Why: Plugin Eval routed "Evaluate this plugin." to Evaluate Plugin because it asks for the overall evaluation report or prioritized findings from it.
- Chat request: "Evaluate this plugin."
- Local command: `plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown`

## Details
<details>
<summary>Full local sequence</summary>

- plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
</details>
<details>
<summary>Other chat requests</summary>

- Full Plugin Analysis: "Give me a full analysis of this plugin, including benchmark setup." -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
- Evaluate Plugin: "Evaluate this plugin." -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
- Explain Token Budget: "Explain the token budget for this plugin." -> plugin-eval explain-budget ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
- Measure Real Token Usage: "Measure the real token usage of this plugin." -> plugin-eval init-benchmark ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review
- Benchmark With Starter Scenarios: "Help me benchmark this plugin." -> plugin-eval init-benchmark ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review
- Start Here: "What should I run next?" -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
</details>
