# Risk-tiered PR review pipeline for yellow-plugins and yellow-goal

Date: 2026-11-02 · Status: approved by the user 2026-11-02; Phase 0 in progress
· Source: the "Anthropic's official code review setup" infographic the user
shared, current Claude Code and Anthropic prompting docs, and an inventory of
both repos at yellow-plugins `06af4d6` and yellow-goal `main`.

## 1. Recommendation in one paragraph

Build this as an extension of yellow-review, not a new plugin. Put the
AI-reviewer core (Hunt, Vote, Rank) in **one plugin-shipped dynamic workflow
script** (`plugins/yellow-review/workflows/review-gate.js`), because that core
is a fan-out with per-finding verification, which is exactly what workflows are
for. Keep everything around it as **fixed, deterministic code**: the risk
classifier, the "findings answered" gate, human approval, the merge queue, and
the eval loop. Those steps must be auditable, need a human, or must not depend
on a model. So the answer to "should this be a dynamic workflow?" is yes for the
review core and no for the pipeline as a whole. The script itself is fixed and
versioned. Only its fan-out changes per PR (how many hunters, how many voters)
based on the risk tier and the diff. We never let Claude write a new
orchestration per PR (`ultracode`), because a reviewer that changes shape every
run cannot be evaluated.

## 2. What the infographic asks for, and what that means for a solo maintainer

| Infographic stage                       | Its rule                                                                                                               | Adaptation here                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR (tests, build, lint already run)     | Review starts after mechanical checks                                                                                  | CI already gates this (`ci-status` in yellow-plugins, `ci.yml` in yellow-goal). The reviewer is told not to report what CI enforces.                                              |
| 1 Hunt                                  | Parallel bug-hunting agents read CLAUDE.md + REVIEW.md                                                                 | Existing `/review:pr` personas become hunters. A new `REVIEW.md` holds the review-only rules.                                                                                     |
| 2 Vote                                  | Verifier agents vote on each finding                                                                                   | **New.** Today one orchestrator does a single "skim-FP check" in Step 6.                                                                                                          |
| 3 Rank                                  | Important / Nit / Pre-existing                                                                                         | Map onto our P0–P3 (P-levels stay internal because [[pr-review-policy]] keys on P1).                                                                                              |
| Findings answered                       | Every finding fixed or resolved with a reason                                                                          | Mostly exists: `/review:resolve` dispositions, the ledger, `/review:merge-ready`, the sticky blocking comment.                                                                    |
| Approval by risk                        | A classifier picks 0, 1 or 2 humans; the change sets the tier; agent approval never counts; approval covers one commit | **New classifier, 0 or 1 human.** The user is the only reviewer, so no tier ever needs more than one human approval. The high tier adds automated checks, not people (section 5). |
| Merge queue on latest main              | Checks rerun                                                                                                           | Exists: Graphite merge queue.                                                                                                                                                     |
| Ship behind a flag                      | Employees, then latest, then stable                                                                                    | Plugins have no runtime flags. Equivalents: config flags in `yellow-plugins.local.md` (shadow → advisory → enforce), the user's own machine first, then the changeset release.    |
| Incident → case → eval → keep if better | Every incident makes the reviewer better                                                                               | **New eval set**, built on the model-swap harness's replay grader (section 7).                                                                                                    |

Two facts shape the whole design:

- **The managed Code Review product is not an option.** It needs a Team or
  Enterprise plan, and the user is on Max. Its four stages (Find, Verify, Rank,
  Post) are the same as the infographic's, so we build our own and borrow its
  conventions: `REVIEW.md`, the severity names, and "a review never approves or
  blocks" (code.claude.com/docs/en/code-review).
- **Usage limits, not dollars, are the budget.** Every agent in a workflow draws
  on the Max plan limits. Fan-out has to scale with risk, and the eval loop
  cannot run the whole set every day (section 7.4).

