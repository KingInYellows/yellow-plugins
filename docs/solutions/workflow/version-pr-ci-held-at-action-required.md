---
title: 'Version Packages PR blocked: CI runs held at action_required for github-actions[bot]'
date: 2026-09-27
category: workflow
track: bug
problem: The bot-opened "chore: version packages" PR sat BLOCKED because its pull_request runs, including the required CI Status Summary, waited at action_required for maintainer approval, so the Graphite merge queue could not land it
tags: [release, changesets, github-actions, action-required, merge-queue, graphite, pat, version-packages]
components: [version-packages.yml, validate-schemas.yml, graphite-merge-queue]
---

## Symptom

PR #895 ("chore: version packages", branch `changeset-release/main`, author
`github-actions[bot]`) stayed `BLOCKED` in the Graphite merge queue although
every visible check passed. The only required status check on `main`,
`CI Status Summary`, never reported. `gh run list --branch changeset-release/main`
showed the "Validate Marketplace and CI Suite", "Lint Plugins" and
"Claude Code Review" runs with conclusion `action_required`.

## Root cause

The repository's Actions setting "Approval for running fork pull request
workflows from contributors" is `all_external_contributors`
(`gh api repos/KingInYellows/yellow-plugins/actions/permissions/fork-pr-contributor-approval`).
`version-packages.yml` opens the Version PR with `GITHUB_TOKEN`, so the PR is
authored by `github-actions[bot]`, which is not an organization member and is
treated as an external contributor. Every `pull_request` run on the PR is
therefore held until a maintainer approves it. Older docs claimed bot PRs
trigger no CI at all; the runs do exist, they are just held.

## Fix

- One-off: approve the held runs, via **Approve and run workflows** on the PR
  or `gh api -X POST repos/<owner>/<repo>/actions/runs/<run-id>/approve`.
  Approving "Validate Marketplace and CI Suite" is enough to produce
  `CI Status Summary`.
- Permanent: set the `RELEASE_PR_TOKEN` repository secret, a fine-grained PAT
  owned by a KingInYellows organization member (resource owner KingInYellows,
  this repository only, Contents + Pull requests read/write).
  `version-packages.yml` passes `secrets.RELEASE_PR_TOKEN || secrets.GITHUB_TOKEN`
  to `changesets/action`, so the PR is opened under the member's identity and
  its CI starts without approval. Unset, the workflow falls back to
  `GITHUB_TOKEN` and the approval step returns. Lifecycle (rotation,
  revocation) is in `docs/security.md` "Release PR token".

## Prevention

- A GitHub App token does not avoid the hold: the App's bot account is also
  not a member. Loosening the approval policy would lower the gate for every
  outside contributor.
- The version workflow's preflight probes the same resolved token, so an
  expired or mis-scoped `RELEASE_PR_TOKEN` fails early with a specific error;
  `force_publish` recovery runs skip it.
