---
'yellow-core': minor
---

/plan:complete Gate C: add a file-provenance tier that runs before the strict slug-match tier. It finds the commit that most recently touched the plan file on `origin/main` and looks up the merged PR(s) GitHub associates with that commit via `gh api repos/{owner}/{repo}/commits/{sha}/pulls`; a unique match passes without prompting, recorded via a `Plan-Verifier-FileProvenance:` commit trailer. This catches the routine case where a plan was expanded from a shell and implemented in the same PR, so the branch name is derived from the feature (not the plan slug) and carries too few slug tokens for either the strict or loose slug-match tier to pass. When the provenance tier finds no commit or an ambiguous set of associated PRs, Gate C falls through to the existing strict/loose tiers unchanged.