## 3. Should this be a dynamic workflow?

### What "dynamic workflow" means in Claude Code today

A dynamic workflow is a JavaScript script that a runtime executes in the
background. It calls `agent()`, `parallel()`, `pipeline()` and `phase()`;
intermediate results stay in script variables instead of a context window;
`agent()` takes a JSON `schema`, `model`, `effort`, `agentType` and
`isolation: 'worktree'`; runs are resumable within a session; and agents with
the same prefix share prompt cache. A plugin can ship scripts in a `workflows/`
directory, and they run as `/<plugin>:<name>`
(code.claude.com/docs/en/workflows). Two ways to get one exist:

1. **A saved or plugin workflow.** A fixed script, versioned in git, invoked by
   name with `args`.
2. **Claude writes one per task** (the `ultracode` keyword or
   `/effort ultracode`). The orchestration differs every run.

### Recommendation: option 1 for the review core only

| Pipeline part                | Shape                                                      | Why                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Risk classify                | Deterministic script                                       | "The change sets the tier, not the author." It must be reproducible and reviewable as data.                                                                                   |
| Hunt → Vote → Rank           | **Plugin workflow** (`review-gate`)                        | Fan-out plus per-finding adversarial voting is the documented workflow sweet spot. Findings stay out of the main context, which today's 1,284-line `/review:pr` cannot avoid. |
| Apply fixes, answer findings | Existing commands (`/review:pr` Step 7, `/review:resolve`) | They need git writes, user gates and sequential edits. Workflows have no mid-run user input and no direct filesystem access.                                                  |
| Approval and merge           | GitHub + `check-merge-ready` + Graphite                    | Must be a human act. A model must not be able to satisfy it.                                                                                                                  |
| Eval loop                    | Python harness (`scripts/eval/`)                           | Graded by regex against golden findings, never by a model judge.                                                                                                              |

Why not let Claude write the workflow per PR: the bottom half of the infographic
only works if "the reviewer" is a fixed artifact you can change one thing at a
time and score. A per-run orchestration has no stable thing to score. Ultracode
also ignores the `-p` path we need for CI (the keyword does not trigger from
`claude -p` or PR comments).

Why not keep everything in the existing command: Step 5 and 6 of `/review:pr`
already dispatch personas in parallel, but the orchestrator reads every return
into its own context and does verification itself in one pass. Adding voting
there multiplies context. In a workflow, voting is `pipeline(findings, verify)`
with no context cost to the parent.

### Constraints to design around

- **No mid-run input.** Anything needing the user (push, approve) happens after
  the workflow returns. The workflow only reads and returns JSON.
- **Headless runs need an allow rule.** In `claude -p` and CI the launch goes
  through normal permission evaluation; add
  `Workflow(yellow-review:review-gate)` to the allow list. A usage-limit wait
  does not pause a `-p` run; the agent fails instead, so the CI path must treat
  a `null` hunter as "coverage incomplete", never as "no findings".
- **Version floor.** The CI action is pinned to v1.0.245, which installs CLI
  2.1.293. Confirm that version loads plugin `workflows/` before Phase 3.
- **Our validators.** `schemas/plugin.schema.json` has
  `additionalProperties: false` and no `workflows` key. The default `workflows/`
  directory needs no manifest field, but the generator, `validate-plugins`, the
  Codex/Cursor copies and `lint-plugins` must learn to ignore or validate the
  new directory. Check the remote validator on a clean install, as CLAUDE.md
  fact 4 requires.
- **Concurrency and size.** At most 16 concurrent agents; the session size
  guideline defaults to "medium" (under 10 agents). Over 25 agents shows a
  "Large workflow" warning. Tier budgets below stay under those numbers except
  for high-risk PRs.

## 4. The review core: `review-gate` workflow

### Inputs (`args`)

