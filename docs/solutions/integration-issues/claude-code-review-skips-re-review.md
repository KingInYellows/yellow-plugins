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

Step 1 of the upstream command (`anthropics/claude-plugins-official`,
`plugins/code-review/commands/code-review.md`) stops when "Claude has already
commented on this PR". Any earlier comment counts, whatever commit it reviewed
and whether the run that posted it finished.

## Fix

- The workflow no longer installs the `code-review@claude-code-plugins` plugin.
  It runs `/ci-code-review`, a vendored copy of the upstream command in
  `.github/claude-code-review/code-review.md`, with that one check removed.
- The copy is fetched from the default branch with `gh api` and written to
  `~/.claude/commands/`, so a PR cannot edit its own review prompt. The action
  loads user, project and local setting sources by default, so user commands are
  found.
- The command always posts its summary comment last, ending with
  `<!-- claude-code-review head=<sha> -->`. A shell step before the action skips
  the run only when a `claude[bot]` comment already carries the current head
  SHA. Same-SHA events (`reopened`, `ready_for_review`) skip; a new push or a
  cancelled run does not.
- Before posting inline comments the command lists the PR's existing ones and
  skips issues `claude[bot]` already raised, so a re-run after a cancel does not
  duplicate them.

Each push now costs a full review (about $1 of subscription usage on #1645).
CLAUDE-285 chose to keep this job, so that cost is accepted.

## Maintaining the copy

When upstream changes the command, diff it against the header's pinned commit
and port the change. Keep the three local changes listed in the header comment.

## Verifying in CI

A PR that edits the workflow cannot verify it: the action refuses to run when
the workflow differs from the default branch. After merge, push twice to a
normal non-draft PR. The second push should run a full review and post a new
summary with the new SHA; a `reopened` event on the same head should log
"already has a completed Claude review; skipping".
