---
title: 'Graphite Merge Queue and GitHub Native Merge Queue are mutually exclusive'
date: 2026-04-30
category: integration-issues
track: knowledge
problem: Enabling both Graphite Merge Queue and GitHub native merge queue on the same branch causes out-of-order merges, redundant CI restarts, and undefined queue behavior
tags: [graphite, merge-queue, github, branch-protection, ci, stack, incompatibility]
components: [merge-queue, gt-workflow, github-actions]
---

## Context

Graphite Merge Queue and GitHub's native merge queue are two distinct systems that each manage how PRs are combined and validated before landing on trunk. They appear superficially similar — both create speculative commits, both run CI before merge — but their internal models are incompatible at the architectural level.

Graphite explicitly documents this: the two systems must not run simultaneously on the same branch. The consequence of running both is undefined merge ordering, double CI restarts, and queue state corruption across the two systems.

This is a **deployment-time configuration decision**, not a code change. It must be made before configuring branch protection rules. An agent helping to configure a repository's merge strategy must check which system is active before making any changes.

## Guidance

### The core incompatibility

Graphite's model and GitHub's native model differ on the unit of work:

| Dimension | Graphite Merge Queue | GitHub Native Merge Queue |
|---|---|---|
| Unit of work | Stack of dependent PRs (all ancestors enqueued atomically) | Individual PRs |
| Stack awareness | First-class — speculative build covers full stack combined diff | None — each PR's speculative commit is independent |
| Bisection on batch failure | Yes — automated, isolates failing PR, re-queues passing set | No — ejects head entry only |
| Conflict handling | Lazy rebase (only conflicted PRs) + eject | Eject |
| CI skip optimization | Graphite CI optimizer step for upstack branches | `merge_group` trigger per workflow |
| API surface | REST under `/merge-queue` namespace (Graphite docs) | GraphQL (`enqueuePullRequest`, `dequeuePullRequest`, `mergeQueueEntry`) + webhooks |

When both are enabled on the same branch, each system independently creates speculative commits (`gh-readonly-queue/*` branches for GitHub, Graphite draft PRs for Graphite). CI runs against both. Merge ordering is not coordinated. If both attempt to fast-forward trunk at the same time, the second write triggers a CI restart on all remaining queued commits in the other system. The practical result is an unstable queue that thrashes CI.

### How to verify which system is active

Check branch protection for `main` (or whichever trunk branch is protected):

```bash
gh api repos/{owner}/{repo}/branches/main/protection --jq '{
  merge_queue_enabled: .required_pull_request_reviews | has("merge_queue"),
  required_checks: .required_status_checks.checks[].context
}'
```

Look for Graphite indicators:
```bash
# Graphite GitHub App installed?
gh api repos/{owner}/{repo}/installations --jq '.[].app_slug' | grep -i graphite

# Graphite bypass actor in branch protection?
gh api repos/{owner}/{repo}/branches/main/protection \
  --jq '.restrictions.apps[].slug' | grep -i graphite
```

If the Graphite GitHub App appears as a bypass actor in branch protection, Graphite Merge Queue is the authoritative queue. GitHub's native queue must be disabled.

### Disabling GitHub native merge queue when using Graphite

GitHub's native merge queue is enabled per branch protection rule. To disable it while keeping other protections intact, edit the branch protection rule in the GitHub UI (Settings → Branches → edit rule for `main`) and uncheck "Require merge queue." Do not remove other status check requirements — Graphite still depends on them.

Graphite requires its GitHub App to be listed as an authorized bypass actor in the same branch protection rule. Without this, Graphite cannot fast-forward trunk and merges will stall.

### What "out-of-band merge on main" means for Graphite

If any commit lands on `main` *outside* Graphite while PRs are queued (e.g., a direct push, a GitHub-native queue merge, or a hotfix bypassing Graphite), Graphite restarts CI on all currently-queued speculative commits against the new base. This is documented Graphite behavior — it is not an error, but it serializes all queued work and wastes CI time. The mitigation is to route all `main` writes through Graphite queue, enforce this via branch protection's push restrictions, and grant bypass only to the Graphite GitHub App.

### Graphite CI optimizer: the upstack CI gotcha

When branch protection requires CI on all base branches, Graphite upstack branches can stall with "missing required CI" errors. The fix is to add the Graphite CI optimizer step to GitHub Actions workflows. This step uses a Graphite token to conditionally skip CI on upstack branches that haven't changed relative to the speculative build.

```yaml
# In .github/workflows/ci.yml
- name: Graphite CI optimizer
  uses: withgraphite/graphite-ci-action@main
  with:
    graphite_token: ${{ secrets.GRAPHITE_TOKEN }}
```

Without this step, upstack PRs in a stack will perpetually show required checks as pending even after their speculative build passes.

**Known Graphite limitation**: GitHub deployment checks in branch protection rules are not supported by Graphite Merge Queue as of April 2026. Do not require deployment checks on a branch where Graphite is the active queue.

## Why This Matters

An agent configuring merge queue behavior for a repository must make this choice explicitly before touching branch protection rules. Getting it wrong means CI instability that is hard to attribute to a misconfiguration (the symptoms — CI restarts, queue thrashing, out-of-order merges — look like flaky CI rather than a configuration conflict).

## When to Apply

- Before configuring any merge queue integration on a new repository
- When migrating from GitHub native queue to Graphite (or vice versa)
- When diagnosing unexplained CI restarts on queued PRs
- When setting up the `merge-queue` plugin for a repository that may already have one system partially configured

## Examples

**Scenario: Migrating from GitHub native queue to Graphite**

1. Confirm the Graphite GitHub App is installed on the repository.
2. Edit branch protection for `main`: remove "Require merge queue" (disables GitHub native queue).
3. Add Graphite GitHub App as a bypass actor in the same rule.
4. Add the Graphite CI optimizer step to CI workflows.
5. Verify: enqueue one PR via Graphite dashboard; confirm the `gh-readonly-queue/*` branches are NOT created (they would be if GitHub native queue were still active).

**Scenario: Diagnosing CI restart loops**

Symptom: queued PRs repeatedly show CI restarting with base SHA changes, even when `main` hasn't had human-authored commits.

Diagnosis:
```bash
# Check for gh-readonly-queue/* branches being created
gh api repos/{owner}/{repo}/branches --jq '.[].name' | grep gh-readonly-queue
```

If these branches appear while Graphite is configured, both queues are running. Disable the native queue.
