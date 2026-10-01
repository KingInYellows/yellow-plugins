---
title: 'Resolver guards that trust the prompt and git status miss ignored and .git paths'
date: 2026-10-01
category: security-issues
track: bug
problem: pr-comment-resolver edits to gitignored or .git paths bypass the git-status revert, and the deny list is prompt-only
tags: [pr-comment-resolver, review-resolve, deny-list, gitignore, fail-closed, trust-boundary, yellow-review]
components: [yellow-review]
---

## Problem

`/review:resolve` dispatches `pr-comment-resolver` agents to edit files, then
verifies and, on failure, reverts their work using `git status`. Two guards
carried the safety weight: the revert, which sees only what git sees, and a
deny list in `references/resolve/dispositions.md`, which was enforced only by
the resolver's prompt. PR #954 review (architecture and security) rated this P1.

## Symptoms

- A resolver edit to `yellow-plugins.local.md`, `.claude/`, `.env`, hooks or
  git config leaves a clean `git status`, so the verify step and the revert
  never see it.
- The deny list has no runtime check; an agent that ignores or misreads the
  prompt edits a denied path with no consequence.
- One resolver's wrong `Files modified` list makes the revert discard every
  cluster's fixes and turns every fixed thread into `unclear`.
- A thread that cites its own anchor passes the "addressed" evidence check, so
  a human-authored thread can be auto-resolved without any fix.
- Null-path (PR-level) clusters run alongside path-anchored resolvers and may
  edit any line of any PR file, racing the other clusters.

## What Didn't Work

- Relying on `git status` as the change oracle. Ignored and `.git` paths are
  outside it by definition.
- Stating the deny list in the resolver prompt only. A prompt rule is advice,
  not enforcement.
- Trusting the resolver's self-reported `Files modified` list as the revert
  scope and accepting any string in it.
- Accepting a citation of the thread's own anchor as evidence that the thread
  was addressed.

## Solution

1. Before the resolver waves, hash every deny-listed path that git ignores or
   that lives under `.git` (`yellow-plugins.local.md`, `.claude`, `.env`,
   hooks, git config). After the waves, re-hash and fail closed on any
   difference: stop, report the path, and do not commit or push. Where the
   runtime allows it, enforce the deny list directly instead of detecting
   violations afterwards.
2. Require `Files modified` entries to be repo-relative paths, and drop any
   file with no diff before writing the files file, so a bad entry cannot widen
   the revert.
3. Run null-path clusters serially in a final wave, after all path-anchored
   clusters finish, and bound their edits to the PR's changed line ranges.
4. Reject a thread's own anchor as addressed-evidence. Require fixed paths
   that appear in the pushed diff.

## Why This Works

The hash comparison covers exactly the paths git cannot report on, so the
detection no longer depends on the tool that has the blind spot. Failing
closed turns a silent bypass into a stopped run. Validating the self-reported
file list and moving evidence to the pushed diff means no guard accepts a claim
the resolver can make about itself. Serializing PR-level clusters removes the
race with path-anchored work.

## Prevention

- Any guard that checks an agent's work must use an oracle independent of the
  agent's own report and of the VCS view if the guarded paths can be ignored.
- A deny list in a prompt must have a runtime counterpart (hash check or
  enforced tool restriction), or the doc must say it is advisory.
- When adding a resolver or editor agent, list which paths are invisible to
  `git status` and test one of them.
- Add a bats or contract test that edits a gitignored deny-listed fixture and
  asserts the run fails closed.
- Evidence rules need a negative test: a thread citing its own anchor must not
  resolve.

See also `docs/solutions/security-issues/tracked-file-as-untrusted-input-channel.md`.

---

## Update — 2026-10-01

PR #955 (`/review:resolve-stack` dirty-tree stop) review found two more
places where the guard trusted what `git status` shows.

### A gitignored trusted-config file is invisible to the revert

`yellow-plugins.local.md` is gitignored in most consumer repos, and it
carries `verify_command` and `verify_unattended`. A steered resolver edit
to it never appears in `git status --porcelain`, so the dirty-tree stop
and the trusted-config revert both miss it. The edit then runs as a shell
command on the next PR in the walk.

Guidance: do not detect trusted-config tampering through git. At
pre-flight, hash every trusted-config path that exists, ignored ones
included (`.claude/`, `yellow-plugins.local.md`, root `CLAUDE.md`,
`AGENTS.md`, `.mcp.json`). After each resolve, re-hash. On a change,
restore the file from the pre-flight copy and stop the walk. A restore
that fails is itself a stop condition. Tracked in #973.

### `--revert-only` was called loosely

The revert step called `run-verify-command` by bare name, so it depended
on `PATH` instead of the plugin root. It passed paths in porcelain shape
(quoted, with rename arrows), and it never checked the exit code or
`treeClean`. A failed revert looked like a successful one.

- Call the script by its full `${CLAUDE_PLUGIN_ROOT}/...` path.
- List paths with `git status --porcelain=v1 -z --untracked-files=all`
  so names with spaces or quotes survive and untracked files in new
  directories show up.
- Treat a non-zero exit or `treeClean: false` as a reported failure
  that stops the walk. Never as a silent success.
