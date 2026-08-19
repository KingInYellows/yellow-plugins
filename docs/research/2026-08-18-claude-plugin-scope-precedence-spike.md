# Claude Code plugin-scope precedence spike

**Date:** 2026-08-18
**Verified against:** Claude Code 2.1.235
**Method:** live `claude plugin` probes against an isolated
`CLAUDE_CONFIG_DIR` (a fresh `mktemp -d`, never `~/.claude`) and several
throwaway `git init` repositories under `/tmp` (never this repository).
Every command below ran with `CLAUDE_CONFIG_DIR` pointed at the throwaway
directory; no real user configuration or real project was touched. The
throwaway environment was deleted after the spike.

Required by `GOAL.md`'s "Mandatory plugin-scope spike" before changing the
switch-planning algorithm in `planProviderSwitch()`
(`plugins/yellow-core/lib/stack-provider-state.js`).

## Setup

```
CLAUDE_CONFIG_DIR=<throwaway>  claude plugin marketplace add KingInYellows/yellow-plugins
CLAUDE_CONFIG_DIR=<throwaway>  claude plugin install gt-workflow@yellow-plugins --scope user -y
```

`gt-workflow` was used as the test plugin (it is one of the two real
`stacked-pr` providers this model classifies) against three throwaway
repos, `REPO_A`, `REPO_B` (a second, unrelated repo, for cross-project
isolation), and `REPO_C` (a third, for a clean project-scope-only test).

## Confirmed findings

### 1. Project/local settings are written to genuinely separate, per-repo files

`claude plugin disable gt-workflow@yellow-plugins --scope project` (run
from inside `REPO_A`) wrote `REPO_A/.claude/settings.json` with
`{"enabledPlugins": {"gt-workflow@yellow-plugins": false}}`. A later
`--scope local` command wrote the sibling `REPO_A/.claude/settings.local.json`.
Confirmed by direct file inspection, not by CLI output. **Project/local
scope is per-repository on disk**, exactly as assumed.

### 2. `claude plugin disable/enable --scope project|local` works WITHOUT a separate install

Disabling at `project` scope succeeded even though `gt-workflow` was only
ever installed at `user` scope in `REPO_A` — no `claude plugin install
--scope project` was required first. This is the load-bearing fact for the
fix below: **a narrower-scope override does not require installing the
plugin again at that scope.**

### 3. `claude plugin list --json`'s effective `enabled` value is CONTEXT-DEPENDENT ON CWD for override-only scopes

With `gt-workflow` enabled only at `user` scope:

- Queried from `REPO_A` immediately after `disable --scope project`
  (no separate project install exists): the single returned row still
  reports `"scope": "user"` but `"enabled": false`.
- Queried from `REPO_B` (a different repo, no override recorded there) at
  the same moment: the same plugin reports `"enabled": true`.
- Queried from outside any git repository, or from a directory unrelated
  to the override: the override is not visible.

The CLI does **not** materialize a separate, always-visible row for a
project/local override that has no accompanying explicit install at that
scope — it folds the override into the existing row's `enabled` value, but
only when queried from a location the override applies to. One observed
`notes` field made this explicit: after enabling at `project` scope while
`user` scope stayed disabled, the row printed
`"Disabled in ~/.claude/settings.json but still loads — project settings
enable it, which overrides your user setting"` — a direct, CLI-authored
confirmation that **project overrides user**.

### 4. `local` overrides `project` in the same repo

Enabling at `local` scope on top of an active `project`-scope disable (same
repo) flipped the effective state back to enabled. Combined with #3's
explicit "project overrides user" text, the observed precedence is
**local > project > user**, consistent with the scope list order Claude
Code's own docs give (`user` → `project` → `local` → `managed`, narrowest
wins other than `managed`, which is unconditional).

### 5. An EXPLICIT separate install at a scope DOES create a persistent, separately-listed row

`claude plugin install gt-workflow@yellow-plugins --scope project` (a
genuinely separate install, distinct from an enable/disable-only override)
created a second row with its own `installPath`, `installedAt`, and
`projectPath`. This row remained visible in `claude plugin list --json`
even when queried from an unrelated directory or from outside any git
repository — confirming the ORIGINAL research doc's finding that
project/local rows are **not** cwd-filtered by the CLI itself and a
consumer must filter by `projectPath` (as `summarizeProviders` already
does). This is a materially different code path from #3's override-only
case, and the two must not be conflated.

### 6. Outside a git repository

