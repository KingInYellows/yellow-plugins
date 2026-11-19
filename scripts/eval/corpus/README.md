# Eval corpus

The minimum eval floor for review, resolve and planning (CLAUDE-304). Every case
comes from a real incident and names it. Grading is by rule, never by a model
judge, and grades the outcome, not the path the run took. The gate that uses
this corpus, with its repeat count, noise floor and pass bar, is in
`CONTRIBUTING.md` "Eval Gate".

| Area    | Cases                    | Harness                     | What a case is                                                                                                                              |
| ------- | ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| review  | 15 cases and 10 controls | `scripts/eval/review-gate/` | A defect the user confirmed, at the buggy PR head (`cases/`), or a clean merged PR (`controls/`). See that README.                          |
| resolve | 19 (`resolve.json`)      | `scripts/eval/model-swap/`  | One real bot review thread replayed to `pr-comment-resolver` at the commit the bot reviewed.                                                |
| plan    | 18 (`plan.json`)         | `scripts/eval/model-swap/`  | A feature request that walks into a past incident from `docs/solutions/`, given to `/flow:plan --non-interactive` at a commit with the doc. |

## Resolve cases

Each case is a Codex P1 thread from a merged PR, harvested with
`scripts/eval/review-gate/harvest.py --bots` and paired with the PR commit that
fixed it. `incident` is the thread's URL. The case tree is the reviewed commit
(`tree`), with the current `references/resolve/dispositions.md` and
`clusters.md` (the edit-bounds table) overlaid, so the contract under test is
the checkout's and editing either reruns the rows. The prompt is the Step 4
envelope from `references/resolve/envelope.md`: the real comment, diff hunk, PR
title, description, file list and changed lines.

- 17 **fixed** cases pass when the resolver reports `disposition=fixed` and the
  file it edited meets regexes taken from the real fix (`not` regexes name the
  buggy line where one exists).
- 2 **oos** cases (`r18`, `r19`) ask for an edit to `docs/security.md`, which
  the PR did not touch. They pass when the resolver reports `disposition=oos`
  and leaves that file alone. Their `selfcheck.protects` makes `eval.py check`
  confirm the case passes on the untouched tree and fails once
  `docs/security.md` is edited or removed.

`selfcheck.fix` is the fixing commit: `eval.py check` writes its version of the
file into the reviewed tree and requires the case to fail before and pass after.
The first paid pass showed three valid fixes failing over-literal regexes
(`r02`, `r07`, `r09`); they were widened to the outcome, and still fail on the
reviewed file.

Graders are also proven against non-fixes. `selfcheck.lookalikes` are edits to
the fixed file that only look like a fix, and `check` requires each to fail:
`r06` defines the redaction helpers but never applies them to the `classify_run`
result, `r12` keeps the faulty exit guard with extra parentheses, split over
lines, or limited to POSIX or group kill (the wrong polarity), and `r15` keeps `git diff` or `git log` double-quoted or on one line.
Graders are proven against other valid fixes too: `selfcheck.alternates` are
edits of the fixed file into a different correct fix, and `check` requires each
to pass. `r12` moves the exit guard into the non-group `else` branch, or limits
it with `process.platform === 'win32'` instead of `groupKill`.
Every case also records the resolver's real `THREAD` line from the 2026-11-17
pass as `selfcheck.reply` (for `r08`, `r13` and `r15`, which reported `unclear`
there, that real line is in `reply_fails` and `reply` is the same line reporting
`fixed`), so `check` proves the reply regexes too.

## Plan cases

`incident` is the `docs/solutions/` doc the case comes from. A case passes when
the run creates exactly one new file under `plans/` (`changed: "added"`, so
editing an existing plan does not count) that has an Acceptance Criteria heading
and names the incident's lesson anywhere in the plan (the `match` regexes after
the heading one). Where in the plan the lesson lands is not graded: a risk or
step that applies it counts. The request never states the lesson, so the case
measures whether planning finds and applies what the repo already learned (the
`learnings-researcher` pre-pass, repo research, spec-flow analysis).
`selfcheck.doc` makes `eval.py check` confirm the lesson regexes match the
incident doc itself.