`{ repo, pr, base, head, tier, diff_path, changed_files, review_md, include, exclude, dismissed }`,
all produced by the calling command before launch. The workflow never fetches
from GitHub itself; the caller passes data so runs are reproducible and the eval
harness can feed the same shape.

### Phase 1 — Hunt

- Hunters are the **existing persona agents**, launched by `agentType` (for
  example `yellow-review:correctness-reviewer`), each with the compact-return
  schema from `skills/pr-review-workflow/references/compact-return-schema.md` as
  the `schema`. That removes the prose-normalization and findings-block
  extraction that fill Step 6 today; schema validation retries up to five times.
- Selection reuses Step 4's rules (always-on, conditional, opt-in, depth gate),
  now computed in the caller and passed in `args.include`.
- **Change from today: hunters report everything.** Anthropic's current guidance
  for Opus 5 says that a review prompt saying "only report high-severity issues"
  or "be conservative" makes the model report less, and to "ask it to report
  everything and filter in a separate pass instead" (platform.claude.com,
  Prompting Claude Opus 5). Our four recall personas already work this way; the
  other personas still apply their own anchor floors. Remove those floors so the
  Vote phase is the only filter.
- Cross-lineage hunter: `codex-reviewer` for medium and above when Codex is
  available. This is the cheapest answer to the data in
  [[pr-review-loop-automation]]: 94% of Codex P1s arrive after a push. Some of
  those are regressions in the new commit, so this suggests, but does not show,
  that our own pass missed them first; Phase 1's eval measures misses on the
  same head.

### Phase 2 — Vote

- A plain-code dedup step first (same file, overlapping lines, same `category`),
  as a barrier, because voting must not run twice on one bug.
- Then `pipeline(findings, vote)`. Each verifier gets the finding, the cited
  lines with context, and the instruction to refute it with a `file:line`
  citation. Verdict schema:
  `{ verdict: confirmed|refuted|unverifiable, evidence_file, evidence_line, reason }`.
- **Voters per finding scale with severity and tier:** P2/P3 get 1 voter; P0/P1
  get 3 voters with distinct lenses (does it reproduce from the code, is it
  handled elsewhere, is it reachable from an entry point). Keep on majority
  `confirmed`. `unverifiable` is reported as unverified, not as refuted, the
  same rule `/deep-research` uses.
- Verifiers run on Sonnet 5.5 at `low` or `medium` effort for P2/P3 and on Opus
  5.5 at `medium` for P0/P1. The guide says Opus 5 review "accuracy holds at
  lower effort settings". Do not add "double-check" instructions to verifier
  prompts; the same guide says they cause over-verification.
- Today's Step 6 quality gates (line accuracy, protected-artifact filter,
  skim-FP check) move into the verifier prompt as its criteria, so the
  orchestrator no longer re-does them.

### Phase 3 — Rank

One agent (or plain code if the schema is rich enough) dedups survivors across
hunters and assigns display severity:

| Display      | Internal                   | Meaning                                                                                      |
| ------------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| Important    | P0, P1                     | Would break behavior, leak data, or block a rollback. Must be answered before merge.         |
| Nit          | P2, P3                     | Worth a look; capped per REVIEW.md. Answered by reply or follow-up per [[pr-review-policy]]. |
| Pre-existing | any, outside changed lines | Reported in its own section, never blocks. Already a `/review:pr` section.                   |

The workflow returns `{ findings[], coverage{ran, failed, skipped}, votes[] }`.
`coverage.failed` non-empty means the review is incomplete and the merge gate
reads it as "unknown", not "clean".

### Tier budgets (agents per run)

| Tier   | Hunters                                           | Voters                        | Extras                                   | Typical total |
| ------ | ------------------------------------------------- | ----------------------------- | ---------------------------------------- | ------------- |
| Low    | 2 (correctness, project-compliance)               | 1 per finding                 | none                                     | 3–6           |
| Medium | 4 always-on + conditional                         | 1 or 3 by severity            | codex-reviewer                           | 8–15          |
| High   | full set incl. adversarial, reliability, security | 3 per finding, Opus for P0/P1 | codex-reviewer; `/council` advisory pack | 15–30         |