`git rev-parse --show-toplevel` fails (exit 128) as expected — the existing
`repo_root=""` fallback in the command markdown is correct.
`claude plugin list --json` itself still runs and returns whatever rows
exist (including other projects' explicitly-installed rows per #5); it
does not error outside a repository.

### 7. Foreign project rows

Confirmed again here: rows explicitly installed at `project`/`local` scope
for one repository are returned by `claude plugin list --json` regardless
of the querying cwd, each carrying its own real `projectPath`. Filtering by
`projectPath === current repo root` (the existing `summarizeProviders`
behavior) remains necessary and correct for this code path.

## The confirmed bug and its fix

`planProviderSwitch()`'s "disable every other provider" loop previously
iterated the OTHER provider's `enabledScopesRaw` and emitted a `claude
plugin disable <other> --scope <thatScope>` for each. When the other
provider is enabled ONLY via a broad `user`-scope entry (finding #3's
common case — no project/local override recorded for the current repo yet)
and the caller requested a **narrower** target scope (`project` or
`local`), the old code emitted `claude plugin disable <other> --scope
user` — which finding #3 confirms disables the other provider **globally**,
for every project, when the user only asked for a repository-scoped
switch. This is exactly the bug `GOAL.md` describes: "the current provider
planner ... may disable a user-scoped provider when a project/local switch
was requested."

**Fix** (implemented in `planProviderSwitch`, see the accompanying commit):
when the requested target `scope` is narrower than an other-provider row's
scope (i.e. target is `project`/`local` and the row is `user`), emit the
disable at the **target's** scope instead of the row's own scope — a
same-repository override, confirmed safe and effective by finding #2/#3 —
rather than touching the broader scope. When the target scope is `user`
(a genuine global switch) or the other provider's row is already at the
same or a narrower scope than the target, the original per-row behavior is
unchanged (still needed to clear same-tier-or-narrower overrides).

## Caveat not fully resolved (documented, not silently dropped)

`claude plugin list --json`'s visibility of override-only rows (finding
#3) is queried from the SAME directory the command markdown already runs
from (the repository being operated on), which is the only case this
model needs to be correct for. Whether `claude plugin list --json` also
surfaces a *just-written* override-only row when queried from that exact
directory but a fresh process invocation with no prior "known project"
registration (as opposed to a long-lived session) was not exhaustively
separated from CWD-based resolution in this spike; the observed behavior
was consistent across every probe run from the affected directory, so this
is noted as a residual uncertainty rather than a blocking gap — the
command markdown always invokes `claude plugin list --json` from the
resolved repo root via `git rev-parse --show-toplevel`, matching every
probe that showed correct results.

## Independent confirmation (parallel spike, same session)

A second, independently-run isolated-`CLAUDE_CONFIG_DIR` spike (peer agent
`scope-spike`, same date) reached the identical `local > project > user`
precedence conclusion by a stronger method: it located the literal
precedence array `["local","project","user"]` directly in the shipped CLI
binary's (minified) source at two call sites — a scope auto-detect resolver
and a per-scope-key resolver — rather than only inferring it from CLI
behavior. It also directly source-confirmed the per-scope boolean fold
(`enabledPlugins[scope] !== undefined ? enabledPlugins[scope] !== false :
defaultEnabled`). This closes the residual uncertainty above at the
mechanism level: the "folded effective boolean per directory" observed in
finding #3 is exactly the `["local","project","user"]` scan applied to each
scope's own settings file, not a caching or session-registration artifact.

One additional nuance from that spike, checked against this repo's
`planProviderSwitch()` and found NOT to affect it: `claude plugin list
--json`'s `scope` field is install provenance (which scope's install
recorded the row), not "the scope currently winning the enable/disable
fold" — a project-scope `disable` of a user-scope install leaves the row's
`scope` as `"user"` with `enabled:false`, it does not relabel the row. This
repo's implementation is unaffected because `enabledScopesRaw` (consumed by
the scope-substitution fix above) is built from `enabledEntries` — rows
already filtered to `enabled === true` — so it never needs to know *which*
scope decided the fold, only which scope(s) currently report the provider
enabled.

## Managed scope

Not independently reachable in an isolated `CLAUDE_CONFIG_DIR` (managed
settings are administrator-provisioned, not user-writable) — consistent
with the "Mandatory plugin-scope spike" instructions permitting simulated
fixtures for this case. The existing `managed-conflict.json` fixture
(hand-authored, matching the documented `claude plugin list --json` shape
for a `managed`-scope row) remains the coverage for `MANAGED_CONFLICT`;
this spike did not change that fixture or the managed-conflict logic,
which is unaffected by the scope-precedence fix above (managed conflicts
are checked before scope-tier logic runs at all).
