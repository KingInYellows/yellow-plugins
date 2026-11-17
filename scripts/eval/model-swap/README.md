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
  search the repo there without seeing the fixtures. An `isolated` prompt agent
  (one that writes files) gets its own tree per run, with the case's `files`
  written into it (and committed when the case sets `commit` to a message); the
  case then also passes only when the tree meets its `files` checks (each a
  `glob`, an optional exact `count`, and `match` / `not` regexes over the
  matched files) and none of its `no_files` globs match.
- **Everything else.** `grade` writes the findings that match no plant to
  `unmatched-findings.txt`. Judge those by hand for false positives.

## How it runs

`run-one.sh` runs the agent body (frontmatter stripped) as the system prompt
with the agent's own `tools:` list. `Read`, `Grep` and `Glob` are approved only
under the run's working directory (`Read(./**)` and the like), and `Read` also
under the prompt file's directory, where a replay's `.patch` lives, so a fixture
that names a host path such as `~/.ssh/...` gets a permission denial instead of
the file. It passes explicit `--model` and `--effort` and disables settings, MCP
servers, slash commands and memory, so model and effort are the only variables.
Project `CLAUDE.md` files still load. Agents listed with `preload_skills` get
those `SKILL.md` bodies appended, which is what `skills:` frontmatter does.
`--plugin-dir` is not used: in cloud sessions it did not register plugin agents.
An agent with a `plugins` key is the exception: it runs its `file` as a slash
command with those plugins loaded by `--plugin-dir`, no system prompt, and Write
and Edit allowed only under the run's tree (`--permission-mode acceptEdits`).
Unless `EVAL_ALLOW_BASH=1`, that run gets no Bash tool and its plugins' hooks
are off, since the command text and hooks come from the checkout under test.

Runs set `CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES=1`, since nobody watches
the subagent progress lines. When settings block the requested model, Claude
Code 2.1.323 and later print
`Model "<name>" is restricted by your organization's settings` on stderr and
carry on with another model; `run-one.sh` fails that run (`<id>.bad`) so it is
never graded as the model it asked for.

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
- a `prompts` entry for `prompt` agents, which name a stand-in or agent `file`,
  a `prompt` template with `{context}`, and an `expect` map from case id to
  checks. `fence: false` passes the context unfenced (for an agent whose
  dispatch prompt is the context). `env` sets variables for the run; `{repo}`,
  `{wt}`, `{rid}` and `{PATH}` are filled in, so
  `"PATH": "{repo}/<fixtures>/bin:{PATH}"` puts stand-in CLIs first. List the
  stand-ins and canned responses the agent reads in `fixtures` (repo-relative
  files or directories): their contents go into its rows' fingerprints, so
  editing one reruns those rows instead of reusing old output.

An agent's optional `replays` or `scans` list limits it to those targets.

Keys the eval corpus (`scripts/eval/corpus/`) uses, all for `isolated` prompt
agents:

- a case's `tree`: a 40-character commit that replaces `prompt_commit` for that
  case's run tree;
- an agent's `overlay`: repo files copied from the checkout into every run tree
  after checkout, so an old tree still gets the version under test (also hashed
  into the fingerprint);
- `{wt}` in an agent's `prompt`: the run's own tree path (each row then gets its
  own prompt file);
- an agent's `plugins`: run `file` as a slash command with those plugins loaded
  by `--plugin-dir`, no system prompt and its `allowed-tools` minus MCP tools
  and `AskUserQuestion`; list the plugin directories under `fixtures` so an edit
  reruns the rows. `EVAL_TIMEOUT_S` in its `env` raises the 1,200 s run timeout;
- a `files` check's `changed`: only files the run added or modified count
  (`"added"`: only files it created; a removed or renamed-away match fails the
  check either way), and `count: 0` then asserts a file was left alone;
- a case's `incident` and `selfcheck` (both required by `check`):
  `{"fix": <sha>, "paths": [...]}`, `{"doc": <repo file>}` or
  `{"protects": [...]}`.

`eval.py check <work-dir> <spec>...` spends nothing: it validates the specs,
fetches missing commits by id, compiles every regex and runs each `selfcheck`
through the real grader (the case must fail on the incident tree and pass with
the fix's files, pass with the doc written as the run's only new plan, or pass
untouched and fail once a protected file is edited or removed). Write and Edit,
like Read, Grep and Glob, are approved only under the run's tree.

## Results

| Date       | Spec                                     | Write-up                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-22 | `fixtures/2026-10-22-haiku-phase2.json`  | CLAUDE-163 comment: comment-analyzer and project-standards-reviewer pass at `haiku` / `medium`; complexity-scanner passes at `haiku` / `low`; `haiku` / `low` fails for both reviewers                                                                                          |
| 2026-10-26 | `fixtures/2026-10-26-haiku-phase3.json`  | CLAUDE-187 comment: agent-native-reviewer passes at `sonnet` / `medium`; agent-cli-readiness-reviewer stays on Opus; duplication and ai-pattern scanners pass at `haiku` / `low`; compounder analyzer and finder pass at `haiku` / `low`; judge pinned to `sonnet`              |
| 2026-10-28 | `fixtures/2026-10-28-haiku-phase3b.json` | CLAUDE-194: scan-verifier passes at `haiku` / `low`; staging-promoter passes at `haiku` / `medium` (Sonnet overwrote an existing doc); audit-synthesizer passes at `sonnet` / `medium`; git-history-analyzer, codex-reviewer and test-runner stay on Sonnet                     |
| 2026-10-29 | `fixtures/2026-10-29-council-cli.json`   | CLAUDE-200: both yellow-council CLI wrapper agents move from `haiku` / `low` to `sonnet` / `medium`; Haiku at either effort skipped the CLI or the canonical redaction in a third of runs. `fixtures/2026-10-29-council-cli-real.json` specifies a real-CLI rerun (not yet run) |
