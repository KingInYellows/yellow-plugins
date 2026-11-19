# Trigger evals

These sets check whether a skill or command fires when it should and stays quiet
on near-miss prompts (CLAUDE-315, roadmap R1.2). Descriptions are trigger text,
so run the affected set before and after any description change (R2.4).

They live at repo level and never ship inside a plugin. The runner stages a
temporary root with copies of the plugins a set needs and one generated
`claude plugin eval` case per query.

## Layout

`evals/<plugin>/<component>/queries.json`:

```json
{
  "source": "plugins/yellow-core/commands/flow/plan.md",
  "queries": [
    {
      "q": "Draft an implementation plan for ...",
      "trigger": true,
      "split": "train"
    },
    {
      "q": "Implement the plan in plans/x.md",
      "trigger": false,
      "split": "heldout"
    }
  ]
}
```

- `source` is the command file or `SKILL.md`. The target must be model-invocable
  (no `disable-model-invocation: true`); internal `user-invocable: false` skills
  qualify.
- At least 8 should-trigger and 8 should-not-trigger queries, each side split
  roughly 60/40 between `train` and `heldout`.
- Near misses name a sibling's job (`/review:resolve` vs `/review:pr`), not
  unrelated chat. Write each prompt so it stands alone: the run starts in an
  empty directory with no repository.

## Running

```bash
pnpm eval:skill-trigger --check                 # free: query files only
pnpm eval:skill-trigger --validate              # free: CLI loads every case, no model call
pnpm eval:skill-trigger yellow-core:flow-plan --out /tmp/flow-plan   # paid
```

A paid run calls `claude plugin eval` with `--ablation none` (a no-plugin arm
cannot fire the target), the `tool_used` grader on the `Skill` tool only,
`max_turns: 2`, Sonnet 5.5, 3 runs per query, 4 runs at once, and
`COMPOUND_DRAIN_IN_PROGRESS=1`. The CLI already runs each case under a temporary
home. `--max-cost-usd` defaults to 20. The CLI checks it before starting each
run, so runs already in flight finish: expect up to concurrency x 0.22 USD
(about 0.90 USD at `-j 4`) over the ceiling. A run that hits the ceiling is
partial and exits 2.

A query triggers when the target fires in at least half its runs. The report
gives recall (should-trigger queries that trigger), specificity (near misses
that stay quiet), precision, accuracy, held-out accuracy and the mean trigger
rate on each side. Exit 0 when every selected set reaches held-out accuracy 0.8,
1 when one does not, 2 on a check failure, a partial run, a failed run, or a
selected query with no valid run (including a `--case` glob that matches
nothing). The CLI call stops after an hour.

Use `--case '<plugin>--<component>--p*'` (or `--n*`) to rerun one side.

## Cost

Measured 2026-11-19 on Claude Code 2.1.328: about 0.09 USD API-equivalent per
run (not a bill) for a quiet run, 0.15 to 0.22 when the target fires and loads
its body. Every run pays its own cache write. One set at 3 runs is about 5 to 6
USD; all four seed sets about 22 USD, above the default ceiling, so a full
refresh needs `--max-cost-usd 25`. Rerun only the set whose description changed.

## What fires instead

Smoke runs show two competitors the sets measure on purpose: the model often
explores with `Bash` or `Glob` before it reaches for a skill, and the built-in
skill `code-review` competed with `/review:pr` in traced runs. A query only
counts if our target fires within two turns.

## Vehicle

Native `claude plugin eval` (Claude Code 2.1.328) won the spike in
`plans/specs/authoring-evals-and-context-budget.md` R5: it scores skills and
commands alike, because the model invokes both through the `Skill` tool (a
command as `plugin:dir:file`, for example `yellow-review:review:review-pr`). It
takes n runs and a threshold, isolates each case under a temporary home, and its
`tool_used` grader is free. Gotchas the runner handles:

- `tool_used` defaults `min` to 1, so a near miss needs `min: 0, max: 0`.
- A case may load only plugins under the eval root, and naming `plugins:`
  replaces the target, so the runner lists the target and its dependencies.
- `case.yaml` may set only `EVAL_*` environment keys; the runner sets
  `COMPOUND_DRAIN_IN_PROGRESS` in the parent environment instead.

## Baseline

`baseline.json` holds the committed per-set and per-query results. Its `sets`
map is keyed by set id. Refresh it only from a run without `--case` whose
`summary.json` has `partial: false`, `failedRuns: 0` and an empty
`unscoredCases`. After a run of one set, replace only that key in
`baseline.json` with the same key from the run's `summary.json`. Copy a whole
`summary.json` over the baseline only after a run of every set.

2026-11-19, Claude Code 2.1.328, Sonnet 5.5, 3 runs, 19.99 USD API-equivalent
(not a bill), 304 s, no failed runs:

| Set                        | Recall | Specificity | Held-out acc. | Mean rate (should fire) |
| -------------------------- | -----: | ----------: | ------------: | ----------------------: |
| `yellow-core:debugging`    |   0.13 |        1.00 |          0.50 |                    0.13 |
| `yellow-core:flow-plan`    |   0.25 |        1.00 |          0.67 |                    0.21 |
| `yellow-review:resolve-pr` |   1.00 |        1.00 |          1.00 |                    1.00 |
| `yellow-review:review-pr`  |   0.50 |        1.00 |          0.83 |                    0.50 |

No near miss fired its target. The gap is recall: `debugging` and `/flow:plan`
rarely fire from a natural prompt, which is the R2.4 (CLAUDE-326) target.
