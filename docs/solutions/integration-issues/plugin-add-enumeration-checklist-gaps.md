---
title: 'Adding a plugin or provider: cross-check hand-written enumeration checklists against validators'
date: 2026-09-29
category: integration-issues
track: knowledge
problem: Hand-written enumeration-site checklists for adding a plugin/provider miss sites the validators enforce (setup-all markers, dist drift form, literal-text pins, stale counts).
tags: [new-plugin, enumeration-sites, validate-setup-all, dist-drift, lockfile, staged-rollout, sdk-testing, planning]
components: [yellow-jules, yellow-linear, yellow-cursor, yellow-goal, scripts]
---

## Context

Expanding shell `yellow-jules-integration-02` into a plan showed that shell 01's
"PR2 enumeration-site checklist" (`docs/yellow-jules/integration-plan.md`)
missed sites that CI enforces when a plugin or provider is added. A checklist
written from the spec names the sites the spec author remembered; the
validators are the authority on what actually fails.

## Guidance

1. **Cross-check the checklist against `scripts/validate-setup-all.js`.** The
   shell 01 checklist missed three `setup/all.md` marker blocks the validator
   enforces: `setup-all-dashboard-example`, `setup-all-delegated-commands`,
   and `setup-all-plugin-command-map`.
2. **Preserve literal text pinned by bats.** `plugins/yellow-linear/tests/delegate.bats`
   pins phrases in `delegate.md`: the Step 3 heading, `resolve_plugin_root`,
   "overriding only the CONFLICT state", and `devin:delegate`. Edits that add a
   provider must keep them.
3. **Re-count plugins from `.claude-plugin/marketplace.json`.** The spec said
   20 plugins; the marketplace had 19. Count claims live at `CLAUDE.md:10`,
   `README.md:3`, and `docs/architecture-overview.md:3,60`. Spec-era counts drift.
4. **Use the untracked-aware form for committed-dist drift checks.**
   yellow-cursor's `git diff --exit-code` misses untracked files. yellow-goal's
   `test -z "$(git status --porcelain --untracked-files=all -- <dist>)"` catches
   them. A new plugin's dist check must use the yellow-goal form.
5. **Ship a lockfile for a data-dir `npm ci`.** Precedent:
   `plugins/yellow-morph/package-lock.json` plus `lib/install-morphmcp.sh`.
   `.gitignore:47` ignores `package-lock.json` globally with per-plugin
   negations. Placing it at `plugins/<name>/runtime/` keeps it out of the pnpm
   workspace, because the `plugins/*` glob matches direct children only.
   yellow-cursor's `installSdk` runs an unlocked `npm install` without
   `--ignore-scripts`, a supply-chain gap not to copy.
6. **Do not trust stale comments in provider validators.** The
   `scripts/validate-provider-groups.js` header says "currently only
   stacked-pr", but `remote-agent` is already routed. Its `ERROR-PROVIDER-*`
   codes are built by string concatenation so `scripts/lint-error-codes.js`
   does not flag literal catalog codes in `scripts/`; keep that style.

## Why This Matters

A missed enumeration site surfaces as a CI failure late in a multi-session
atomic PR, after the plan was approved. Cross-checking at planning time turns
those into plan lines.

## When to Apply

When expanding a shell or writing a plan that adds a plugin or provider, or
that consumes an earlier shell's enumeration checklist.

## Examples

### Testing a forbidden path: the R50 vs R52 tension

The spec required create/429/lost-2xx transport fixtures in the same PR that
must compile no vendor-mutating runtime path. Resolution:

- Export pure builders (`buildClientOptions`, `buildCreateSessionConfig`) and an
  error classifier from the adapter.
- Drive the pinned SDK's mutating surface only from test code, against a
  loopback fake server. The shipped runtime never calls it.
- Add a separate negative test asserting zero POST/PATCH/PUT/DELETE across
  every shipped subcommand.

General pattern: when a staged rollout forbids shipping a code path but
evidence requirements demand testing it, test the vendor surface through
exported pure config builders from test code.
