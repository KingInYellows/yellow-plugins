---
'gt-workflow': minor
'github-workflow': minor
---

`smart-submit` and `github-stack-submit` add a `## New concepts` section to the
commit body (and so the PR description) when a change introduces a new,
load-bearing term not already in the repo's `CONCEPTS.md` as of `HEAD`, and add
nothing for a routine change (CLAUDE-220). `smart-submit` now passes the commit
message to `gt` from a temp file and fences the staged diff as untrusted
content.
