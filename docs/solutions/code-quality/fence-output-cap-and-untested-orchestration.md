---
title: 'Command Fences: Aggregated Output Truncation and Untested Orchestration'
date: 2026-09-30
category: code-quality
track: knowledge
problem: A command fence that prints N untrusted blocks in one Bash call hits the tool output cap, and deleting inputs in the same fence makes the truncation unrecoverable.
tags: [bash-tool, output-cap, command-authoring, bats, council, orchestration]
components: [yellow-council]
---

# Command Fences: Aggregated Output Truncation and Untested Orchestration

## Context

The council synthesis step (PR #948 review) collected every reviewer's
output, printed it from one Bash fence, and removed the source files in the
same fence. Review found four related authoring defects. Each looks fine when
a helper is tested alone and fails only when the whole fence runs against
realistic inputs.

## Guidance

### 1. Never print N untrusted blocks from one Bash call

The Bash tool caps captured output at roughly 30K characters. Three or four
long reviewer reports exceed that, and the tail is silently cut. If the same
fence deletes its inputs (`rm` after `cat`), the cut text is gone for good.

- Write each block to its own file in a private staging directory
  (`mktemp -d`, mode 700, under the run directory).
- Read each file with the Read tool, one per call.
- Delete the staging directory in a later, separate step, after every read
  has succeeded.

Rule of thumb: a fence may produce output or destroy inputs, never both.

### 2. Test the whole orchestration fence, not just extracted helpers

Bats tests that source an extracted helper prove the helper. They do not
prove the fence wiring: variable hand-off, ordering, cleanup, and
empty-input paths. Extract the fence body from the command markdown, run it
in bats against a temp git repo with fixture reviewer outputs, and assert on
both stdout and the files left behind. Include cases for: zero reviewers,
one oversized reviewer, and a reviewer file that is unreadable.

### 3. One tested helper for logic copied across fences

The same parser or `sed` expression pasted into two fences drifts. Either
move it to one sourced library with a bats test, or add a drift check that
diffs the copies. Do not rely on reviewers noticing.

### 4. Strip flags token-wise

Removing a flag with a substring `sed` (`s/--fast//`) also mangles
`--fast-forward` and values containing the text. Split the argument string
into tokens, drop exact matches, rejoin. Test with a flag that is a prefix
of another token.

## Why This Matters

Truncation and drift failures are silent: synthesis runs to completion on
partial evidence and reports a confident verdict. The orchestration layer is
markdown plus shell, so nothing type-checks it; only an end-to-end bats run
does.

## When to Apply

- Any command or agent fence that aggregates output from multiple agents,
  files, or API calls.
- Any fence that both reads and deletes its inputs.
- Any shell snippet duplicated between commands, agents, or skills.

## Examples

```bash
# Stage: write each block to a file, print only the paths.
STAGE="$(mktemp -d "${RUN_DIR}/stage.XXXXXX")" && chmod 700 "$STAGE"
i=0
for f in "$RUN_DIR"/reviewer-*.out; do
  i=$((i + 1))
  cp "$f" "$STAGE/block-$i.txt"
  printf '%s\n' "$STAGE/block-$i.txt"
done
# Next step: Read each path. Final step, after all reads: rm -rf "$STAGE".
```

See also `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md`
for why synthesis input completeness matters, and
`docs/solutions/security-issues/preserve-reviewer-evidence-through-fencing.md`
for the evidence-fidelity side of the same change.

---

## Update — 2026-10-01

PR #955 (open when this note was written; its tests are not on `main`) added
`skill-content.bats` tests for resolve-stack and sweep-all. Review found the
first drafts of the contract and dirty-tree tests only grepped for
`ratelimited=`, so the safety-critical branches (each field of the `Resolve:`
line, the revert branches, the compound-skip text) could be deleted without
failing a test. Later rounds on that PR added assertions for the
`--revert-dirty` and `--revert-only` branches, `treeClean: false`, the
compound-skip text, the stop ordering and the `Blocking` column, and the shared
contract test now checks the `Resolve:` fields in resolve-stack and sweep.
What remains thin: the sweep-all check of the contract line is a loose
`blocking` grep. The general rule stands: assert each field and each branch by
name, so removing a branch fails a test. For absence checks, see
[A negated grep in the middle of a bats test never fails](bats-negated-grep-mid-test-never-fails.md).
