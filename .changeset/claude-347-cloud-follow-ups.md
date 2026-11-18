---
'github-workflow': patch
'yellow-core': patch
---

github-workflow `merge` names the repository gh-stack would merge in and refuses
an ambiguous one, a URL for another repository, or a repository that changed
since the preview; `merge-single` reports where the head branch lives so a fork
branch is not taken for a Graphite one. yellow-core reads gh-stack prerelease
versions, and `/setup:all` checks git 2.36+ for the GitHub provider
(CLAUDE-347).