### REVIEW.md

Add a root `REVIEW.md` to both repos, using the managed product's format so it
stays portable: what Important means here, a Nit cap ("at most five Nits"), a
"Do not report" list (anything CI enforces: lint, prettier, schema validators,
shell-compat; generated `.claude-plugin/` and `.agents/` manifests;
`docs/solutions/`, `plans/`), and an "Always check" list (untrusted input
fenced, fenced shell blocks work in bash and zsh, no real-spend executor
commands in yellow-goal). Hunters and verifiers receive it in the prompt; the
CLAUDE.md files are already injected into workflow agents. Read it from the
default branch, never from the PR or its base, so a PR cannot weaken its own
review: in a stack the base is the parent PR's unmerged branch (the same reason
§5 gives for the policy). The managed product reads the base branch, which is
the same commit for an unstacked PR.

## 5. Approval by risk

### Classifier

A deterministic script,
`plugins/yellow-review/skills/pr-review-workflow/scripts/classify-risk`, reads
the changed paths and diff stats and a per-repo policy file
`.github/review-risk.json` (JSON so `jq` reads it with no YAML dependency).
Output: `{ tier, reasons[] }`. Rules are path globs plus one size signal. Each
file takes the tier of the first rule in file order whose glob matches it, so
narrow exceptions sit above the broad rule they carve out of; the change takes
the highest tier of its files. The policy is read from the default branch (not
the PR's base, which in a stack is the parent PR's unmerged branch), so a PR
cannot lower its own tier. Hook registrations in `catalog/plugins/*` and plugin
manifests, and the root `CLAUDE.md`/`AGENTS.md` that reviewers follow, are high
as well. The policy file itself and any `REVIEW.md` are always high whatever the
policy says. A policy file that exists but cannot be read or validated makes
every file high (fail closed); a repo with no policy file uses the built-in
default, where every other file is medium. A backtest of the seed policy on 300
merged yellow-plugins PRs gave 45% high, 49% medium and 6% low.

Seed policy for yellow-plugins (to be confirmed by the user). The concrete globs
are in `.github/review-risk.json`; this is the intent they encode:

- **High (always high, whatever the diff size):** `plugins/*/hooks/**`,
  `plugins/*/lib/*.sh` that handle trust boundaries, `scripts/` release and
  generator code, `.github/workflows/**`, `schemas/**`, `catalog/**`,
  `.claude-plugin/**` (except the generated `.claude-plugin/marketplace.json`
  and `.agents/plugins/*`, which are medium: `catalog/` is their source and CI
  checks them for drift), anything that writes to GitHub unattended
  (`resolve-*`, `apply-thread-actions`). `rp_runner` in `lib/resolve-paths.sh`
  already lists paths that unattended resolve must never commit, which is a good
  starting set.
- **Medium:** agent, command and skill Markdown; tests; any code not listed.
- **Low:** docs, READMEs, CHANGELOG, `docs/research/`, changesets alone.
  Additive changes behind a `yellow-plugins.local.md` flag defaulting off would
  also qualify, but that depends on diff content the path classifier cannot see;
  it is left to the optional model second opinion below.

For yellow-goal: high for `backend/src/real-run/**`, `executors/**`, approval
and spend-ledger code, `.claude/hooks/guard-live-executor.mjs`, `policies/**`,
and `.github/workflows/**`; the planner is medium with the planner eval
required.

An **optional model second opinion** can only raise the tier, never lower it,
and runs in shadow mode first. This is the natural first site for the judgment
layer the user approved on 2026-10-10 (`lib/judge.sh` with
shadow/advisory/enforce modes; [[judgment-layer]]), which has not been built
yet. Jev could be the classifier's model here; consent for redacted diffs from
KingInYellows repos is already on record ([[jev]]).

