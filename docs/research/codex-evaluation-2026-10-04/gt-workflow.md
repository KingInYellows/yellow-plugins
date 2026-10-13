# Plugin Eval Report: gt-workflow

## At a Glance
- Score: 0/100
- Grade: F
- Risk: high
- Checks: 12 fail, 1 warn, 2 info
- Active budget: 20766 tokens (excessive)
- Observed usage: not supplied

## Why It Matters
- 12 failing error checks are driving the highest-confidence problems.
- 1 warning signal still need cleanup before this feels polished.
- manifest is the largest source of score loss at -126 points.
- Active budget pressure is high enough that token cost may dominate the user experience.
- No observed usage is attached yet, so budget conclusions are still based on static estimates.

## Fix First
- [fail/error] plugin.json interface is missing `capabilities`. Why: Manifest issues reduce trust because Codex may not discover or represent the plugin correctly. Fix: Add interface.capabilities to plugin.json.
- [fail/error] plugin.json interface is missing `defaultPrompt`. Why: Manifest issues reduce trust because Codex may not discover or represent the plugin correctly. Fix: Add interface.defaultPrompt to plugin.json.
- [fail/error] plugin.json interface is missing `developerName`. Why: Manifest issues reduce trust because Codex may not discover or represent the plugin correctly. Fix: Add interface.developerName to plugin.json.

## Recommended Next Step
- Fix structural issues first
- Why: Failing manifest or skill structure issues reduce trust and can invalidate later measurements.
- Chat request: "What should I fix first?"
- Local command: `plugin-eval start ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow --request 'What should I fix first?' --format markdown`

## Details
<details>
<summary>Watch next</summary>

- [fail/error] plugin.json interface is missing `longDescription`. Why: Manifest issues reduce trust because Codex may not discover or represent the plugin correctly. Fix: Add interface.longDescription to plugin.json.
- [fail/error] plugin.json interface is missing `privacyPolicyURL`. Why: Manifest issues reduce trust because Codex may not discover or represent the plugin correctly. Fix: Add interface.privacyPolicyURL to plugin.json.
- [fail/error] plugin.json interface is missing `shortDescription`. Why: Manifest issues reduce trust because Codex may not discover or represent the plugin correctly. Fix: Add interface.shortDescription to plugin.json.
</details>
<details>
<summary>Improvement brief</summary>

- Raise the evaluation from grade F (0/100) with a focus on the highest-signal structural and budget issues first.
- Goal: Add `author` to plugin.json.
- Goal: Add interface.shortDescription to plugin.json.
- Goal: Add interface.longDescription to plugin.json.
- Goal: Add interface.developerName to plugin.json.
- Goal: Add interface.capabilities to plugin.json.
- Measure: token-usage-observer
- Measure: task-outcome-scorecard
- Measure: tool-call-audit
- Measure: latency-efficiency
- Suggested prompt: Use the skill-creator guidance to improve gt-workflow. Keep the structure compact and move bulky details into references or scripts. Define success measures with these toolsets: token-usage-observer, task-outcome-scorecard, tool-call-audit, latency-efficiency. Address manifest-missing-author: plugin.json is missing the required `author` field. Address interface-missing-shortDescription: plugin.json interface is missing `shortDescription`. Address interface-missing-longDescription: plugin.json interface is missing `longDescription`. Address interface-missing-developerName: plugin.json interface is missing `developerName`. Address interface-missing-capabilities: plugin.json interface is missing `capabilities`. Address interface-missing-websiteURL: plugin.json interface is missing `websiteURL`. Address interface-missing-privacyPolicyURL: plugin.json interface is missing `privacyPolicyURL`. Address interface-missing-termsOfServiceURL: plugin.json interface is missing `termsOfServiceURL`.
</details>
<details>
<summary>Budgets and observed usage</summary>

- trigger_cost_tokens: 686 (excessive)
- invoke_cost_tokens: 20080 (excessive)
- deferred_cost_tokens: 66384 (excessive)
- explicit_only_invoke_cost_tokens: 0 (good, unscored)
- total_tokens: 87150 (excessive)

