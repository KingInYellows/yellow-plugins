# Per-workflow cost baseline

Baseline for roadmap item R0.1 (CLAUDE-302): tokens, time and cost of the five
most-used workflows, measured from session transcripts after the fact. Later
cost claims compare against this table.

Measured 2026-11-11 on one machine, Claude Code 2.1.322, from 51 workflow runs
(27 standalone, 24 nested) in 17 sessions between 2026-10-14 and 2026-11-11.

## Baseline

| Workflow | Runs | Active time (median / p90) | API calls | Subagents | Input | Cache write | Cache read | Output | Cost (median / p90 / max) | Subagent share |
|---|---|---|---|---|---|---|---|---|---|---|
| `/review:pr` | 1 (0 typed, 1 model) | 57 min / 57 min | 453 | 42 | 960 | 3.55M | 110.86M | 196.2k | $40.31 / $40.31 / $40.31 | 28% |
| `/review:pr` inside another workflow | 15 | 10 min / 32 min | 159 | 18 | 344 | 1.27M | 22.64M | 45.2k | $7.88 / $19.72 / $32.95 | 54% |
| `/review:resolve` | 7 (3 typed, 4 model) | 20 min / 40 min | 78 | 4 | 168 | 434.0k | 19.33M | 35.7k | $6.54 / $25.24 / $25.24 | 30% |
| `/review:resolve` inside another workflow | 6 | 12 min / 18 min | 46 | 2 | 98 | 254.6k | 15.32M | 26.8k | $2.70 / $3.46 / $3.46 | 15% |
| `/review:sweep` | 5 (1 typed, 4 model) | 9 min / 1.7 h | 146 | 15 | 310 | 1.10M | 12.71M | 22.8k | $6.51 / $42.00 / $42.00 | 53% |
| `/flow:plan` | 7 (4 typed, 3 model) | 52 min / 9.9 h | 118 | 6 | 244 | 610.3k | 9.64M | 108.8k | $9.55 / $42.48 / $42.48 | 34% |
| `/flow:work` | 7 (3 typed, 4 model) | 1.1 h / 3.5 h | 302 | 5 | 628 | 1.62M | 41.02M | 118.7k | $13.54 / $67.53 / $67.53 | 26% |
| `/flow:work` inside another workflow | 3 | 39 min / 7.5 h | 119 | 11 | 266 | 835.0k | 34.01M | 106.0k | $14.65 / $19.60 / $19.60 | 19% |

Token columns and API calls are per-run medians. "Subagent share" is the part
of the group's total cost spent in subagents. A row marked "inside another
workflow" counts runs that a parent workflow started, such as the `/review:pr`
step of `/review:sweep` or of `/flow:work`; the parent's row includes them.

The 27 standalone runs total $471 at API list price, across 6,050 model
responses: Claude Sonnet 5.5 3,008, Claude Opus 5.5 2,489, Claude Fable 5.2
346 and Claude Haiku 5.5 207.

## The two pools

- **Subscription usage.** Every run above was an interactive session
  (`entrypoint: cli`) on the Max subscription. The dollar figures are what the
  same tokens would cost at API list price. They size the runs against each
  other; they are not a bill, and Anthropic does not publish how tokens convert
  to subscription usage. Weekly headroom is tracked separately by R0.2
  (CLAUDE-303).
- **Metered dollars.** Not measured here. Transcripts hold no billing
  information, and none of the five workflows ran headless in the window. The
  script reads `claude -p --output-format json` results with `--headless`, so
  metered runs can be added once their output is kept: the SessionStart drain
  logs its cost since #1774, and the eval scripts print it. Spend at research
  providers and other CLIs that a workflow calls is outside both sources.

## Method

Run `node scripts/workflow-cost-baseline.js`. It reads
`~/.claude/projects/*/*.jsonl` and each session's `subagents/` directory, adds
no hook and calls no model. `--since` and `--until` bound the window,
`--project` filters by project directory name, `--runs` lists single runs and
`--json` prints the data.

- **Run.** A run starts at a typed command for one of the five workflows, or
  at a `Skill` tool call for one when no run is open. It ends at the next
  prompt a person types, or at the end of the transcript. Tool results,
  injected skill bodies and task notifications do not end it.
- **Nested run.** A `Skill` call for a different tracked workflow inside an
  open run starts a nested run. It ends at the next nested run or with its
  parent.
- **Tokens.** Each API response is counted once by message id; a transcript
  repeats its usage on every content block. Subagent usage is added to the run
  whose tool call spawned the subagent, through `toolUseId` in the subagent's
  `.meta.json`.
- **Cost.** Tokens times the list prices on
  <https://platform.claude.com/docs/en/about-claude/pricing>, read 2026-11-11:
  base input, 5-minute and 1-hour cache writes, cache reads and output, with
  the higher Claude Haiku 5.5 rate for prompts over 100,000 tokens. The price
  table is in the script and must be updated when prices change.
- **Active time.** The part of the run covered by completed turns, from the
  `turn_duration` records. It leaves out time the session sat idle between
  turns.

## Limits

- **Small sample.** Transcripts are deleted after 30 days by default
  (`cleanupPeriodDays`), so the window is four weeks. `/review:pr` has one
  standalone run; read its nested row instead. With 5 to 7 runs per workflow,
  the p90 is the second-largest or largest run.
- **Run boundaries are approximate.** A run ends when the person types again,
  so a follow-up prompt mid-workflow cuts it short, and a model-invoked run in
  a long autonomous turn can include work after the workflow finished. The
  largest `/flow:plan` runs are of that kind. Aborted invocations with one or
  two responses are kept and pull medians down.
- **Active time includes waiting** on permission prompts, questions and
  background agents inside a turn. Treat the p90 as an upper bound.
- **Not covered.** `/review:sweep-all` and `/review:resolve-stack` run the
  tracked workflows per PR but are not rows. Sessions on other machines and
  cloud sessions are not on this disk.
- **The transcript format is internal** to Claude Code and changes between
  versions. The synthetic records in
  `tests/integration/workflow-cost-baseline.test.ts` copy the 2.1.322 shape; a
  format change shows up as zero runs or zero subagents, not as an error.

## OpenTelemetry

Checked against the documentation on 2026-11-11, not by running an exporter
(<https://code.claude.com/docs/en/monitoring-usage>). With
`CLAUDE_CODE_ENABLE_TELEMETRY=1`, Claude Code exports `claude_code.token.usage`
and `claude_code.cost.usage` with `skill.name`, `plugin.name`, `agent.name` and
`model` attributes, and an `api_request` event with tokens, cost and duration.
That is per-skill attribution without transcript parsing. It was not used
here because it records nothing about past sessions, needs a collector
(console and OTLP exporters only; no file exporter is documented), reports
third-party plugin and skill names as `third-party` unless
`OTEL_LOG_TOOL_DETAILS=1` is set, so these workflows cannot be told apart
without that setting, and its cost figures are documented as approximations. It is the better source for a continuous record if one is
wanted later.
