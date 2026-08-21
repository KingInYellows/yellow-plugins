---
'yellow-core': patch
'github-workflow': patch
'yellow-review': patch
'yellow-debt': patch
'yellow-devin': patch
---

Resolve the PR #716 review findings that survived onto main: route READY_GITHUB through the github-stack command surface in the provider router; fix flow:work's GitHub linear continuation to stage before `add`; add missing Skill tool grants (plus validator RULE 19 enforcing them); close the check-git-push space-separated `--git-dir`/`--work-tree`/`--namespace` bypass; harden skill shell transport (validated targets, NUL-delimited staging arrays, file-based commit messages, pre-staged credential review, untrusted-content fencing); resolve the stacked-PR provider before enumeration/adoption in stack-traversal, resolve-stack, and review-all; gate debt-fixer todo completion on commit AND submit success in both provider branches with affected-file path validation; and gate devin review-prs' `gt track` on READY_GRAPHITE.
