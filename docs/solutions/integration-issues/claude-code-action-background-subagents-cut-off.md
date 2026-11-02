---
title: 'claude-code-action ends before background subagents run'
date: '2026-11-02'
category: 'integration-issues'
track: bug
problem:
  'Claude Code Review runs never launch the code-review plugin review agents'
tags:
  - github-actions
  - claude-code-action
  - subagents
  - code-review-plugin
components:
  - .github/workflows/claude-code-review.yml
---

# claude-code-action ends before background subagents run

## Problem

The Claude Code Review workflow (`anthropics/claude-code-action` with the
`code-review@claude-code-plugins` plugin) finished every run in 2 to 7 turns.
`modelUsage` in the job log listed only the parent model (`claude-sonnet-5-5`).
None of the plugin's Haiku, Sonnet or Opus agents ran, and nothing was posted.
yellow-goal's copy of the workflow, which already passed `--comment`, failed the
same way.

## Root cause

Claude Code starts subagents in the background by default. The plugin's first
step launches a Haiku eligibility agent. The parent then says it will continue
when the agent reports back, and ends its turn.

`claude-code-action` iterates the Agent SDK's `query()` and breaks at the first
`result` message (`base-action/src/run-claude-sdk.ts`). The end of the parent's
first turn produces that result, so the job ends while the eligibility agent is
still on its first tool call. The review agents never start.

The full output is hidden by default (`show_full_output: false`), so the log
shows only the short `result` summary.

## Fix

Run subagents in the foreground through the action's `settings` input:

```yaml
settings: '{"env":{"CLAUDE_CODE_DISABLE_BACKGROUND_TASKS":"1"}}'
```

With background tasks off, the parent blocks on each Agent call and only ends
its turn after the review is done.

The plugin also needs these to post findings:

- `--comment` in the prompt. Without it, findings go only to the hidden log.
- `pull-requests: write` in the job permissions.
- `--allowedTools` in `claude_args` listing
  `mcp__github_inline_comment__create_inline_comment`. The action starts its
  inline-comment MCP server only when that tool is listed there. The plugin's
  own `allowed-tools` frontmatter does not start it.

## Reproducing locally

Install the versions the action uses (`@anthropic-ai/claude-agent-sdk@0.3.293`
and `@anthropic-ai/claude-code@2.1.293`). Then call `query()` with the action's
options (`systemPrompt` preset `claude_code`, `settingSources`
user/project/local, the plugin as a local plugin) and break on the first
`result`. The baseline returns its result while the subagent is still running.
With the setting passed as `extraArgs: { settings: ... }`, the parent waits.

## Verifying in CI

A workflow change cannot be tested on its own PR, because the action requires
the workflow file to match the default branch. Check the next normal (non-draft)
PR after merge: `modelUsage` should list `claude-haiku-5-5` and
`claude-opus-5-5`.
