---
'github-workflow': minor
'gt-workflow': patch
---

github-workflow's `check-git-push` hook now allows a plain `git push` (including
`git push -u origin <branch>`) and blocks only force pushes, `--mirror` and
branch deletes, which can break a pull request stacked on the branch. A push the
hook cannot read in full is still blocked, and pushing a branch in a gh-stack
stack gets a reminder to run `/github-stack:sync`. gt-workflow's hook is
unchanged; its copy of the shared push detector gains the
`analyzeGitPushCommand` export.
