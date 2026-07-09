---
"yellow-docs": patch
---

fix: deny Write/Edit/MultiEdit on the doc-auditor agent (its `memory: project`
frontmatter auto-grants write tools) and document the read-only Bash exception
— `disallowedTools` alone cannot stop shell-routed writes, so the agent now
carries an explicit no-write-via-Bash contract limiting Bash to `git log`,
`git blame`, and `git ls-files`.