A plan that names the lesson can still prescribe the bug. `p07`, `p10` and `p18`
have a `not` regex for a shell code block that does exactly that (a hook with
`set -e` that prints `{"continue": true}`, a `printf` whose `%b` format takes
the message, an `EXIT` trap in the `mktemp -d` block) with no warning word
(`wrong`, `reinterpret` and so on, but not routine words like `never`
or `inject`) anywhere in the block, so quoting the incident's own anti-pattern
still passes. Their `selfcheck.lookalikes` append such a block to the incident
doc and require the case to fail. `p18` flags the block whatever the order of
`mktemp -d` and the trap, on one line or two; only "fires when this call ..."
counts as a warning, so a comment such as "cleanup fires on exit" does not.

Runs load `yellow-core` from the checkout with `--plugin-dir` (agent `plugins`
key) and invoke `/yellow-core:flow:plan` as a slash command, so the command, its
references and its research agents are all the versions under test. The plugin
directory is listed under `fixtures`, so editing any file in it reruns the rows.

## Running

Check first; it spends nothing (CI runs it in `eval-offline`):

```bash
python3 scripts/eval/model-swap/eval.py check /tmp/corpus-check scripts/eval/corpus/*.json
```

A paid pass, from a full clone (`git fetch --unshallow origin` in cloud
sessions):

```bash
python3 scripts/eval/model-swap/eval.py prepare scripts/eval/corpus/resolve.json /tmp/eval-resolve
python3 scripts/eval/model-swap/eval.py run /tmp/eval-resolve -j 6
python3 scripts/eval/model-swap/eval.py grade /tmp/eval-resolve
```

The same three commands take `plan.json`; use `-j 3` there, since every row
starts several research agents. The pass rate is the `recall` column. A stopped
run resumes, and `grade` refuses to report while a row is missing. Planning rows
run plugin text from the checkout under test with your environment, so they get
no Bash tool and no plugin hooks unless you set `EVAL_ALLOW_BASH=1` (resolve
rows too, though the resolver has no Bash today). Set it only for a checkout
whose plugin files you wrote or reviewed (never for an outside contributor's
PR), and use the same setting for the baseline and the candidate: it is part of
each row's fingerprint. The recorded planning pass below ran with Bash approved.
Never run either from CI.

Each row is capped by `EVAL_MAX_BUDGET_USD`: 5 USD for resolve, 15 for plan (the
`plan` agent's `env`). The specs pin the gate's repeat count (3); to record a
single pass, prepare from a copy with `reps` set to 1.

## Results

One pass (`reps` 1) at `32f60d9` on Claude Code 2.1.326. Cost is the CLI's
`total_cost_usd`, an API-equivalent figure that a subscription counts toward
usage, not a bill. An earlier resolve pass on the same build, regraded with the
final regexes, scored 17/19: `r08` passed there and reported `unclear` here, so
one-repetition passes already differ by about 5 points. `r13` and `r15` failed
both times (the resolver reported `unclear`). The plan area passed every case on
its first clean pass, so today it detects regressions only; harder planning
cases are a follow-up.

| Date       | Area    | Config         | Pass                         | Mean cost per row | Pass cost (rows x mean) | Mean wall |
| ---------- | ------- | -------------- | ---------------------------- | ----------------- | ----------------------- | --------- |
| 2026-11-17 | resolve | sonnet, medium | 16/19                        | 0.14 USD          | 2.6 USD                 | 18 s      |
| 2026-11-17 | plan    | opus, high     | 18/18                        | 1.39 USD          | 25 USD                  | 242 s     |
| 2026-11-16 | review  | review-gate    | 6/17 recall, 0/10 control FP |                   | about 103 USD (25 rows) |           |

The 2026-11-18 grader changes (CLAUDE-355) were checked against those passes for
free: every row's recorded edit and reply, replayed onto its case tree and
graded with the new regexes, scores the same (resolve 16/19, plan 18/18), so the
recorded passes stay the baselines. The row fingerprints changed with the
runner, so a resumed `run` reruns every row.

A gated resolve change runs the area three times at the gate's repeat count (two
baselines and one candidate, each `R` = 3): 9 passes, about 24 USD. The plan
area is saturated, so under the gate's saturated-area rule a planning change
reuses the archived baseline and runs one candidate pass plus reruns of any
failed cases: about 25 to 30 USD. The review gate runs at `R` = 2: with two
weekly runs on unchanged reviewer files as the baselines, only the candidate's 2
passes are new, about 206 USD. The review numbers are the 2026-11-16 weekly run
(`scripts/eval/review-gate/results-2026-11-16.md`).
