# Workflow Diagrams

Mermaid diagrams of how the marketplace's plugins work together and how a change
to this repository is validated and released. GitHub renders them inline. Each
section names the files that define the behaviour, so check those when a diagram
and the code disagree.

- [Marketplace at a glance](#marketplace-at-a-glance)
- [Stacked-PR provider selection](#stacked-pr-provider-selection)
- [Development loop (`/flow:*`)](#development-loop-flow)
- [PR review and merge gate (`/review:*`)](#pr-review-and-merge-gate-review)
- [Knowledge compounding](#knowledge-compounding)
- [Build, validation and release](#build-validation-and-release)

For the component-level architecture (catalog, generator, hooks, CI), see
[architecture-overview.md](architecture-overview.md). For a per-plugin list of
commands, see [commands-reference.md](commands-reference.md).

## Marketplace at a glance

yellow-core owns the development loop and the stack router. Every plugin that
branches, commits or submits goes through the router to whichever stacked-PR
provider is enabled, never to raw `git push` or `gh pr create`.

```mermaid
flowchart TB
  Core["yellow-core<br/>/flow:* dev loop, plan, stack and setup commands"]
  Review["yellow-review<br/>/review:pr, /review:resolve, /review:merge-ready"]
  Semgrep["yellow-semgrep<br/>/semgrep:fix"]
  Router{{"stack-provider-router<br/>(yellow-core)"}}
  GH["github-workflow<br/>/github-stack:* (recommended)"]
  GT["gt-workflow<br/>gt-workflow:* skills (Graphite, retiring)"]
  Second["Second opinions<br/>yellow-council, yellow-codex"]
  Context["Context and memory<br/>yellow-linear, yellow-ruvector,<br/>yellow-research, yellow-docs"]
  Quality["Quality and CI<br/>yellow-ci, yellow-debt, yellow-browser-test"]
  Delegates["Delegates<br/>yellow-cursor (preferred), yellow-devin (legacy),<br/>yellow-agy, yellow-jules (deprecated), yellow-goal"]
  Core -->|"Phase 5: /review:pr --report-only"| Review
  Core --> Router
  Review --> Router
  Semgrep --> Router
  Router -->|READY_GITHUB| GH
  Router -->|READY_GRAPHITE| GT
  Core -.->|stuck polish loop| Second
  Review -.->|optional cross-model reviewer| Second
  Core -.->|issue sync, recall, deeper plans| Context
  Review -.->|follow-up issues, memory| Context
```

Quality, delegate and utility plugins (`yellow-composio`, `yellow-morph`,
`yellow-claudemod`) run on their own commands. Remote delegates such as
yellow-cursor's cloud agents open their own pull requests and do not use the
router.

## Stacked-PR provider selection

`/stack:status` classifies the provider state and the `stack-provider-router`
skill routes only the two `READY_*` states. Every other state stops with the
classifier's `detail`; there is no fallback to the other provider.

Defined in `plugins/yellow-core/lib/stack-provider-state.js` (states and
precedence), `stack-tooling-probe.js`, `stack-operation-registry.js` (operation
to provider mapping) and `commands/stack/{status,select}.md`.

```mermaid
flowchart TD
  Start(["/stack:status or any routed command"]) --> Inputs
  Inputs["Read inputs:<br/>claude plugin list --json (enabled plugins, scope)<br/>.yellow-stack.yml intent<br/>tooling probe for the intended provider only"]
  Inputs --> M{"Managed-scope setting conflicts?<br/>(both enabled with one managed, managed plugin<br/>against intent, or managed-disabled but enabled)"}
  M -->|yes| S1[MANAGED_CONFLICT]
  M -->|no| C{"Both providers enabled?"}
  C -->|yes| S2[CONFLICT]
  C -->|no| I{".yellow-stack.yml parses?"}
  I -->|no| S3[CONFIG_INVALID]
  I -->|yes| X{"Intent and enabled plugin agree?"}
  X -->|"no intent, nothing enabled"| S5["UNSELECTED<br/>(recommends github)"]
  X -->|mismatch| S4[CONFIG_MISMATCH]
  X -->|yes| T{"Provider CLI ready?"}
  T -->|no| S6[PARTIAL_TOOLING]
  T -->|"yes: gt"| RG[READY_GRAPHITE]
  T -->|"yes: gh + gh-stack >= 0.3.0 + git >= 2.36"| RH[READY_GITHUB]
  T -->|"unknown: probe inconclusive"| RU["READY_* with toolingKnown false"]
  RG --> GT["gt-workflow skills<br/>gt-setup, smart-submit, gt-sync, ..."]
  RH --> GH["github-workflow commands<br/>/github-stack:submit, /github-stack:sync, ..."]
  S1 & S2 & S3 & S4 & S5 & S6 & RU --> Stop(["Stop and print detail"])
```

Switching providers is `/stack:select`, which shows its plan before acting:

```mermaid
sequenceDiagram
  actor User
  participant Select as /stack:select
  participant State as stack-provider-state.js
  participant CLI as claude plugin
  User->>Select: /stack:select github --scope project
  Select->>State: classify (current state)
  Select->>State: plan --target github
  alt plan REFUSED (for example managed conflict)
    State-->>Select: refused with detail
    Select-->>User: stop and explain
  else plan OK
    State-->>Select: ordered command list
    Select-->>User: show exact commands
    Select->>User: Apply this provider switch?
    alt declined
      Select-->>User: stop, nothing changed
    else approved
      Select->>CLI: 1. disable gt-workflow
      Select->>CLI: 2. install github-workflow (only if missing)
      Select->>CLI: 3. enable github-workflow
      Note over Select,CLI: stops at the first failed step, no retry or rollback
      Select-->>User: run /reload-plugins
      Select->>User: offer to write .yellow-stack.yml
    end
  end
```

Both providers also register a `PreToolUse` hook (`check-git-push`) and a
`PostToolUse` hook (`check-commit-message`) that warns on non-conventional
commit messages. The push hooks differ: gt-workflow's denies a raw `git push`,
because a push outside `gt submit` leaves Graphite's metadata stale.
github-workflow's allows a plain `git push` and denies only pushes that can
rewrite or delete a branch a stack builds on (force, delete or mirror pushes).

## Development loop (`/flow:*`)

Defined in `plugins/yellow-core/commands/flow/` and `commands/plan/`. Large
features go through spec and shells first; smaller ones start at brainstorm or
plan.

```mermaid
flowchart LR
  subgraph large [Large feature]
    Spec["/flow:spec<br/>plans/specs/slug.md"] --> Decompose["/flow:decompose<br/>plans/shells/*.md"]
    Decompose --> Pick["/flow:pick-next-shell<br/>runs /flow:expand-shell on the next<br/>unblocked shell, then halts"]
  end
  Brainstorm["/flow:brainstorm<br/>docs/brainstorms/"] --> Plan
  Plan["/flow:plan<br/>research agents, plans/name.md"]
  Plan -.-> Deepen["/flow:deepen-plan<br/>(yellow-research)"]
  Pick -->|fresh session| Work
  Plan --> Work
  Deepen -.-> Work
  Work["/flow:work"] --> FReview["/flow:review<br/>plan adherence, scope drift"]
  FReview --> Complete["/plan:complete<br/>archive to plans/complete/"]
  Work -.-> Compound["/flow:compound<br/>docs/solutions/"]
```

Inside `/flow:work`, the router is resolved once and every branch, commit and
submit goes through the active provider:

```mermaid
sequenceDiagram
  actor User
  participant Work as /flow:work
  participant Router as stack-provider-router
  participant Provider as Active provider
  participant Linear as yellow-linear
  participant Review as yellow-review
  User->>Work: /flow:work plans/name.md
  Work->>Work: Phase 1: read plan, optional ruvector recall, clarify
  Work->>Router: resolve provider once
  alt state is not READY_*
    Router-->>Work: detail
    Work-->>User: stop
  else READY_GITHUB or READY_GRAPHITE
    Router-->>Work: provider operations
    loop Phase 1b: each stack item, bottom-up (stack mode only)
      Work->>Provider: create branch
      Work->>Work: implement and test
      Work->>Provider: commit and submit
    end
    Work->>Work: Phase 2 execute, Phase 3 quality loop (max 3 rounds, /council when stuck)
    Work->>Provider: Phase 4 submit (/github-stack:submit or smart-submit)
    Work->>Linear: post-submit sync (native automation, else /linear:sync)
    Work->>Review: Phase 5 /review:pr --report-only
    Review-->>User: findings report
  end
```

## PR review and merge gate (`/review:*`)

Defined in `plugins/yellow-review/commands/review/`. `/review:sweep` runs
`/review:pr` then `/review:resolve` unattended; `/review:sweep-all` does that
for every open non-draft PR you authored.

```mermaid
sequenceDiagram
  actor User
  participant PR as /review:pr
  participant Risk as classify-risk
  participant Agents as Reviewer agents
  participant Router as stack-provider-router
  participant Resolve as /review:resolve
  participant Gate as /review:merge-ready
  User->>PR: /review:pr 123
  PR->>PR: clean tree check, fetch and check out PR
  PR->>Risk: tier from .github/review-risk.json on the default branch
  Risk-->>PR: low / medium / high (shown in report)
  PR->>Agents: learnings pre-pass, then always-on personas<br/>plus conditional personas picked from the diff
  Agents-->>PR: findings
  PR->>PR: confidence rubric to P0-P3, apply fixes, code-simplifier pass
  PR->>Router: commit and push through active provider
  PR-->>User: report (themes, P0-P3, verdict, risk tier)
  User->>Resolve: /review:resolve 123
  Resolve->>Agents: parallel pr-comment-resolver per comment cluster
  Resolve->>Router: commit and push fixes
  Resolve->>Resolve: reply to and resolve threads, re-pass until quiet
  User->>Gate: /review:merge-ready 123
  Gate->>Gate: threads, CHANGES_REQUESTED, CI, ledger P0-P2
  Gate->>Risk: tier at default-branch policy
  alt low
    Gate-->>User: ready (no human approval needed)
  else medium or high, review_approval_gate advisory (default)
    Gate-->>User: ready, listing any missing approval
  else medium or high, review_approval_gate enforce
    Gate-->>User: ready only with head-SHA approval or a fresh<br/>merge-approved label from an approver login
  end
```

## Knowledge compounding

Two paths write solution docs to `docs/solutions/`: the manual `/flow:compound`,
and a background staging ledger fed by yellow-core's Stop hook and by
`/review:pr`. Defined in `plugins/yellow-core/CLAUDE.md` "Compound Staging" and
the `staging-*` agents.

```mermaid
sequenceDiagram
  participant Session as Claude Code session
  participant Stop as Stop hook (yellow-core)
  participant Ledger as compound-staging/pending/
  participant Start as SessionStart hook
  participant Drain as Background drain (claude -p, haiku)
  participant Docs as docs/solutions/
  Session->>Stop: assistant finishes a response (session may stay open)
  Stop->>Ledger: write redacted pending entry (transcript tail)
  Note over Ledger: /review:pr also stages learnings
  Session->>Start: next session starts
  Start->>Start: 5+ entries or oldest over 48h, and no review lock?
  Start->>Drain: launch detached drain
  Drain->>Drain: staging-reviewer runs staging-scorer (score, filter, dedup)
  Drain->>Docs: staging-promoter writes solution doc and MEMORY.md line
  Note over Session,Docs: /compound:review-staged drains on demand
```

## Build, validation and release

How a change to this repository is generated, validated and released. Defined in
`scripts/generate-manifests.js`, `package.json` scripts,
`.github/workflows/validate-schemas.yml` and
`.github/workflows/version-packages.yml`. See
[operations/release-checklist.md](operations/release-checklist.md) for the
release runbook.

```mermaid
flowchart TD
  subgraph author [Author]
    Catalog["catalog/catalog.json<br/>catalog/plugins/name.json"]
    Pkg["plugins/name/package.json<br/>(version source of truth)"]
    Content["commands, agents, skills, hooks"]
  end
  Catalog --> Gen["pnpm generate:manifests"]
  Pkg --> Gen
  Gen --> Claude[".claude-plugin/marketplace.json<br/>plugins/name/.claude-plugin/plugin.json"]
  Gen --> CodexOut[".agents/plugins/marketplace.json<br/>.codex-plugin/ (Codex-enabled)"]
  Gen --> CursorOut[".cursor-plugin/ (Cursor-enabled)"]
  Content --> Local
  Claude --> Local
  Local["pnpm validate:schemas, validate:agents, lint:plugins,<br/>validate:versions, typecheck, test:unit, test:integration"]
  Local --> Changeset["pnpm changeset<br/>(.changeset/*.md for plugin changes)"]
  Changeset --> PRStep["Pull request"]
  PRStep --> CIJobs["CI: validate-schemas matrix, shell tests,<br/>unit and integration, build, security audit,<br/>changeset-check, eval-offline, claude-plugin-validate"]
  CIJobs --> Status{"ci-status green?"}
  Status -->|no| Local
  Status -->|yes| Main["Merge to main"]
  Main --> VP{"Pending changesets?"}
  VP -->|yes| VersionPR["changesets/action opens<br/>chore: version packages PR<br/>(changeset version + sync-manifests.js)"]
  VersionPR --> Main
  VP -->|no| TagExists{"Catalog tag already exists?"}
  TagExists -->|yes| Noop["Nothing to do, no release"]
  TagExists -->|no| Tags["release-tags.sh: name@x.y.z and v-catalog tags"]
  Tags --> Release["GitHub Release with tarball, SBOM, checksums"]
```
