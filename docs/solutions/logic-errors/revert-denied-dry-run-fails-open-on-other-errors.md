---
title: 'An ask-first gate must not fall back to the unasked action when its preview fails'
date: 2026-10-14
category: logic-errors
track: bug
problem: 'Interactive /review:resolve fell back to the unasked trusted-config revert whenever the revert-denied --dry-run preview failed for any reason but the ignored-file stop'
tags: [yellow-review, resolve-pr, run-verify-command, revert-denied, fail-open, askuserquestion, exit-codes]
components: [plugins/yellow-review/commands/review/resolve-pr.md, plugins/yellow-review/skills/pr-review-workflow/scripts/run-verify-command, plugins/yellow-review/tests/run-verify-command.bats]
---

## Problem

PR #1193 made interactive `/review:resolve` ask before reverting
trusted-config files (agent instructions, tool config) that a resolver may have
written, using a new `run-verify-command --revert-denied --dry-run` preview.
Its `/review:pr` review found that the gate failed open: the first draft of
`resolve-pr.md` Step 6 treated only the ignored-file refusal as a stop, and any
other dry-run failure (a crash, malformed JSON, a missing field) ran the old
unasked revert. The ask existed to protect a user's own concurrent edit, so
reverting without asking on an error was the exact loss it was added to
prevent. PR #1077 had already hit the same `revert-denied` exit-code ambiguity.

## Symptoms

- A dry run that failed for a reason other than the ignored-file stop reverted
  every dirty trusted-config file without a question.
- When names were withheld or cut, the question offered a single option, which
  `AskUserQuestion` rejects (it needs two).
- The dry-run `reason` repeated link-hit paths that the `linkHits` field
  withholds, so a name containing `---` could close the caller's fence.

## What Didn't Work

- Treating exit 2 alone as the ignored-file refusal: other failures exit 2 as
  well, so the stop is matched on exit 2 plus its own stderr text.
- Offering only "Revert" when names were withheld: the tool needs two options
  and always allows free text, so the answer must be read defensively.

## Solution

Fixed in PR #1193 (`resolve-pr.md` Step 6 and `run-verify-command`):

1. Exit 2 with `gitignored trusted-config files changed since` on stderr is the
   ignored-file stop. Any other non-zero exit, or a result that is not
   `dry-run` or lacks one of its five fields, means the files could not be
   listed: the question is still asked, saying so and showing no list.
2. Both options are always real. When names were withheld, cut or not listed,
   the second option is "Leave them unseen and block merge". Any answer other
   than the second option (dismissed, free text, an error) is Revert.
3. The confirmed revert is bound to its preview: Revert passes
   `--expect-snapshot "<snapshot>"`, and a file that changed while the question
   was open makes the call refuse with nothing reverted, so the preview is
   re-run and asked once more.
4. The dry run no longer repeats link-hit paths in `reason`; `linkHits` carries
   them, screened. The shared `paths_json` screen reports a screen that did
   not run as "could not be screened", not as a credential.
5. Kept files are re-listed with a second dry run after the next question, not
   read from `git status`.

`--non-interactive` keeps the unasked revert.

## Prevention

- A gate that wraps a destructive default must treat every non-success of its
  probe as ask or stop, never as the default.
- Give each failure class its own signal (exit code plus stable text), and test
  the caller against each one.
- When a screening helper is shared by several outputs, test every output that
  uses it.
- Read a question's answer defensively: name the one answer that keeps the risky
  state and treat everything else as the safe choice.
