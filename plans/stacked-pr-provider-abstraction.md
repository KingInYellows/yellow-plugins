# Feature: Stacked-PR provider abstraction

## Overview

Establish the repository architecture that will eventually let a user pick
**exactly one** stacked-PR provider:

1. `gt-workflow` — Graphite (`gt`), the incumbent.
2. `github-workflow` — GitHub native stacked PRs via the official
   `github/gh-stack` extension.

This plan covers the **foundation only**. No stack creation, submission,
amendment, synchronisation, cleanup, or merging is implemented, and no
`gh stack` subcommand is invoked anywhere in the repository.

Research backing: [`docs/research/2026-08-16-github-native-stacks-vs-graphite.md`](../docs/research/2026-08-16-github-native-stacks-vs-graphite.md).
The April 2026 Graphite report
([`docs/research/graphite-merge-queue-stacked-prs-coding-agents.md`](../docs/research/graphite-merge-queue-stacked-prs-coding-agents.md))
is preserved unedited as the historical record.

## Problem Statement

GitHub shipped native stacked pull requests in **public preview** on
2026-07-30, with an official `gh` extension and an official agent skill.
This repository's entire branch/PR workflow is Graphite-only and asserted as
such in root `CLAUDE.md`, `AGENTS.md`, and `plugins/*/CLAUDE.md`.

Two futures are both plausible: GitHub native reaches GA and becomes the
default, or Graphite's stack-aware merge queue (still the more complete
product) keeps winning. Committing to either now would be a guess. What is
*not* a guess is that the two cannot run at once — Graphite's queue and
GitHub's native queue are documented as mutually exclusive on the same
branch (`docs/solutions/integration-issues/graphite-github-native-queue-incompatibility.md`),
and that incompatibility is unchanged by the preview.

So the immediate need is not a migration. It is a **seam**: a way to record
which provider a repository intends to use, to detect the runtime state
truthfully, and to refuse ambiguity loudly.

## Architecture

```text
                    ┌──────────────────────────────────┐
                    │ yellow-core (provider-neutral)   │
                    │  /stack:select   /stack:status   │
                    │  skills: stack-provider-router   │
                    │          stack-provider-guard    │
                    │  lib/stack-provider-state.js     │
                    └───────────┬──────────────────────┘
                                │ depends on: nothing
              ┌─────────────────┴─────────────────┐
              │                                   │
   ┌──────────▼──────────┐            ┌───────────▼──────────┐
   │ gt-workflow          │            │ github-workflow      │
   │ capabilityProvider:  │            │ capabilityProvider:  │
   │   group: stacked-pr  │            │   group: stacked-pr  │
   │   id:    graphite    │            │   id:    github      │
   └──────────────────────┘            └──────────────────────┘
        both MAY be installed · exactly one MAY be enabled
```

Invariants:

- `yellow-core` owns the provider-neutral `/stack:*` surface.
- `gt-workflow` and `github-workflow` are alternative providers in the
  `stacked-pr` group.
- Both may be **installed**; at most one may be **enabled**. A `READY_*`
  state requires exactly one enabled provider whose identity matches the
  recorded intent — zero enabled (`UNSELECTED`) is a valid, non-error state.
- **No silent fallback.** Ambiguity (both enabled, none enabled, intent
  mismatch, managed conflict) is reported, never guessed around.
- `yellow-core` must not depend on either provider.
- Provider state is read with `claude plugin list --json`.
- Switching uses `claude plugin install` / `enable` / `disable` followed by
  `/reload-plugins`. Settings JSON is never edited directly.
- Managed-scope conflicts **fail closed**.
- `.yellow-stack.yml` records repository *intent*; runtime enabled state
  must match it.

### Documented adjustments to the target architecture

Two deviations, both evidence-driven:

1. **`gt-workflow` does not gain a `dependencies: ["yellow-core"]` entry in
   this change.** The target says "provider plugins depend on yellow-core."
   Claude Code's dependency semantics are load-bearing: a declared
   dependency auto-enables transitively and `claude plugin enable` *fails*
   when the dependency is not installed. `gt-workflow` already ships to
   existing installs and functions standalone; adding a hard dependency
   before `/stack:*` is load-bearing would break those installs for no
   present benefit. `github-workflow` is new and therefore declares the
   dependency from day one. `gt-workflow` gains it in the shell that makes
   `/stack:*` operational.
2. **Provider mutual exclusion is enforced at runtime, not statically.**
   "Exactly one active provider is required at runtime, but both may be
   installed" is not a property a catalog file can violate, so the static
   validator cannot check it directly. It checks the structural
   preconditions (a group has ≥2 distinct members, no duplicate IDs, every
   referenced plugin exists, the setup:all provider-group section declares
   the group mutually exclusive); the runtime half is checked by the
   `CONFLICT` and `MANAGED_CONFLICT` cases in the classifier's fixture
   tests. This split is stated in the validator's header comment so nobody
   later reads the static pass as covering the runtime rule.

## Provider-state model

`plugins/yellow-core/lib/stack-provider-state.js` is a dependency-free CJS
module (plus a thin CLI) that is the **single owner** of the seven states.
The `/stack:*` command markdown calls it; the fixture tests exercise it. No
state name is defined in prose alone.

### Inputs

| Input | Source | Notes |
| --- | --- | --- |
| `plugins` | `claude plugin list --json` | flat array; `id` is `name@marketplace` |
| `projectPath` | `git rev-parse --show-toplevel` | filters foreign `project`/`local` entries |
| `intent` | `.yellow-stack.yml` `provider:` key | absent ⇒ no intent |
| `tooling` | provider CLI probes | `true`/`false`/unknown per provider |

