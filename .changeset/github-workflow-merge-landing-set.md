---
'github-workflow': minor
---

Harden stack and single merges (CLAUDE-361). The `merge` preview now reads
the landing set from the Stacks REST API the way `gh stack merge` does, so a
branch that exists only on GitHub is shown, and a confirmed merge requires
the previewed `repository` and `previewToken` and is refused when the set,
a head commit, the base or the method changed. A hostless `GH_REPO` uses
gh's default host from `hosts.yml`. `merge-single` also checks the Stacks
API for stack membership, lists open pull requests built on its branch,
and lands a pull request into a release or hotfix branch only when that
base is named with `--base`.
