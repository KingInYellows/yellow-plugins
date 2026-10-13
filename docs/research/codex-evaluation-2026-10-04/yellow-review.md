# Plugin Eval Report: yellow-review

## At a Glance
- Score: 0/100
- Grade: F
- Risk: high
- Checks: 10 fail, 3 warn, 2 info
- Active budget: 5464 tokens (heavy)
- Observed usage: not supplied

## Why It Matters
- 10 failing error checks are driving the highest-confidence problems.
- 3 warning signals still need cleanup before this feels polished.
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
- Local command: `plugin-eval start ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --request 'What should I fix first?' --format markdown`

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
- Suggested prompt: Use the skill-creator guidance to improve yellow-review. Keep the structure compact and move bulky details into references or scripts. Define success measures with these toolsets: token-usage-observer, task-outcome-scorecard, tool-call-audit, latency-efficiency. Address manifest-missing-author: plugin.json is missing the required `author` field. Address interface-missing-shortDescription: plugin.json interface is missing `shortDescription`. Address interface-missing-longDescription: plugin.json interface is missing `longDescription`. Address interface-missing-developerName: plugin.json interface is missing `developerName`. Address interface-missing-capabilities: plugin.json interface is missing `capabilities`. Address interface-missing-websiteURL: plugin.json interface is missing `websiteURL`. Address interface-missing-privacyPolicyURL: plugin.json interface is missing `privacyPolicyURL`. Address interface-missing-termsOfServiceURL: plugin.json interface is missing `termsOfServiceURL`.
</details>
<details>
<summary>Budgets and observed usage</summary>

- trigger_cost_tokens: 207 (moderate)
- invoke_cost_tokens: 5257 (heavy)
- deferred_cost_tokens: 235808 (excessive)
- explicit_only_invoke_cost_tokens: 0 (good, unscored)
- total_tokens: 241272 (excessive)

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
Quick local entrypoint: plugin-eval start ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --request 'Evaluate this plugin.' --format markdown
Plugin Eval will run first: plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown

Other chat requests you can use:
- Full Plugin Analysis: say "Give me a full analysis of this plugin, including benchmark setup." -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
- Evaluate Plugin: say "Evaluate this plugin." -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
- Explain Token Budget: say "Explain the token budget for this plugin." -> plugin-eval explain-budget ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
- Measure Real Token Usage: say "Measure the real token usage of this plugin." -> plugin-eval init-benchmark ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review
- Benchmark With Starter Scenarios: say "Help me benchmark this plugin." -> plugin-eval init-benchmark ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review
- Start Here: say "What should I run next?" -> plugin-eval analyze ~/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review --format markdown
</details>
<details>
<summary>Checks</summary>

- [FAIL] manifest-missing-author: plugin.json is missing the required `author` field. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add `author` to plugin.json.
- [FAIL] interface-missing-shortDescription: plugin.json interface is missing `shortDescription`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.shortDescription to plugin.json.
- [FAIL] interface-missing-longDescription: plugin.json interface is missing `longDescription`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.longDescription to plugin.json.
- [FAIL] interface-missing-developerName: plugin.json interface is missing `developerName`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.developerName to plugin.json.
- [FAIL] interface-missing-capabilities: plugin.json interface is missing `capabilities`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.capabilities to plugin.json.
- [FAIL] interface-missing-websiteURL: plugin.json interface is missing `websiteURL`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.websiteURL to plugin.json.
- [FAIL] interface-missing-privacyPolicyURL: plugin.json interface is missing `privacyPolicyURL`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.privacyPolicyURL to plugin.json.
- [FAIL] interface-missing-termsOfServiceURL: plugin.json interface is missing `termsOfServiceURL`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.termsOfServiceURL to plugin.json.
- [FAIL] interface-missing-defaultPrompt: plugin.json interface is missing `defaultPrompt`. Evidence: /home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04/plugins/yellow-review/.codex-plugin/plugin.json Remediation: Add interface.defaultPrompt to plugin.json.
- [WARN] skill:yellow-thermonuclear-review:description-trigger-weak: The description does not clearly advertise when the skill should trigger. Evidence: Descriptions are the primary auto-load surface in Codex. Remediation: Rewrite the description to include a clear 'Use when ...' trigger sentence.
- [WARN] skill:yellow-thermonuclear-review:progressive-disclosure-missing: The skill is getting large without using references for progressive disclosure. Evidence: Large skills are easier to maintain when variants live under references/. Remediation: Move deep detail or edge-case variants into references/ and link them from SKILL.md.
- [WARN] invoke_cost_tokens-budget-high: invoke_cost_tokens is heavy relative to the current Codex baseline. Evidence: Value: 5257 tokens Baseline samples: skills=5, plugins=176 Remediation: Reduce repeated instruction text and move detail into deferred supporting files.
- [FAIL] deferred_cost_tokens-budget-high: deferred_cost_tokens is excessive relative to the current Codex baseline. Evidence: Value: 235808 tokens Baseline samples: skills=5, plugins=176 Remediation: Reduce repeated instruction text and move detail into deferred supporting files.
- [INFO] coverage-artifacts-unavailable: No coverage artifacts were found for this target. Evidence: plugins/yellow-review Remediation: Generate `lcov.info`, `coverage.xml`, or an Istanbul coverage JSON file if you want coverage scoring.
</details>
<details>
<summary>Metrics</summary>

- skill:yellow-thermonuclear-review:skill_line_count: 414 lines (moderate)
- skill:yellow-thermonuclear-review:description_length_chars: 339 chars (good)
- skill:yellow-thermonuclear-review:relative_link_count: 0 links (good)
- skill:yellow-thermonuclear-review:code_fence_count: 5 blocks (good)
- skill:yellow-thermonuclear-review:support_file_count: 0 files (info)
- plugin_skill_count: 1 skills (good)
- plugin_keyword_count: 0 keywords (info)
- plugin_default_prompt_count: 0 prompts (moderate)
- trigger_cost_tokens: 207 tokens (moderate)
- invoke_cost_tokens: 5257 tokens (heavy)
- deferred_cost_tokens: 235808 tokens (excessive)
- explicit_only_invoke_cost_tokens: 0 tokens (good)
- coverage_artifact_count: 0 files (info)
</details>
<details>
<summary>Score details</summary>

- Starting score: 100
- Total deductions: -153.75
- Final score: 0
- Risk: Contains 10 failing error checks (deferred_cost_tokens-budget-high, interface-missing-capabilities, interface-missing-defaultPrompt).
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
- -14 points: manifest-missing-author [fail/error] plugin.json is missing the required `author` field.
- -4.5 points: invoke_cost_tokens-budget-high [warn/warning] invoke_cost_tokens is heavy relative to the current Codex baseline.
- -4.5 points: skill:yellow-thermonuclear-review:description-trigger-weak [warn/warning] The description does not clearly advertise when the skill should trigger.
- -4.5 points: skill:yellow-thermonuclear-review:progressive-disclosure-missing [warn/warning] The skill is getting large without using references for progressive disclosure.
- -0.25 points: coverage-artifacts-unavailable [info/info] No coverage artifacts were found for this target.

- manifest: -126 points across 9 checks
- budget: -18.5 points across 2 checks
- best-practice: -9 points across 2 checks
- coverage: -0.25 points across 1 check
</details>