### Approval rules: 0 or 1 human, never more

The user is the sole reviewer on solo hobby projects (stated 2026-11-02), so the
infographic's "two people" tier does not exist here. Every tier needs at most
the user's own approval. What rises with risk is the automated scrutiny, not the
number of humans.

| Tier   | Requirement before `graphite-queue`                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low    | All Important findings answered, CI green, `check-merge-ready` ready. Claude may add the label itself (the existing standing approval).                                                                                                                                                                                                                                                     |
| Medium | The above, plus KingInYellow18's approval **of the head SHA**: adding `graphite-queue` after the head arrived (chosen 2026-11-02), or an approving review on it.                                                                                                                                                                                                                            |
| High   | Same single approval from KingInYellow18 of the head SHA, plus automated extras before it: a cross-lineage pass (Codex or council) with no unanswered Important, and a fresh `review-gate` run on the final head commit. Until the ledger records each run's head (Phase 3), the fresh run is unverifiable, so `enforce` leaves high PRs `unknown`; `advisory`, the default, only lists it. |

Rules from the infographic kept literally:

- **An agent's approval never counts.** `check-merge-ready` accepts only a
  review by, or a `graphite-queue` label added by, a listed human login; bot
  approvals and labels are ignored. Claude acting through the owner's account is
  indistinguishable from the owner, so for labels this rule rests on Claude
  never adding the label to a medium or high PR (see below).
- **An approval covers one commit.** Compare the approving review's `commit_id`
  with the head SHA, or the label event's time with the time the head arrived
  (the latest of its committer date, its first check suite on the PR's head
  branch, and any force push to it, read from the last 100 timeline events: a
  longer timeline leaves the time unknown); any later push invalidates it, and
  removing the label revokes it. GitHub will not let the owner approve their own
  PR, so on 2026-11-02 the user chose the label as their approval. Claude acts
  through the same account, so it must never add the label to a medium or high
  PR. A repo ruleset with "dismiss stale approvals" enforces the same for
  reviews on GitHub's side; nothing on GitHub invalidates a stale label, so
  `check-merge-ready` is the only check of label freshness.
- **The change sets the tier.** The tier is recomputed on every push and posted
  in the sticky comment `sync-blocking-comment` already maintains.

This changes the standing approval in [[graphite]]: Claude adds `graphite-queue`
only for low-tier PRs.

## 6. Stage-by-stage map: existing vs new

| Stage             | Existing component                                                                                                                      | New work                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Precondition      | CI `ci-status`; yellow-goal `ci.yml`                                                                                                    | REVIEW.md "do not report" list                                                                |
| Context           | CLAUDE.md files; `/review:pr` Step 3d learnings pre-pass; Step 3e ledger dismissed context                                              | Root `REVIEW.md` in both repos                                                                |
| Hunt              | 16 yellow-review personas, 10 yellow-core review agents, `codex-reviewer`, `thermonuclear-reviewer` (opt-in), compact-return schema     | `review-gate.js` Hunt phase; drop persona-side confidence floors                              |
| Vote              | Step 6 skim-FP check (single orchestrator pass)                                                                                         | Verifier prompt + verdict schema; per-severity voter counts                                   |
| Rank              | P0–P3 + Pre-existing sections; ledger categories (`review-ledger-vocab.json`)                                                           | Important/Nit display mapping; Nit cap                                                        |
| Findings answered | `/review:resolve` dispositions, `apply-thread-actions`, review ledger, `/review:triage`, `sync-blocking-comment`, `/review:merge-ready` | Merge gate reads workflow `coverage.failed` as unknown                                        |
| Approval by risk  | `check-merge-ready` (threads, reviews, CI, ledger)                                                                                      | `classify-risk` + `.github/review-risk.json`; human-on-head-SHA check; tier in sticky comment |
| Merge queue       | Graphite MQ, `graphite-queue` label                                                                                                     | none                                                                                          |
| Ship behind flag  | `review_pipeline` setting (already has `legacy`), changesets, version-packages PR                                                       | `review_pipeline: workflow` value; shadow → advisory → enforce                                |
| CI reviewer       | `claude-code-review.yml` (upstream `code-review` plugin on Sonnet 5.5)                                                                  | Phase 3: second job running `review-gate` headless                                            |
| Cross-lineage     | `/council` (advisory, Claude + Codex + Gemini + OpenCode)                                                                               | Called for high tier only                                                                     |
| Eval              | `scripts/eval/model-swap` (replay + scan graders, fingerprints, resume), `scripts/eval/thermonuclear-fixtures`                          | `scripts/eval/review-gate/` case format, case intake, scheduled run                           |