- No observed usage supplied.
</details>
<details>
<summary>Measurement plan</summary>

Combine cost, outcome, and trust signals so you can tell whether the skill or plugin is genuinely helping instead of only looking well-structured on paper.

- Token Usage Observer [high] Measure how many tokens the skill or plugin actually burns in representative runs. Signals: observed_usage_sample_count, observed_input_tokens_avg, observed_total_tokens_avg, estimate_vs_observed_input_ratio. Evidence: Responses API usage logs, Codex-like session exports, JSONL traces captured from local benchmarking harnesses.
- Task Outcome Scorecard [high] Measure whether the skill helps users finish the intended job with fewer retries and less cleanup. Signals: task_success_rate, first_pass_success_rate, retry_rate, human_override_rate. Evidence: Task run logs, Structured user acceptance checklist, Before/after comparison runs on the same prompts.
- Tool Call Audit [high] Check whether the agent uses the right tools, arguments, and sequencing when the skill is active. Signals: tool_call_success_rate, invalid_tool_argument_rate, recoverable_tool_failure_rate. Evidence: Tool invocation traces, Recorded sessions, Golden-path scenario replays.
- Latency And Efficiency [high] Track whether the skill speeds users up enough to justify its cost. Signals: p50_time_to_first_acceptable_answer_seconds, p95_time_to_task_completion_seconds, tokens_per_successful_run. Evidence: Benchmark harness timings, Manual stopwatch runs on canonical tasks, Responses API timestamps combined with usage logs.
- Human Rubric Review [medium] Capture clarity, trust, and usefulness signals that automated checks will miss. Signals: clarity_score_avg, confidence_score_avg, follow_up_question_rate. Evidence: Reviewer scorecards, Team rubric sheets, Annotated transcripts.
</details>
<details>
<summary>Use From Codex Chat</summary>

Start with a natural chat request, then let plugin-eval show the exact local command sequence behind it.

Start with this chat request: "Evaluate this plugin."
Why this path: Plugin Eval recommended Evaluate Plugin from the current local state for this plugin.
Quick local entrypoint: plugin-eval start ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow --request 'Evaluate this plugin.' --format markdown
Plugin Eval will run first: plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow --format markdown

Other chat requests you can use:
- Full Plugin Analysis: say "Give me a full analysis of this plugin, including benchmark setup." -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow --format markdown
- Evaluate Plugin: say "Evaluate this plugin." -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow --format markdown
- Explain Token Budget: say "Explain the token budget for this plugin." -> plugin-eval explain-budget ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow --format markdown
- Measure Real Token Usage: say "Measure the real token usage of this plugin." -> plugin-eval init-benchmark ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow
- Benchmark With Starter Scenarios: say "Help me benchmark this plugin." -> plugin-eval init-benchmark ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow
- Start Here: say "What should I run next?" -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow --format markdown
</details>
<details>
<summary>Checks</summary>

