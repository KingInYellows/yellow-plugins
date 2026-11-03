# review-gate in CI

`.github/workflows/review-gate.yml` runs the `yellow-review:review-gate`
workflow (Hunt → Vote → Rank) headless on every non-draft pull request. It is
Phase 3 of `plans/risk-tiered-review-pipeline.md` (CLAUDE-235). The upstream
`code-review` job in `claude-code-review.yml` keeps running beside it as an
independent lineage until the eval says it adds nothing.

The review never approves or blocks. The job passes whatever it finds and is not
part of `CI Status Summary`.

## Modes

Set the repository variable `REVIEW_GATE_MODE`:

| Value             | What happens                                                   |
| ----------------- | -------------------------------------------------------------- |
| unset or `shadow` | Result in the job summary and the `review-gate` artifact only. |
| `advisory`        | Also one sticky PR comment, edited in place on each push.      |
| `off`             | The job is skipped.                                            |

Every run draws on the `CLAUDE_CODE_OAUTH_TOKEN` subscription's usage limits:
3–6 agents at the low tier, 8–15 at medium and up to about 30 at high. A newer
push cancels the run in progress. Drafts, fork PRs and bot-authored PRs are
skipped, and so is any run when the secret is missing.

## What runs

`ci.py` has four steps, each its own workflow step:

1. `prepare` diffs `base...head` in a full checkout of the PR head, classifies
   the risk with `classify-risk --policy-ref <default branch tip>`, reads
   `REVIEW.md` from the default branch, picks hunters, and writes the workflow
   `args` (`prompts/args.json`) and `meta.json`.
2. `run` launches one `claude -p` with the review-gate eval's exact argv
   (`scripts/eval/review-gate/eval.py` `headless_argv`): the default branch's
   `yellow-core`, `yellow-linear` and `yellow-review` via `--plugin-dir`, no
   setting sources or MCP servers, `Workflow(yellow-review:review-gate)` plus
   Read/Grep/Glob allowed, Bash and every write tool denied. So CI runs the
   reviewer the eval scores. It writes `result.json`.
3. `render` writes `comment.md` and the job summary.
4. `post` (advisory only) runs in a separate `comment` job, the only one with
   `pull-requests: write`, from the uploaded artifact. It creates or edits the
   comment that starts with `<!-- yellow-review:review-gate-ci -->`, and skips
   when the PR head has moved past the reviewed commit.

A result is `complete` only when the eval would grade it. A hunter that returned
`null` (in `-p`, a usage-limit wait fails the agent instead of pausing), an
empty run or a malformed result is `incomplete`, and the comment says no finding
means nothing about the rest of the change. A crash, timeout or reply without
workflow JSON is `error` ("not run") and fails the job, so the check shows it;
findings and incomplete coverage never fail it. The comment ends with a
`<!-- review-gate-status {...} -->` line (`head`, `tier`, `status`, `important`)
for a later merge-gate reader.

## Trust boundaries

- The reviewer (plugins, this driver, `.github/review-risk.json`, `REVIEW.md`)
  comes from the default branch, so a PR cannot change them (its own `CLAUDE.md`
  files still load; see below). A PR that changes the reviewer is reviewed by
  the old one; the eval covers the new one. On the PR that adds this driver the
  job skips with a notice.
- The PR's code is read, never run. The `claude` step gets the subscription
  token and no GitHub token; only `post` has `GH_TOKEN`.
- Finding text comes from models that read untrusted code. Before `result.json`
  is written, `run` passes every model-authored string (and every key that is
  not a lowercase schema word) through yellow-core's `cs_redact_secrets`, the
  filter `review-ledger.sh` uses. That is a list of known credential shapes, so
  an unrecognized secret can still pass. A string redaction cannot vouch for,
  including one whose whitespace-folded text still matches a shape (a token
  split across lines), is withheld, and a complete result then counts as
  incomplete. `render` then puts it on one line and escapes HTML, links, code
  spans, table pipes and `@` mentions.
- The PR's own `CLAUDE.md` files are still loaded as project memory, since the
  PR checkout is the working directory. With only read tools that can mislead
  the review but not act.

## Hunter selection

A deterministic subset of `/review:pr` Step 4 (CI has no local config, ledger or
learnings pass): at the low tier only `correctness-reviewer` and
`project-compliance-reviewer`, which is all `review-gate.js` runs there.
Otherwise the four always-on personas, plus `plugin-contract-reviewer` and
`pattern-recognition-specialist` for plugin manifests, agents, commands, skills
and hooks; `pr-test-analyzer` for test files; `security-reviewer` for shell,
hooks, plugin `lib/`, scripts and workflows; `silent-failure-hunter` for added
lines with `try`, `catch`, `except`, `rescue`, `recover`, `|| null`,
`?? undefined` or `or None`; `adversarial-reviewer` above 200 changed lines;
`architecture-strategist` for 10+ files across 3+ top-level directories. High
tier always adds `adversarial-reviewer`, `reliability-reviewer` and
`security-reviewer`. `codex-reviewer` is not used: CI has no Codex.

## CLI version

The job installs `@anthropic-ai/claude-code@2.1.316` itself instead of using
`claude-code-action` (which pins 2.1.293, not checked for plugin `workflows/`).
On 2026-11-03 a local `ci.py run` on 2.1.316 against a planted zsh `noclobber`
bug in a docs block finished in 48 s with 8 agents, waited for the workflow, and
returned it as an Important P1.

## Tests

```bash
python3 -m unittest discover scripts/ci/review-gate/tests
```

They use the eval's stand-in `claude` and a throwaway git repo, and spend
nothing.
