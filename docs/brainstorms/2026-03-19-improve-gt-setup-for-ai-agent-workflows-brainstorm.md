# What We're Building

An improved `/gt-setup` command for the `gt-workflow` plugin that does two
things in sequence: (1) a guided wizard that configures the real Graphite CLI
user settings most impactful for AI agent workflows, and (2) a repo analysis
phase that generates a `.graphite.yml` convention file committed to the
repository root. The convention file is a gt-workflow artifact — not a
Graphite CLI feature — and is read by `smart-submit`, `gt-stack-plan`, and
other gt-workflow commands for repo-level behavior overrides.

### Background: What `.graphite.yml` Is Not

ChatGPT suggested a `.graphite.yml` format with `guards`, `stack.submit.restack`,
and `stack.diff.context_lines`. After verifying the Graphite CLI v1.8.2 binary,
live docs at graphite.dev/docs/configure-cli, and GitHub code search: none of
those keys exist. Graphite CLI has no `.graphite.yml` file and no guards system.
The actual Graphite config surface is two JSON files (`~/.config/graphite/user_config`
and `.git/.graphite_repo_config`) plus CLI commands under `gt user` and `gt config`.
The `.graphite.yml` we are building is our own project convention, clearly
documented as such, not a Graphite CLI feature.

## Why This Approach

The current `/gt-setup` is a read-only validator: it checks whether `gt` is
installed, authenticated, and repo-initialized, then reports pass/fail. It
configures nothing and creates nothing. For a human developer this is sufficient
— they run `gt config` interactively to set their preferences. For AI agents
operating across many repos, the gaps are:

1. **No AI-agent-aware Graphite settings.** The default `gt user` settings are
   designed for humans. Branch dates are on, no prefix is set, PR bodies do not
   include commit messages by default, and `pager` is git's default (blocks
   non-interactive runs). These defaults hurt AI agent workflows.

2. **No repo-level override mechanism.** `smart-submit`, `gt-stack-plan`, and
   `gt-amend` have hardcoded behaviors: always 3 audit agents, always submit
   non-draft, branch naming derived inline from commit messages. Teams cannot
   configure these per repo without editing command files.

3. **No PR template for stacked PRs.** Graphite reads `.github/pull_request_template.md`
   for PR body pre-fill. No template exists in most repos, so AI-generated PR
   descriptions have no structure.

Approach A (chosen) addresses all three by expanding `/gt-setup` into a wizard
that configures real settings AND generates persistent artifacts. It keeps the
existing validation phase intact as Step 1 and appends new phases.

## Key Decisions

### 1. Command structure: extend `/gt-setup` in place

The existing `gt-setup` command is 124 lines. The new version will grow to
~300-350 lines. That is within the plugin authoring line budget for multi-step
workflows with distinct phases. We do not split into two commands (`gt-setup` +
`gt-config-init`) because the onboarding experience is better as one flow and
the validation prereqs are shared.

### 2. Real Graphite settings to configure (Phase 2 of the new wizard)

Only settings that materially change AI agent behavior qualify. Applied via
`gt user` CLI commands, not by editing the JSON config files directly.

| Setting | AI-agent default | Why |
|---|---|---|
| `gt user branch-prefix --set <prefix>` | `agent/` or `<username>/` | Namespaces agent branches away from human branches; makes cleanup commands easier to scope |
| `gt user branch-date --disable` | disabled | AI agents create many branches; dates in branch names bloat names without providing useful signal when the agent controls branch lifecycle |
| `gt user restack-date --use-author-date` | enabled | Preserves original commit timestamps when Graphite restacks — important for auditing when a change was actually written vs when it was rebased |
| `gt user submit-body --include-commit-messages` | enabled | Puts commit message context in the PR body automatically — reviewers of AI-generated code benefit from seeing the full reasoning |
| `gt user pager --disable` | disabled | AI agents do not have a terminal pager; leaving it enabled causes `gt log` and other commands to hang |

All five of these are `--no-interactive`-safe (they are set-and-forget, not
interactive prompts). The wizard asks one AskUserQuestion per setting where the
choice is non-obvious (branch prefix), and applies the others silently with a
summary report.

**What we do NOT configure:**
- `gt user editor` — agents do not open editors; leave as git default
- `gt user yubikey` — never relevant for agents
- `gt user tips` — cosmetic only
- Auth token — already validated in Phase 1 (existing behavior)
- `targetTrunk` — repo-specific, not agent-specific; leave to the repo owner

### 3. Convention file: `.graphite.yml` schema