- [FAIL] manifest-missing-author: plugin.json is missing the required `author` field. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add `author` to plugin.json.
- [FAIL] interface-missing-shortDescription: plugin.json interface is missing `shortDescription`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.shortDescription to plugin.json.
- [FAIL] interface-missing-longDescription: plugin.json interface is missing `longDescription`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.longDescription to plugin.json.
- [FAIL] interface-missing-developerName: plugin.json interface is missing `developerName`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.developerName to plugin.json.
- [FAIL] interface-missing-capabilities: plugin.json interface is missing `capabilities`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.capabilities to plugin.json.
- [FAIL] interface-missing-websiteURL: plugin.json interface is missing `websiteURL`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.websiteURL to plugin.json.
- [FAIL] interface-missing-privacyPolicyURL: plugin.json interface is missing `privacyPolicyURL`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.privacyPolicyURL to plugin.json.
- [FAIL] interface-missing-termsOfServiceURL: plugin.json interface is missing `termsOfServiceURL`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.termsOfServiceURL to plugin.json.
- [FAIL] interface-missing-defaultPrompt: plugin.json interface is missing `defaultPrompt`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/gt-workflow/.codex-plugin/plugin.json Remediation: Add interface.defaultPrompt to plugin.json.
- [WARN] skill:gt-setup:progressive-disclosure-missing: The skill is getting large without using references for progressive disclosure. Evidence: Large skills are easier to maintain when variants live under references/. Remediation: Move deep detail or edge-case variants into references/ and link them from SKILL.md.
- [FAIL] trigger_cost_tokens-budget-high: trigger_cost_tokens is excessive relative to the current Codex baseline. Evidence: Value: 686 tokens Baseline samples: skills=5, plugins=176 Remediation: Reduce repeated instruction text and move detail into deferred supporting files.
- [FAIL] invoke_cost_tokens-budget-high: invoke_cost_tokens is excessive relative to the current Codex baseline. Evidence: Value: 20080 tokens Baseline samples: skills=5, plugins=176 Remediation: Reduce repeated instruction text and move detail into deferred supporting files.
- [FAIL] deferred_cost_tokens-budget-high: deferred_cost_tokens is excessive relative to the current Codex baseline. Evidence: Value: 66384 tokens Baseline samples: skills=5, plugins=176 Remediation: Reduce repeated instruction text and move detail into deferred supporting files.
- [INFO] coverage-artifacts-unavailable: No coverage artifacts were found for this target. Evidence: plugins/gt-workflow Remediation: Generate `lcov.info`, `coverage.xml`, or an Istanbul coverage JSON file if you want coverage scoring.
</details>
<details>
<summary>Metrics</summary>

- skill:audit-review:skill_line_count: 140 lines (good)
- skill:audit-review:description_length_chars: 197 chars (good)
- skill:audit-review:relative_link_count: 0 links (good)
- skill:audit-review:code_fence_count: 3 blocks (good)
- skill:audit-review:support_file_count: 0 files (info)
- skill:gt-amend:skill_line_count: 224 lines (good)
- skill:gt-amend:description_length_chars: 300 chars (good)
- skill:gt-amend:relative_link_count: 0 links (good)
- skill:gt-amend:code_fence_count: 9 blocks (moderate)
- skill:gt-amend:support_file_count: 0 files (info)
- skill:gt-cleanup:skill_line_count: 361 lines (moderate)
- skill:gt-cleanup:description_length_chars: 271 chars (good)
- skill:gt-cleanup:relative_link_count: 0 links (good)
- skill:gt-cleanup:code_fence_count: 14 blocks (moderate)
- skill:gt-cleanup:support_file_count: 3 files (good)
- skill:gt-merge:skill_line_count: 72 lines (good)
- skill:gt-merge:description_length_chars: 194 chars (good)
- skill:gt-merge:relative_link_count: 0 links (good)
- skill:gt-merge:code_fence_count: 3 blocks (good)
- skill:gt-merge:support_file_count: 0 files (info)
- skill:gt-nav:skill_line_count: 139 lines (good)
- skill:gt-nav:description_length_chars: 265 chars (good)
- skill:gt-nav:relative_link_count: 0 links (good)
- skill:gt-nav:code_fence_count: 11 blocks (moderate)
- skill:gt-nav:support_file_count: 0 files (info)
- skill:gt-setup:skill_line_count: 440 lines (moderate)
- skill:gt-setup:description_length_chars: 175 chars (good)
- skill:gt-setup:relative_link_count: 0 links (good)
- skill:gt-setup:code_fence_count: 12 blocks (moderate)
- skill:gt-setup:support_file_count: 0 files (info)
- skill:gt-stack-plan:skill_line_count: 268 lines (good)
- skill:gt-stack-plan:description_length_chars: 129 chars (good)
- skill:gt-stack-plan:relative_link_count: 0 links (good)
- skill:gt-stack-plan:code_fence_count: 6 blocks (good)
- skill:gt-stack-plan:support_file_count: 0 files (info)
- skill:gt-sync:skill_line_count: 159 lines (good)
- skill:gt-sync:description_length_chars: 285 chars (good)
- skill:gt-sync:relative_link_count: 0 links (good)
- skill:gt-sync:code_fence_count: 9 blocks (moderate)
- skill:gt-sync:support_file_count: 0 files (info)
- skill:smart-submit:skill_line_count: 325 lines (good)
- skill:smart-submit:description_length_chars: 357 chars (good)
- skill:smart-submit:relative_link_count: 0 links (good)
- skill:smart-submit:code_fence_count: 17 blocks (moderate)
- skill:smart-submit:support_file_count: 0 files (info)
- skill:stack-decomposition-format:skill_line_count: 154 lines (good)
- skill:stack-decomposition-format:description_length_chars: 203 chars (good)
- skill:stack-decomposition-format:relative_link_count: 0 links (good)
- skill:stack-decomposition-format:code_fence_count: 5 blocks (good)
- skill:stack-decomposition-format:support_file_count: 0 files (info)
- skill:stack-plan-style:skill_line_count: 36 lines (good)
- skill:stack-plan-style:description_length_chars: 187 chars (good)
- skill:stack-plan-style:relative_link_count: 0 links (good)
- skill:stack-plan-style:code_fence_count: 0 blocks (good)
- skill:stack-plan-style:support_file_count: 0 files (info)
- plugin_skill_count: 11 skills (good)
- plugin_keyword_count: 0 keywords (info)
- plugin_default_prompt_count: 0 prompts (moderate)
- trigger_cost_tokens: 686 tokens (excessive)
- invoke_cost_tokens: 20080 tokens (excessive)
- deferred_cost_tokens: 66384 tokens (excessive)
- explicit_only_invoke_cost_tokens: 0 tokens (good)
- coverage_artifact_count: 0 files (info)
</details>
<details>
<summary>Score details</summary>

