---
'github-workflow': minor
'yellow-core': minor
---

Make GitHub-native stacked pull requests the recommended provider and bring the
integration up to `gh-stack` 0.3.0.

github-workflow: `add` no longer passes `--remote` (gh-stack rejects it), `init`
adopts existing branches bottom to top and refuses a wrong order, a new `push`
operation, `merge` reduces a pull request URL to its number, and a retargeted
base is reported as `BASE_CHANGE_UNCONFIRMED` instead of success
(`--accept-base-change` needs confirmation). The amend skill rebases the
branches above before re-submitting, submit registers an untracked branch as a
one-branch stack, the merge preview lists every pull request that will land,
and setup offers the extension upgrade.

yellow-core: the tooling probe reports `github/gh-stack` older than 0.3.0 or
Git older than 2.36 as not ready, `UNSELECTED` recommends
`/stack:select github` without selecting it, and `/setup:all` reports an
outdated extension. Adds `docs/stacked-prs-native-migration.md`.
