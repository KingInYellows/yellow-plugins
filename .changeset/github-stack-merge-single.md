---
'github-workflow': minor
---

Add `/github-stack:merge-single` for an ordinary, unstacked pull request. The
adapter's new `merge-single` operation takes a pull request number and an
explicit merge method, refuses a draft, a closed pull request and one GitHub
reports as part of a stack, and merges only the head commit that was confirmed.
`/github-stack:merge` now points an ordinary pull request to it instead of the
repository's merge page.
