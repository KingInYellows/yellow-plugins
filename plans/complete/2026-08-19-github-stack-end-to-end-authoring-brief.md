> **Archived 2026-08-19.** This was the session-scoped authoring brief for
> PR #716 (`agent/feat/github-stack-end-to-end`), originally checked in at
> the repo root as `GOAL.md`. Moved here post-implementation, per the
> `plans/complete/` archival convention, so a durable task brief isn't
> mistaken for standing project documentation. Its operating instructions
> ("do not run ultrareview," "do not merge," baseline SHAs, "when this
> task was authored") describe that session, not an ongoing policy. The
> durable design source this brief implements is
> [`plans/stacked-pr-provider-abstraction.md`](../stacked-pr-provider-abstraction.md).
> Content below is otherwise unedited from the original.

# Objective

Work in `KingInYellows/yellow-plugins` and implement the complete GitHub-native stacked-PR provider as one coherent, end-to-end pull request.

This is not a discovery-only task and must not stop after producing a plan. Perform the evidence pass, design corrections, implementation, tests, documentation, changesets, generated artifacts, draft-PR maintenance, and final validation in this session/workstream.

The final result must be one merge-ready draft PR that is suitable for a separate Claude Code `/code-review ultra <PR-number>` run.

## Baselines

- Repository: `KingInYellows/yellow-plugins`
- Required base: current `origin/main`
- Known baseline when this task was authored:
  `910b3cbdd52ae74e50ea042653f53c80d1c03094`
- Foundation PRs already merged: #712 and #713
- Initial upstream GitHub skill snapshot to revalidate:
  `github/gh-stack@ab00aa4a3f2dddc51aa65849c68b391a1b079311`
- Target branch:
  `agent/feat/github-stack-end-to-end`
- Target PR title:
  `feat(stack): complete GitHub-native authoring and provider-neutral workflows`

If `origin/main` has moved, record the new base SHA and reconcile the plan against current code before editing.

## Operating mode

1. Read completely before changing code:
   - `CLAUDE.md`
   - `AGENTS.md`
   - `CONTRIBUTING.md`
   - `plans/stacked-pr-provider-abstraction.md`
   - `docs/research/2026-08-16-github-native-stacks-vs-graphite.md`
   - `docs/solutions/code-quality/upstream-concept-fork-snapshot-protocol.md`
   - `plugins/yellow-core/CLAUDE.md`
   - `plugins/github-workflow/CLAUDE.md`
   - `plugins/gt-workflow/CLAUDE.md`
   - The provider-state implementation and tests
   - The full active workflow surfaces named below

2. Use the repository’s current Graphite workflow to create and maintain this implementation PR because the new provider does not exist in the published runtime yet.

3. This implementation itself is one ordinary feature branch directly from `main`. Do not decompose it into stacked PRs.

4. Open or update a draft PR early. Keep its body current as evidence, scope, validation, and known limitations evolve.

5. Use multiple atomic commits inside the one PR. Do not squash the work into one opaque commit during implementation.

6. Do not run ultrareview. Leave the PR ready for Brad to invoke it separately.

7. Do not switch the repository’s active provider to GitHub, uninstall Graphite, edit Brad’s real global Claude settings, or cancel any service.

8. Ask only when a live external operation would create/delete remote resources, merge PRs, alter real account-wide settings, or perform another genuinely destructive action. Use best judgment for normal code and test decisions.

## Phase 0 — Revalidate current external behavior

Before implementing operations, revalidate the current official sources:

- GitHub stacked pull request reference
- GitHub stacked PR CLI command reference
- Current `github/gh-stack` repository and first-party skill
- Claude Code plugin scopes, dependencies, enablement, and settings precedence
- Current Graphite CLI behavior for any operation for which parity is claimed

Record in a tracked research or plan-update artifact:

- Source repository and locked tag/SHA
- Snapshot date
- Relevant command and exit-code contracts
- Merge queue status
- Public-preview caveats
- Any behavior that changed since the August 16 research document
- Which upstream concepts are adopted, adapted, or rejected

Do not freehand-copy the upstream skill. Follow this repository’s upstream concept-fork snapshot protocol.

### Mandatory plugin-scope spike

The current provider planner aggregates scope rows and may disable a user-scoped provider when a project/local switch was requested.

Before changing that algorithm, run an isolated current-CLI matrix using a temporary HOME/config environment and a throwaway repository. Do not alter the real user configuration.

Measure at least:

- Provider installed/enabled at user scope
- Same provider enabled or disabled at project scope
- Same provider enabled or disabled at local scope
- Non-target provider user-enabled with target provider project-enabled
- Non-target provider user-enabled with an explicit project/local disable
- Dependency installation and enablement at each scope
- Managed-enabled and managed-disabled fixtures where they can be simulated
- `claude plugin list --json` output for each state
- Behavior outside a Git repository
- Behavior when project/local rows from another repository exist

Derive the effective-state and switch-planning model from observed behavior and official precedence—not assumptions. Preserve the fixtures or a sanitized evidence record so tests pin the contract.

## Phase 1 — Harden the provider foundation

### Intent parsing

Replace the nullable-only intent parser with an explicit result that distinguishes:

- `absent`
- `valid: graphite`
- `valid: github`
- `invalid: <fixed reason>`

Invalid cases must include:

- Existing file with no valid provider key
- Empty provider value
- Unknown provider
- Duplicate provider keys
- Malformed quoting or syntax
- Unreadable/non-regular/symlink conditions where relevant

Introduce a fixed `CONFIG_INVALID` state or an equivalently explicit hard-refusal result. Update every status, router, guard, setup, and selection consumer.

Never overwrite an existing invalid intent file as a side effect of provider selection.

### Tooling readiness

Create one dependency-free executable probe as the canonical source for:

- `gt` availability/readiness
- `gh` version
- `gh auth status`
- Exact official extension identity: `github/gh-stack`
- Missing vs wrong-owner vs unavailable probe
- Repository-level stacked-PR availability where an operation requires it

Markdown commands and skills must call this probe and render structured results. Remove duplicated readiness logic rather than leaving synchronized copies.

`READY_GITHUB` must be impossible when authentication is invalid.

### Effective scope model

Update classification and switch planning to model the provider effective in the current repository according to verified precedence.

Requirements:

- Do not disable a global provider merely because a project/local switch was requested when an effective same-repository override is sufficient.
- Do not generate mutating commands from project/local rows belonging to another repository.
- Refuse mutation when the repository root cannot be established and safe attribution is impossible.
- Managed settings remain authoritative and fail closed.
- Every generated CLI command has a validated provider, marketplace, scope, and repository association.
- Preserve raw untrusted values only internally for refusal checks; never return them in display JSON.
- Add complete state and transition fixtures.

## Phase 2 — Define a provider-operation contract

Create a fixed operation registry owned by `yellow-core`. At minimum cover:

- `setup`
- `status`
- `plan`
- `submit`
- `amend`
- `sync`
- `nav`
- `cleanup`
- `merge`

Also define whatever lower-level primitives `flow:work` needs, such as:

- resolve trunk
- inspect stack
- initialize first layer
- add a layer
- checkout a branch/layer
- commit or amend
- submit
- rebase upstack
- continue or abort conflict recovery

The registry must:

- Map each operation to one Graphite implementation and one GitHub implementation where supported.
- Represent unsupported behavior explicitly.
- Never use the other provider as fallback.
- Be validated against catalog provider declarations and real command/skill targets.
- Have deterministic integration tests.
- Remain invisible from generated plugin manifests unless the runtime genuinely requires metadata there.

Add provider-neutral commands in `yellow-core`:

- `/stack:setup`
- `/stack:status` — retain and harden
- `/stack:select` — retain and harden
- `/stack:plan`
- `/stack:submit`
- `/stack:amend`
- `/stack:sync`
- `/stack:nav`
- `/stack:cleanup`
- `/stack:merge`

Each neutral command must resolve provider state exactly once, route only on a healthy state, and report one actionable refusal for every other state.

## Phase 3 — Implement the GitHub runtime adapter

Build a dependency-free Node runtime under `plugins/github-workflow` for deterministic `gh`, `gh stack`, and required `git` execution.

Use `spawn` or `execFile` with argument arrays. Do not assemble executable shell strings from branch names, paths, remotes, PR metadata, commit subjects, or other repository-controlled values.

Validate:

- Branch names with `git check-ref-format --branch`
- Positive PR/stack numbers
- Repository-relative paths where accepted
- Remote names against `git remote`
- Fixed enum flags and merge methods
- Output sizes before returning them to model context

Return structured results containing:

- Operation
- Command identity and sanitized arguments
- Exit code
- Status enum
- Safe summary
- Bounded/fenced stdout and stderr where needed
- Recovery action
- Whether any remote/local mutation may already have occurred

Encode these current first-party constraints:

- `gh stack view --json`, never bare `view`
- `gh stack submit --auto`, with `--open` only when explicitly requested
- Explicit branch arguments for `init` and `add`
- Explicit target for `checkout`
- Never `gh stack modify`
- Never `gh stack switch`
- Never `gh pr merge` for a stack
- Explicit remote when multiple remotes exist unless `remote.pushDefault` is verified
- Noninteractive `sync` output containing `Sync aborted` is unresolved/failure even when exit code is zero
- Push and submit may be partially applied
- Exit 3: conflict recovery
- Exit 4: API/auth failure
- Exit 5: invalid invocation
- Exit 6: ambiguous stack
- Exit 7: rebase already in progress
- Exit 8: lock/retry
- Exit 9: stacked PRs unavailable
- Exit 10: modify recovery required

Remote unstack, pruning, merging, and destructive cleanup require exact confirmation.

## Phase 4 — Complete `github-workflow`

Create thin Claude command wrappers and canonical host-neutral skills for:

- `github-stack-setup`
- `github-stack-status`
- `github-stack-plan`
- `github-stack-submit`
- `github-stack-amend`
- `github-stack-sync`
- `github-stack-nav`
- `github-stack-cleanup`
- `github-stack-merge`

Reuse shared provider-neutral audit, stack-decomposition, and display contracts from `yellow-core`; do not make GitHub depend on `gt-workflow`.

Expected behavior:

### Plan

Produce the same structured `## Stack Decomposition` contract consumed by `flow:work`. Plan-only; no branches.

### Submit

Support:

- New work from trunk
- Existing tracked stack branch
- Existing ordinary branch that can be safely initialized/adopted
- Draft by default unless the user explicitly requests open/ready
- Existing PR updates
- Conventional commit generation
- Individual file staging, never blanket secret-prone staging
- Shared audit gate
- Exact partial-failure reporting

### Amend

- Amend the layer that owns the change.
- Cascade rebase upstack.
- Resubmit with `--auto`.
- Do not use the TUI-only modify command.
- Stop on conflict with exact continue/abort instructions.

### Sync

- Handle fetch/reconcile/rebase/push/refresh.
- Detect successful-exit aborts.
- Prune only behind explicit intent.
- Report before/after JSON state.

### Navigate

- Parse `view --json`.
- Support deterministic up/down/top/bottom and explicit checkout.
- No menu-only command.

### Cleanup

- Handle merged stack branches through safe sync/prune behavior.
- Preserve broader branch-audit safeguards where shared with existing cleanup.
- Never delete branches with unmerged unique commits without explicit confirmation.

### Merge

- Use `gh stack merge <target> --yes`.
- Require an explicit PR or stack target and explicit confirmation.
- Verify readiness first.
- Respect merge queue behavior.
- Do not claim atomic landing when a merge queue may split a large stack into consecutive groups; report the queued result accurately.

Add no MCP server unless empirical evidence shows a capability that the structured CLI cannot provide. The default decision is no MCP.

## Phase 5 — Preserve and register Graphite compatibility

Add `yellow-core` as a dependency of `gt-workflow` only after the neutral operation surface is implemented and validated.

Register the existing Graphite operations without removing or renaming existing commands:

- `gt-setup`
- `smart-submit`
- `gt-amend`
- `gt-stack-plan`
- `gt-sync`
- `gt-nav`
- `gt-cleanup`

For neutral merge behavior, inspect the current Graphite CLI and document the supported action. If no safe direct CLI stack-merge exists, return a structured Graphite handoff. Do not call the GitHub provider as fallback.

Move genuinely shared concepts from `gt-workflow` to `yellow-core`:

- audit-review behavior
- stack decomposition format
- stack-plan display/style

Leave forwarding compatibility or generated equivalents wherever current Claude/Codex users require the old skill identifiers.

Do not remove Graphite hooks, MCP support, commands, or Codex behavior unless an equivalent compatibility path is proven.

## Phase 6 — Migrate active provider-neutral workflows

Audit the entire current repository for direct mutating provider invocations.

Migrate active runtime surfaces, including at minimum:

- `plugins/yellow-core/commands/flow/work.md`
- `plugins/yellow-core/commands/flow/review.md`
- `plugins/yellow-core/commands/plan/complete.md`
- `plugins/yellow-review/commands/review/resolve-pr.md`
- review stack/sweep/all mutation and submission flows
- active yellow-linear workflows that submit changes
- active yellow-debt workflows that commit or submit changes
- active yellow-devin workflows that submit review fixes
- yellow-core debugging or helper workflows that route to `gt submit`
- relevant active setup/status dashboards
- root `CLAUDE.md`
- root `AGENTS.md`
- active user-facing operational guides

Do not rewrite:

- Historical plans
- Archived plans
- Changelogs
- Research passages that accurately describe historical Graphite behavior
- `gt-workflow`’s provider-owned implementation
- Tests or fixtures intentionally asserting Graphite-specific behavior

Create a static validator that rejects direct mutating `gt` or `gh stack` commands in active provider-neutral surfaces, with narrow path-and-count-based exclusions for:

- Provider implementation files
- Historical documents
- Deliberate examples owned by the matching provider
- The validator’s own fixed patterns

Avoid a broad directory allowlist that could hide future regressions.

Rewrite root authority to this contract:

- Resolve the active provider through `/stack:status`.
- Use only that provider for branch/PR stack mutations.
- Stop on unselected, conflicting, invalid, partial-tooling, or managed-conflict states.
- Never use raw `git push` or `gh pr create` as a substitute.
- Never fall back to the other provider.

Do not set repository intent to `github` in this PR. If an intent file is added, it may only preserve the verified current `graphite` intent, and the PR body must disclose that decision.

## Phase 7 — Hooks and host parity

Ensure the raw-push safety policy remains effective under either provider.

Use one canonical policy, either:

- owned by yellow-core and provider-aware, or
- consumed identically by both provider plugins.

It must block or warn on the correct unsafe forms without telling a GitHub-provider user to run `gt submit`.

Enable Codex support for `github-workflow` from the same canonical skills unless a verified platform limitation prevents it. Do not maintain a separate hand-written Codex implementation.

Generate artifacts through the repository generator. Never hand-edit generated manifests or generated Codex skill copies.

## Phase 8 — Testing

Add deterministic fake executables and fixtures for `gh`, `git`, and provider state.

Cover at minimum:

### Intent/state

- absent intent
- valid Graphite
- valid GitHub
- malformed line
- empty value
- duplicate keys
- unknown provider
- symlink/non-regular file
- auth expired
- extension wrong owner
- extension probe unavailable
- foreign project rows
- project root unavailable
- managed enable/disable
- user/project/local precedence matrix
- partial tooling
- no silent fallback

### GitHub runtime

- exact argument arrays
- branch-name rejection
- remote-name rejection
- multiple remotes
- no TUI-only command
- bounded stdout/stderr
- exit codes 1–10
- exit 0 with `Sync aborted`
- partial push/submit
- rebase conflict continue/abort
- unavailable repository feature
- stack lock
- interrupted modify state
- merge confirmation
- prune/unstack confirmation
- JSON schema changes or missing fields

### Registry and migration

- Every provider has an explicit result for every required operation.
- Every registry target resolves to a real skill/command.
- Catalog and runtime provider tables agree.
- Active neutral surfaces contain no prohibited direct provider mutations.
- Historical/provider-owned exclusions are exact.
- `flow:work` dispatches Graphite and GitHub paths correctly.
- Existing Graphite tests remain green.
- Generated manifests and Codex artifacts are byte-consistent.

Run:

```bash
pnpm install
pnpm generate:manifests
pnpm validate:generated
pnpm validate:schemas
pnpm validate:versions
pnpm test:unit
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm lint:plugins
pnpm test:lint-plugins
```

Run every affected Bats suite, including new GitHub provider tests and existing yellow-core/gt-workflow tests.

Also run:

```bash
git diff --check
git status --short
```

Create the required changesets for every modified plugin according to repository semver policy.

## Phase 9 — Live smoke test

Use an isolated local fixture first.

For any remote GitHub smoke test, obtain confirmation before creating or deleting remote resources. Prefer an existing approved sandbox repository or a temporary repository explicitly approved by Brad.

Exercise:

1. Tooling/setup readiness
2. Provider selection in an isolated Claude configuration
3. Two-layer linear stack creation
4. Draft submit
5. JSON state verification
6. Edit/amend the lower layer
7. Cascading upstack rebase
8. Resubmit
9. Sync
10. Safe merged-branch cleanup
11. Merge or merge-queue submission where repository settings permit
12. Switch back to Graphite
13. Verify Graphite commands still operate

Record sanitized commands, versions, state transitions, exit codes, and results in the PR body or a tracked validation artifact. Do not record credentials or raw sensitive paths.

## PR size gate

This PR is intentionally large but must remain within ultrareview’s default reviewable range.

Before finalizing, calculate the diff and enforce:

- No more than 450 changed files
- No more than 7,500 changed lines

Generated files count.

If the implementation approaches the gate, reduce duplication through canonical runtime/reference extraction. Do not cut tests, fail-closed behavior, active workflow migrations, or documentation needed to understand the contract.

## Required PR body

Maintain these sections:

1. Summary
2. Why one PR
3. Baseline and upstream snapshot
4. Scope-matrix evidence
5. Before/after architecture
6. Provider-operation matrix
7. GitHub noninteractive safety contract
8. Active surfaces migrated
9. Backward compatibility
10. Security boundaries
11. Test results
12. Live smoke results
13. Diff size
14. Known limitations
15. Rollback
16. Notes for ultrareview

In “Notes for ultrareview,” call attention to:

- scope precedence and provider transitions
- invalid intent handling
- managed settings
- auth/tooling classification
- command argument validation
- noninteractive/TUI avoidance
- partial remote mutations
- sync exit-zero abort
- conflict recovery
- operation registry drift
- Graphite compatibility
- direct-provider-command validator
- generated source parity

Do not include generic requests for style review.

## Completion conditions

Do not report completion until:

- The draft PR exists and targets `main`.
- Every mandatory operation is implemented or explicitly and truthfully unsupported for a provider.
- The provider-neutral workflows no longer silently assume Graphite.
- All required tests and validators pass.
- The live smoke lifecycle is recorded or clearly marked as the only externally blocked item with the exact approval/action needed.
- The diff is inside the ultrareview budget.
- The working tree is clean.
- The final response includes:
  - PR number and title
  - branch
  - base and head SHAs
  - changed files and lines
  - validation results
  - live-smoke results
  - known limitations
  - rollback procedure
  - exact ultrareview command Brad should run

Do not merge the PR and do not launch ultrareview.