### States (precedence order — first match wins)

| # | State | Condition |
| --- | --- | --- |
| 1 | `MANAGED_CONFLICT` | a provider is enabled at `managed` scope and something we would have to change is managed — unfixable by any command we can issue |
| 2 | `CONFLICT` | both providers enabled simultaneously |
| 3 | `CONFIG_MISMATCH` | `.yellow-stack.yml` declares an intent the runtime does not match (including "intent set, nothing enabled") |
| 4 | `UNSELECTED` | no intent recorded **and** no provider enabled |
| 5 | `PARTIAL_TOOLING` | exactly one provider enabled and consistent with intent, but its CLI tooling probe returned `false` |
| 6 | `READY_GRAPHITE` | exactly `gt-workflow` enabled, consistent with intent, tooling not known-missing |
| 7 | `READY_GITHUB` | exactly `github-workflow` enabled, consistent with intent, tooling not known-missing |

Unknown tooling (never probed) does **not** produce `PARTIAL_TOOLING`; the
result carries `toolingKnown: false` so the caller can say so rather than
implying a check that never ran.

### `.yellow-stack.yml`

Repository intent, committed by the *user's* repository — **not** by this
one. This change deliberately ships no `.yellow-stack.yml`, because writing
one would be selecting a provider.

```yaml
# .yellow-stack.yml
provider: graphite   # or: github
```

Parsing is deliberately minimal (a single anchored `provider:` line, no YAML
dependency in a shipped plugin lib). Anything else in the file is ignored;
a malformed/absent file is treated as "no intent", never as a default.

Known limitation: `parseIntent()` returns `null` for "file absent", "no
`provider:` line", and "`provider:` line present but unparseable" alike —
`classifyProviderState()` cannot tell them apart, so `/stack:status` reports
`UNSELECTED` instead of a configuration error, and `/stack:select` can offer
to write a fresh intent over a file that already had (invalid) content
without flagging that. Accepted for this foundation-only shell, not fixed
here; tracked as deferred work below.

### Switch planning

`planProviderSwitch()` returns an ordered, **unexecuted** command plan, or a
refusal. It never runs a command and never edits settings JSON. `/stack:select`
prints the plan, gets confirmation, then executes it step by step; any step
that fails aborts the remaining steps and reports — it never falls back to
the other provider.

## Catalog metadata

Catalog-only field on `catalog/plugins/<name>.json`:

```json
"capabilityProvider": { "group": "stacked-pr", "id": "graphite" }
```

It is **never emitted** into `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`, or `.codex-plugin/plugin.json`. Both
emitters build from explicit key lists rather than spreading the source, so
non-emission holds by construction — and a test pins it so a future
`{...source}` refactor fails loudly.

## Scope

### In scope (this change)

- [x] `capabilityProvider` field: schema, source-shape validation
- [x] `scripts/validate-provider-groups.js` + error codes + four CI wirings
- [x] `gt-workflow` annotated as `stacked-pr` / `graphite`
- [x] `github-workflow` skeleton (setup + status only, no MCP server)
- [x] `yellow-core`: `/stack:select`, `/stack:status`, two skills, state lib
- [x] `setup:all` + validator updated for alternative providers
- [x] Deterministic fixture tests for all ten required cases
- [x] Changesets; regenerated manifests

### Explicitly out of scope

Listed as plain bullets, not task boxes — these are non-goals, not deferred
work items, and an unchecked box here would block archival forever.

- Any `gh stack` invocation (`init`, `add`, `submit`, `push`, `sync`,
  `rebase`, `merge`)
- Changes to `flow:work`
- Changes to the root Graphite authority (`CLAUDE.md`, `AGENTS.md`)
- Removal of any `gt-workflow` command
- Branch protections, rulesets, merge queues, required checks, apps
- Uninstalling Graphite, or disabling it outside a confirmed provider switch

## Deferred work — the GitHub authoring layer

The next shell(s), gated on the evidence in the research doc:

1. **Operations mapping** — `gh stack init/add/submit/sync/rebase/merge`
   wrapped as `github-workflow` skills, mirroring `gt-workflow`'s command
   set one-for-one so `/stack:*` can dispatch either way.
2. **`gt-workflow` dependency + provider dispatch** — add
   `dependencies: ["yellow-core"]` and route `smart-submit`-class work
   through the router.
3. **`flow:work` provider awareness** — replace its hardcoded `gt` fallback
   with a router call.
4. **Root authority rewrite** — `CLAUDE.md`/`AGENTS.md` "Graphite is
   mandatory" becomes "the enabled provider is mandatory".
5. **Merge-queue story** — blocked until GitHub's stack-aware merge queue
   finishes rolling out; the two queues remain mutually exclusive.
6. **Extension-identity verification** — `gh extension list` must confirm
   the installed `gh stack` is `github/gh-stack` and not one of the three
   third-party lookalikes.
7. **Re-validate the preview surfaces** — GitHub stacked PRs, `gh skill`,
   and `gh-stack` itself were all pre-GA on 2026-08-17.
8. **Malformed-intent detection** — give `parseIntent()` a way to
   distinguish "absent" from "present but unparseable" `.yellow-stack.yml`
   so `classifyProviderState()` can report a configuration-error state
   instead of collapsing both into `UNSELECTED`, and `/stack:select` can
   refuse (or warn before) overwriting an existing-but-invalid file. Add a
   malformed-intent fixture alongside it.