- Starting score: 100
- Total deductions: -172.75
- Final score: 0
- Risk: Contains 12 failing error checks (deferred_cost_tokens-budget-high, interface-missing-capabilities, interface-missing-defaultPrompt).
- Risk: Overall score is below 70, which the evaluator treats as high risk.

- -14 points: deferred_cost_tokens-budget-high [fail/error] deferred_cost_tokens is excessive relative to the current Codex baseline.
- -14 points: interface-missing-capabilities [fail/error] plugin.json interface is missing `capabilities`.
- -14 points: interface-missing-defaultPrompt [fail/error] plugin.json interface is missing `defaultPrompt`.
- -14 points: interface-missing-developerName [fail/error] plugin.json interface is missing `developerName`.
- -14 points: interface-missing-longDescription [fail/error] plugin.json interface is missing `longDescription`.
- -14 points: interface-missing-privacyPolicyURL [fail/error] plugin.json interface is missing `privacyPolicyURL`.
- -14 points: interface-missing-shortDescription [fail/error] plugin.json interface is missing `shortDescription`.
- -14 points: interface-missing-termsOfServiceURL [fail/error] plugin.json interface is missing `termsOfServiceURL`.
- -14 points: interface-missing-websiteURL [fail/error] plugin.json interface is missing `websiteURL`.
- -14 points: invoke_cost_tokens-budget-high [fail/error] invoke_cost_tokens is excessive relative to the current Codex baseline.
- -14 points: manifest-missing-author [fail/error] plugin.json is missing the required `author` field.
- -14 points: trigger_cost_tokens-budget-high [fail/error] trigger_cost_tokens is excessive relative to the current Codex baseline.
- -4.5 points: skill:gt-setup:progressive-disclosure-missing [warn/warning] The skill is getting large without using references for progressive disclosure.
- -0.25 points: coverage-artifacts-unavailable [info/info] No coverage artifacts were found for this target.

- manifest: -126 points across 9 checks
- budget: -42 points across 3 checks
- best-practice: -4.5 points across 1 check
- coverage: -0.25 points across 1 check
</details>
