# Model-swap eval

Checks whether an agent can move to a cheaper model or effort before the swap
ships, as the Phase 2 gate in `docs/research/model-routing-policy.md` requires.
Runs are graded against golden findings, never by a model judge.

`run` spends real model usage: each row is one nested `claude -p` run.
`prepare`, `run --dry-run` and `grade` spend nothing.

## Usage

```bash
pip install lizard   # scan grading only
python3 scripts/eval/model-swap/eval.py prepare scripts/eval/model-swap/fixtures/2026-10-22-haiku-phase2.json /tmp/swap-eval
python3 scripts/eval/model-swap/eval.py run /tmp/swap-eval --dry-run
python3 scripts/eval/model-swap/eval.py run /tmp/swap-eval -j 6
python3 scripts/eval/model-swap/eval.py grade /tmp/swap-eval
```

Keep the work directory outside the repo; `prepare` adds detached worktrees
under it. Remove them afterwards with `git worktree remove --force <path>` and
`git worktree prune`. `prepare` rebuilds every worktree, and each matrix row
carries a fingerprint of its inputs (agent body, preloaded skills, prompt, diff,
spec entry, model, effort). `run` skips a row only when its output has the same
fingerprint, so a stopped run resumes and a changed spec reruns; `grade` treats
an output with another fingerprint as missing.

## How it grades

- **Replay.** A merged PR is checked out at its merge commit with defects
  planted into it, and the agent reviews the diff against the parent. A plant
  counts as found when a single finding names the plant's file and matches every
  regex in its `match` list. Recall only counts plants in the agent's `lane`.
- **Scan.** A scanner runs over a file set. With `golden.ccn_over` /
  `length_over`, the files are unchanged and the golden set is every function
  lizard reports over the limit; a finding counts when its file matches and its
  start line is within 3 of the function's. With `golden.planted`, the scan's
  `plants` for the agent's `lane` are the golden set; a finding counts when its
  line range overlaps a planted region (or an `also` region, such as the
  original a planted duplicate copies), widened by 3 lines.
- **Prompt.** A sub-task prompt that is not an agent file (a compounder
  extractor, the `/optimize` judge) runs from a stand-in under `fixtures/` with
  a case's context: inline `text`, or a repo file at a commit (`source`, with
  its title and any `docs/solutions` line removed). Each case passes when the
  reply hits every `match` regex and no `not` regex, or, for `lowest`, scores
  every one of the case's `candidates` and gives that one the lowest
  `weighted_score`. Cases run in a worktree at `prompt_commit`, so a finder can
  search the repo there without seeing the fixtures.
- **Everything else.** `grade` writes the findings that match no plant to
  `unmatched-findings.txt`. Judge those by hand for false positives.

## How it runs

`run-one.sh` runs the agent body (frontmatter stripped) as the system prompt
with the agent's own `tools:` list. `Read`, `Grep` and `Glob` are approved only
under the run's working directory (`Read(./**)` and the like), so a fixture that
names a host path such as `~/.ssh/...` gets a permission denial instead of the
file. It passes explicit `--model` and `--effort` and disables settings, MCP
servers, slash commands and memory, so model and effort are the only variables.
Project `CLAUDE.md` files still load. Agents listed with `preload_skills` get
those `SKILL.md` bodies appended, which is what `skills:` frontmatter does.
`--plugin-dir` is not used: in cloud sessions it did not register plugin agents.

The orchestrator blocks that `/review:pr` injects (`<standards-paths>`,
`<rule-vocabulary>`) are not supplied, so agents run in standalone mode.

## Adding a case

Add a spec under `fixtures/`, or extend one:

- an `agents` entry: the agent file, `kind` (`replay` or `scan`), the `configs`
  set it uses, and for replays its `lane` and `output` (`json` for
  compact-return agents);
- a `replays` entry: a merge commit and its plants. Each plant is an exact `old`
  → `new` replacement that must match once, or `fold_description`;
- a `scans` entry: a commit, a file list and optional `plants` (each with a
  `lane`);
- a `prompts` entry for `prompt` agents, which name a stand-in `file`, a
  `prompt` template with `{context}`, and an `expect` map from case id to
  checks.

An agent's optional `replays` or `scans` list limits it to those targets.

## Results

| Date       | Spec                                    | Write-up                                                                                                                                                                                                                                                           |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-22 | `fixtures/2026-10-22-haiku-phase2.json` | CLAUDE-163 comment: comment-analyzer and project-standards-reviewer pass at `haiku` / `medium`; complexity-scanner passes at `haiku` / `low`; `haiku` / `low` fails for both reviewers                                                                             |
| 2026-10-26 | `fixtures/2026-10-26-haiku-phase3.json` | CLAUDE-187 comment: agent-native-reviewer passes at `sonnet` / `medium`; agent-cli-readiness-reviewer stays on Opus; duplication and ai-pattern scanners pass at `haiku` / `low`; compounder analyzer and finder pass at `haiku` / `low`; judge pinned to `sonnet` |
