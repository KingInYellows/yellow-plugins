# Simplify pass (`/flow:work` Phase 3 step 8)

Runs once, after the polish loop and before Phase 4, so the reviewers in Phase 5
and on the PR see a diff without duplication, dead code, worthless tests or
narrating comments. Adapted from Compound Engineering's `ce-simplify-code`
pipeline mode (pin `b405537`). The pass applies its fixes without asking and
returns a short summary; it never widens scope beyond the branch diff.

## 1. Scope and preflight

Scope is the branch diff against trunk (`git diff <trunk>...HEAD`, plus
uncommitted changes). Within it, simplify only lines the branch added or
changed, and prune only tests and comments the branch added or changed.

Stop with "Simplify pass: nothing to simplify" when the scope holds no
human-authored code: only Markdown (including plugin command, agent and skill
files), other docs, generated files (`.claude-plugin/`, `.agents/`, snapshot
files), lockfiles, changesets, or version bumps. For a mixed diff, keep only the
code files and their tests. This check is about the kind of change, never its
size.

Note the **proof tests**: the tests this task added or ran to show its change
works (from Phase 2 and Phase 3 step 1). They stay exactly as they are.

## 2. Dispatch reviewers

Issue the calls in a single response and wait for all of them. Pass each the
diff, the changed files, and the proof tests.

- `yellow-review:review:code-simplifier`: reuse, quality and efficiency on the
  changed code. Always.
- `yellow-review:review:test-value-reviewer`: only when the scope changes test
  files (`*.bats`, `*.test.ts`, `*.test.js`, `test_*.py`, fixtures).
- `yellow-review:review:comment-reviewer`: only when the scope adds or changes
  comments in `.js`, `.mjs`, `.cjs`, `.ts`, `.sh`, `.bash`, `.bats` or `.py`
  files.

If yellow-review is not installed or an agent fails, say which reviewer did not
run and continue with the others; with none, skip to step 5.

## 3. Apply

Apply worthwhile findings directly; record false positives and low-value
findings as skipped without asking. Edit only the scope and the import or export
lines it needs. Each fix must preserve outputs, errors, side effects and
ordering; skip it if that cannot be established.

- Never simplify away a safety check: trust-boundary validation, path and
  symlink checks, data-loss protection, credential handling, or the shell-compat
  tier guards.
- Never touch a proof test, or the test-only code it calls.
- **Delete a test only after running it green.** Run the command the finding
  gives. If the test fails or cannot run, do not delete it; report it as a
  possible defect. After the deletion, run the test the finding named as still
  covering the behavior and confirm it passes.
- Comment findings: delete, or reshape then delete. Never reword a comment in
  place.

## 4. Verify

Re-run the checks Phase 3 step 1 ran, scoped to the files the pass changed when
the runner allows it, plus typecheck and lint. A failure caused by the pass is
fixed or the responsible change is reverted. Never weaken or delete a test to
make a check pass. If nothing changed, skip this step.

Commit any changes as one commit, the same way Phase 3 step 6 does. On Graphite,
step 6 amends the branch commit and replaces its whole message, so build the
message file from the current message (`git log -1 --format=%B`) and keep its
body intact: the Linear closing line and any deferred P1/P2 list from step 7's
"Stop and ship as-is" branch must survive. On GitHub, write a new commit with a
message like `refactor: simplify pass before review`, keeping the Linear closing
line.

## 5. Summary

Report, in a few lines: applied counts by reuse/quality/efficiency, tests and
comments; skipped count; check outcomes; for each deleted test, the test that
still covers its behavior; and reviewers that did not run. If nothing changed,
say so. Keep the summary out of commit messages and the PR body.
