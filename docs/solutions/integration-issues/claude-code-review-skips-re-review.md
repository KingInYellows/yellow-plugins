---
title: 'Claude Code Review skips every push after its first comment'
date: '2026-11-17'
category: 'integration-issues'
track: bug
problem:
  'The upstream code-review command reviews a PR once and then stops for good'
tags:
  - github-actions
  - claude-code-action
  - code-review-plugin
components:
  - .github/workflows/claude-code-review.yml
  - .github/claude-code-review/code-review.md
---

# Claude Code Review skips every push after its first comment

## Problem

After #1633 made the Claude Code Review workflow post with `--comment`, a PR got
one review. Later pushes (`synchronize`) ended in 2 to 3 turns with nothing
posted. When `cancel-in-progress` cancelled a run while it was posting inline
comments, the rest were never posted, and the next run skipped the PR too
(CLAUDE-248).

## Root cause

Step 1 of the upstream command
([code-review.md in anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/blob/fd30cee3ecd5a8ee772733c5d20c0f2bae2da2f0/plugins/code-review/commands/code-review.md))
stops when "Claude has already commented on this PR". Any earlier comment
counts, whatever commit it reviewed and whether the run that posted it finished.

## Fix

- The workflow no longer installs the `code-review@claude-code-plugins` plugin.
  It runs `/ci-code-review`, a vendored copy of the upstream command in
  `.github/claude-code-review/code-review.md`, with that one check removed.
- The copy is fetched from the default branch with `gh api` and written to
  `~/.claude/commands/`, so a PR cannot edit its own review prompt. The action
  runs with `--setting-sources user`, so user commands are found and the PR's
  `.claude/` settings, hooks, commands, skills, agents and `CLAUDE.md` files do
  not load (CLAUDE-350).
- The command always posts its summary comment last: it starts with
  `## Code review` and ends with `<!-- claude-code-review head=<sha> -->`. A
  shell step before the action skips the run only when such a `claude[bot]`
  comment exists for the current head SHA. Same-SHA events (`reopened`,
  `ready_for_review`) skip; a new push or a cancelled run does not. A failure to
  fetch the command other than 404 fails the job instead of skipping.
- The same step saves `claude[bot]`'s earlier inline comments to
  `.claude-code-review/prior-inline-comments.jsonl`, and the command skips
  issues already raised there. The agent itself gets no `gh api` access.

Each push now costs a full review (about $1 of subscription usage on #1645).
CLAUDE-285 chose to keep this job, so that cost is accepted.

## Maintaining the copy

When upstream changes the command, diff it against the header's pinned commit
and port the change. Keep the local changes listed in the header comment.

## Verifying in CI

A PR that edits the workflow cannot verify it: the action refuses to run when
the workflow differs from the default branch. After merge, push twice to a
normal non-draft PR. The second push should run a full review and post a new
summary with the new SHA; a `reopened` event on the same head should log
"already has a completed Claude review; skipping".