The convention file lives at `<repo-root>/.graphite.yml` and is committed to
the repository. It is parsed by gt-workflow commands using `yq` (kislyuk
variant — already present in the plugin's dependency assumptions).

**Schema (all keys optional, sane defaults when absent):**

```yaml
# gt-workflow convention file — read by smart-submit, gt-stack-plan, gt-amend
# Not a Graphite CLI feature. See: https://github.com/KingInYellows/yellow-plugins

submit:
  draft: false          # Submit PRs as draft by default (true = safer for agent PRs)
  merge_when_ready: false  # Auto-merge when all CI checks pass
  restack_before: true  # Run gt stack restack before every submit

audit:
  agents: 3             # Number of parallel audit agents in smart-submit (1-3)
  skip_on_draft: false  # Skip audit agents when submitting as draft

branch:
  prefix: "agent/"      # Override gt user branch-prefix for this repo
                        # (if set here, takes precedence over global gt user setting)

pr_template:
  create: true          # Whether gt-setup should create .github/pull_request_template.md
```

**Keys intentionally omitted:**
- CI check names to wait for — too repo-specific, not worth standardizing here
- Stack size limits — YAGNI; `gt` itself has no such concept
- `context_lines` — does not exist in Graphite and is not a gt-workflow concern

**Consumer commands (what reads `.graphite.yml`):**
- `smart-submit` — reads `submit.*`, `audit.*`, `branch.prefix`
- `gt-stack-plan` — reads `branch.prefix`
- `gt-amend` — reads `audit.agents`
- `gt-setup` — reads `pr_template.create` during Phase 3

### 4. PR template creation (Phase 3 of the wizard)

Graphite reads `.github/pull_request_template.md` for PR body pre-fill on
`gt submit`. The wizard checks whether one already exists. If not, it offers to
create one optimized for stacked PRs from AI agents.

The generated template includes:
- `## Summary` — 2-3 bullet points of what this PR does
- `## Stack context` — what branch is below this one and why (critical for stack reviewers)
- `## Test plan` — what was verified before submit
- `## Notes for reviewers` — anything the agent wants to call attention to

This template is generated as a file, not configured in `.graphite.yml`. It is
a GitHub artifact, not a gt-workflow artifact.

### 5. Existing validation phase stays unchanged (Phase 1)

The current bash check block (gt version, jq, git repo, `.graphite_repo_config`,
auth config, `gt trunk`) runs first, unchanged. If it reports failures, the
wizard stops before Phase 2. The existing "Failures (hard stop)" and "Warnings"
interpretation logic is preserved exactly.

### 6. `yq` dependency for convention file parsing

Consumers of `.graphite.yml` (smart-submit, gt-stack-plan, etc.) need `yq` to
parse the convention file. The `yq` variant check pattern from the project
memory applies: always check `yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk'`
before using `-y`/`@sh` flags. When `.graphite.yml` is absent, consumers fall
back to their built-in defaults silently. When `.graphite.yml` exists but
cannot be parsed (including because `yq` is missing), consumers emit a warning
and use defaults.

`gt-setup` Phase 2 adds `yq` to its prerequisites check and warns (but does not
block) if `yq` is missing, since the real Graphite settings in Phase 2 do not
need `yq`.

### 7. Idempotent wizard behavior

Re-running `/gt-setup` after initial setup:
- Phase 1: re-validates, reports current status (no change)
- Phase 2: reads current `gt user` settings, shows what is already configured,
  and only prompts for settings that differ from the AI-agent defaults
- Phase 3: shows "`.graphite.yml` already exists" with current contents and
  offers "Update", "Show diff", or "Skip"
- PR template phase: shows "`.github/pull_request_template.md` already exists"
  and offers "View", "Regenerate", or "Skip"

### 8. What gt-setup does NOT do

- Does not run `gt init` (user must do this; it is in the validation report)
- Does not set `gt user branch-prefix` globally without asking (it's user-global,
  so the wizard asks and confirms before running the command)
- Does not create GitHub Actions workflows (out of scope)
- Does not configure merge queue settings (Graphite merge queue is a paid
  GitHub feature, not relevant to the CLI config)
- Does not write to `.git/.graphite_repo_config` directly (only `gt` commands
  should touch that file)

## Open Questions

1. **Branch prefix choice UX.** Should the wizard offer `agent/<username>/` as
   the default (scoping further per-user) or just `agent/`? Using `<username>`
   requires reading `gh api user` or `git config user.email` — one more
   dependency. YAGNI suggests `agent/` as the flat default until multi-user
   agent setups are actually in use.

2. **`.graphite.yml` in gitignore or committed?** The file contains team-wide
   preferences (audit agent count, draft mode), so it should be committed. But
   `branch.prefix` in the convention file conflicts with the `gt user`
   branch-prefix setting which is user-global — if two developers have different
   prefixes, the committed file wins in gt-workflow commands. Decision needed
   before implementation: either (a) remove `branch.prefix` from the committed
   file and keep it user-global only, or (b) document that the committed file
   preference is the team preference.

3. **smart-submit integration complexity.** Today `smart-submit` is ~200 lines
   and has no convention file parsing. Adding `yq`-based parsing of `.graphite.yml`
   at the top adds ~15-20 lines and a `yq` variant check. This is straightforward
   but must be added carefully to avoid the "wrong yq" bug documented in project
   memory.

4. **`gt user pager --disable` is irreversible without a manual reset.** An AI
   agent running `gt-setup` on behalf of a developer who uses the pager would
   silently break their pager for all `gt` commands. This should be a prompted
   AskUserQuestion, not a silent default. Or: only suggest it as a manual step,
   not automated.