## 7. The eval feedback loop

### 7.1 Where incidents come from

The infographic starts from "a change still breaks something". In these repos
the signals are:

1. Reverts and `fix:` commits on `main` whose message or diff points at an
   earlier PR.
2. **Late bot findings our reviewer missed.** Any Codex or Bugbot P1 posted
   after `review-gate` ran on the same head is a miss by definition. The October
   data says that was most of them.
3. Regressions from our own fixes (20% of P1s in the October sample).
4. Post-merge CI failures and `docs/solutions/` entries tagged as bugs.

A small script (`scripts/eval/review-gate/harvest.py`) lists candidates weekly.
It reads only git history and GitHub threads. It writes nothing.

### 7.2 Expert-checked case

The user is the expert. Each candidate goes to the user as a short list (a
thread card or a Linear issue labelled `review-eval-case`); only confirmed ones
become cases. A case is the model-swap **replay** format with a real defect
instead of a planted one:

```json
{
  "id": "1467-unquoted-path",
  "repo": "yellow-plugins",
  "base": "<sha before the buggy PR>",
  "head": "<sha of the buggy PR head>",
  "lane": "correctness",
  "golden": [
    { "file": "plugins/x/lib/y.sh", "line": 42, "match": ["unquoted", "path"] }
  ],
  "source": "codex P1 on #1467, confirmed 2026-11-…",
  "tier": "high"
}
```

Also keep **clean controls**: merged PRs with no later incident and the
thermonuclear "expect nothing" fixtures. They measure false positives, which
recall-only scoring would let rise unnoticed.

### 7.3 Reuse of the model-swap harness

`scripts/eval/model-swap/eval.py` already does what the loop needs: `prepare`
builds detached worktrees at a commit, each row carries a fingerprint of its
inputs (agent body, skills, prompt, diff, model, effort) so only changed rows
rerun, and `grade` matches findings to golden entries by file plus regexes, with
no model judge. Add one runner mode that calls the `review-gate` workflow
(through `claude -p` with the allow rule) instead of a single agent, and one
grader that counts Important-only recall and false-positive rate on controls.
Known gotchas carry over ([[model-swap-eval-harness]]): use raw-string regexes,
and run agents with fixed `/tmp` names at `-j 1`.

### 7.4 When it runs

"Daily eval run" does not fit a Max plan with a growing case set. Instead:

- **On every change to the reviewer.** A PR touching
  `plugins/yellow-review/{agents,workflows,skills}/**`, `REVIEW.md`, or the
  model and effort pins gets the eval run, by Claude in the PR's session (never
  from CI, which would spend the subscription token on every push).
- **Weekly**, a scheduled cloud routine runs the full set once and writes
  `results-<date>.md` next to the script, like `thermonuclear-fixtures` does.

Keep the change only if Important recall rises (or holds while cost drops) and
the control false-positive rate does not rise. That is the infographic's "score
went up? keep it; if not, drop it", written as a rule the PR description must
show.

## 8. Prompting rules for the new prompts

From Anthropic's current prompting guide and the repo's own
`docs/research/best-practices/gpt-claude-latest-model-prompting-guidance.md`:

- Hunters: "report every issue you find, with your confidence"; never "only
  high-severity" or "be conservative". Filtering is the Vote phase's job.
- Verifiers: a plain task ("show where in the code this is or is not handled")
  with evidence required. No "double-check" or "re-verify" lines; Opus 5 already
  self-checks and these cause over-verification.
- No ALL-CAPS rule lists or "CRITICAL: you MUST"; the guide says newer models
  overtrigger on aggressive language.
- Give context and motivation instead of bare rules (why a Nit cap exists).
- The workflow, not the prompt, controls spawning. Persona prompts should say
  not to delegate, since Opus 5 "delegates to subagents more readily".
- Control cost with `effort` per stage, not by disabling thinking.

## 9. Rollout

| Phase | Scope                                                                                                                                                                          | Gate to the next phase                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 0     | `REVIEW.md` in both repos; seed `review-risk.json`; `classify-risk` script with bats tests; tier shown in `/review:pr` only (sticky comment later).                            | A week of tiers the user agrees with.                      |
| 1     | `review-gate.js` behind `review_pipeline: workflow` in `/review:pr`, run in shadow next to the current pipeline; both outputs logged. Validator support for `workflows/`.      | Eval: new pipeline's recall ≥ current, controls not worse. |
| 2     | `review_pipeline: workflow` becomes the default for `/review:pr` and `/review:sweep`; approval rules enforced in `check-merge-ready`.                                          | Two weeks without a merge-gate false block.                |
| 3     | CI job runs `review-gate` headless on non-draft PRs (separate from the upstream `code-review` job, which stays as an independent lineage until the eval says it adds nothing). | Ongoing eval loop.                                         |
| 4     | Harvest script, case intake, weekly scheduled eval.                                                                                                                            | none                                                       |

yellow-goal follows one phase behind yellow-plugins, using the same plugin.
goal-gen's own eval-driven rule ("run `npm run eval` before and after planner or
prompt changes") already matches the loop; the eval runner must only ever use
`--executor stub` there.

## 10. Open questions for the user

1. ~~**Standing label approval.**~~ Decided 2026-11-02: Claude adds
   `graphite-queue` only to low-tier PRs; the owner's label approves medium and
   high.
2. **High-tier automated extras.** Is "cross-lineage pass plus fresh re-review
   on the final commit" the right extra scrutiny for high-tier PRs? (Human
   approvals stay at one, per the user's 2026-11-02 note.)
3. **Seed path list.** Confirm or edit the high-tier paths in section 5.
4. **Eval spend.** Weekly full run plus per-reviewer-change runs, or per-change
   only?
5. **Upstream `code-review` CI job.** Keep it alongside `review-gate` as an
   extra lineage, or retire it once the eval shows no extra catches?

## Sources

- Claude Code docs: Code Review (code.claude.com/docs/en/code-review), Customize
  Code Review and REVIEW.md (…/code-review-customize), Dynamic workflows
  (…/workflows), the bundled `/workflow-authoring` reference (agent options,
  pipeline vs parallel, resume).
- Anthropic prompting: Prompting best practices
  (platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
  and Prompting Claude Opus 5 (…/prompting-claude-opus-5).
- Repos:
  `plugins/yellow-review/{CLAUDE.md,commands/review/review-pr.md,commands/review/merge-ready.md,agents/review/*}`,
  `plugins/yellow-council/commands/council/council.md`,
  `scripts/eval/{model-swap,thermonuclear-fixtures}/README.md`,
  `.github/workflows/claude-code-review.yml`, `schemas/plugin.schema.json`,
  yellow-goal `goal-gen/CLAUDE.md`.
- Project memory: pr-review-policy, pr-review-loop-automation, graphite, jev,
  judgment-layer, model-swap-eval-harness, claude-code-review-workflow.
